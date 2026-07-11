const VM_SANDBOX_RUNTIME_PROGRESS_EVENT: &str = "forge-vm-sandbox-runtime-progress";
const VM_SANDBOX_RUNTIME_NAME: &str = "QEMU";
const VM_SANDBOX_RUNTIME_PACKAGE_NAME: &str = "QEMU VM Sandbox runtime";
const VM_SANDBOX_RUNTIME_DIR_NAME: &str = "vm-sandbox";
const VM_SANDBOX_RUNTIME_ARCHIVE_NAME: &str = "qemu-runtime.zip";
const VM_SANDBOX_RUNTIME_DOWNLOAD_MIN_MB: u64 = 80;
const VM_SANDBOX_RUNTIME_DOWNLOAD_MAX_MB: u64 = 180;
const VM_SANDBOX_RUNTIME_INSTALL_TIMEOUT_SECS: u64 = 900;
const VM_SANDBOX_RUNTIME_URL_ENV: &str = "DIFFFORGE_VM_QEMU_RUNTIME_URL";
const VM_SANDBOX_RUNTIME_SHA256_ENV: &str = "DIFFFORGE_VM_QEMU_RUNTIME_SHA256";
const VM_SANDBOX_RUNTIME_ARCHIVE_ENV: &str = "DIFFFORGE_VM_QEMU_RUNTIME_ARCHIVE";
const VM_SANDBOX_BUILD_RUNTIME_URL: Option<&str> = option_env!("DIFFFORGE_VM_QEMU_RUNTIME_URL");
const VM_SANDBOX_BUILD_RUNTIME_SHA256: Option<&str> =
    option_env!("DIFFFORGE_VM_QEMU_RUNTIME_SHA256");
const VM_SANDBOX_BUILD_RUNTIME_ARCHIVE: Option<&str> =
    option_env!("DIFFFORGE_VM_QEMU_RUNTIME_ARCHIVE");

#[derive(Clone)]
pub struct VmSandboxState {
    install_lock: Arc<Mutex<()>>,
}

impl Default for VmSandboxState {
    fn default() -> Self {
        Self {
            install_lock: Arc::new(Mutex::new(())),
        }
    }
}

#[derive(Serialize, Clone)]
pub struct VmSandboxRuntimeStatus {
    installed: bool,
    runtime_installed: bool,
    managed_runtime_installed: bool,
    managed_assets_installed: bool,
    external_runtime: bool,
    runtime_name: &'static str,
    runtime_package_name: &'static str,
    runtime_path: String,
    runtime_directory: String,
    runtime_installable: bool,
    runtime_install_hint: String,
    managed_runtime_package_url: Option<String>,
    approximate_download_mb_min: u64,
    approximate_download_mb_max: u64,
    accelerator: String,
    host_os: String,
    host_arch: String,
}

#[derive(Serialize, Clone)]
pub struct VmSandboxRuntimeProgress {
    state: String,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    percent: Option<f64>,
    message: String,
}

fn vm_sandbox_emit_progress(app: &AppHandle, progress: VmSandboxRuntimeProgress) {
    let _ = app.emit(VM_SANDBOX_RUNTIME_PROGRESS_EVENT, progress);
}

fn vm_sandbox_configured_runtime_url() -> Option<String> {
    env::var(VM_SANDBOX_RUNTIME_URL_ENV)
        .ok()
        .or_else(|| VM_SANDBOX_BUILD_RUNTIME_URL.map(ToString::to_string))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn vm_sandbox_configured_runtime_sha256() -> Option<String> {
    env::var(VM_SANDBOX_RUNTIME_SHA256_ENV)
        .ok()
        .or_else(|| VM_SANDBOX_BUILD_RUNTIME_SHA256.map(ToString::to_string))
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
}

fn vm_sandbox_runtime_archive_name() -> String {
    env::var(VM_SANDBOX_RUNTIME_ARCHIVE_ENV)
        .ok()
        .or_else(|| VM_SANDBOX_BUILD_RUNTIME_ARCHIVE.map(ToString::to_string))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| VM_SANDBOX_RUNTIME_ARCHIVE_NAME.to_string())
}

fn vm_sandbox_data_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?;

    Ok(app_data_dir.join(VM_SANDBOX_RUNTIME_DIR_NAME))
}

fn vm_sandbox_runtime_directory(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(vm_sandbox_data_directory(app)?.join("runtime"))
}

fn vm_sandbox_runtime_archive_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(vm_sandbox_data_directory(app)?.join(vm_sandbox_runtime_archive_name()))
}

