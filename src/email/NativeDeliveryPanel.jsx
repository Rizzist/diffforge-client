import { useCallback, useMemo, useState } from "react";

import {
  EMAIL_PREFLIGHT_CHECK_LABELS,
  runLocalEmailPreflight,
} from "./emailDeliveryContract.js";
import {
  EmailField,
  EmailFieldGrid,
  EmailFieldHint,
  EmailFieldLabel,
  EmailFieldRow,
  EmailFormActions,
  EmailInlineButton,
  EmailInput,
  EmailMessage,
  EmailPreflightBadge,
  EmailPreflightItem,
  EmailPreflightList,
  EmailPreflightMain,
  EmailPreflightStatusDot,
} from "./emailStyles.js";

const RESULT_TONES = {
  qualified: "success",
  pending: "info",
  failed: "error",
  degraded: "error",
};

const RESULT_COPY = {
  qualified: "This device is qualified for native delivery.",
  pending:
    "Checks the device can run locally look good; the network checks await the operator-run qualification (real DNS, port 25 from outside, seed delivery).",
  failed: "A required check is failing — native delivery is unavailable until it is fixed.",
  degraded: "Previously qualified, but a check has regressed. Re-run qualification.",
};

// Native-delivery qualification checklist. Runs the LOCAL preflight snapshot
// (journal health, credential store, runtime); the network/reputation checks
// render as pending with their remediation text — live probing is
// operator-gated and never launched from this panel.
export function NativeDeliveryPanel({ profiles = [] }) {
  const nativeProfile = useMemo(
    () => profiles.find((profile) => profile.mode === "native") || profiles[0] || null,
    [profiles],
  );
  const [domain, setDomain] = useState("");
  const [preflight, setPreflight] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const runChecklist = useCallback(async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await runLocalEmailPreflight(
        nativeProfile?.profile_ref || "",
        domain.trim(),
      );
      setPreflight(result?.preflight || null);
    } catch (runError) {
      setError(
        typeof runError === "string"
          ? runError
          : runError?.message || "Unable to run the local preflight checklist.",
      );
    } finally {
      setBusy(false);
    }
  }, [busy, domain, nativeProfile]);

  const checks = Array.isArray(preflight?.checks) ? preflight.checks : [];
  const result = preflight?.result || null;

  return (
    <EmailFieldGrid>
      <EmailFieldHint>
        Native delivery sends straight to recipient mail servers from this machine. It
        requires a public static IP, outbound port 25, forward-confirmed reverse DNS, and
        published SPF/DKIM/DMARC — the checklist below tracks each requirement with what to
        fix when it fails. Full qualification (live DNS, outside-in port 25, seed delivery)
        is run by the operator flow; this panel refreshes the checks the device can verify
        locally.
      </EmailFieldHint>

      <EmailFieldRow $columns="1fr auto">
        <EmailField>
          <EmailFieldLabel>Sending domain</EmailFieldLabel>
          <EmailInput
            autoCapitalize="none"
            autoCorrect="off"
            disabled={busy}
            onChange={(event) => setDomain(event.target.value)}
            placeholder="yourdomain.com"
            spellCheck={false}
            value={domain}
          />
        </EmailField>
        <EmailFormActions style={{ alignSelf: "end" }}>
          <EmailInlineButton
            data-variant="primary"
            disabled={busy || !domain.trim()}
            onClick={runChecklist}
            type="button"
          >
            {busy ? "Checking…" : "Run local checks"}
          </EmailInlineButton>
        </EmailFormActions>
      </EmailFieldRow>

      {error && <EmailMessage data-tone="error">{error}</EmailMessage>}

      {result && (
        <EmailMessage data-tone={RESULT_TONES[result] || "info"}>
          {RESULT_COPY[result] || `Preflight result: ${result}`}
        </EmailMessage>
      )}

      {checks.length > 0 && (
        <EmailPreflightList>
          {checks.map((check) => (
            <EmailPreflightItem key={check.check_id}>
              <EmailPreflightStatusDot data-status={check.status} />
              <EmailPreflightMain>
                <strong>
                  {EMAIL_PREFLIGHT_CHECK_LABELS[check.check_id] || check.check_id}
                  {check.required ? "" : " (advisory)"}
                </strong>
                <span>
                  {check.observed || "Not yet observed"} · expected: {check.expected}
                </span>
                {check.remediation && <em>Fix: {check.remediation}</em>}
              </EmailPreflightMain>
              <EmailPreflightBadge data-status={check.status}>
                {check.status}
              </EmailPreflightBadge>
            </EmailPreflightItem>
          ))}
        </EmailPreflightList>
      )}
    </EmailFieldGrid>
  );
}
