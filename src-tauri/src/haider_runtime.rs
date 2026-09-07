//! Explicit, user-scoped desktop runtime setup. Nothing calls these doors at app startup.
//! GitHub is public/unauthenticated; no credential stores or signing material are used.
//! Unix installs the release's `haider` + `haiderd` pair in ~/.local/bin. Windows
//! uses %LOCALAPPDATA%\haider\bin. Android APK installation is deliberately excluded.
//! Blocking HTTP, archive, filesystem and child-process work runs on Tauri's worker pool.

use std::{
    cmp::Ordering,
    fs::{self, File},
    io::{self, BufReader, Read, Seek, SeekFrom, Write},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering as AtomicOrdering},
        Mutex,
    },
    time::{Duration, Instant},
};

use reqwest::blocking::{Client, Response};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tempfile::{NamedTempFile, TempDir};

const RELEASE_API: &str = "https://api.github.com/repos/Rizzist/haider-agent/releases/latest";
const MAX_ARCHIVE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_UNPACKED_BYTES: u64 = 1024 * 1024 * 1024;
static LATEST: Mutex<Option<String>> = Mutex::new(None);
static MUTATING: AtomicBool = AtomicBool::new(false);

type Result<T> = std::result::Result<T, RuntimeError>;

#[derive(Debug, Clone, Serialize)]
pub struct RuntimeError {
    pub code: &'static str,
    pub message: String,
    pub retryable: bool,
}

impl RuntimeError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            retryable: matches!(code, "network" | "rate_limited" | "busy"),
        }
    }
}

impl From<io::Error> for RuntimeError {
    fn from(_: io::Error) -> Self {
        // Do not echo subprocess output, URLs, environment, or OS paths from errors.
        Self::new("io", "Runtime filesystem or process operation failed")
    }
}

#[derive(Debug, Serialize)]
pub struct RuntimeStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub running: bool,
    pub install_path: String,
    pub latest_known: Option<String>,
    /// Unknown until both the installed executable and GitHub supplied a version.
    pub update_available: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct InstallResult {
    pub installed_version: String,
    pub path: String,
    /// A running daemon is never stopped or restarted by the installer.
    pub restart_needed: bool,
}

#[derive(Debug, Serialize)]
pub struct StartResult {
    /// True only after a newly spawned process is live and its endpoint is reachable.
    /// Already running is { started: false, error: null }.
    pub started: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct InstallProgress {
    pub phase: &'static str,
    /// Decimal strings preserve u64 precision across Tauri/JavaScript.
    pub downloaded_bytes: String,
    pub total_bytes: Option<String>,
}

fn progress(emit: &impl Fn(InstallProgress), phase: &'static str, bytes: u64, total: Option<u64>) {
    emit(InstallProgress {
        phase,
        downloaded_bytes: bytes.to_string(),
        total_bytes: total.map(|v| v.to_string()),
    });
}

#[derive(Clone, Copy, Debug)]
struct Platform {
    target: &'static str,
    extension: &'static str,
    windows: bool,
}

fn platform(os: &str, arch: &str) -> Result<Platform> {
    let target = match (os, arch) {
        ("macos", "aarch64") => "aarch64-apple-darwin",
        ("macos", "x86_64") => "x86_64-apple-darwin",
        ("linux", "x86_64") => "x86_64-unknown-linux-gnu",
        ("linux", "aarch64") => "aarch64-unknown-linux-gnu",
        ("windows", "x86_64") => "x86_64-pc-windows-msvc",
        _ => {
            return Err(RuntimeError::new(
                "unsupported_platform",
                "No desktop Haider runtime for this platform",
            ))
        }
    };
    Ok(Platform {
        target,
        extension: if os == "windows" { "zip" } else { "tar.xz" },
        windows: os == "windows",
    })
}

fn current_platform() -> Result<Platform> {
    platform(std::env::consts::OS, std::env::consts::ARCH)
}

fn install_path_for(platform: Platform, user_root: &Path) -> Result<PathBuf> {
    if !user_root.is_absolute()
        || user_root
            .components()
            .any(|c| matches!(c, Component::ParentDir))
    {
        return Err(RuntimeError::new(
            "unsafe_path",
            "Runtime install root must be an absolute user directory",
        ));
    }
    Ok(if platform.windows {
        user_root.join("haider/bin/haider.exe")
    } else {
        user_root.join(".local/bin/haider")
    })
}

fn install_path() -> Result<PathBuf> {
    let platform = current_platform()?;
    let root = std::env::var_os(if platform.windows {
        "LOCALAPPDATA"
    } else {
        "HOME"
    })
    .filter(|p| !p.is_empty())
    .ok_or_else(|| RuntimeError::new("unavailable", "User install directory is unavailable"))?;
    install_path_for(platform, Path::new(&root))
}

fn daemon_path(path: &Path, platform: Platform) -> PathBuf {
    path.with_file_name(if platform.windows {
        "haiderd.exe"
    } else {
        "haiderd"
    })
}

/// Resolve existing ancestors, including symlinks, before checking checkout containment.
fn outside_checkout(path: &Path) -> Result<()> {
    if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(RuntimeError::new(
            "unsafe_path",
            "Runtime files require an absolute path outside checkouts",
        ));
    }
    let existing = path
        .ancestors()
        .find(|p| p.exists())
        .ok_or_else(|| RuntimeError::new("unsafe_path", "No existing install ancestor"))?
        .canonicalize()?;
    if existing.ancestors().any(|p| p.join(".git").exists()) {
        return Err(RuntimeError::new(
            "unsafe_path",
            "Runtime files must remain outside Git checkouts",
        ));
    }
    Ok(())
}

fn staging_directory() -> Result<TempDir> {
    let root = std::env::temp_dir();
    outside_checkout(&root)?;
    Ok(tempfile::Builder::new()
        .prefix("diffforge-haider-")
        .tempdir_in(root)?)
}