fn vm_sandbox_primary_runtime_names() -> &'static [&'static str] {
    #[cfg(all(windows, target_arch = "aarch64"))]
    {
        &["qemu-system-aarch64.exe", "qemu-system-x86_64.exe"]
    }

    #[cfg(all(windows, not(target_arch = "aarch64")))]
    {
        &["qemu-system-x86_64.exe", "qemu-system-aarch64.exe"]
    }

    #[cfg(all(not(windows), target_arch = "aarch64"))]
    {
        &["qemu-system-aarch64", "qemu-system-x86_64"]
    }

    #[cfg(all(not(windows), not(target_arch = "aarch64")))]
    {
        &["qemu-system-x86_64", "qemu-system-aarch64"]
    }
}

fn vm_sandbox_find_executable_on_path(names: &[&str]) -> Option<PathBuf> {
    let path_value = env::var_os("PATH")?;

    for directory in env::split_paths(&path_value) {
        for name in names {
            let candidate = directory.join(name);

            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    None
}

fn vm_sandbox_common_runtime_paths() -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        vec![
            PathBuf::from("/opt/homebrew/bin/qemu-system-aarch64"),
            PathBuf::from("/opt/homebrew/bin/qemu-system-x86_64"),
            PathBuf::from("/usr/local/bin/qemu-system-x86_64"),
            PathBuf::from("/usr/local/bin/qemu-system-aarch64"),
        ]
    }

    #[cfg(target_os = "linux")]
    {
        vec![
            PathBuf::from("/usr/bin/qemu-system-x86_64"),
            PathBuf::from("/usr/bin/qemu-system-aarch64"),
            PathBuf::from("/usr/local/bin/qemu-system-x86_64"),
            PathBuf::from("/usr/local/bin/qemu-system-aarch64"),
        ]
    }

    #[cfg(windows)]
    {
        let mut paths = Vec::new();
        for root in [
            env::var_os("ProgramFiles").map(PathBuf::from),
            env::var_os("ProgramFiles(x86)").map(PathBuf::from),
        ]
        .into_iter()
        .flatten()
        {
            paths.push(root.join("qemu").join("qemu-system-x86_64.exe"));
            paths.push(root.join("qemu").join("qemu-system-aarch64.exe"));
        }
        paths
    }
}

fn vm_sandbox_find_named_runtime(directory: &Path, runtime_name: &str) -> Option<PathBuf> {
    let mut pending = vec![directory.to_path_buf()];

    while let Some(current) = pending.pop() {
        let Ok(entries) = fs::read_dir(&current) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();

            if path.is_dir() {
                pending.push(path);
                continue;
            }

            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("");

            if runtime_name.eq_ignore_ascii_case(name) {
                return Some(path);
            }
        }
    }

    None
}

fn vm_sandbox_find_managed_runtime(directory: &Path) -> Option<PathBuf> {
    vm_sandbox_primary_runtime_names()
        .iter()
        .find_map(|runtime_name| vm_sandbox_find_named_runtime(directory, runtime_name))
}

fn vm_sandbox_external_runtime_path() -> Option<PathBuf> {
    if let Some(runtime) = vm_sandbox_find_executable_on_path(vm_sandbox_primary_runtime_names()) {
        return Some(runtime);
    }

    vm_sandbox_common_runtime_paths()
        .into_iter()
        .find(|candidate| candidate.is_file())
}

fn vm_sandbox_runtime_path(app: &AppHandle) -> Result<(Option<PathBuf>, bool), String> {
    let runtime_directory = vm_sandbox_runtime_directory(app)?;
    if let Some(runtime) = vm_sandbox_find_managed_runtime(&runtime_directory) {
        return Ok((Some(runtime), true));
    }

    Ok((vm_sandbox_external_runtime_path(), false))
}

