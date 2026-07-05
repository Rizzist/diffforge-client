// Hyperframes code-driven video support.
//
// This file is `include!`d into the crate root (see lib.rs), so it shares the
// crate-root module scope. Avoid top-level `use` imports; reference standard
// library and crate items with fully-qualified paths, and keep trait imports
// function-local.
//
// Agents author plain-HTML Hyperframes compositions inside the repo at
// media/code/<slug>/index.html; the app renders them to media/generated/
// through an app-owned harness (managed Node + pinned hyperframes packages +
// chrome-headless-shell) so user repos never need node_modules.

const VIDEO_CODE_TOOLS_PROGRESS_EVENT: &str = "video-code-tools-progress";
const VIDEO_CODE_DIR: &str = "code";
const VIDEO_CODE_HYPERFRAMES_VERSION: &str = "0.7.33";
const VIDEO_CODE_NODE_VERSION: &str = "24.12.0";
const VIDEO_CODE_MIN_SYSTEM_NODE_MAJOR: u64 = 22;
const VIDEO_CODE_INSTALL_TIMEOUT_SECS: u64 = 1800;
const VIDEO_CODE_RENDER_TIMEOUT_SECS: u64 = 3600;
const VIDEO_CODE_PREVIEW_PORT_RANGE: std::ops::Range<u16> = 4620..4680;
const VIDEO_CODE_PREVIEW_READY_TIMEOUT_MS: u64 = 25_000;
const VIDEO_CODE_DEFAULT_DURATION_MS: u64 = 10_000;
const VIDEO_CODE_DEFAULT_WIDTH: u32 = 1920;
const VIDEO_CODE_DEFAULT_HEIGHT: u32 = 1080;
const VIDEO_CODE_DEFAULT_FPS: u32 = 30;

static VIDEO_CODE_INSTALL_JOBS: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<String, VideoJobHandle>>,
> = std::sync::OnceLock::new();
static VIDEO_CODE_PREVIEWS: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<String, VideoCodePreviewEntry>>,
> = std::sync::OnceLock::new();

struct VideoCodePreviewEntry {
    port: u16,
    url: String,
    child: std::sync::Arc<std::sync::Mutex<std::process::Child>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoCodeToolStatus {
    installed: bool,
    version: Option<String>,
    path: Option<String>,
    source: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoCodeToolsStatusResponse {
    installable: bool,
    ready: bool,
    hyperframes_version: String,
    node: VideoCodeToolStatus,
    harness: VideoCodeToolStatus,
    chrome: VideoCodeToolStatus,
    ffmpeg_ready: bool,
}

#[derive(Debug, Clone)]
enum VideoCodeNodeRuntime {
    /// Managed Node extracted under the app tools dir; npm invoked via npm-cli.js.
    Managed {
        node: std::path::PathBuf,
        npm_cli: std::path::PathBuf,
    },
    /// User's own Node >= 22 discovered on PATH; npm invoked via the `npm` shim.
    System {
        node: std::path::PathBuf,
        npm: Option<std::path::PathBuf>,
    },
}

impl VideoCodeNodeRuntime {
    fn node_path(&self) -> &std::path::Path {
        match self {
            VideoCodeNodeRuntime::Managed { node, .. } => node,
            VideoCodeNodeRuntime::System { node, .. } => node,
        }
    }

    fn source(&self) -> &'static str {
        match self {
            VideoCodeNodeRuntime::Managed { .. } => "managed",
            VideoCodeNodeRuntime::System { .. } => "system",
        }
    }

    fn node_bin_dir(&self) -> Option<std::path::PathBuf> {
        self.node_path().parent().map(std::path::Path::to_path_buf)
    }
}

fn video_code_root_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(video_app_tools_directory(app)?.join("hyperframes"))
}

fn video_code_node_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(video_code_root_dir(app)?.join("node"))
}

fn video_code_harness_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(video_code_root_dir(app)?.join("harness"))
}

fn video_code_chrome_path_file(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(video_code_root_dir(app)?.join("chrome-path.txt"))
}

fn video_code_node_download_url() -> Result<(String, &'static str), String> {
    let version = VIDEO_CODE_NODE_VERSION;
    let (slug, archive) = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => (format!("node-v{version}-darwin-arm64"), "tar.gz"),
        ("macos", "x86_64") => (format!("node-v{version}-darwin-x64"), "tar.gz"),
        ("linux", "aarch64") => (format!("node-v{version}-linux-arm64"), "tar.gz"),
        ("linux", "x86_64") => (format!("node-v{version}-linux-x64"), "tar.gz"),
        ("windows", "aarch64") => (format!("node-v{version}-win-arm64"), "zip"),
        ("windows", "x86_64") => (format!("node-v{version}-win-x64"), "zip"),
        (os, arch) => {
            return Err(format!(
                "Automatic Node install is not available for {os}/{arch}."
            ));
        }
    };
    Ok((
        format!("https://nodejs.org/dist/v{version}/{slug}.{archive}"),
        archive,
    ))
}

fn video_code_find_file_under(
    root: &std::path::Path,
    file_name: &str,
) -> Option<std::path::PathBuf> {
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.eq_ignore_ascii_case(file_name))
                .unwrap_or(false)
            {
                return Some(path);
            }
        }
    }
    None
}