fn parse_version(text: &str) -> Option<Version> {
    Version::parse(text.trim().strip_prefix('v').unwrap_or(text.trim())).ok()
}

fn compare_versions(installed: &str, latest: &str) -> Option<Ordering> {
    Some(parse_version(installed)?.cmp_precedence(&parse_version(latest)?))
}

fn version_from_output(output: &str, binary: &str) -> Option<String> {
    let mut words = output.split_whitespace();
    if words.next()? != binary {
        return None;
    }
    let raw = words.next()?;
    let version = parse_version(raw)?;
    Some(version.to_string())
}

fn binary_version(path: &Path, binary: &str) -> Option<String> {
    // A file-backed stdout avoids a full pipe deadlocking wait and bounds what is read.
    let dir = staging_directory().ok()?;
    let mut output = NamedTempFile::new_in(dir.path()).ok()?;
    let mut command = Command::new(path);
    command
        .arg("--version")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .stdout(output.reopen().ok()?);
    hide_console(&mut command);
    let mut child = command.spawn().ok()?;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(_)) => return None,
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(25)),
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let mut text = String::new();
    output.seek(SeekFrom::Start(0)).ok()?;
    output.take(4097).read_to_string(&mut text).ok()?;
    if text.len() > 4096 {
        return None;
    }
    version_from_output(&text, binary)
}

fn hide_console(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW, version probe only.
    }
    #[cfg(not(windows))]
    let _ = command;
}

fn runtime_endpoint() -> Result<PathBuf> {
    #[cfg(windows)]
    let path = crate::haider_rpc_ade::runtime_pipe_path();
    #[cfg(not(windows))]
    let path = crate::haider_rpc_ade::resolve_socket_path();
    path.ok_or_else(|| RuntimeError::new("unavailable", "Haider endpoint cannot be resolved"))
}

fn daemon_running() -> Result<bool> {
    let observed = resolved_endpoint_running();
    if matches!(observed, Ok(true)) {
        return observed;
    }
    // New releases can move the deterministic Unix endpoint. Ask the installed
    // CLI's own resolver/handshake without spawning, reading its JSON, or changing
    // the ADE's existing discovery surfaces. Success is an observed live daemon.
    if install_path().is_ok_and(|path| no_spawn_status(&path)) {
        return Ok(true);
    }
    observed
}

fn no_spawn_status(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    let mut command = Command::new(path);
    command
        .args(["status", "--json", "--no-spawn"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    hide_console(&mut command);
    let Ok(mut child) = command.spawn() else {
        return false;
    };
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(25)),
            _ => {
                // Only the read-only CLI probe is terminated, never a daemon.
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
        }
    }
}

fn resolved_endpoint_running() -> Result<bool> {
    let path = runtime_endpoint()?;
    #[cfg(unix)]
    let connection = std::os::unix::net::UnixStream::connect(path);
    #[cfg(windows)]
    let connection = fs::OpenOptions::new().read(true).write(true).open(path);
    #[cfg(not(any(unix, windows)))]
    let connection: io::Result<()> = Err(io::Error::from(io::ErrorKind::Unsupported));
    match connection {
        Ok(_) => Ok(true),
        #[cfg(windows)]
        Err(error) if error.raw_os_error() == Some(231) => Ok(true), // ERROR_PIPE_BUSY
        Err(error)
            if matches!(
                error.kind(),
                io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused
            ) =>
        {
            Ok(false)
        }
        Err(_) => Err(RuntimeError::new(
            "endpoint_unavailable",
            "Cannot inspect Haider endpoint; no daemon was stopped or started",
        )),
    }
}

#[derive(Debug, Deserialize)]
struct Release {
    tag_name: String,
    assets: Vec<Asset>,
}
#[derive(Debug, Clone, Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
    size: u64,
}

fn http_client() -> Result<Client> {
    Client::builder()
        .user_agent("DiffForge-Haider-Runtime")
        .https_only(true)
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|_| RuntimeError::new("network", "Cannot initialize public release client"))
}

fn check_http_status(status: u16) -> Result<()> {
    match status {
        200..=299 => Ok(()),
        403 | 429 => Err(RuntimeError::new(
            "rate_limited",
            "GitHub declined the unauthenticated request; retry later",
        )),
        404 => Err(RuntimeError::new(
            "release_unavailable",
            "Published release or asset is unavailable",
        )),
        _ => Err(RuntimeError::new(
            "network",
            "GitHub release request failed",
        )),
    }
}

fn checked_response(response: Response) -> Result<Response> {
    check_http_status(response.status().as_u16())?;
    Ok(response)
}

fn get(client: &Client, url: &str) -> Result<Response> {
    checked_response(
        client
            .get(url)
            .send()
            .map_err(|_| RuntimeError::new("network", "Public release download failed"))?,
    )
}

fn read_limited(mut reader: impl Read, limit: u64) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    (&mut reader).take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(RuntimeError::new(
            "invalid_release",
            "Published metadata exceeds its size limit",
        ));
    }
    Ok(bytes)
}

