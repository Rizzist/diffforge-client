fn is_safe_auth_value(value: &str) -> bool {
    let value_length = value.len();

    value_length >= MIN_AUTH_VALUE_LENGTH
        && value_length <= MAX_AUTH_VALUE_LENGTH
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn validate_auth_value(label: &str, value: &str) -> Result<(), String> {
    if is_safe_auth_value(value) {
        return Ok(());
    }

    Err(format!("{label} is invalid."))
}

#[cfg(windows)]
type WindowsHandle = *mut std::ffi::c_void;

#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetModuleHandleW(module_name: *const u16) -> WindowsHandle;
}

#[cfg(windows)]
#[link(name = "user32")]
unsafe extern "system" {
    fn GetSystemMetrics(index: i32) -> i32;
    fn LoadImageW(
        instance: WindowsHandle,
        name: *const u16,
        image_type: u32,
        width: i32,
        height: i32,
        load_flags: u32,
    ) -> WindowsHandle;
    fn SendMessageW(hwnd: WindowsHandle, message: u32, wparam: usize, lparam: isize) -> isize;
    fn SetClassLongPtrW(hwnd: WindowsHandle, index: i32, value: isize) -> isize;
}

fn is_safe_terminal_pane_id(value: &str) -> bool {
    let value_length = value.len();

    value_length >= 3
        && value_length <= 96
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn validate_terminal_pane_id(value: &str) -> Result<(), String> {
    if is_safe_terminal_pane_id(value) {
        return Ok(());
    }

    Err("Terminal pane id is invalid.".to_string())
}