fn video_code_node_version(node: &std::path::Path) -> Option<String> {
    let capture = run_command_capture(
        &node.to_string_lossy(),
        &["--version"],
        None,
        std::time::Duration::from_secs(10),
        None,
    )
    .ok()?;
    let text = command_output_text(&capture.stdout, &capture.stderr);
    let version = first_output_line(&text).trim().to_string();
    if version.is_empty() { None } else { Some(version) }
}

fn video_code_node_major(version: &str) -> Option<u64> {
    version
        .trim()
        .trim_start_matches('v')
        .split('.')
        .next()
        .and_then(|major| major.parse::<u64>().ok())
}

fn video_code_resolve_node(app: &tauri::AppHandle) -> Option<VideoCodeNodeRuntime> {
    if let Ok(node_dir) = video_code_node_dir(app) {
        if node_dir.is_dir() {
            if let Some(node) = video_find_executable_under(&node_dir, "node") {
                if let Some(npm_cli) = video_code_find_file_under(&node_dir, "npm-cli.js") {
                    return Some(VideoCodeNodeRuntime::Managed { node, npm_cli });
                }
            }
        }
    }
    let node = tools_binary_on_path(&video_executable_name("node"))
        .or_else(|| tools_binary_on_path("node"))?;
    let node = std::path::PathBuf::from(node);
    let version = video_code_node_version(&node)?;
    if video_code_node_major(&version)? < VIDEO_CODE_MIN_SYSTEM_NODE_MAJOR {
        return None;
    }
    let npm = tools_binary_on_path(&video_executable_name("npm"))
        .or_else(|| tools_binary_on_path("npm"))
        .map(std::path::PathBuf::from);
    Some(VideoCodeNodeRuntime::System { node, npm })
}

fn video_code_harness_installed_version(app: &tauri::AppHandle) -> Option<String> {
    let harness = video_code_harness_dir(app).ok()?;
    let manifest = harness
        .join("node_modules")
        .join("@hyperframes")
        .join("producer")
        .join("package.json");
    let raw = std::fs::read_to_string(manifest).ok()?;
    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
    value
        .get("version")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

fn video_code_scan_puppeteer_chrome() -> Option<std::path::PathBuf> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(std::path::PathBuf::from)?;
    let base = home
        .join(".cache")
        .join("puppeteer")
        .join("chrome-headless-shell");
    let mut versions: Vec<std::path::PathBuf> = std::fs::read_dir(&base)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    versions.sort();
    for version_dir in versions.into_iter().rev() {
        for platform in [
            "chrome-headless-shell-mac-arm64",
            "chrome-headless-shell-mac-x64",
            "chrome-headless-shell-linux64",
            "chrome-headless-shell-win64",
        ] {
            let binary = if platform.ends_with("win64") {
                version_dir.join(platform).join("chrome-headless-shell.exe")
            } else {
                version_dir.join(platform).join("chrome-headless-shell")
            };
            if binary.is_file() {
                return Some(binary);
            }
        }
    }
    None
}

fn video_code_chrome_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    if let Ok(path_file) = video_code_chrome_path_file(app) {
        if let Ok(raw) = std::fs::read_to_string(&path_file) {
            let stored = std::path::PathBuf::from(raw.trim());
            if stored.is_file() {
                return Some(stored);
            }
        }
    }
    video_code_scan_puppeteer_chrome()
}

fn video_code_tools_status_for(app: &tauri::AppHandle) -> VideoCodeToolsStatusResponse {
    let node_runtime = video_code_resolve_node(app);
    let node = match &node_runtime {
        Some(runtime) => VideoCodeToolStatus {
            installed: true,
            version: video_code_node_version(runtime.node_path()),
            path: Some(runtime.node_path().to_string_lossy().to_string()),
            source: Some(runtime.source().to_string()),
        },
        None => VideoCodeToolStatus {
            installed: false,
            version: None,
            path: None,
            source: None,
        },
    };
    let harness_version = video_code_harness_installed_version(app);
    let harness = VideoCodeToolStatus {
        installed: harness_version.as_deref() == Some(VIDEO_CODE_HYPERFRAMES_VERSION),
        version: harness_version,
        path: video_code_harness_dir(app)
            .ok()
            .map(|path| path.to_string_lossy().to_string()),
        source: Some("managed".to_string()),
    };
    let chrome_path = video_code_chrome_path(app);
    let chrome = VideoCodeToolStatus {
        installed: chrome_path.is_some(),
        version: None,
        path: chrome_path.map(|path| path.to_string_lossy().to_string()),
        source: Some("managed".to_string()),
    };
    let ffmpeg_ready = video_tools_status_for(app).ffmpeg.installed;
    let installable = video_code_node_download_url().is_ok();
    let ready = node.installed && harness.installed && chrome.installed;
    VideoCodeToolsStatusResponse {
        installable,
        ready,
        hyperframes_version: VIDEO_CODE_HYPERFRAMES_VERSION.to_string(),
        node,
        harness,
        chrome,
        ffmpeg_ready,
    }
}

fn video_code_emit_tools_progress(
    app: &tauri::AppHandle,
    job_id: &str,
    state: &str,
    message: &str,
    percent: Option<f64>,
    done: bool,
    error: Option<&str>,
) {
    let _ = app.emit(
        VIDEO_CODE_TOOLS_PROGRESS_EVENT,
        serde_json::json!({
            "jobId": job_id,
            "state": state,
            "message": message,
            "percent": percent,
            "done": done,
            "error": error,
        }),
    );
}