fn latest_release(client: &Client) -> Result<Release> {
    let response = client
        .get(RELEASE_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .map_err(|_| RuntimeError::new("network", "Cannot fetch latest public Haider release"))?;
    let bytes = read_limited(checked_response(response)?, 2 * 1024 * 1024)?;
    let release: Release = serde_json::from_slice(&bytes)
        .map_err(|_| RuntimeError::new("invalid_release", "Invalid GitHub release metadata"))?;
    let version = parse_version(&release.tag_name).ok_or_else(|| {
        RuntimeError::new("invalid_release", "Release tag is not a semantic version")
    })?;
    *LATEST
        .lock()
        .map_err(|_| RuntimeError::new("internal", "Release state unavailable"))? =
        Some(version.to_string());
    Ok(release)
}

fn select_assets(release: &Release, platform: Platform) -> Result<(Asset, Asset)> {
    let version = parse_version(&release.tag_name)
        .ok_or_else(|| RuntimeError::new("invalid_release", "Invalid release version"))?;
    let name = format!(
        "haider-v{version}-{}.{}",
        platform.target, platform.extension
    );
    let select = |name: &str| -> Result<Asset> {
        let mut matching = release.assets.iter().filter(|asset| asset.name == name);
        let asset = matching.next().ok_or_else(|| {
            RuntimeError::new(
                "asset_unavailable",
                "Latest release lacks this platform's archive or checksum",
            )
        })?;
        if matching.next().is_some() {
            return Err(RuntimeError::new(
                "invalid_release",
                "Duplicate release asset",
            ));
        }
        // Do not accept arbitrary hosts/credentials from metadata. HTTPS redirects for
        // GitHub's release CDN remain enabled in reqwest and do not carry authentication.
        let url = reqwest::Url::parse(&asset.browser_download_url)
            .map_err(|_| RuntimeError::new("invalid_release", "Invalid asset URL"))?;
        if url.scheme() != "https"
            || url.host_str() != Some("github.com")
            || !url.username().is_empty()
            || url.password().is_some()
            || !url
                .path()
                .starts_with("/Rizzist/haider-agent/releases/download/")
        {
            return Err(RuntimeError::new(
                "invalid_release",
                "Asset is not a public Haider GitHub release download",
            ));
        }
        Ok(asset.clone())
    };
    Ok((select(&name)?, select(&format!("{name}.sha256"))?))
}

fn expected_checksum(text: &[u8], asset: &str) -> Result<String> {
    let text = std::str::from_utf8(text)
        .map_err(|_| RuntimeError::new("invalid_checksum", "Checksum is not UTF-8"))?;
    let lines: Vec<_> = text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect();
    if lines.len() != 1 {
        return Err(RuntimeError::new(
            "invalid_checksum",
            "Expected one published checksum",
        ));
    }
    let mut fields = lines[0].split_whitespace();
    let digest = fields.next().unwrap_or_default();
    let file = fields.next().map(|s| s.trim_start_matches('*'));
    if digest.len() != 64
        || !digest.bytes().all(|b| b.is_ascii_hexdigit())
        || file.is_some_and(|file| file != asset)
        || fields.next().is_some()
    {
        return Err(RuntimeError::new(
            "invalid_checksum",
            "Published checksum does not identify this asset",
        ));
    }
    Ok(digest.to_ascii_lowercase())
}

fn verify_sha256(mut archive: impl Read, published: &[u8], asset: &str) -> Result<()> {
    let expected = expected_checksum(published, asset)?;
    let mut hasher = Sha256::new();
    let mut buf = [0; 64 * 1024];
    loop {
        let n = archive.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    if format!("{:x}", hasher.finalize()) != expected {
        return Err(RuntimeError::new(
            "checksum_mismatch",
            "Haider archive failed the published SHA-256 check; it was not installed",
        ));
    }
    Ok(())
}

fn download_verified(
    client: &Client,
    release: &Release,
    platform: Platform,
    dir: &Path,
    emit: &impl Fn(InstallProgress),
) -> Result<(PathBuf, u64)> {
    let (asset, checksum) = select_assets(release, platform)?;
    if asset.size == 0 || asset.size > MAX_ARCHIVE_BYTES {
        return Err(RuntimeError::new(
            "invalid_release",
            "Archive size is outside allowed limits",
        ));
    }
    let published = read_limited(get(client, &checksum.browser_download_url)?, 4096)?;
    expected_checksum(&published, &asset.name)?;
    save_verified_archive(
        get(client, &asset.browser_download_url)?,
        &asset,
        &published,
        dir,
        emit,
    )
}

fn save_verified_archive(
    mut response: impl Read,
    asset: &Asset,
    published: &[u8],
    dir: &Path,
    emit: &impl Fn(InstallProgress),
) -> Result<(PathBuf, u64)> {
    let mut file = NamedTempFile::new_in(dir)?;
    let mut downloaded = 0;
    let mut buffer = [0; 64 * 1024];
    let mut last_emit = Instant::now();
    progress(emit, "downloading", 0, Some(asset.size));
    loop {
        let n = response
            .read(&mut buffer)
            .map_err(|_| RuntimeError::new("network", "Archive download interrupted"))?;
        if n == 0 {
            break;
        }
        downloaded += n as u64;
        if downloaded > asset.size {
            return Err(RuntimeError::new(
                "invalid_release",
                "Archive exceeded its published size",
            ));
        }
        file.write_all(&buffer[..n])?;
        if last_emit.elapsed() >= Duration::from_millis(100) {
            progress(emit, "downloading", downloaded, Some(asset.size));
            last_emit = Instant::now();
        }
    }
    if downloaded != asset.size {
        return Err(RuntimeError::new(
            "network",
            "Archive download is incomplete",
        ));
    }
    progress(emit, "downloading", downloaded, Some(asset.size));
    progress(emit, "verifying", downloaded, Some(asset.size));
    file.flush()?;
    file.seek(SeekFrom::Start(0))?;
    verify_sha256(&mut file, published, &asset.name)?; // RAII deletes artifact on every failure.
    let path = dir.join(&asset.name);
    file.persist(&path)
        .map_err(|_| RuntimeError::new("io", "Cannot stage verified archive"))?;
    Ok((path, downloaded))
}

struct LimitedWriter<W> {
    inner: W,
    remaining: u64,
}
impl<W: Write> Write for LimitedWriter<W> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() as u64 > self.remaining {
            return Err(io::Error::other("archive exceeds unpacked limit"));
        }
        let n = self.inner.write(bytes)?;
        self.remaining -= n as u64;
        Ok(n)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

fn archive_binary_index(path: &Path, names: &[&str; 2]) -> Result<Option<usize>> {
    if path.is_absolute()
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_) | Component::CurDir))
    {
        return Err(RuntimeError::new(
            "invalid_archive",
            "Unsafe archive member path",
        ));
    }
    Ok(names
        .iter()
        .position(|name| path.file_name().is_some_and(|file| file == *name)))
}

