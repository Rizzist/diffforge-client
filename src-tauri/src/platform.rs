#[cfg(windows)]
fn windows_resource_id(resource_id: u16) -> *const u16 {
    resource_id as usize as *const u16
}

#[cfg(windows)]
fn windows_metric(index: i32, fallback: i32) -> i32 {
    let value = unsafe { GetSystemMetrics(index) };

    if value > 0 {
        value
    } else {
        fallback
    }
}

#[cfg(windows)]
fn load_windows_app_icon(width: i32, height: i32) -> Option<isize> {
    let module = unsafe { GetModuleHandleW(std::ptr::null()) };

    if module.is_null() {
        return None;
    }

    let icon = unsafe {
        LoadImageW(
            module,
            windows_resource_id(WINDOWS_APP_ICON_RESOURCE_ID),
            IMAGE_ICON,
            width,
            height,
            LR_DEFAULTCOLOR,
        )
    };

    if icon.is_null() {
        None
    } else {
        Some(icon as isize)
    }
}

#[cfg(windows)]
fn pin_windows_hang_icon(hwnd: WindowsHandle) {
    if hwnd.is_null() {
        return;
    }

    if let Some(icon) =
        load_windows_app_icon(windows_metric(SM_CXICON, 32), windows_metric(SM_CYICON, 32))
    {
        unsafe {
            SendMessageW(hwnd, WM_SETICON, ICON_BIG, icon);
            SetClassLongPtrW(hwnd, GCLP_HICON, icon);
        }
    }

    if let Some(icon) = load_windows_app_icon(
        windows_metric(SM_CXSMICON, 16),
        windows_metric(SM_CYSMICON, 16),
    ) {
        unsafe {
            SendMessageW(hwnd, WM_SETICON, ICON_SMALL, icon);
            SetClassLongPtrW(hwnd, GCLP_HICONSM, icon);
        }
    }
}