const VIDEO_CODE_HARNESS_RENDER_MJS: &str = r#"// Diff Forge Hyperframes render harness.
// Invoked as: node render.mjs --project <dir> --entry <file> --output <path> [--fps N] [--quality q]
// Emits NDJSON progress on stdout: {type:"progress",percent,stage} / {type:"done"} / {type:"error",message}.
import { createRenderJob, executeRenderJob } from "@hyperframes/producer";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function emit(payload) {
  try {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } catch {
    // stdout gone: parent died; nothing sensible to do.
  }
}

const projectDir = arg("project");
const entryFile = arg("entry", "index.html");
const outputPath = arg("output");
const fps = Number(arg("fps", "30")) || 30;
const qualityArg = arg("quality", "standard");
const quality = ["draft", "standard", "high"].includes(qualityArg) ? qualityArg : "standard";

if (!projectDir || !outputPath) {
  emit({ type: "error", message: "render.mjs requires --project and --output." });
  process.exit(2);
}

const controller = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    controller.abort();
  });
}

// Keep harness logs off stdout so the NDJSON stream stays parseable.
const quietLogger = {
  debug: () => {},
  info: () => {},
  warn: (...parts) => console.error("[hyperframes:warn]", ...parts),
  error: (...parts) => console.error("[hyperframes:error]", ...parts),
};

let lastEmittedPercent = -1;
try {
  const job = createRenderJob({ fps, quality, entryFile, logger: quietLogger });
  await executeRenderJob(
    job,
    projectDir,
    outputPath,
    (progressJob, message) => {
      const raw = Number(progressJob?.progress) || 0;
      // Producer reports 0..1; normalize defensively in case it ever reports 0..100.
      const percent = Math.max(0, Math.min(100, raw > 1 ? raw : raw * 100));
      if (percent - lastEmittedPercent >= 0.5 || progressJob?.status !== "rendering") {
        lastEmittedPercent = percent;
        emit({
          type: "progress",
          percent,
          stage: progressJob?.currentStage || progressJob?.status || "rendering",
          framesRendered: progressJob?.framesRendered ?? null,
          totalFrames: progressJob?.totalFrames ?? null,
          message: String(message || ""),
        });
      }
    },
    controller.signal,
  );
  emit({ type: "done", outputPath });
  process.exit(0);
} catch (error) {
  const cancelled = controller.signal.aborted || error?.name === "RenderCancelledError";
  emit({
    type: cancelled ? "cancelled" : "error",
    message: String(error?.message || error || "Render failed."),
  });
  process.exit(cancelled ? 3 : 1);
}
"#;

fn video_code_harness_package_json() -> String {
    format!(
        r#"{{
  "name": "diffforge-hyperframes-harness",
  "private": true,
  "type": "module",
  "dependencies": {{
    "hyperframes": "{version}",
    "@hyperframes/producer": "{version}"
  }}
}}
"#,
        version = VIDEO_CODE_HYPERFRAMES_VERSION
    )
}

fn video_code_write_harness_files(harness_dir: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(harness_dir)
        .map_err(|error| format!("Unable to create hyperframes harness directory: {error}"))?;
    std::fs::write(
        harness_dir.join("package.json"),
        video_code_harness_package_json(),
    )
    .map_err(|error| format!("Unable to write hyperframes harness package.json: {error}"))?;
    std::fs::write(
        harness_dir.join("render.mjs"),
        VIDEO_CODE_HARNESS_RENDER_MJS,
    )
    .map_err(|error| format!("Unable to write hyperframes render harness: {error}"))?;
    Ok(())
}

fn video_code_hyperframes_cli(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let cli = video_code_harness_dir(app)?
        .join("node_modules")
        .join("hyperframes")
        .join("dist")
        .join("cli.js");
    if cli.is_file() {
        Ok(cli)
    } else {
        Err("Hyperframes harness is not installed yet.".to_string())
    }
}

/// Env for harness subprocesses. Everything runs with the parent env plus these
/// overrides; render subprocesses are additionally env-scrubbed (see
/// `video_code_render_command_env`).
fn video_code_common_env(
    app: &tauri::AppHandle,
    runtime: &VideoCodeNodeRuntime,
) -> Vec<(String, String)> {
    let mut env = vec![
        ("HYPERFRAMES_NO_TELEMETRY".to_string(), "1".to_string()),
        ("DO_NOT_TRACK".to_string(), "1".to_string()),
        ("NO_COLOR".to_string(), "1".to_string()),
    ];
    if let Some(bin_dir) = runtime.node_bin_dir() {
        let current = std::env::var("PATH").unwrap_or_default();
        let separator = if cfg!(windows) { ";" } else { ":" };
        env.push((
            "PATH".to_string(),
            format!("{}{separator}{current}", bin_dir.to_string_lossy()),
        ));
    }
    let tools = video_tools_status_for(app);
    if let Some(path) = tools.ffmpeg.path {
        env.push(("HYPERFRAMES_FFMPEG_PATH".to_string(), path));
    }
    if let Some(path) = tools.ffprobe.path {
        env.push(("HYPERFRAMES_FFPROBE_PATH".to_string(), path));
    }
    if let Some(chrome) = video_code_chrome_path(app) {
        env.push((
            "PRODUCER_HEADLESS_SHELL_PATH".to_string(),
            chrome.to_string_lossy().to_string(),
        ));
    }
    env
}