fn vm_sandbox_host_accelerator() -> String {
    #[cfg(target_os = "macos")]
    {
        "HVF".to_string()
    }

    #[cfg(target_os = "windows")]
    {
        "WHPX".to_string()
    }

    #[cfg(target_os = "linux")]
    {
        if Path::new("/dev/kvm").exists() {
            "KVM".to_string()
        } else {
            "TCG".to_string()
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        "TCG".to_string()
    }
}

fn vm_sandbox_install_hint(has_managed_url: bool) -> String {
    if has_managed_url {
        return "Diff Forge will download and install the managed QEMU runtime on first use."
            .to_string();
    }

    #[cfg(target_os = "macos")]
    {
        if vm_sandbox_homebrew_executable_path().is_some() {
            "Install VM Sandbox runtime: about 80-180 MB. Diff Forge will install QEMU with Homebrew."
                .to_string()
        } else {
            "Install Homebrew from https://brew.sh, then recheck or configure a managed QEMU runtime package."
                .to_string()
        }
    }

    #[cfg(target_os = "linux")]
    {
        "Install qemu-system with your package manager, or configure DIFFFORGE_VM_QEMU_RUNTIME_URL for a managed runtime ZIP."
            .to_string()
    }

    #[cfg(target_os = "windows")]
    {
        "Install QEMU for Windows or configure DIFFFORGE_VM_QEMU_RUNTIME_URL for a managed runtime ZIP."
            .to_string()
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        "Configure DIFFFORGE_VM_QEMU_RUNTIME_URL for a managed QEMU runtime ZIP."
            .to_string()
    }
}

fn vm_sandbox_runtime_installable(has_managed_url: bool) -> bool {
    has_managed_url || cfg!(target_os = "macos")
}

fn vm_sandbox_runtime_status_for(app: &AppHandle) -> Result<VmSandboxRuntimeStatus, String> {
    let runtime_directory = vm_sandbox_runtime_directory(app)?;
    let managed_runtime_path = vm_sandbox_find_managed_runtime(&runtime_directory);
    let runtime_path = managed_runtime_path
        .clone()
        .or_else(vm_sandbox_external_runtime_path);
    let runtime_installed = runtime_path.is_some();
    let managed_runtime_installed = managed_runtime_path.is_some();
    let managed_assets_installed =
        managed_runtime_installed || runtime_directory.exists() || vm_sandbox_runtime_archive_path(app)?.exists();
    let managed_url = vm_sandbox_configured_runtime_url();

    Ok(VmSandboxRuntimeStatus {
        installed: runtime_installed,
        runtime_installed,
        managed_runtime_installed,
        managed_assets_installed,
        external_runtime: runtime_installed && !managed_runtime_installed,
        runtime_name: VM_SANDBOX_RUNTIME_NAME,
        runtime_package_name: VM_SANDBOX_RUNTIME_PACKAGE_NAME,
        runtime_path: runtime_path
            .map(|path| path.display().to_string())
            .unwrap_or_else(|| runtime_directory.display().to_string()),
        runtime_directory: runtime_directory.display().to_string(),
        runtime_installable: vm_sandbox_runtime_installable(managed_url.is_some()),
        runtime_install_hint: vm_sandbox_install_hint(managed_url.is_some()),
        managed_runtime_package_url: managed_url,
        approximate_download_mb_min: VM_SANDBOX_RUNTIME_DOWNLOAD_MIN_MB,
        approximate_download_mb_max: VM_SANDBOX_RUNTIME_DOWNLOAD_MAX_MB,
        accelerator: vm_sandbox_host_accelerator(),
        host_os: env::consts::OS.to_string(),
        host_arch: env::consts::ARCH.to_string(),
    })
}

#[cfg(target_os = "macos")]
fn vm_sandbox_homebrew_executable_path() -> Option<PathBuf> {
    if let Some(brew) = vm_sandbox_find_executable_on_path(&["brew"]) {
        return Some(brew);
    }

    [
        PathBuf::from("/opt/homebrew/bin/brew"),
        PathBuf::from("/usr/local/bin/brew"),
    ]
    .into_iter()
    .find(|candidate| candidate.is_file())
}

#[cfg(target_os = "macos")]
fn vm_sandbox_install_runtime_with_homebrew(app: &AppHandle) -> Result<bool, String> {
    let Some(brew_path) = vm_sandbox_homebrew_executable_path() else {
        vm_sandbox_emit_progress(
            app,
            VmSandboxRuntimeProgress {
                state: "runtime-missing".to_string(),
                downloaded_bytes: 0,
                total_bytes: None,
                percent: Some(100.0),
                message: "Homebrew is required for automatic QEMU install on macOS."
                    .to_string(),
            },
        );

        return Ok(false);
    };

    vm_sandbox_emit_progress(
        app,
        VmSandboxRuntimeProgress {
            state: "installing".to_string(),
            downloaded_bytes: 0,
            total_bytes: None,
            percent: None,
            message: "Installing QEMU with Homebrew.".to_string(),
        },
    );

    let capture = run_command_capture(
        &brew_path.to_string_lossy(),
        &["install", "qemu"],
        None,
        Duration::from_secs(VM_SANDBOX_RUNTIME_INSTALL_TIMEOUT_SECS),
        None,
    )
    .map_err(|error| format!("Unable to run Homebrew: {error}"))?;

    if capture.exit_code != Some(0) {
        let detail = first_output_line(&command_output_text(&capture.stdout, &capture.stderr));

        vm_sandbox_emit_progress(
            app,
            VmSandboxRuntimeProgress {
                state: "runtime-missing".to_string(),
                downloaded_bytes: 0,
                total_bytes: None,
                percent: Some(100.0),
                message: "Homebrew could not install QEMU.".to_string(),
            },
        );

        if detail.is_empty() {
            return Err("Homebrew could not install QEMU.".to_string());
        }

        return Err(format!("Homebrew could not install QEMU: {detail}"));
    }

    vm_sandbox_emit_progress(
        app,
        VmSandboxRuntimeProgress {
            state: "installed".to_string(),
            downloaded_bytes: 0,
            total_bytes: None,
            percent: Some(100.0),
            message: "QEMU was installed with Homebrew.".to_string(),
        },
    );

    Ok(true)
}

fn vm_sandbox_sha256_file(path: &Path) -> Result<String, String> {
    let mut file =
        fs::File::open(path).map_err(|error| format!("Unable to verify VM runtime: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];

    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Unable to verify VM runtime: {error}"))?;

        if read == 0 {
            break;
        }

        hasher.update(&buffer[..read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

fn vm_sandbox_extract_zip_file(zip_path: &Path, destination: &Path) -> Result<(), String> {
    let file = fs::File::open(zip_path)
        .map_err(|error| format!("Unable to open VM runtime archive: {error}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| format!("Unable to read VM runtime archive: {error}"))?;

    fs::create_dir_all(destination)
        .map_err(|error| format!("Unable to prepare VM runtime directory: {error}"))?;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Unable to extract VM runtime: {error}"))?;
        let enclosed_name = entry
            .enclosed_name()
            .ok_or_else(|| "VM runtime archive contains an unsafe path.".to_string())?;
        let output_path = destination.join(enclosed_name);

        if entry.is_dir() {
            fs::create_dir_all(&output_path)
                .map_err(|error| format!("Unable to create VM runtime directory: {error}"))?;
            continue;
        }

        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Unable to prepare VM runtime directory: {error}"))?;
        }

        let mut output_file = fs::File::create(&output_path)
            .map_err(|error| format!("Unable to create VM runtime file: {error}"))?;
        std::io::copy(&mut entry, &mut output_file)
            .map_err(|error| format!("Unable to write VM runtime file: {error}"))?;
    }

    Ok(())
}

#[cfg(unix)]
fn vm_sandbox_mark_runtime_executable(runtime_path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let metadata = fs::metadata(runtime_path)
        .map_err(|error| format!("Unable to inspect VM runtime executable: {error}"))?;
    let mut permissions = metadata.permissions();
    permissions.set_mode(permissions.mode() | 0o755);
    fs::set_permissions(runtime_path, permissions)
        .map_err(|error| format!("Unable to mark VM runtime executable: {error}"))
}

#[cfg(not(unix))]
fn vm_sandbox_mark_runtime_executable(_runtime_path: &Path) -> Result<(), String> {
    Ok(())
}

async fn vm_sandbox_download_runtime_archive(
    app: &AppHandle,
    runtime_url: &str,
    expected_sha256: Option<&str>,
) -> Result<PathBuf, String> {
    let data_directory = vm_sandbox_data_directory(app)?;
    let archive_path = vm_sandbox_runtime_archive_path(app)?;
    let temp_path = data_directory.join(format!("{}.download", vm_sandbox_runtime_archive_name()));

    fs::create_dir_all(&data_directory)
        .map_err(|error| format!("Unable to prepare VM runtime directory: {error}"))?;

    vm_sandbox_emit_progress(
        app,
        VmSandboxRuntimeProgress {
            state: "downloading".to_string(),
            downloaded_bytes: 0,
            total_bytes: None,
            percent: None,
            message: "Downloading VM Sandbox runtime.".to_string(),
        },
    );

    let client = http_client(Duration::from_secs(VM_SANDBOX_RUNTIME_INSTALL_TIMEOUT_SECS))?;
    let mut response = client
        .get(runtime_url)
        .send()
        .await
        .map_err(|error| format!("Unable to download VM runtime: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "VM runtime download returned HTTP {}.",
            response.status()
        ));
    }

    let total_bytes = response.content_length();
    let mut downloaded_bytes = 0u64;
    let mut file = fs::File::create(&temp_path)
        .map_err(|error| format!("Unable to write VM runtime: {error}"))?;

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("Unable to read VM runtime download: {error}"))?
    {
        file.write_all(&chunk)
            .map_err(|error| format!("Unable to write VM runtime: {error}"))?;
        downloaded_bytes += chunk.len() as u64;
        let percent = total_bytes
            .filter(|total| *total > 0)
            .map(|total| (downloaded_bytes as f64 / total as f64) * 100.0);

        vm_sandbox_emit_progress(
            app,
            VmSandboxRuntimeProgress {
                state: "downloading".to_string(),
                downloaded_bytes,
                total_bytes,
                percent,
                message: "Downloading VM Sandbox runtime.".to_string(),
            },
        );
    }

    file.flush()
        .map_err(|error| format!("Unable to finish VM runtime write: {error}"))?;

    if let Some(expected_sha256) = expected_sha256 {
        let downloaded_sha256 = vm_sandbox_sha256_file(&temp_path)?;
        if downloaded_sha256 != expected_sha256 {
            let _ = fs::remove_file(&temp_path);
            return Err("Downloaded VM runtime failed checksum verification.".to_string());
        }
    }

    fs::rename(&temp_path, &archive_path)
        .map_err(|error| format!("Unable to install VM runtime archive: {error}"))?;

    Ok(archive_path)
}

#[tauri::command(rename_all = "snake_case")]
async fn vm_sandbox_runtime_status(app: AppHandle) -> Result<VmSandboxRuntimeStatus, String> {
    vm_sandbox_runtime_status_for(&app)
}

#[tauri::command(rename_all = "snake_case")]
async fn vm_sandbox_install_runtime(
    app: AppHandle,
    vm_sandbox_state: State<'_, VmSandboxState>,
) -> Result<VmSandboxRuntimeStatus, String> {
    let _install_guard = vm_sandbox_state.install_lock.lock().await;

    let (existing_runtime, _) = vm_sandbox_runtime_path(&app)?;
    if existing_runtime.is_some() {
        vm_sandbox_emit_progress(
            &app,
            VmSandboxRuntimeProgress {
                state: "done".to_string(),
                downloaded_bytes: 0,
                total_bytes: None,
                percent: Some(100.0),
                message: "VM Sandbox runtime is already available.".to_string(),
            },
        );
        return vm_sandbox_runtime_status_for(&app);
    }

    if let Some(runtime_url) = vm_sandbox_configured_runtime_url() {
        let runtime_sha256 = vm_sandbox_configured_runtime_sha256();
        let runtime_directory = vm_sandbox_runtime_directory(&app)?;
        let archive_path =
            vm_sandbox_download_runtime_archive(&app, &runtime_url, runtime_sha256.as_deref())
                .await?;

        vm_sandbox_emit_progress(
            &app,
            VmSandboxRuntimeProgress {
                state: "extracting".to_string(),
                downloaded_bytes: 0,
                total_bytes: None,
                percent: None,
                message: "Installing VM Sandbox runtime.".to_string(),
            },
        );

        vm_sandbox_extract_zip_file(&archive_path, &runtime_directory)?;
        let Some(runtime_path) = vm_sandbox_find_managed_runtime(&runtime_directory) else {
            return Err("VM runtime package did not include qemu-system.".to_string());
        };
        vm_sandbox_mark_runtime_executable(&runtime_path)?;

        vm_sandbox_emit_progress(
            &app,
            VmSandboxRuntimeProgress {
                state: "done".to_string(),
                downloaded_bytes: 0,
                total_bytes: None,
                percent: Some(100.0),
                message: "VM Sandbox runtime is installed.".to_string(),
            },
        );

        return vm_sandbox_runtime_status_for(&app);
    }

    #[cfg(target_os = "macos")]
    {
        if vm_sandbox_install_runtime_with_homebrew(&app)? {
            return vm_sandbox_runtime_status_for(&app);
        }
    }

    vm_sandbox_emit_progress(
        &app,
        VmSandboxRuntimeProgress {
            state: "runtime-missing".to_string(),
            downloaded_bytes: 0,
            total_bytes: None,
            percent: Some(100.0),
            message: vm_sandbox_install_hint(false),
        },
    );

    vm_sandbox_runtime_status_for(&app)
}