fn unpack_pair(archive: &Path, dir: &Path, platform: Platform) -> Result<[PathBuf; 2]> {
    let names = if platform.windows {
        ["haider.exe", "haiderd.exe"]
    } else {
        ["haider", "haiderd"]
    };
    let paths = names.map(|name| dir.join(name));
    let mut found = [false; 2];
    let mut copy = |index: usize, size: u64, reader: &mut dyn Read| -> Result<()> {
        if found[index] || size == 0 || size > MAX_UNPACKED_BYTES {
            return Err(RuntimeError::new(
                "invalid_archive",
                "Duplicate, empty, or oversized runtime executable",
            ));
        }
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&paths[index])?;
        let count = io::copy(&mut reader.take(MAX_UNPACKED_BYTES + 1), &mut output)?;
        if count != size {
            return Err(RuntimeError::new(
                "invalid_archive",
                "Runtime member size mismatch",
            ));
        }
        output.sync_all()?;
        executable(&output)?;
        found[index] = true;
        Ok(())
    };
    if platform.windows {
        let mut zip = zip::ZipArchive::new(File::open(archive)?)
            .map_err(|_| RuntimeError::new("invalid_archive", "Invalid ZIP archive"))?;
        for i in 0..zip.len() {
            let mut entry = zip
                .by_index(i)
                .map_err(|_| RuntimeError::new("invalid_archive", "Invalid ZIP member"))?;
            let path = entry
                .enclosed_name()
                .ok_or_else(|| RuntimeError::new("invalid_archive", "Unsafe ZIP member path"))?;
            if let Some(index) = archive_binary_index(&path, &names)? {
                if entry.is_dir() || entry.is_symlink() {
                    return Err(RuntimeError::new(
                        "invalid_archive",
                        "Runtime member is not a regular file",
                    ));
                }
                copy(index, entry.size(), &mut entry)?;
            }
        }
    } else {
        let mut tar_file = NamedTempFile::new_in(dir)?;
        lzma_rs::xz_decompress(
            &mut BufReader::new(File::open(archive)?),
            &mut LimitedWriter {
                inner: &mut tar_file,
                remaining: MAX_UNPACKED_BYTES,
            },
        )
        .map_err(|_| RuntimeError::new("invalid_archive", "Invalid or oversized XZ archive"))?;
        tar_file.seek(SeekFrom::Start(0))?;
        let mut tar = tar::Archive::new(tar_file);
        for entry in tar
            .entries()
            .map_err(|_| RuntimeError::new("invalid_archive", "Invalid TAR archive"))?
        {
            let mut entry =
                entry.map_err(|_| RuntimeError::new("invalid_archive", "Invalid TAR member"))?;
            if let Some(index) = archive_binary_index(&entry.path()?, &names)? {
                if !entry.header().entry_type().is_file() {
                    return Err(RuntimeError::new(
                        "invalid_archive",
                        "Runtime member is not a regular file",
                    ));
                }
                copy(index, entry.size(), &mut entry)?;
            }
        }
    }
    if found != [true, true] {
        return Err(RuntimeError::new(
            "invalid_archive",
            "Archive must contain both haider and haiderd",
        ));
    }
    Ok(paths)
}

fn executable(file: &File) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o755))?;
    }
    #[cfg(not(unix))]
    let _ = file;
    Ok(())
}

fn stage_atomic(source: &Path, destination: &Path) -> Result<NamedTempFile> {
    outside_checkout(destination)?;
    if fs::symlink_metadata(destination).is_ok_and(|m| !m.is_file() || m.file_type().is_symlink()) {
        return Err(RuntimeError::new(
            "unsafe_path",
            "Refusing to replace a non-regular runtime path",
        ));
    }
    let parent = destination
        .parent()
        .ok_or_else(|| RuntimeError::new("unsafe_path", "Install destination has no parent"))?;
    fs::create_dir_all(parent)?;
    outside_checkout(parent)?;
    // Same-directory temporary file is required for atomic rename across filesystems.
    let mut staged = NamedTempFile::new_in(parent)?;
    io::copy(&mut File::open(source)?, &mut staged)?;
    executable(staged.as_file())?;
    staged.as_file().sync_all()?;
    Ok(staged)
}

fn install_pair(sources: &[PathBuf; 2], destination: &Path, platform: Platform) -> Result<()> {
    let daemon = daemon_path(destination, platform);
    let cli_stage = stage_atomic(&sources[0], destination)?;
    let daemon_stage = stage_atomic(&sources[1], &daemon)?;
    // Preserve the old daemon for rollback if the second rename fails. Never unlink
    // a live executable first. Windows sharing violations fail without killing it.
    let backup = if daemon.exists() {
        Some(stage_atomic(&daemon, &daemon)?)
    } else {
        None
    };
    daemon_stage.persist(&daemon).map_err(|_| RuntimeError::new("install_failed", "Cannot atomically replace haiderd; a running Windows daemon may need an operator restart"))?;
    if cli_stage.persist(destination).is_err() {
        let restored = if let Some(backup) = backup {
            backup.persist(&daemon).map(|_| ()).map_err(|e| e.error)
        } else {
            fs::remove_file(&daemon)
        };
        return Err(RuntimeError::new(
            "install_failed",
            if restored.is_ok() {
                "Cannot replace haider; previous runtime restored"
            } else {
                "Cannot replace haider or restore haiderd; repair installation before starting"
            },
        ));
    }
    Ok(())
}

struct MutationGuard;
impl MutationGuard {
    fn acquire() -> Result<Self> {
        MUTATING
            .compare_exchange(false, true, AtomicOrdering::AcqRel, AtomicOrdering::Acquire)
            .map_err(|_| {
                RuntimeError::new("busy", "Another runtime install or start is in progress")
            })?;
        Ok(Self)
    }
}
impl Drop for MutationGuard {
    fn drop(&mut self) {
        MUTATING.store(false, AtomicOrdering::Release);
    }
}