async fn video_code_install_node(
    app: &tauri::AppHandle,
    job_id: &str,
    cancel: &std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<(), String> {
    let (url, archive_kind) = video_code_node_download_url()?;
    let node_dir = video_code_node_dir(app)?;
    let _ = std::fs::remove_dir_all(&node_dir);
    std::fs::create_dir_all(&node_dir)
        .map_err(|error| format!("Unable to create managed Node directory: {error}"))?;
    let downloads_dir = video_code_root_dir(app)?.join("downloads");
    std::fs::create_dir_all(&downloads_dir)
        .map_err(|error| format!("Unable to create hyperframes downloads directory: {error}"))?;
    let archive_path = downloads_dir.join(format!("node.{archive_kind}"));
    video_code_emit_tools_progress(
        app,
        job_id,
        "node",
        "Downloading Node runtime.",
        Some(5.0),
        false,
        None,
    );
    video_download_to_path(app, job_id, &url, &archive_path, cancel, "Downloading Node.").await?;
    video_code_emit_tools_progress(
        app,
        job_id,
        "node",
        "Extracting Node runtime.",
        Some(20.0),
        false,
        None,
    );
    if archive_kind == "zip" {
        video_extract_zip_file(&archive_path, &node_dir)?;
    } else {
        let cancel_for_command = cancel.clone();
        let capture = run_command_capture_with_cancel(
            "tar",
            &[
                "-xzf",
                &archive_path.to_string_lossy(),
                "-C",
                &node_dir.to_string_lossy(),
            ],
            None,
            std::time::Duration::from_secs(VIDEO_CODE_INSTALL_TIMEOUT_SECS),
            None,
            move || cancel_for_command.load(std::sync::atomic::Ordering::Acquire),
            "Hyperframes tools install was cancelled.",
        )?;
        if capture.exit_code != Some(0) {
            let detail = first_output_line(&command_output_text(&capture.stdout, &capture.stderr));
            return Err(format!("Unable to extract Node runtime: {detail}"));
        }
    }
    let _ = std::fs::remove_file(&archive_path);
    let node = video_find_executable_under(&node_dir, "node")
        .ok_or_else(|| "Node archive did not contain a node executable.".to_string())?;
    video_mark_executable(&node)?;
    Ok(())
}

async fn video_code_tools_install_worker(
    app: tauri::AppHandle,
    job_id: String,
    cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
) {
    let result = video_code_tools_install_steps(&app, &job_id, &cancel).await;
    match result {
        Ok(()) => video_code_emit_tools_progress(
            &app,
            &job_id,
            "done",
            "Hyperframes tools are ready.",
            Some(100.0),
            true,
            None,
        ),
        Err(error) if cancel.load(std::sync::atomic::Ordering::Acquire) => {
            video_code_emit_tools_progress(
                &app,
                &job_id,
                "cancelled",
                "Hyperframes tools install cancelled.",
                None,
                true,
                Some(&error),
            )
        }
        Err(error) => video_code_emit_tools_progress(
            &app,
            &job_id,
            "error",
            &error,
            None,
            true,
            Some(&error),
        ),
    }
    video_job_registry_remove(&VIDEO_CODE_INSTALL_JOBS, &job_id);
}

async fn video_code_tools_install_steps(
    app: &tauri::AppHandle,
    job_id: &str,
    cancel: &std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<(), String> {
    // 1. Node: prefer an existing system Node >= 22, otherwise download managed.
    if video_code_resolve_node(app).is_none() {
        video_code_install_node(app, job_id, cancel).await?;
    }
    let runtime = video_code_resolve_node(app)
        .ok_or_else(|| "Node runtime is unavailable after install.".to_string())?;

    // 2. Harness: pinned hyperframes packages owned by the app.
    video_code_emit_tools_progress(
        app,
        job_id,
        "harness",
        "Installing Hyperframes packages.",
        Some(35.0),
        false,
        None,
    );
    let harness_dir = video_code_harness_dir(app)?;
    video_code_write_harness_files(&harness_dir)?;
    let mut env = video_code_common_env(app, &runtime);
    // Chrome is fetched explicitly through `browser ensure` below — skip
    // puppeteer's own full-Chrome postinstall download.
    env.push(("PUPPETEER_SKIP_DOWNLOAD".to_string(), "1".to_string()));
    let npm_result = {
        let cancel_for_command = cancel.clone();
        match &runtime {
            VideoCodeNodeRuntime::Managed { node, npm_cli } => {
                run_command_capture_with_cancel_and_env(
                    &node.to_string_lossy(),
                    &[
                        &npm_cli.to_string_lossy(),
                        "install",
                        "--no-audit",
                        "--no-fund",
                    ],
                    None,
                    std::time::Duration::from_secs(VIDEO_CODE_INSTALL_TIMEOUT_SECS),
                    Some(&harness_dir),
                    &env,
                    move || cancel_for_command.load(std::sync::atomic::Ordering::Acquire),
                    "Hyperframes tools install was cancelled.",
                )?
            }
            VideoCodeNodeRuntime::System { npm, .. } => {
                let npm = npm
                    .as_ref()
                    .ok_or_else(|| "npm is not available next to the system Node.".to_string())?;
                run_command_capture_with_cancel_and_env(
                    &npm.to_string_lossy(),
                    &["install", "--no-audit", "--no-fund"],
                    None,
                    std::time::Duration::from_secs(VIDEO_CODE_INSTALL_TIMEOUT_SECS),
                    Some(&harness_dir),
                    &env,
                    move || cancel_for_command.load(std::sync::atomic::Ordering::Acquire),
                    "Hyperframes tools install was cancelled.",
                )?
            }
        }
    };
    if npm_result.exit_code != Some(0) {
        let detail = first_output_line(&command_output_text(
            &npm_result.stdout,
            &npm_result.stderr,
        ));
        return Err(format!("npm install failed: {detail}"));
    }

    // 3. Chrome headless shell via the hyperframes CLI.
    video_code_emit_tools_progress(
        app,
        job_id,
        "chrome",
        "Downloading Chrome headless shell.",
        Some(70.0),
        false,
        None,
    );
    let cli = video_code_hyperframes_cli(app)?;
    let env = video_code_common_env(app, &runtime);
    let cancel_for_command = cancel.clone();
    let ensure = run_command_capture_with_cancel_and_env(
        &runtime.node_path().to_string_lossy(),
        &[&cli.to_string_lossy(), "browser", "ensure"],
        None,
        std::time::Duration::from_secs(VIDEO_CODE_INSTALL_TIMEOUT_SECS),
        Some(&harness_dir),
        &env,
        move || cancel_for_command.load(std::sync::atomic::Ordering::Acquire),
        "Hyperframes tools install was cancelled.",
    )?;
    if ensure.exit_code != Some(0) {
        let detail = first_output_line(&command_output_text(&ensure.stdout, &ensure.stderr));
        return Err(format!("Chrome download failed: {detail}"));
    }
    let cancel_for_command = cancel.clone();
    let path_capture = run_command_capture_with_cancel_and_env(
        &runtime.node_path().to_string_lossy(),
        &[&cli.to_string_lossy(), "browser", "path"],
        None,
        std::time::Duration::from_secs(60),
        Some(&harness_dir),
        &env,
        move || cancel_for_command.load(std::sync::atomic::Ordering::Acquire),
        "Hyperframes tools install was cancelled.",
    )?;
    let chrome_line = command_output_text(&path_capture.stdout, &path_capture.stderr)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .rev()
        .find(|line| std::path::Path::new(line).is_file())
        .map(str::to_string);
    if let Some(chrome) = chrome_line {
        let path_file = video_code_chrome_path_file(app)?;
        if let Some(parent) = path_file.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        std::fs::write(&path_file, &chrome)
            .map_err(|error| format!("Unable to record Chrome path: {error}"))?;
    } else if video_code_scan_puppeteer_chrome().is_none() {
        return Err("Chrome headless shell was not found after download.".to_string());
    }
    Ok(())
}

/// Attribute scan for `data-duration` on the root composition element.
/// Static and cheap by design — the contract requires an explicit
/// data-duration on the element carrying data-composition-id.
fn video_code_parse_duration_ms(html: &str) -> Option<u64> {
    let composition_at = html.find("data-composition-id")?;
    // Scan the containing start tag: back up to '<' and forward to '>'.
    let tag_start = html[..composition_at].rfind('<')?;
    let tag_end = composition_at + html[composition_at..].find('>')?;
    let tag = &html[tag_start..tag_end];
    let duration_at = tag.find("data-duration")?;
    let after = &tag[duration_at + "data-duration".len()..];
    let after = after.trim_start();
    let after = after.strip_prefix('=')?.trim_start();
    let quote = after.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let rest = &after[1..];
    let end = rest.find(quote)?;
    let seconds: f64 = rest[..end].trim().parse().ok()?;
    if !seconds.is_finite() || seconds <= 0.0 {
        return None;
    }
    Some((seconds * 1000.0).round() as u64)
}

fn video_code_slugify_title(title: &str) -> String {
    let slug = video_slugify_with_fallback(title, "composition");
    if slug.is_empty() {
        "composition".to_string()
    } else {
        slug
    }
}

/// Scaffolds media/code/<slug>/ with index.html + AGENTS.md. Returns the
/// repo-relative path of the entry HTML. Never overwrites an existing
/// composition — a taken slug gets a numeric suffix.
fn video_code_scaffold_composition(
    root: &std::path::Path,
    media_root: &std::path::Path,
    title: &str,
    duration_ms: u64,
    width: u32,
    height: u32,
    fps: u32,
) -> Result<String, String> {
    let code_root = media_root.join(VIDEO_CODE_DIR);
    std::fs::create_dir_all(&code_root)
        .map_err(|error| format!("Unable to create media/code directory: {error}"))?;
    let base_slug = video_code_slugify_title(title);
    let mut slug = base_slug.clone();
    let mut attempt = 1u32;
    while code_root.join(&slug).exists() {
        attempt += 1;
        slug = format!("{base_slug}-{attempt}");
    }
    let dir = code_root.join(&slug);
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("Unable to create composition directory: {error}"))?;
    let duration_seconds = (duration_ms as f64 / 1000.0).max(0.1);
    let display_title = if title.trim().is_empty() {
        slug.clone()
    } else {
        title.trim().to_string()
    };
    let index_html = format!(
        r#"<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width={width}, height={height}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * {{ margin: 0; padding: 0; box-sizing: border-box; }}
      html, body {{
        width: {width}px;
        height: {height}px;
        overflow: hidden;
        background: #05070c;
        font-family: "Inter", sans-serif;
      }}
      .title {{
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        color: #e8eefc;
        font-size: 96px;
        font-weight: 800;
        letter-spacing: -0.02em;
      }}
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="{duration_seconds}"
      data-width="{width}"
      data-height="{height}"
      data-fps="{fps}"
    >
      <h1 class="clip title" data-start="0" data-duration="{duration_seconds}" data-track-index="1">
        {display_title}
      </h1>
    </div>
    <script>
      // GSAP timelines animate the composition; Hyperframes seeks them per frame.
      const tl = gsap.timeline();
      tl.from(".title", {{ opacity: 0, y: 60, scale: 0.94, duration: 1.2, ease: "power3.out" }});
    </script>
  </body>
</html>
"#
    );
    std::fs::write(dir.join("index.html"), index_html)
        .map_err(|error| format!("Unable to write composition index.html: {error}"))?;
    let agents_md = format!(
        r#"# Hyperframes composition: {display_title}

This folder holds a code-driven video composition rendered by Diff Forge's
video editor (Hyperframes v{version}, HTML-based — https://hyperframes.heygen.com).

Contract:
- `index.html` is the entry. The root element declares `data-composition-id`,
  `data-width`, `data-height`, and **`data-duration` (seconds) — keep it
  accurate**; the editor's timeline placeholder uses it before the render lands.
- Timed elements use `class="clip"` with `data-start` / `data-duration`
  (seconds, relative to the composition) and `data-track-index`.
- Animate with GSAP timelines, CSS/WAAPI animations, or Lottie — Hyperframes
  seeks them deterministically per frame at render time.
- Media (video/img/audio) referenced with relative paths inside this folder
  renders fine; avoid runtime network fetches beyond the pinned CDN script tags.

Render loop: edit this file, then call the `video_generate` MCP tool with
`action: "render"` and this composition's jobId (or ask the user to press
Render in the Generate panel). The rendered mp4 lands in `media/generated/`
and any timeline placeholder clip resolves automatically.
"#,
        version = VIDEO_CODE_HYPERFRAMES_VERSION,
    );
    let _ = std::fs::write(dir.join("AGENTS.md"), agents_md);
    Ok(video_relative_path(root, &dir.join("index.html")))
}

/// Env scrub for render/preview subprocesses running agent-authored code:
/// start from a minimal whitelist instead of the app's full environment.
fn video_code_render_command_env(
    app: &tauri::AppHandle,
    runtime: &VideoCodeNodeRuntime,
) -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = Vec::new();
    let inherit: &[&str] = if cfg!(windows) {
        &[
            "SYSTEMROOT",
            "SYSTEMDRIVE",
            "WINDIR",
            "COMSPEC",
            "TEMP",
            "TMP",
            "USERPROFILE",
            "APPDATA",
            "LOCALAPPDATA",
            "PROGRAMDATA",
            "NUMBER_OF_PROCESSORS",
        ]
    } else {
        &["HOME", "TMPDIR", "LANG", "LC_ALL", "USER", "SHELL"]
    };
    for key in inherit {
        if let Ok(value) = std::env::var(key) {
            env.push((key.to_string(), value));
        }
    }
    let base_path = if cfg!(windows) {
        std::env::var("PATH").unwrap_or_default()
    } else {
        "/usr/bin:/bin:/usr/sbin:/sbin".to_string()
    };
    let path = match runtime.node_bin_dir() {
        Some(bin_dir) => {
            let separator = if cfg!(windows) { ";" } else { ":" };
            format!("{}{separator}{base_path}", bin_dir.to_string_lossy())
        }
        None => base_path,
    };
    env.push(("PATH".to_string(), path));
    env.push(("HYPERFRAMES_NO_TELEMETRY".to_string(), "1".to_string()));
    env.push(("DO_NOT_TRACK".to_string(), "1".to_string()));
    env.push(("NO_COLOR".to_string(), "1".to_string()));
    let tools = video_tools_status_for(app);
    if let Some(path) = tools.ffmpeg.path {
        env.push(("HYPERFRAMES_FFMPEG_PATH".to_string(), path));
    }
    if let Some(path) = tools.ffprobe.path {
        env.push(("HYPERFRAMES_FFPROBE_PATH".to_string(), path));
    }
    if let Some(chrome) = video_code_chrome_path(app) {
        env.push((
            "PRODUCER_HEADLESS_SHELL_PATH".to_string(),
            chrome.to_string_lossy().to_string(),
        ));
    }
    env
}

