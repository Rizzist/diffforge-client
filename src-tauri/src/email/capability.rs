//! Device email capability block (plan §4.3, contract §8/§9.5). Built into
//! the device profile json so the cloud knows this device's email
//! capability version, modes, runtime, and credential-store health — and
//! suppresses `email_send` to devices below its minimum (§9.5).

use serde_json::{json, Value};

use super::contract::EMAIL_CAPABILITY_VERSION;

/// Runtime classification reported to the cloud (§8 `runtime` enum).
pub fn runtime_kind() -> &'static str {
    if crate::daemon_mode_active() {
        "daemon"
    } else if crate::app_is_in_background_mode() {
        "background"
    } else {
        "gui"
    }
}

/// HONEST capability advertisement (review #11): the native MX/DKIM/rate
/// engine exists and is fully tested, but it has no production caller in the
/// send state machine yet — a leased native job cannot execute end-to-end.
/// Until the lease-aware, journaled native worker is wired in, the device
/// MUST NOT advertise native mode: advertising it would let the cloud lease
/// native jobs that stall nonterminally and get reoffered forever. Flip this
/// to true ONLY together with that wiring.
pub const NATIVE_SEND_WIRED: bool = false;

/// The §8 `modes` list this device truthfully supports end-to-end.
pub fn supported_modes() -> Vec<&'static str> {
    if NATIVE_SEND_WIRED {
        vec!["provider", "native"]
    } else {
        vec!["provider"]
    }
}

/// The `email_capability` object folded into
/// `cloud_mcp_desktop_device_profile` (§28273 region). Content-free about
/// individual profiles; the full capability list rides
/// `email_sender_capabilities_sync`. Uses the CACHED credential-store
/// health — the device profile is on hot ack/presence paths and must never
/// block on a Keychain probe.
pub fn email_capability_block() -> Value {
    let credential_store = super::credentials::cached_store_health().as_str();
    json!({
        "capability_version": EMAIL_CAPABILITY_VERSION,
        "modes": supported_modes(),
        "runtime": runtime_kind(),
        "credential_store": credential_store,
        // Native send additionally requires a runtime that can stay
        // reachable (daemon or background) — a foreground-only GUI cannot
        // host the always-on wake path, though provider mode still works.
        "native_capable": NATIVE_SEND_WIRED && matches!(runtime_kind(), "daemon" | "background"),
    })
}

/// Whether this device meets a cloud-declared minimum capability version.
/// Version skew never produces a parse failure by construction (§9.5).
pub fn meets_minimum(min_required_version: u64) -> bool {
    EMAIL_CAPABILITY_VERSION >= min_required_version
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capability_block_shape() {
        let block = email_capability_block();
        assert_eq!(
            block["capability_version"].as_u64(),
            Some(EMAIL_CAPABILITY_VERSION)
        );
        // Honest advertisement (review #11): native is only listed when the
        // native delivery worker is actually wired into the state machine.
        if NATIVE_SEND_WIRED {
            assert_eq!(block["modes"], json!(["provider", "native"]));
        } else {
            assert_eq!(
                block["modes"],
                json!(["provider"]),
                "no phantom native mode"
            );
            assert_eq!(block["native_capable"], json!(false));
        }
        assert!(block["runtime"].is_string());
        assert!(block["credential_store"].is_string());
        assert!(block["native_capable"].is_boolean());
    }

    #[test]
    fn native_mode_stays_gated_until_worker_wired() {
        // Regression tripwire: if someone flips NATIVE_SEND_WIRED they must
        // ALSO wire the lease-aware journaled native path into
        // submission::run_leased_send (which currently abandons native
        // grants). This assertion makes the flip a conscious two-site change.
        assert!(
            !NATIVE_SEND_WIRED,
            "flipping NATIVE_SEND_WIRED requires wiring the native delivery worker \
             into the send state machine (submission.rs run_leased_send)"
        );
        assert_eq!(supported_modes(), vec!["provider"]);
    }

    #[test]
    fn minimum_version_gate() {
        assert!(meets_minimum(EMAIL_CAPABILITY_VERSION));
        assert!(meets_minimum(0));
        assert!(!meets_minimum(EMAIL_CAPABILITY_VERSION + 1));
    }
}
