//! Tauri invoke handlers backing the native Email Delivery settings panel
//! (plan §4.3). Profiles are configured on-device only (the dashboard never
//! sees credentials); password fields are write-only and an untouched save
//! preserves the stored secret. These commands wrap the journal + credential
//! stack + preflight modules; the JS contract lives in
//! `src/email/emailDeliveryContract.js`.

use serde_json::{json, Value};

use super::capability::email_capability_block;
use super::cli::credential_store_report;
use super::credentials::CredentialStack;
use super::journal::EmailJournal;
use super::preflight::{PreflightObservations, PreflightRun};
use super::profiles::{self, ProfileSaveRequest};

fn open() -> Result<(EmailJournal, CredentialStack), String> {
    Ok((EmailJournal::open_default()?, CredentialStack::new()))
}

#[tauri::command(rename_all = "snake_case")]
pub async fn email_delivery_profiles_list() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let (journal, _credentials) = open()?;
        let profiles = profiles::list_profiles(&journal)?;
        Ok::<Value, String>(json!({
            "profiles": profiles
                .iter()
                .map(profiles::SenderProfile::summary)
                .collect::<Vec<_>>(),
        }))
    })
    .await
    .map_err(|error| format!("email_delivery_profiles_list join failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn email_delivery_profile_save(request: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (mut journal, credentials) = open()?;
        let save = ProfileSaveRequest::from_value(&request)?;
        let profile = profiles::save_profile(&mut journal, &credentials, &save)?;
        Ok::<Value, String>(json!({ "profile": profile.summary() }))
    })
    .await
    .map_err(|error| format!("email_delivery_profile_save join failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn email_delivery_profile_delete(profile_ref: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (mut journal, credentials) = open()?;
        let deleted = profiles::delete_profile(&mut journal, &credentials, &profile_ref)?;
        Ok::<Value, String>(json!({ "deleted": deleted }))
    })
    .await
    .map_err(|error| format!("email_delivery_profile_delete join failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn email_delivery_profile_probe(profile_ref: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (journal, credentials) = open()?;
        profiles::probe_profile_credentials(&journal, &credentials, &profile_ref)
    })
    .await
    .map_err(|error| format!("email_delivery_profile_probe join failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
pub async fn email_delivery_capability_snapshot() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let credentials = CredentialStack::new();
        let journal_health = EmailJournal::open_default()
            .and_then(|journal| journal.health_check())
            .unwrap_or_else(|error| json!({ "ok": false, "error": error }));
        Ok::<Value, String>(json!({
            "capability": email_capability_block(),
            "credential_store": credential_store_report(&credentials),
            "journal": journal_health,
        }))
    })
    .await
    .map_err(|error| format!("email_delivery_capability_snapshot join failed: {error}"))?
}

/// Run a LOCAL-only preflight snapshot for the settings checklist: fills the
/// checks the device can observe without network probing (journal health,
/// credential store, clock), leaving network checks pending. Live probing is
/// operator-gated and never runs from the UI (brief: no live probes).
#[tauri::command(rename_all = "snake_case")]
pub async fn email_delivery_preflight_local(
    profile_ref: String,
    domain: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (journal, credentials) = open()?;
        let journal_healthy = journal.health_check().map(|value| {
            value.get("ok").and_then(Value::as_bool).unwrap_or(false)
        });
        let credential_healthy = matches!(
            credentials.health(),
            super::credentials::CredentialStoreHealth::Healthy
        );
        let observations = PreflightObservations {
            journal_healthy: journal_healthy.ok(),
            credential_store_healthy: Some(credential_healthy),
            // Network + reputation checks are left as `pending`: the UI shows
            // them awaiting the operator-run qualification.
            ..PreflightObservations::default()
        };
        let run = PreflightRun::build(
            &crate::cloud_mcp_email_device_id(),
            &profile_ref,
            &domain,
            &observations,
            false,
        );
        Ok::<Value, String>(json!({ "preflight": run.to_wire() }))
    })
    .await
    .map_err(|error| format!("email_delivery_preflight_local join failed: {error}"))?
}