fn video_code_ready_error(status: &VideoCodeToolsStatusResponse) -> Option<String> {
    if status.ready && status.ffmpeg_ready {
        return None;
    }
    let mut missing = Vec::new();
    if !status.node.installed {
        missing.push("Node >= 22");
    }
    if !status.harness.installed {
        missing.push("Hyperframes packages");
    }
    if !status.chrome.installed {
        missing.push("Chrome headless shell");
    }
    if !status.ffmpeg_ready {
        missing.push("ffmpeg");
    }
    Some(format!(
        "Hyperframes render tools missing: {}. Install them from the Video Editor's Generate → Code tab (video tools + hyperframes tools install).",
        missing.join(", ")
    ))
}

/// Runs the harness render subprocess to completion, streaming NDJSON
/// progress into `on_progress(percent_0_100, stage, message)`.
fn video_code_render_blocking(
    app: &tauri::AppHandle,
    project_dir: &std::path::Path,
    entry_file: &str,
    output_abs: &std::path::Path,
    fps: u32,
    quality: &str,
    cancel: &std::sync::Arc<std::sync::atomic::AtomicBool>,
    on_progress: &mut dyn FnMut(f64, &str, &str),
) -> Result<(), String> {
    let status = video_code_tools_status_for(app);
    if let Some(error) = video_code_ready_error(&status) {
        return Err(error);
    }
    let runtime = video_code_resolve_node(app)
        .ok_or_else(|| "Node runtime is unavailable for the hyperframes render.".to_string())?;
    let harness_dir = video_code_harness_dir(app)?;
    let render_mjs = harness_dir.join("render.mjs");
    if !render_mjs.is_file() {
        video_code_write_harness_files(&harness_dir)?;
    }
    if let Some(parent) = output_abs.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Unable to create render output directory: {error}"))?;
    }
    let env = video_code_render_command_env(app, &runtime);
    let mut command = std::process::Command::new(runtime.node_path());
    command
        .arg(&render_mjs)
        .arg("--project")
        .arg(project_dir)
        .arg("--entry")
        .arg(entry_file)
        .arg("--output")
        .arg(output_abs)
        .arg("--fps")
        .arg(fps.to_string())
        .arg("--quality")
        .arg(quality)
        .current_dir(&harness_dir)
        .env_clear()
        .envs(env.iter().map(|(key, value)| (key.clone(), value.clone())))
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Unable to start hyperframes render: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Unable to read hyperframes render output.".to_string())?;
    let stderr = child.stderr.take();

    // Drain stderr on a side thread so the child can't block on a full pipe;
    // keep a small tail for diagnostics.
    let stderr_tail = std::sync::Arc::new(std::sync::Mutex::new(
        std::collections::VecDeque::<String>::new(),
    ));
    let stderr_tail_writer = stderr_tail.clone();
    let stderr_thread = stderr.map(|stderr| {
        std::thread::spawn(move || {
            use std::io::BufRead as _;
            let reader = std::io::BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                if let Ok(mut tail) = stderr_tail_writer.lock() {
                    tail.push_back(line);
                    while tail.len() > 20 {
                        tail.pop_front();
                    }
                }
            }
        })
    });

    let started_at = std::time::Instant::now();
    let mut reported_error: Option<String> = None;
    let mut saw_done = false;
    {
        use std::io::BufRead as _;
        let reader = std::io::BufReader::new(stdout);
        for line in reader.lines() {
            if cancel.load(std::sync::atomic::Ordering::Acquire) || app_shutdown_requested() {
                let _ = child.kill();
                break;
            }
            if started_at.elapsed().as_secs() > VIDEO_CODE_RENDER_TIMEOUT_SECS {
                let _ = child.kill();
                reported_error = Some("Hyperframes render timed out.".to_string());
                break;
            }
            let Ok(line) = line else {
                break;
            };
            let Ok(payload) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };
            match payload.get("type").and_then(serde_json::Value::as_str) {
                Some("progress") => {
                    let percent = payload
                        .get("percent")
                        .and_then(serde_json::Value::as_f64)
                        .unwrap_or(0.0)
                        .clamp(0.0, 100.0);
                    let stage = payload
                        .get("stage")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("rendering");
                    let message = payload
                        .get("message")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("");
                    on_progress(percent, stage, message);
                }
                Some("done") => {
                    saw_done = true;
                }
                Some("error") | Some("cancelled") => {
                    let message = payload
                        .get("message")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("Render failed.")
                        .to_string();
                    reported_error = Some(message);
                }
                _ => {}
            }
        }
    }
    let exit = child
        .wait()
        .map_err(|error| format!("Unable to wait for hyperframes render: {error}"))?;
    if let Some(thread) = stderr_thread {
        let _ = thread.join();
    }
    if cancel.load(std::sync::atomic::Ordering::Acquire) {
        return Err("Hyperframes render cancelled.".to_string());
    }
    if saw_done && exit.success() && output_abs.is_file() {
        return Ok(());
    }
    if let Some(error) = reported_error {
        return Err(format!("Hyperframes render failed: {error}"));
    }
    let tail = stderr_tail
        .lock()
        .ok()
        .map(|tail| tail.iter().cloned().collect::<Vec<_>>().join(" | "))
        .unwrap_or_default();
    if tail.is_empty() {
        Err("Hyperframes render exited without producing output.".to_string())
    } else {
        Err(format!("Hyperframes render failed: {tail}"))
    }
}