fn status(refresh_latest: bool) -> Result<RuntimeStatus> {
    let path = install_path()?;
    if refresh_latest {
        latest_release(&http_client()?)?;
    }
    let installed = path.is_file();
    let version = installed.then(|| binary_version(&path, "haider")).flatten();
    let latest_known = LATEST
        .lock()
        .map_err(|_| RuntimeError::new("internal", "Release state unavailable"))?
        .clone();
    let update_available = version
        .as_deref()
        .zip(latest_known.as_deref())
        .and_then(|(installed, latest)| compare_versions(installed, latest))
        .map(|order| order == Ordering::Less);
    Ok(RuntimeStatus {
        installed,
        version,
        running: daemon_running()?,
        install_path: path.to_string_lossy().into_owned(),
        latest_known,
        update_available,
    })
}

fn install_latest(emit: impl Fn(InstallProgress)) -> Result<InstallResult> {
    let _guard = MutationGuard::acquire()?;
    let platform = current_platform()?;
    let path = install_path()?;
    outside_checkout(&path)?;
    let dir = staging_directory()?;
    progress(&emit, "resolving", 0, None);
    let client = http_client()?;
    let release = latest_release(&client)?;
    let (archive, bytes) = download_verified(&client, &release, platform, dir.path(), &emit)?;
    let sources = unpack_pair(&archive, dir.path(), platform)?;
    let version = binary_version(&sources[0], "haider").ok_or_else(|| {
        RuntimeError::new(
            "invalid_binary",
            "Verified haider executable did not report a version",
        )
    })?;
    let daemon_version = binary_version(&sources[1], "haiderd").ok_or_else(|| {
        RuntimeError::new(
            "invalid_binary",
            "Verified haiderd executable did not report a version",
        )
    })?;
    if compare_versions(&version, &release.tag_name) != Some(Ordering::Equal)
        || compare_versions(&daemon_version, &version) != Some(Ordering::Equal)
    {
        return Err(RuntimeError::new(
            "invalid_binary",
            "Runtime executables do not match the published release version",
        ));
    }
    // Unknown endpoint health conservatively asks for a restart; it must not prevent
    // replacing a stale binary. No stop, signal, sudo, or daemon restart is performed.
    let restart_needed = daemon_running().unwrap_or(true);
    progress(&emit, "installing", bytes, Some(bytes));
    install_pair(&sources, &path, platform)?;
    Ok(InstallResult {
        installed_version: version,
        path: path.to_string_lossy().into_owned(),
        restart_needed: restart_needed || daemon_running().unwrap_or(true),
    })
}

