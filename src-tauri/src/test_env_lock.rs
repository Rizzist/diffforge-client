// Test-only serialization for process-global environment changes. Libtest
// runs tests on parallel threads, while environment variables belong to the
// whole process. The thread-local depth makes nested guards on one test thread
// re-entrant without weakening exclusion between different test threads.

static PROCESS_TEST_ENV_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());
static PROCESS_TEST_ENV_ISOLATION_COUNT: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

thread_local! {
    static PROCESS_TEST_ENV_DEPTH: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    static PROCESS_TEST_ENV_MUTEX_GUARD:
        std::cell::RefCell<Option<std::sync::MutexGuard<'static, ()>>> =
            const { std::cell::RefCell::new(None) };
}

struct ProcessTestEnvIsolationGuard {
    _lock: ProcessTestEnvLock,
}

fn process_test_env_isolation() -> ProcessTestEnvIsolationGuard {
    let lock = process_test_env_lock();
    PROCESS_TEST_ENV_ISOLATION_COUNT
        .fetch_update(
            std::sync::atomic::Ordering::SeqCst,
            std::sync::atomic::Ordering::SeqCst,
            |count| count.checked_add(1),
        )
        .expect("process test env isolation count overflowed");
    ProcessTestEnvIsolationGuard { _lock: lock }
}

fn process_test_env_isolation_active() -> bool {
    PROCESS_TEST_ENV_ISOLATION_COUNT.load(std::sync::atomic::Ordering::SeqCst) > 0
}

fn assert_process_test_storage_isolation(storage_kind: &str) {
    assert!(
        process_test_env_isolation_active(),
        "env-derived {storage_kind} storage resolution requires process_test_storage_isolation()",
    );
}

fn process_test_protected_email_storage_path(filename: &str) -> Option<std::path::PathBuf> {
    if process_test_env_isolation_active()
        || !matches!(
            filename,
            crate::email::encrypted_vault::VAULT_FILE | crate::email::journal::EMAIL_JOURNAL_FILE
        )
    {
        return None;
    }

    // The email tree is protected in this pass, so its direct unit tests cannot
    // acquire the new guard at their call sites. Keep those two artifacts away
    // from an authority-derived user root by giving each libtest thread an
    // isolated default. Calls from production-shaped worker threads still hit
    // the assertion below instead of silently sharing this compatibility root.
    let thread = std::thread::current();
    let test_name = thread.name().filter(|name| name.starts_with("email::"))?;
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    std::hash::Hash::hash(test_name, &mut hash);
    let root = std::env::temp_dir()
        .join(format!(
            "diffforge-protected-email-test-storage-{}",
            std::process::id()
        ))
        .join(format!("{:016x}", std::hash::Hasher::finish(&hash)));
    std::fs::create_dir_all(&root).expect("create protected email test storage root");
    Some(root.join(filename))
}

impl Drop for ProcessTestEnvIsolationGuard {
    fn drop(&mut self) {
        PROCESS_TEST_ENV_ISOLATION_COUNT
            .fetch_update(
                std::sync::atomic::Ordering::SeqCst,
                std::sync::atomic::Ordering::SeqCst,
                |count| count.checked_sub(1),
            )
            .expect("process test env isolation count underflowed");
    }
}

struct ProcessTestStorageIsolationGuard {
    root: std::path::PathBuf,
    cache_root: std::path::PathBuf,
    _data_env: ProcessTestEnvVarGuard,
    _cache_env: ProcessTestEnvVarGuard,
    _isolation: ProcessTestEnvIsolationGuard,
}