fn video_code_previews()
-> &'static std::sync::Mutex<std::collections::HashMap<String, VideoCodePreviewEntry>> {
    VIDEO_CODE_PREVIEWS.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

fn video_code_preview_key(project_dir: &std::path::Path) -> String {
    project_dir.to_string_lossy().to_string()
}

fn video_code_child_is_running(child: &std::sync::Arc<std::sync::Mutex<std::process::Child>>) -> bool {
    child
        .lock()
        .ok()
        .map(|mut child| matches!(child.try_wait(), Ok(None)))
        .unwrap_or(false)
}

fn video_code_pick_preview_port() -> Result<u16, String> {
    for port in VIDEO_CODE_PREVIEW_PORT_RANGE {
        if std::net::TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Ok(port);
        }
    }
    Err("No free port available for the hyperframes preview server.".to_string())
}

fn video_code_preview_wait_ready(port: u16) -> bool {
    let deadline = std::time::Instant::now()
        + std::time::Duration::from_millis(VIDEO_CODE_PREVIEW_READY_TIMEOUT_MS);
    while std::time::Instant::now() < deadline {
        if std::net::TcpStream::connect_timeout(
            &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
            std::time::Duration::from_millis(500),
        )
        .is_ok()
        {
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    false
}

/// Starts (or reuses) a hyperframes Studio preview server for a composition
/// directory. Returns { url, port }.
fn video_code_preview_start_blocking(
    app: &tauri::AppHandle,
    project_dir: &std::path::Path,
) -> Result<serde_json::Value, String> {
    let key = video_code_preview_key(project_dir);
    if let Ok(previews) = video_code_previews().lock() {
        if let Some(entry) = previews.get(&key) {
            if video_code_child_is_running(&entry.child) {
                return Ok(serde_json::json!({ "url": entry.url, "port": entry.port }));
            }
        }
    }
    let status = video_code_tools_status_for(app);
    if let Some(error) = video_code_ready_error(&status) {
        return Err(error);
    }
    let runtime = video_code_resolve_node(app)
        .ok_or_else(|| "Node runtime is unavailable for the hyperframes preview.".to_string())?;
    let cli = video_code_hyperframes_cli(app)?;
    let port = video_code_pick_preview_port()?;
    let env = video_code_render_command_env(app, &runtime);
    let mut command = std::process::Command::new(runtime.node_path());
    command
        .arg(&cli)
        .arg("preview")
        .arg(project_dir)
        .arg("--port")
        .arg(port.to_string())
        .arg("--no-open")
        .arg("--force-new")
        .current_dir(project_dir)
        .env_clear()
        .envs(env.iter().map(|(key, value)| (key.clone(), value.clone())))
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let child = command
        .spawn()
        .map_err(|error| format!("Unable to start hyperframes preview: {error}"))?;
    let child = std::sync::Arc::new(std::sync::Mutex::new(child));
    if !video_code_preview_wait_ready(port) {
        if let Ok(mut child) = child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
        return Err("Hyperframes preview server did not start in time.".to_string());
    }
    let url = format!("http://127.0.0.1:{port}");
    if let Ok(mut previews) = video_code_previews().lock() {
        previews.insert(
            key,
            VideoCodePreviewEntry {
                port,
                url: url.clone(),
                child,
            },
        );
    }
    Ok(serde_json::json!({ "url": url, "port": port }))
}

fn video_code_preview_stop_entry(entry: &VideoCodePreviewEntry) {
    if let Ok(mut child) = entry.child.lock() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn video_code_preview_stop_for(project_dir: &std::path::Path) {
    let key = video_code_preview_key(project_dir);
    if let Ok(mut previews) = video_code_previews().lock() {
        if let Some(entry) = previews.remove(&key) {
            video_code_preview_stop_entry(&entry);
        }
    }
}

fn video_code_preview_stop_all() {
    if let Ok(mut previews) = video_code_previews().lock() {
        for (_key, entry) in previews.drain() {
            video_code_preview_stop_entry(&entry);
        }
    }
}

/// Resolves a repo-relative composition source path (media/code/...) to its
/// absolute project directory + entry file name, verifying containment.
fn video_code_resolve_source(
    root: &std::path::Path,
    media_root: &std::path::Path,
    source_path: &str,
) -> Result<(std::path::PathBuf, String), String> {
    let normalized = video_normalize_relative_path(source_path)?;
    let abs = root.join(&normalized);
    let code_root = media_root.join(VIDEO_CODE_DIR);
    if !abs.starts_with(&code_root) {
        return Err("Composition sources must live under media/code/.".to_string());
    }
    if !abs.is_file() {
        return Err(format!(
            "Composition source not found: {source_path}. Write the HTML file first."
        ));
    }
    let entry = abs
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("index.html")
        .to_string();
    let project_dir = abs
        .parent()
        .map(std::path::Path::to_path_buf)
        .ok_or_else(|| "Composition source has no parent directory.".to_string())?;
    Ok((project_dir, entry))
}

#[tauri::command]
async fn video_code_tools_status(
    app: tauri::AppHandle,
) -> Result<VideoCodeToolsStatusResponse, String> {
    tauri::async_runtime::spawn_blocking(move || video_code_tools_status_for(&app))
        .await
        .map_err(|error| format!("Unable to read hyperframes tools status: {error}"))
}

#[tauri::command]
async fn video_code_tools_install(app: tauri::AppHandle) -> Result<VideoJobStartResult, String> {
    let (job_id, cancel) = video_job_registry_insert(&VIDEO_CODE_INSTALL_JOBS)?;
    tauri::async_runtime::spawn(video_code_tools_install_worker(
        app,
        job_id.clone(),
        cancel,
    ));
    Ok(VideoJobStartResult { job_id })
}

#[tauri::command]
fn video_code_tools_install_cancel(job_id: String) -> Result<(), String> {
    video_job_registry_cancel(&VIDEO_CODE_INSTALL_JOBS, &job_id)
}

#[tauri::command]
async fn video_code_preview_start(
    app: tauri::AppHandle,
    repo_path: String,
    source_path: String,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        let (project_dir, _entry) = video_code_resolve_source(&root, &media_root, &source_path)?;
        video_code_preview_start_blocking(&app, &project_dir)
    })
    .await
    .map_err(|error| format!("Unable to start hyperframes preview: {error}"))?
}

#[tauri::command]
async fn video_code_preview_stop(repo_path: String, source_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
        // Resolve leniently: stopping a preview for a deleted source should
        // still work, so fall back to the raw joined path on resolve errors.
        match video_code_resolve_source(&root, &media_root, &source_path) {
            Ok((project_dir, _entry)) => video_code_preview_stop_for(&project_dir),
            Err(_) => {
                if let Ok(normalized) = video_normalize_relative_path(&source_path) {
                    if let Some(parent) = root.join(normalized).parent() {
                        video_code_preview_stop_for(parent);
                    }
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("Unable to stop hyperframes preview: {error}"))?
}