fn start_daemon() -> Result<StartResult> {
    let _guard = MutationGuard::acquire()?;
    let platform = current_platform()?;
    let path = install_path()?;
    let daemon = daemon_path(&path, platform);
    if !path.is_file() || !daemon.is_file() {
        return Err(RuntimeError::new(
            "unavailable",
            "Install the Haider runtime before starting its daemon",
        ));
    }
    if daemon_running()? {
        return Ok(StartResult {
            started: false,
            error: None,
        });
    }
    // Contract: release README ships both binaries; haider-daemond/main.rs documents
    // bare `haiderd` as resolving the same profile as `haider`. There is no `daemon start`
    // CLI subcommand. A detached sibling is the actual daemon invocation.
    let mut command = Command::new(daemon);
    command
        .current_dir(
            path.parent()
                .ok_or_else(|| RuntimeError::new("unsafe_path", "Install directory unavailable"))?,
        )
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            command.pre_exec(|| {
                if libc::setsid() == -1 {
                    Err(io::Error::last_os_error())
                } else {
                    Ok(())
                }
            });
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x00000008 | 0x00000200); // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    }
    let mut child = command
        .spawn()
        .map_err(|_| RuntimeError::new("start_failed", "Cannot spawn installed haiderd"))?;
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if let Some(exit) = child.try_wait()? {
            return Ok(StartResult {
                started: false,
                error: Some(format!(
                    "haiderd exited before readiness (code {:?})",
                    exit.code()
                )),
            });
        }
        if daemon_running().unwrap_or(false) {
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            return Ok(StartResult {
                started: true,
                error: None,
            });
        }
        if Instant::now() >= deadline {
            // We never kill a daemon, including a slow-starting candidate. Reap when it exits.
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            return Ok(StartResult { started: false, error: Some("Daemon spawned, but its endpoint was not ready within 10 seconds; it was left running".into()) });
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

#[tauri::command]
pub async fn haider_runtime_status(refresh_latest: Option<bool>) -> Result<RuntimeStatus> {
    tauri::async_runtime::spawn_blocking(move || status(refresh_latest.unwrap_or(false)))
        .await
        .map_err(|_| RuntimeError::new("internal", "Runtime status worker failed"))?
}

#[tauri::command]
pub async fn haider_install_latest(app: AppHandle) -> Result<InstallResult> {
    tauri::async_runtime::spawn_blocking(move || {
        install_latest(|payload| {
            let _ = app.emit("haider-install-progress", payload);
        })
    })
    .await
    .map_err(|_| RuntimeError::new("internal", "Runtime install worker failed"))?
}

#[tauri::command]
pub async fn haider_daemon_start() -> Result<StartResult> {
    tauri::async_runtime::spawn_blocking(start_daemon)
        .await
        .map_err(|_| RuntimeError::new("internal", "Runtime start worker failed"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    const ABC_SHA256: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

    fn asset(name: &str, size: u64) -> Asset {
        Asset {
            name: name.into(),
            browser_download_url: format!(
                "https://github.com/Rizzist/haider-agent/releases/download/v1.2.3/{name}"
            ),
            size,
        }
    }

    #[test]
    fn asset_selection_covers_every_desktop_target_and_checksum() {
        for (os, arch, triple, extension) in [
            ("macos", "aarch64", "aarch64-apple-darwin", "tar.xz"),
            ("macos", "x86_64", "x86_64-apple-darwin", "tar.xz"),
            ("linux", "x86_64", "x86_64-unknown-linux-gnu", "tar.xz"),
            ("linux", "aarch64", "aarch64-unknown-linux-gnu", "tar.xz"),
            ("windows", "x86_64", "x86_64-pc-windows-msvc", "zip"),
        ] {
            let p = platform(os, arch).unwrap();
            let name = format!("haider-v1.2.3-{triple}.{extension}");
            let checksum = format!("{name}.sha256");
            let release = Release {
                tag_name: "v1.2.3".into(),
                assets: vec![
                    asset("haider-v1.2.3-android.apk", 3),
                    asset(&name, 3),
                    asset(&checksum, 100),
                ],
            };
            let selected = select_assets(&release, p).unwrap();
            assert_eq!(selected.0.name, name);
            assert_eq!(selected.1.name, checksum);
        }
    }

    #[test]
    fn android_and_unsupported_architectures_are_excluded() {
        for (os, arch) in [
            ("android", "aarch64"),
            ("android", "x86_64"),
            ("windows", "aarch64"),
            ("linux", "arm"),
            ("ios", "aarch64"),
        ] {
            assert_eq!(platform(os, arch).unwrap_err().code, "unsupported_platform");
        }
    }

    #[test]
    fn windows_pipe_discovery_accepts_userprofile_without_home() {
        let dir = staging_directory().unwrap();
        let by_home = crate::haider_rpc_ade::runtime_pipe_path_for(None, Some(dir.path())).unwrap();
        let store = dir.path().join(".haider/dev-profile");
        let by_profile = crate::haider_rpc_ade::runtime_pipe_path_for(Some(&store), None).unwrap();
        assert_eq!(by_home, by_profile);
        assert!(by_home.to_str().unwrap().starts_with(r"\\.\pipe\haider-"));
        let other = crate::haider_rpc_ade::runtime_pipe_path_for(
            Some(&dir.path().join("other-profile")),
            None,
        )
        .unwrap();
        assert_ne!(by_home, other);
        assert!(crate::haider_rpc_ade::runtime_pipe_path_for(None, None).is_none());
    }

    #[test]
    fn missing_checksum_and_duplicate_or_untrusted_assets_fail_closed() {
        let platform = platform("macos", "aarch64").unwrap();
        let name = "haider-v1.2.3-aarch64-apple-darwin.tar.xz";
        let mut release = Release {
            tag_name: "v1.2.3".into(),
            assets: vec![asset(name, 3)],
        };
        assert_eq!(
            select_assets(&release, platform).unwrap_err().code,
            "asset_unavailable"
        );
        release.assets.push(asset(&format!("{name}.sha256"), 64));
        release.assets.push(asset(name, 3));
        assert_eq!(
            select_assets(&release, platform).unwrap_err().code,
            "invalid_release"
        );
        release.assets.pop();
        release.assets[0].browser_download_url = "https://example.org/haider".into();
        assert_eq!(
            select_assets(&release, platform).unwrap_err().code,
            "invalid_release"
        );
        release.tag_name = "../../outside".into();
        assert_eq!(
            select_assets(&release, platform).unwrap_err().code,
            "invalid_release"
        );
    }

    #[test]
    fn version_comparison_is_numeric_and_unknown_stays_unknown() {
        assert_eq!(compare_versions("0.0.99", "v0.0.100"), Some(Ordering::Less));
        assert_eq!(
            compare_versions("1.0.0", "0.99.999"),
            Some(Ordering::Greater)
        );
        assert_eq!(
            compare_versions("1.0.0-rc.1", "1.0.0"),
            Some(Ordering::Less)
        );
        assert_eq!(
            compare_versions("v1.0.0+build", "1.0.0"),
            Some(Ordering::Equal)
        );
        assert_eq!(compare_versions("", "1.0.0"), None);
        assert_eq!(compare_versions("unknown", "1.0.0"), None);
    }

    #[test]
    fn installed_version_requires_actual_binary_output() {
        assert_eq!(
            version_from_output("haider 1.2.3\n", "haider"),
            Some("1.2.3".into())
        );
        for text in ["", "1.2.3", "haider unknown", "other 1.2.3"] {
            assert_eq!(version_from_output(text, "haider"), None);
        }
        let dir = staging_directory().unwrap();
        assert_eq!(
            binary_version(&dir.path().join("missing-haider"), "haider"),
            None
        );
    }

    #[cfg(unix)]
    #[test]
    fn version_and_no_spawn_probe_use_the_absolute_fixture_binary() {
        let dir = staging_directory().unwrap();
        let path = dir.path().join("haider");
        fs::write(&path, b"#!/bin/sh\ncase \"$*\" in\n'--version') echo 'haider 1.2.3';;\n'status --json --no-spawn') exit 0;;\n*) exit 99;;\nesac\n").unwrap();
        executable(&File::open(&path).unwrap()).unwrap();
        assert_eq!(binary_version(&path, "haider"), Some("1.2.3".into()));
        assert!(no_spawn_status(&path));
        fs::write(&path, b"#!/bin/sh\nexit 7\n").unwrap();
        assert!(!no_spawn_status(&path));
        assert_eq!(binary_version(&path, "haider"), None);
        assert!(!no_spawn_status(&dir.path().join("absent")));
    }

    #[test]
    fn sha256_verifies_published_fixture_not_download_derived_trust() {
        let checksum = format!("{ABC_SHA256}  runtime.tar.xz\n");
        verify_sha256(Cursor::new(b"abc"), checksum.as_bytes(), "runtime.tar.xz").unwrap();
        assert_eq!(
            verify_sha256(Cursor::new(b"abd"), checksum.as_bytes(), "runtime.tar.xz")
                .unwrap_err()
                .code,
            "checksum_mismatch"
        );
        verify_sha256(
            Cursor::new(b"abc"),
            ABC_SHA256.to_ascii_uppercase().as_bytes(),
            "runtime.tar.xz",
        )
        .unwrap();
    }

    #[test]
    fn malformed_and_wrong_filename_checksum_fixtures_are_rejected() {
        for text in [
            format!("{ABC_SHA256} other.tar.xz"),
            "not-a-hash".into(),
            format!("{ABC_SHA256}\n{ABC_SHA256}"),
            format!("{ABC_SHA256} runtime.tar.xz extra"),
        ] {
            assert_eq!(
                expected_checksum(text.as_bytes(), "runtime.tar.xz")
                    .unwrap_err()
                    .code,
                "invalid_checksum"
            );
        }
        assert_eq!(
            expected_checksum(
                format!("{ABC_SHA256} *runtime.tar.xz").as_bytes(),
                "runtime.tar.xz"
            )
            .unwrap(),
            ABC_SHA256
        );
    }

    #[test]
    fn fixture_download_progress_and_verified_file_are_real() {
        let dir = staging_directory().unwrap();
        let events = Mutex::new(Vec::new());
        let (path, bytes) = save_verified_archive(
            Cursor::new(b"abc"),
            &asset("runtime.tar.xz", 3),
            ABC_SHA256.as_bytes(),
            dir.path(),
            &|event| events.lock().unwrap().push(event),
        )
        .unwrap();
        assert_eq!(fs::read(path).unwrap(), b"abc");
        assert_eq!(bytes, 3);
        let events = events.into_inner().unwrap();
        assert_eq!(events.first().unwrap().phase, "downloading");
        assert_eq!(events.last().unwrap().phase, "verifying");
        assert_eq!(events.last().unwrap().downloaded_bytes, "3");
        assert_eq!(events.last().unwrap().total_bytes.as_deref(), Some("3"));
    }

    #[test]
    fn checksum_mismatch_deletes_download_and_never_leaves_installable_artifact() {
        let dir = staging_directory().unwrap();
        assert_eq!(
            save_verified_archive(
                Cursor::new(b"bad"),
                &asset("runtime.tar.xz", 3),
                ABC_SHA256.as_bytes(),
                dir.path(),
                &|_| {}
            )
            .unwrap_err()
            .code,
            "checksum_mismatch"
        );
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn truncated_and_oversized_downloads_delete_temporary_files() {
        for bytes in [b"ab".as_slice(), b"abcd".as_slice()] {
            let dir = staging_directory().unwrap();
            assert!(save_verified_archive(
                Cursor::new(bytes),
                &asset("runtime.tar.xz", 3),
                ABC_SHA256.as_bytes(),
                dir.path(),
                &|_| {}
            )
            .is_err());
            assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
        }
    }

    #[test]
    fn http_errors_are_typed_without_echoing_response_bodies() {
        for (status, code) in [
            (403, "rate_limited"),
            (429, "rate_limited"),
            (404, "release_unavailable"),
            (500, "network"),
        ] {
            assert_eq!(check_http_status(status).unwrap_err().code, code);
        }
        check_http_status(200).unwrap();
    }

    #[test]
    fn atomic_install_roots_are_user_scoped_and_absolute() {
        let dir = staging_directory().unwrap();
        assert_eq!(
            install_path_for(platform("macos", "aarch64").unwrap(), dir.path()).unwrap(),
            dir.path().join(".local/bin/haider")
        );
        assert_eq!(
            install_path_for(platform("windows", "x86_64").unwrap(), dir.path()).unwrap(),
            dir.path().join("haider/bin/haider.exe")
        );
        assert!(
            install_path_for(platform("linux", "x86_64").unwrap(), Path::new("relative")).is_err()
        );
        assert!(outside_checkout(&dir.path().join("../escape")).is_err());
        fs::create_dir(dir.path().join(".git")).unwrap();
        assert_eq!(
            outside_checkout(&dir.path().join("new/bin/haider"))
                .unwrap_err()
                .code,
            "unsafe_path"
        );
    }

    #[test]
    fn atomic_install_replaces_both_binaries_and_leaves_no_temporary_files() {
        let dir = staging_directory().unwrap();
        let sources = [
            dir.path().join("cli-source"),
            dir.path().join("daemon-source"),
        ];
        fs::write(&sources[0], b"new-cli").unwrap();
        fs::write(&sources[1], b"new-daemon").unwrap();
        let target = dir.path().join("install/haider");
        let platform = platform("macos", "aarch64").unwrap();
        install_pair(&sources, &target, platform).unwrap();
        fs::write(&sources[0], b"replacement-cli").unwrap();
        install_pair(&sources, &target, platform).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"replacement-cli");
        assert_eq!(
            fs::read(daemon_path(&target, platform)).unwrap(),
            b"new-daemon"
        );
        assert_eq!(fs::read_dir(target.parent().unwrap()).unwrap().count(), 2);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(target).unwrap().permissions().mode() & 0o777,
                0o755
            );
        }
    }

    #[test]
    fn invalid_atomic_destination_preserves_existing_pair() {
        let dir = staging_directory().unwrap();
        let sources = [
            dir.path().join("cli-source"),
            dir.path().join("daemon-source"),
        ];
        for source in &sources {
            fs::write(source, b"new").unwrap();
        }
        let target = dir.path().join("install/haider");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.with_file_name("haiderd"), b"old").unwrap();
        assert!(install_pair(&sources, &target, platform("macos", "aarch64").unwrap()).is_err());
        assert_eq!(fs::read(target.with_file_name("haiderd")).unwrap(), b"old");
    }

    #[cfg(unix)]
    #[test]
    fn atomic_install_rejects_symlink_and_checkout_ancestor() {
        use std::os::unix::fs::symlink;
        let dir = staging_directory().unwrap();
        let source = dir.path().join("source");
        fs::write(&source, b"new").unwrap();
        let victim = dir.path().join("victim");
        fs::write(&victim, b"old").unwrap();
        let dest = dir.path().join("haider");
        symlink(&victim, &dest).unwrap();
        assert_eq!(
            stage_atomic(&source, &dest).unwrap_err().code,
            "unsafe_path"
        );
        assert_eq!(fs::read(victim).unwrap(), b"old");
        let checkout = dir.path().join("checkout");
        fs::create_dir_all(checkout.join(".git")).unwrap();
        symlink(&checkout, dir.path().join("linked-checkout")).unwrap();
        assert_eq!(
            outside_checkout(&dir.path().join("linked-checkout/bin/haider"))
                .unwrap_err()
                .code,
            "unsafe_path"
        );
    }

    fn tar_fixture(dir: &Path, members: &[(&str, &[u8])]) -> PathBuf {
        let mut tar = tar::Builder::new(Vec::new());
        for (name, contents) in members {
            let mut header = tar::Header::new_gnu();
            header.set_size(contents.len() as u64);
            header.set_mode(0o755);
            header.set_cksum();
            tar.append_data(&mut header, name, *contents).unwrap();
        }
        let bytes = tar.into_inner().unwrap();
        let path = dir.join("fixture.tar.xz");
        lzma_rs::xz_compress(&mut Cursor::new(bytes), &mut File::create(&path).unwrap()).unwrap();
        path
    }

    #[test]
    fn tar_xz_fixture_extracts_only_pair_from_release_directory() {
        let dir = staging_directory().unwrap();
        let archive = tar_fixture(
            dir.path(),
            &[
                ("release/haider", b"cli"),
                ("release/haiderd", b"daemon"),
                ("release/README", b"ignored"),
            ],
        );
        let paths =
            unpack_pair(&archive, dir.path(), platform("macos", "aarch64").unwrap()).unwrap();
        assert_eq!(fs::read(&paths[0]).unwrap(), b"cli");
        assert_eq!(fs::read(&paths[1]).unwrap(), b"daemon");
        assert!(!dir.path().join("release").exists());
    }

    #[test]
    fn zip_fixture_extracts_windows_pair() {
        let dir = staging_directory().unwrap();
        let path = dir.path().join("fixture.zip");
        let mut zip = zip::ZipWriter::new(File::create(&path).unwrap());
        for name in ["release/haider.exe", "release/haiderd.exe"] {
            zip.start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b"exe-fixture").unwrap();
        }
        zip.finish().unwrap();
        let paths = unpack_pair(&path, dir.path(), platform("windows", "x86_64").unwrap()).unwrap();
        assert_eq!(paths[0].file_name().unwrap(), "haider.exe");
        assert_eq!(fs::read(&paths[1]).unwrap(), b"exe-fixture");
    }

    #[test]
    fn incomplete_and_duplicate_archives_fail() {
        for members in [
            vec![("haider", b"cli".as_slice())],
            vec![
                ("haider", b"cli".as_slice()),
                ("haider", b"cli".as_slice()),
                ("haiderd", b"d".as_slice()),
            ],
        ] {
            let dir = staging_directory().unwrap();
            let path = tar_fixture(dir.path(), &members);
            assert_eq!(
                unpack_pair(&path, dir.path(), platform("linux", "x86_64").unwrap())
                    .unwrap_err()
                    .code,
                "invalid_archive"
            );
        }
        for path in ["/haider", "../haider", "release/../../haider"] {
            assert_eq!(
                archive_binary_index(Path::new(path), &["haider", "haiderd"])
                    .unwrap_err()
                    .code,
                "invalid_archive"
            );
        }
    }

    #[test]
    fn unpacked_limit_stops_archive_bombs() {
        let mut writer = LimitedWriter {
            inner: Vec::new(),
            remaining: 3,
        };
        writer.write_all(b"abc").unwrap();
        assert!(writer.write_all(b"d").is_err());
        assert_eq!(writer.inner, b"abc");
    }

    #[test]
    fn mutation_guard_rejects_overlap_and_releases_on_failure() {
        let guard = MutationGuard::acquire().unwrap();
        assert!(matches!(MutationGuard::acquire(), Err(error) if error.code == "busy"));
        drop(guard);
        assert!(MutationGuard::acquire().is_ok());
    }

    #[test]
    fn ui_contract_preserves_unknowns_and_decimal_byte_counts() {
        let status = RuntimeStatus {
            installed: false,
            version: None,
            running: false,
            install_path: "/fixture/haider".into(),
            latest_known: None,
            update_available: None,
        };
        let json = serde_json::to_value(status).unwrap();
        assert!(json["version"].is_null());
        assert!(json["latest_known"].is_null());
        assert!(json["update_available"].is_null());
        let emit = |event| {
            let value = serde_json::to_value(event).unwrap();
            assert_eq!(value["downloaded_bytes"], u64::MAX.to_string());
            assert!(value["total_bytes"].is_null());
        };
        progress(&emit, "resolving", u64::MAX, None);
    }

    /// Explicit opt-in only. Downloads and verifies the real release into OS temp,
    /// then drops it. Never extracts, executes, installs, starts, or stops Haider.
    #[test]
    #[ignore = "network dry-run; invoke explicitly with orchestrator authorization"]
    fn real_api_download_verify_only() {
        let dir = staging_directory().unwrap();
        let client = http_client().unwrap();
        let release = latest_release(&client).unwrap();
        println!(
            "release={} target={}",
            release.tag_name,
            current_platform().unwrap().target
        );
        let (path, bytes) = download_verified(
            &client,
            &release,
            current_platform().unwrap(),
            dir.path(),
            &|event| println!("{}", serde_json::to_string(&event).unwrap()),
        )
        .unwrap();
        println!(
            "VERIFIED bytes={bytes} asset={} install=false extract=false execute=false",
            path.file_name().unwrap().to_string_lossy()
        );
        let root = dir.path().to_owned();
        drop(dir);
        assert!(!root.exists());
        println!("temporary artifacts removed=true");
    }
}