fn process_test_storage_isolation(label: &str) -> ProcessTestStorageIsolationGuard {
    let isolation = process_test_env_isolation();
    let root = std::env::temp_dir().join(format!(
        "diffforge-test-storage-{label}-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let data_root = root.join("data");
    let cache_root = root.join("cache");
    std::fs::create_dir_all(&data_root).unwrap();
    std::fs::create_dir_all(&cache_root).unwrap();
    let data_env = ProcessTestEnvVarGuard::set("RUST_DIFFFORGE_DATA_DIR", &data_root);
    let cache_env = ProcessTestEnvVarGuard::set("RUST_DIFFFORGE_CACHE_DIR", &cache_root);
    ProcessTestStorageIsolationGuard {
        root,
        cache_root,
        _data_env: data_env,
        _cache_env: cache_env,
        _isolation: isolation,
    }
}

impl Drop for ProcessTestStorageIsolationGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

struct ProcessTestEnvLock {
    // The depth and stored MutexGuard belong to the acquiring thread.
    _not_send: std::marker::PhantomData<std::rc::Rc<()>>,
}

fn process_test_env_lock() -> ProcessTestEnvLock {
    PROCESS_TEST_ENV_DEPTH.with(|depth| {
        let current = depth.get();
        if current == 0 {
            let guard = PROCESS_TEST_ENV_MUTEX
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            PROCESS_TEST_ENV_MUTEX_GUARD.with(|slot| {
                debug_assert!(slot.borrow().is_none());
                *slot.borrow_mut() = Some(guard);
            });
        }
        depth.set(
            current
                .checked_add(1)
                .expect("process test env lock depth overflowed"),
        );
    });
    ProcessTestEnvLock {
        _not_send: std::marker::PhantomData,
    }
}

impl Drop for ProcessTestEnvLock {
    fn drop(&mut self) {
        PROCESS_TEST_ENV_DEPTH.with(|depth| {
            let current = depth.get();
            debug_assert!(current > 0);
            let next = current.saturating_sub(1);
            depth.set(next);
            if next == 0 {
                PROCESS_TEST_ENV_MUTEX_GUARD.with(|slot| {
                    slot.borrow_mut().take();
                });
            }
        });
    }
}

struct ProcessTestEnvVarGuard {
    key: &'static str,
    previous: Option<std::ffi::OsString>,
    _lock: ProcessTestEnvLock,
}

impl ProcessTestEnvVarGuard {
    fn set(key: &'static str, value: impl AsRef<std::ffi::OsStr>) -> Self {
        let lock = process_test_env_lock();
        let previous = std::env::var_os(key);
        std::env::set_var(key, value);
        Self {
            key,
            previous,
            _lock: lock,
        }
    }

    fn set_str(key: &'static str, value: &str) -> Self {
        Self::set(key, value)
    }

    fn remove(key: &'static str) -> Self {
        let lock = process_test_env_lock();
        let previous = std::env::var_os(key);
        std::env::remove_var(key);
        Self {
            key,
            previous,
            _lock: lock,
        }
    }
}

impl Drop for ProcessTestEnvVarGuard {
    fn drop(&mut self) {
        match self.previous.take() {
            Some(previous) => std::env::set_var(self.key, previous),
            None => std::env::remove_var(self.key),
        }
    }
}

#[test]
fn process_test_storage_isolation_is_visible_to_worker_threads() {
    let _storage = process_test_storage_isolation("worker-visible-isolation");
    let worker_observed_isolation = std::thread::spawn(process_test_env_isolation_active)
        .join()
        .expect("isolation observer worker panicked");
    assert!(
        worker_observed_isolation,
        "spawned work must see env isolation before it can start a detached storage worker",
    );
}

#[test]
fn env_derived_storage_resolution_rejects_missing_process_isolation() {
    // Holding the env mutex without incrementing the storage-isolation count
    // makes this deterministic even while libtest runs other tests in parallel:
    // no guarded storage reader can overlap these deliberately unguarded calls.
    let _env_lock = process_test_env_lock();
    assert!(!process_test_env_isolation_active());

    for (storage_kind, resolver) in [
        (
            "cache",
            cloud_mcp_outbox_db_path as fn() -> Option<std::path::PathBuf>,
        ),
        (
            "data",
            cloud_mcp_credit_ledger_db_path as fn() -> Option<std::path::PathBuf>,
        ),
    ] {
        let panic = match std::panic::catch_unwind(resolver) {
            Ok(_) => panic!("unguarded {storage_kind} resolution did not panic"),
            Err(panic) => panic,
        };
        let message = panic
            .downcast_ref::<String>()
            .map(String::as_str)
            .or_else(|| panic.downcast_ref::<&str>().copied())
            .unwrap_or("non-string panic");
        assert!(
            message.contains(&format!(
                "env-derived {storage_kind} storage resolution requires process_test_storage_isolation()"
            )),
            "unexpected storage-boundary panic: {message}",
        );
    }
}
