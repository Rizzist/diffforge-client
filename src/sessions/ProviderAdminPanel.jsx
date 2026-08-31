import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";

import { fenceFor } from "./providerAdminModel.js";

const API_FAMILIES = [
  "anthropic_messages",
  "openai_responses",
  "openai_chat_completions",
  "gemini_generate_content",
];
const AUTH_REQUIREMENTS = ["api_key", "o_auth", "none"];

function blankForm() {
  return {
    provider: "",
    apiFamily: "",
    origin: "",
    authRequirement: "",
    enabled: true,
    models: "",
    includeDefaultModel: false,
    defaultModel: "",
    includeResponseOpenTimeout: false,
    responseOpenTimeoutMs: "",
    includeChunkIdleTimeout: false,
    chunkIdleTimeoutMs: "",
    includeSemanticProgressTimeout: false,
    semanticProgressTimeoutMs: "",
  };
}

function formFromRow(row) {
  return {
    ...blankForm(),
    provider: row.name || "",
    enabled: row.enabled === true,
    models: Array.isArray(row.models) ? row.models.join("\n") : "",
  };
}

function modelsFromText(value) {
  return [...new Set(String(value || "")
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean))];
}

function publishedValue(value) {
  return value === undefined ? "not published" : String(value);
}

function categoryLabel(view) {
  return view?.label || "not published";
}

function quotaLabel(status) {
  if (!status) return "Quota not published";
  return `${publishedValue(status.quotaUsed)} used / ${publishedValue(status.quotaLimit)} bytes limit`;
}

function OptionalNumberField({
  checked,
  label,
  onChecked,
  onValue,
  value,
}) {
  return (
    <OptionalField>
      <label>
        <input
          checked={checked}
          onChange={(event) => onChecked(event.target.checked)}
          type="checkbox"
        />
        Set {label}
      </label>
      {checked ? (
        <input
          aria-label={label}
          min="0"
          onChange={(event) => onValue(event.target.value)}
          placeholder="milliseconds"
          step="1"
          type="number"
          value={value}
        />
      ) : (
        <FieldHint>Omitted; the daemon keeps its stored value.</FieldHint>
      )}
    </OptionalField>
  );
}

export default function ProviderAdminPanel({
  configureError = "",
  configurePending = false,
  configureUnavailable = false,
  conflict = null,
  globalLockdown = undefined,
  lastReceipt = null,
  lockdownByProvider = {},
  lockdownError = "",
  lockdownLoading = false,
  lockdownUnavailable = false,
  onConfigure = null,
  onRefresh = null,
  onRemove = null,
  onSetQuota = null,
  onSetTrust = null,
  providerAvailability = undefined,
  providerRevision = undefined,
  providers = undefined,
  quotaPending = false,
  removeError = "",
  removePendingByProvider = {},
  removeUnavailable = false,
  trustPendingByProvider = {},
}) {
  const [formMode, setFormMode] = useState("");
  const [form, setForm] = useState(blankForm);
  const [formRevision, setFormRevision] = useState(undefined);
  const [formIdentity, setFormIdentity] = useState(null);
  const [formError, setFormError] = useState("");
  const [removeReview, setRemoveReview] = useState(null);
  const [trustReview, setTrustReview] = useState(null);
  const [quotaDraft, setQuotaDraft] = useState("");
  const [quotaReview, setQuotaReview] = useState(null);
  const conflictedProviderNames = Array.isArray(conflict?.conflictedProviders)
    ? conflict.conflictedProviders
    : typeof conflict?.provider === "string" ? [conflict.provider] : [];
  const conflictedProvidersKey = [...new Set(conflictedProviderNames)].sort().join("\u0000");
  const conflictedProviders = useMemo(
    () => new Set(conflictedProvidersKey ? conflictedProvidersKey.split("\u0000") : []),
    [conflictedProvidersKey],
  );

  /* A conflict invalidates every local disclosure holding that provider's
     fence. Closing it forces the next review to be built from the re-read row. */
  useEffect(() => {
    if (!conflictedProvidersKey) return;
    setRemoveReview((current) => (
      current?.name && conflictedProviders.has(current.name) ? null : current
    ));
    setTrustReview((current) => (
      current?.row?.name && conflictedProviders.has(current.row.name) ? null : current
    ));
    if (formMode && conflictedProviders.has(form.provider.trim())) {
      setFormMode("");
      setForm(blankForm());
      setFormRevision(undefined);
      setFormIdentity(null);
      setFormError("");
    }
  }, [conflictedProviders, conflictedProvidersKey]);

  const openCreate = () => {
    setForm(blankForm());
    setFormRevision(providerRevision);
    setFormIdentity(null);
    setFormError("");
    setFormMode("create");
  };
  const openUpdate = (row) => {
    setForm(formFromRow(row));
    setFormRevision(fenceFor(row));
    setFormIdentity({ apiFamily: row.apiFamily, origin: row.origin });
    setFormError("");
    setFormMode("update");
  };
  const closeForm = () => {
    setFormMode("");
    setForm(blankForm());
    setFormRevision(undefined);
    setFormIdentity(null);
    setFormError("");
  };
  const patchForm = (patch) => setForm((current) => ({ ...current, ...patch }));

  const submitConfigure = async (event) => {
    event.preventDefault();
    const provider = form.provider.trim();
    if (!provider) {
      setFormError("Enter a provider name.");
      return;
    }
    if (formMode === "create" && !form.apiFamily) {
      setFormError("Choose the provider API family explicitly.");
      return;
    }
    if (formRevision === undefined) {
      setFormError("Provider revision is not published. Re-read provider authority before submitting.");
      return;
    }
    const fields = {
      provider,
      enabled: form.enabled,
      models: modelsFromText(form.models),
      expectedRevision: formRevision,
    };
    if (formMode === "create") {
      fields.apiFamily = form.apiFamily;
      if (form.origin.trim()) fields.origin = form.origin.trim();
    }
    if (form.authRequirement) fields.authRequirement = form.authRequirement;
    if (form.includeDefaultModel) {
      if (!form.defaultModel.trim()) {
        setFormError("Enter the default model to set, or leave that option omitted.");
        return;
      }
      fields.defaultModel = form.defaultModel.trim();
    }
    for (const [included, value, key, label] of [
      [form.includeResponseOpenTimeout, form.responseOpenTimeoutMs, "responseOpenTimeoutMs", "response-open timeout"],
      [form.includeChunkIdleTimeout, form.chunkIdleTimeoutMs, "chunkIdleTimeoutMs", "chunk-idle timeout"],
      [form.includeSemanticProgressTimeout, form.semanticProgressTimeoutMs, "semanticProgressTimeoutMs", "semantic-progress timeout"],
    ]) {
      if (!included) continue;
      const number = Number(value);
      if (!Number.isSafeInteger(number) || number < 0) {
        setFormError(`Enter a non-negative safe integer for ${label}.`);
        return;
      }
      fields[key] = number;
    }
    setFormError("");
    const receipt = await onConfigure?.(formMode, fields);
    if (receipt) closeForm();
  };

  const reviewQuota = () => {
    const bytes = Number(quotaDraft);
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      setFormError("Lockdown quota must be a non-negative safe integer of bytes.");
      return;
    }
    setFormError("");
    setQuotaReview({ bytes });
  };

  const availabilityState = typeof providerAvailability?.state === "string"
    ? providerAvailability.state
    : null;
  const availabilityReason = typeof providerAvailability?.reason === "string"
    ? providerAvailability.reason
    : "";
  const rowsPublished = Array.isArray(providers);

  return (
    <Panel aria-label="Providers">
      <PanelHeader>
        <div>
          <Eyebrow>Daemon provider management</Eyebrow>
          <h2>Providers</h2>
          <p>Configure provider identity and runtime policy without changing the session model picker.</p>
        </div>
        <HeaderActions>
          <SecondaryButton disabled={lockdownLoading} onClick={() => onRefresh?.()} type="button">
            {lockdownLoading ? "Reading…" : "Re-read authority"}
          </SecondaryButton>
          <PrimaryButton
            disabled={configureUnavailable || providerRevision === undefined}
            onClick={openCreate}
            type="button"
          >
            Configure new provider
          </PrimaryButton>
        </HeaderActions>
      </PanelHeader>

      <AuthorityBar data-state={availabilityState || "unknown"}>
        <span>Provider-list revision: <strong>{publishedValue(providerRevision)}</strong></span>
        <span>
          Authority: <strong>{availabilityState || "not published"}</strong>
          {availabilityState && !["available", "unavailable", "unknown"].includes(availabilityState)
            ? " (unrecognized)"
            : ""}
        </span>
      </AuthorityBar>

      {conflict ? (
        <Notice data-tone="error" role="alert">
          <strong>Provider revision conflict — this action was never retried.</strong>
          <span>Provider: {conflict.provider || "not published"} · action: {conflict.action || "not published"}</span>
          <span>
            Expected revision: {publishedValue(conflict.expectedRevision)} · current revision: {publishedValue(conflict.currentRevision)}
          </span>
          <span>Re-read provider authority before trying the action again.</span>
          <SecondaryButton onClick={() => onRefresh?.()} type="button">Re-read provider authority</SecondaryButton>
        </Notice>
      ) : null}

      {configureError ? <Notice data-tone="error" role="alert">Configure: {configureError}</Notice> : null}
      {removeError ? <Notice data-tone="error" role="alert">Remove: {removeError}</Notice> : null}
      {lockdownError ? <Notice data-tone="error" role="alert">Trust / lockdown: {lockdownError}</Notice> : null}
      {formError ? <Notice data-tone="error" role="alert">{formError}</Notice> : null}

      <FeatureGrid>
        <FeatureState data-unavailable={configureUnavailable ? "true" : undefined}>
          Configure · {configureUnavailable ? "unavailable" : "available or not yet tested"}
        </FeatureState>
        <FeatureState data-unavailable={removeUnavailable ? "true" : undefined}>
          Remove · {removeUnavailable ? "unavailable" : "available or not yet tested"}
        </FeatureState>
        <FeatureState data-unavailable={lockdownUnavailable ? "true" : undefined}>
          Trust &amp; lockdown · {lockdownUnavailable ? "unavailable" : "available or not yet tested"}
        </FeatureState>
      </FeatureGrid>

      {lastReceipt ? (
        <Receipt role="status">
          Receipt received for <strong>{lastReceipt.action}</strong>
          {lastReceipt.provider ? ` · ${lastReceipt.provider}` : ""}. Provider authority re-read: {lastReceipt.relisted === null
            ? "pending"
            : lastReceipt.relisted ? "completed" : "not confirmed"}.
          {lastReceipt.receipt && Object.hasOwn(lastReceipt.receipt, "revision")
            ? ` Receipt revision: ${String(lastReceipt.receipt.revision)}.`
            : ""}
        </Receipt>
      ) : null}

      <QuotaCard>
        <CardHeading>
          <div>
            <h3>Global lockdown quota</h3>
            <p>Status appears only after the daemon publishes it; an absent activation is unknown.</p>
          </div>
          <StatusBadge data-recognized={globalLockdown?.activation?.recognized ? "true" : undefined}>
            {globalLockdown ? categoryLabel(globalLockdown.activation) : "status unread"}
          </StatusBadge>
        </CardHeading>
        <FactGrid>
          <Fact><span>Activation</span><strong>{globalLockdown ? categoryLabel(globalLockdown.activation) : "not published"}</strong></Fact>
          <Fact><span>Quota</span><strong>{quotaLabel(globalLockdown)}</strong></Fact>
          <Fact><span>Reason</span><strong>{globalLockdown?.reason || "not published"}</strong></Fact>
        </FactGrid>
        <QuotaControl>
          <label>
            New quota in bytes
            <input
              disabled={lockdownUnavailable || quotaPending}
              min="0"
              onChange={(event) => setQuotaDraft(event.target.value)}
              placeholder="Enter bytes explicitly"
              step="1"
              type="number"
              value={quotaDraft}
            />
          </label>
          <SecondaryButton
            disabled={lockdownUnavailable || quotaPending || quotaDraft === ""}
            onClick={reviewQuota}
            type="button"
          >
            Review quota change
          </SecondaryButton>
        </QuotaControl>
        {quotaReview ? (
          <Disclosure role="group" aria-label="Review lockdown quota change">
            <strong>Review lockdown quota change</strong>
            <span>Current published limit: {publishedValue(globalLockdown?.quotaLimit)} bytes</span>
            <span>Requested limit: {quotaReview.bytes} bytes</span>
            <span>This changes the quota enforced by daemon lockdown policy.</span>
            <ActionRow>
              <DangerButton
                disabled={quotaPending}
                onClick={async () => {
                  const receipt = await onSetQuota?.(quotaReview.bytes);
                  if (receipt) {
                    setQuotaReview(null);
                    setQuotaDraft("");
                  }
                }}
                type="button"
              >
                {quotaPending ? "Setting…" : "Confirm quota change"}
              </DangerButton>
              <SecondaryButton onClick={() => setQuotaReview(null)} type="button">Cancel</SecondaryButton>
            </ActionRow>
          </Disclosure>
        ) : null}
      </QuotaCard>

      {formMode ? (
        <ConfigureForm onSubmit={submitConfigure}>
          <CardHeading>
            <div>
              <h3>{formMode === "create" ? "Create provider" : `Update ${form.provider}`}</h3>
              <p>
                This submission is fenced at revision {publishedValue(formRevision)}. Optional fields are sent only when selected.
              </p>
            </div>
            <SecondaryButton onClick={closeForm} type="button">Close</SecondaryButton>
          </CardHeading>

          <FormGrid>
            <label>
              Provider name
              <input
                disabled={formMode === "update"}
                onChange={(event) => patchForm({ provider: event.target.value })}
                placeholder="provider-id"
                value={form.provider}
              />
            </label>
            {formMode === "create" ? (
              <>
                <label>
                  API family · create only
                  <select
                    onChange={(event) => patchForm({ apiFamily: event.target.value })}
                    value={form.apiFamily}
                  >
                    <option value="">Choose explicitly…</option>
                    {API_FAMILIES.map((family) => <option key={family} value={family}>{family}</option>)}
                  </select>
                </label>
                <label>
                  Origin · create only
                  <input
                    onChange={(event) => patchForm({ origin: event.target.value })}
                    placeholder="Omit unless this provider needs an origin"
                    value={form.origin}
                  />
                </label>
              </>
            ) : (
              <IdentityNotice>
                <strong>Stored identity is preserved.</strong>
                <span>API family: {categoryLabel(formIdentity?.apiFamily)}</span>
                <span>Origin: {formIdentity?.origin || "not published"}</span>
                <span>Neither create-only field is sent on update.</span>
              </IdentityNotice>
            )}
            <label>
              Authentication requirement
              <select
                onChange={(event) => patchForm({ authRequirement: event.target.value })}
                value={form.authRequirement}
              >
                <option value="">Omit · preserve daemon value</option>
                {AUTH_REQUIREMENTS.map((requirement) => (
                  <option key={requirement} value={requirement}>{requirement}</option>
                ))}
              </select>
            </label>
            <label>
              Models · one per line or comma-separated
              <textarea
                onChange={(event) => patchForm({ models: event.target.value })}
                placeholder="model-a\nmodel-b"
                rows={4}
                value={form.models}
              />
            </label>
            <CheckboxLabel>
              <input
                checked={form.enabled}
                onChange={(event) => patchForm({ enabled: event.target.checked })}
                type="checkbox"
              />
              Provider enabled
            </CheckboxLabel>
          </FormGrid>

          <OptionalGrid>
            <OptionalField>
              <label>
                <input
                  checked={form.includeDefaultModel}
                  onChange={(event) => patchForm({ includeDefaultModel: event.target.checked })}
                  type="checkbox"
                />
                Set default model
              </label>
              {form.includeDefaultModel ? (
                <input
                  aria-label="Default model"
                  onChange={(event) => patchForm({ defaultModel: event.target.value })}
                  placeholder="Enter an explicit model"
                  value={form.defaultModel}
                />
              ) : (
                <FieldHint>Omitted; no default is chosen client-side.</FieldHint>
              )}
            </OptionalField>
            <OptionalNumberField
              checked={form.includeResponseOpenTimeout}
              label="response-open timeout"
              onChecked={(checked) => patchForm({ includeResponseOpenTimeout: checked })}
              onValue={(value) => patchForm({ responseOpenTimeoutMs: value })}
              value={form.responseOpenTimeoutMs}
            />
            <OptionalNumberField
              checked={form.includeChunkIdleTimeout}
              label="chunk-idle timeout"
              onChecked={(checked) => patchForm({ includeChunkIdleTimeout: checked })}
              onValue={(value) => patchForm({ chunkIdleTimeoutMs: value })}
              value={form.chunkIdleTimeoutMs}
            />
            <OptionalNumberField
              checked={form.includeSemanticProgressTimeout}
              label="semantic-progress timeout"
              onChecked={(checked) => patchForm({ includeSemanticProgressTimeout: checked })}
              onValue={(value) => patchForm({ semanticProgressTimeoutMs: value })}
              value={form.semanticProgressTimeoutMs}
            />
          </OptionalGrid>

          <ActionRow>
            <PrimaryButton disabled={configurePending || configureUnavailable} type="submit">
              {configurePending ? "Submitting…" : formMode === "create" ? "Create provider" : "Update provider"}
            </PrimaryButton>
            <SecondaryButton onClick={closeForm} type="button">Cancel</SecondaryButton>
          </ActionRow>
        </ConfigureForm>
      ) : null}

      <RowsHeader>
        <h3>Published providers</h3>
        <span>{rowsPublished ? `${providers.length} row${providers.length === 1 ? "" : "s"}` : "unread"}</span>
      </RowsHeader>

      {rowsPublished && providers.length > 0 && availabilityState === "unavailable" ? (
        <Notice data-tone="error" role="status">
          These rows were published with provider authority unavailable
          {availabilityReason ? `: ${availabilityReason}` : "."}
        </Notice>
      ) : null}

      {!rowsPublished ? (
        <EmptyState data-tone="unknown">
          Provider rows are not published. This is not an empty provider list.
        </EmptyState>
      ) : providers.length === 0 && availabilityState === "available" ? (
        <EmptyState>No providers are configured in the published authority.</EmptyState>
      ) : providers.length === 0 && availabilityState === "unavailable" ? (
        <EmptyState data-tone="unavailable">
          Provider authority is unavailable{availabilityReason ? `: ${availabilityReason}` : "."}
        </EmptyState>
      ) : providers.length === 0 ? (
        <EmptyState data-tone="unknown">
          The list published no rows, but provider availability is {availabilityState || "not published"}; emptiness is unverified.
        </EmptyState>
      ) : (
        <ProviderList>
          {providers.map((row, index) => {
            const name = row.name || `unpublished-provider-${index + 1}`;
            const lockdown = row.name ? lockdownByProvider[row.name] : undefined;
            const rowFence = fenceFor(row);
            const canConfigure = rowFence !== undefined
              && typeof row.enabled === "boolean"
              && Array.isArray(row.models);
            const trustPending = row.name ? trustPendingByProvider[row.name] : null;
            const rereadRequired = Boolean(row.name && conflictedProviders.has(row.name));
            return (
              <ProviderCard key={`${name}:${String(rowFence)}`}>
                <CardHeading>
                  <div>
                    <h3>{row.name || "Provider name not published"}</h3>
                    <p>{row.origin || "Origin not published"}</p>
                  </div>
                  <TrustBadge data-full={row.trust.fullTrust ? "true" : undefined}>
                    {row.trust.label}
                  </TrustBadge>
                </CardHeading>

                <FactGrid>
                  <Fact><span>API family</span><strong>{categoryLabel(row.apiFamily)}</strong></Fact>
                  <Fact><span>Authentication requirement</span><strong>{categoryLabel(row.authRequirement)}</strong></Fact>
                  <Fact><span>Revision fence</span><strong>{publishedValue(rowFence)}</strong></Fact>
                  <Fact><span>Enabled</span><strong>{row.enabled === null ? "not published" : row.enabled ? "yes" : "no"}</strong></Fact>
                  <Fact><span>Availability</span><strong>{categoryLabel(row.availability)}</strong></Fact>
                  <Fact><span>Default model</span><strong>{row.defaultModel || "not published"}</strong></Fact>
                  <Fact><span>Models</span><strong>{Array.isArray(row.models) ? row.models.join(", ") || "published empty" : "not published"}</strong></Fact>
                </FactGrid>

                <LockdownFacts>
                  <strong>Published lockdown status</strong>
                  <span>Activation: {lockdown ? categoryLabel(lockdown.activation) : "not published"}</span>
                  <span>{quotaLabel(lockdown)}</span>
                  <span>Reason: {lockdown?.reason || "not published"}</span>
                </LockdownFacts>

                <ActionRow>
                  <SecondaryButton
                    disabled={configureUnavailable || !canConfigure || rereadRequired}
                    onClick={() => openUpdate(row)}
                    title={rereadRequired
                      ? "Re-read required after the provider revision conflict."
                      : canConfigure ? "" : "Update requires published enabled, models, and revision facts."}
                    type="button"
                  >
                    {rereadRequired ? "Configure · re-read required" : "Configure"}
                  </SecondaryButton>
                  <SecondaryButton
                    disabled={rereadRequired || lockdownUnavailable || rowFence === undefined || row.trust.raw === "full" || Boolean(trustPending)}
                    onClick={() => setTrustReview({ row, trust: "full" })}
                    type="button"
                  >
                    {rereadRequired ? "Full trust · re-read required" : "Review full trust"}
                  </SecondaryButton>
                  <SecondaryButton
                    disabled={rereadRequired || lockdownUnavailable || rowFence === undefined || row.trust.raw === "lockdown" || Boolean(trustPending)}
                    onClick={() => setTrustReview({ row, trust: "lockdown" })}
                    type="button"
                  >
                    {rereadRequired ? "Lockdown · re-read required" : "Review lockdown"}
                  </SecondaryButton>
                  <DangerButton
                    disabled={rereadRequired || removeUnavailable || rowFence === undefined || removePendingByProvider[row.name]}
                    onClick={() => setRemoveReview(row)}
                    type="button"
                  >
                    {rereadRequired
                      ? "Remove · re-read required"
                      : removePendingByProvider[row.name] ? "Removing…" : "Remove"}
                  </DangerButton>
                  {rereadRequired ? (
                    <SecondaryButton onClick={() => onRefresh?.()} type="button">
                      Re-read provider authority
                    </SecondaryButton>
                  ) : null}
                </ActionRow>
              </ProviderCard>
            );
          })}
        </ProviderList>
      )}

      {trustReview ? (
        <ReviewOverlay role="dialog" aria-modal="true" aria-label="Review provider trust change">
          <ReviewCard>
            <Eyebrow>Security state change</Eyebrow>
            <h3>Review trust change</h3>
            <p>This changes the daemon security policy for exactly one provider.</p>
            <FactGrid>
              <Fact><span>Provider</span><strong>{trustReview.row.name || "not published"}</strong></Fact>
              <Fact><span>Current published trust</span><strong>{trustReview.row.trust.label}</strong></Fact>
              <Fact><span>Requested trust</span><strong>{trustReview.trust}</strong></Fact>
              <Fact><span>Revision fence</span><strong>{publishedValue(fenceFor(trustReview.row))}</strong></Fact>
            </FactGrid>
            <Disclosure>
              {trustReview.trust === "full"
                ? "Full trust is the permissive provider mode. Confirm only after reviewing this provider and revision."
                : "Lockdown restricts this provider under the daemon's published lockdown policy and quota."}
            </Disclosure>
            <ActionRow>
              <DangerButton
                disabled={Boolean(trustPendingByProvider[trustReview.row.name])}
                onClick={async () => {
                  const receipt = await onSetTrust?.(trustReview.row, trustReview.trust);
                  if (receipt) setTrustReview(null);
                }}
                type="button"
              >
                {trustPendingByProvider[trustReview.row.name] ? "Changing…" : `Confirm ${trustReview.trust}`}
              </DangerButton>
              <SecondaryButton onClick={() => setTrustReview(null)} type="button">Cancel</SecondaryButton>
            </ActionRow>
          </ReviewCard>
        </ReviewOverlay>
      ) : null}

      {removeReview ? (
        <ReviewOverlay role="dialog" aria-modal="true" aria-label="Review provider removal">
          <ReviewCard>
            <Eyebrow>Fenced removal</Eyebrow>
            <h3>Remove {removeReview.name || "provider"}?</h3>
            <p>The request will use only the revision read with this provider row.</p>
            <FactGrid>
              <Fact><span>Provider</span><strong>{removeReview.name || "not published"}</strong></Fact>
              <Fact><span>Revision fence</span><strong>{publishedValue(fenceFor(removeReview))}</strong></Fact>
            </FactGrid>
            <ActionRow>
              <DangerButton
                disabled={Boolean(removePendingByProvider[removeReview.name])}
                onClick={async () => {
                  const receipt = await onRemove?.(removeReview);
                  if (receipt) setRemoveReview(null);
                }}
                type="button"
              >
                {removePendingByProvider[removeReview.name] ? "Removing…" : "Confirm removal"}
              </DangerButton>
              <SecondaryButton onClick={() => setRemoveReview(null)} type="button">Cancel</SecondaryButton>
            </ActionRow>
          </ReviewCard>
        </ReviewOverlay>
      ) : null}
    </Panel>
  );
}

const Panel = styled.section`
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 14px;
  overflow: auto;
  padding: 22px 24px 40px;
  color: var(--forge-text-primary);
`;

const PanelHeader = styled.header`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;

  h2, p { margin: 0; }
  h2 { margin-top: 2px; font-size: 22px; }
  p { max-width: 720px; margin-top: 5px; color: var(--forge-text-secondary); font-size: 13px; }

  @media (max-width: 800px) { flex-direction: column; }
`;

const Eyebrow = styled.span`
  color: var(--forge-text-disabled);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
`;

const HeaderActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;

  @media (max-width: 800px) { justify-content: flex-start; }
`;

const buttonBase = `
  border: 1px solid var(--forge-border-subtle);
  border-radius: 7px;
  padding: 7px 10px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  &:disabled { cursor: not-allowed; opacity: 0.45; }
`;

const PrimaryButton = styled.button`
  ${buttonBase}
  border-color: color-mix(in srgb, var(--forge-accent) 55%, transparent);
  background: var(--forge-accent);
  color: #fff;
`;

const SecondaryButton = styled.button`
  ${buttonBase}
  background: var(--forge-surface-raised, var(--forge-surface));
  color: var(--forge-text-primary);
`;

const DangerButton = styled.button`
  ${buttonBase}
  border-color: color-mix(in srgb, var(--forge-red) 45%, transparent);
  background: color-mix(in srgb, var(--forge-red) 10%, var(--forge-surface));
  color: var(--forge-red);
`;

const AuthorityBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  border: 1px solid var(--forge-border-subtle);
  border-radius: 8px;
  padding: 9px 11px;
  color: var(--forge-text-secondary);
  font-size: 12px;
`;

const Notice = styled.div`
  display: grid;
  gap: 5px;
  border: 1px solid var(--forge-border-subtle);
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--forge-surface-raised, var(--forge-surface));
  color: var(--forge-text-secondary);
  font-size: 12px;

  &[data-tone="error"] {
    border-color: color-mix(in srgb, var(--forge-red) 45%, transparent);
    color: var(--forge-red);
  }

  button { justify-self: start; margin-top: 3px; }
`;

const FeatureGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;

  @media (max-width: 800px) { grid-template-columns: 1fr; }
`;

const FeatureState = styled.div`
  border: 1px solid var(--forge-border-subtle);
  border-radius: 7px;
  padding: 8px 10px;
  color: var(--forge-text-secondary);
  font-size: 11px;

  &[data-unavailable="true"] { color: var(--forge-text-disabled); }
`;

const Receipt = styled.div`
  border-left: 3px solid var(--forge-green);
  padding: 8px 11px;
  background: color-mix(in srgb, var(--forge-green) 7%, transparent);
  color: var(--forge-text-secondary);
  font-size: 12px;
`;

const QuotaCard = styled.article`
  display: grid;
  gap: 12px;
  border: 1px solid var(--forge-border-subtle);
  border-radius: 10px;
  padding: 14px;
  background: var(--forge-surface-raised, var(--forge-surface));
`;

const CardHeading = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;

  h3, p { margin: 0; }
  h3 { font-size: 14px; }
  p { margin-top: 4px; color: var(--forge-text-secondary); font-size: 11px; }
`;

const StatusBadge = styled.span`
  max-width: 260px;
  border: 1px solid var(--forge-border-subtle);
  border-radius: 999px;
  padding: 4px 8px;
  color: var(--forge-text-disabled);
  font-size: 10px;

  &[data-recognized="true"] { color: var(--forge-amber); }
`;

const TrustBadge = styled(StatusBadge)`
  color: var(--forge-amber);
  &[data-full="true"] { color: var(--forge-green); }
`;

const FactGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;

  @media (max-width: 800px) { grid-template-columns: 1fr; }
`;

const Fact = styled.div`
  display: grid;
  gap: 2px;
  min-width: 0;
  border-radius: 6px;
  padding: 7px 8px;
  background: color-mix(in srgb, var(--forge-text-primary) 3%, transparent);

  span { color: var(--forge-text-disabled); font-size: 10px; }
  strong { overflow-wrap: anywhere; font-size: 11px; font-weight: 600; }
`;

const QuotaControl = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 8px;

  label { display: grid; flex: 1; gap: 5px; color: var(--forge-text-secondary); font-size: 11px; }

  @media (max-width: 800px) { align-items: stretch; flex-direction: column; }
`;

const inputStyles = `
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--forge-border-subtle);
  border-radius: 6px;
  padding: 7px 8px;
  background: var(--forge-surface);
  color: var(--forge-text-primary);
  font: inherit;
  font-size: 12px;
`;

const Disclosure = styled.div`
  display: grid;
  gap: 5px;
  border: 1px solid color-mix(in srgb, var(--forge-amber) 45%, transparent);
  border-radius: 8px;
  padding: 10px;
  background: color-mix(in srgb, var(--forge-amber) 6%, transparent);
  color: var(--forge-text-secondary);
  font-size: 11px;
`;

const ConfigureForm = styled.form`
  display: grid;
  gap: 14px;
  border: 1px solid color-mix(in srgb, var(--forge-accent) 40%, var(--forge-border-subtle));
  border-radius: 10px;
  padding: 14px;
  background: var(--forge-surface-raised, var(--forge-surface));

  input:not([type="checkbox"]), select, textarea { ${inputStyles} }
`;

const FormGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;

  > label { display: grid; align-content: start; gap: 5px; color: var(--forge-text-secondary); font-size: 11px; }

  @media (max-width: 800px) { grid-template-columns: 1fr; }
`;

const CheckboxLabel = styled.label`
  display: flex !important;
  grid-auto-flow: column;
  align-items: center;
  justify-content: start;
`;

const IdentityNotice = styled.div`
  display: grid;
  gap: 3px;
  border: 1px solid var(--forge-border-subtle);
  border-radius: 7px;
  padding: 8px;
  color: var(--forge-text-secondary);
  font-size: 11px;
`;

const OptionalGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;

  @media (max-width: 800px) { grid-template-columns: 1fr; }
`;

const OptionalField = styled.div`
  display: grid;
  align-content: start;
  gap: 6px;
  border: 1px solid var(--forge-border-subtle);
  border-radius: 7px;
  padding: 8px;

  label { display: flex; align-items: center; gap: 6px; color: var(--forge-text-secondary); font-size: 11px; }
  input:not([type="checkbox"]) { ${inputStyles} }
`;

const FieldHint = styled.span`
  color: var(--forge-text-disabled);
  font-size: 10px;
`;

const ActionRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
`;

const RowsHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 3px;

  h3 { margin: 0; font-size: 14px; }
  span { color: var(--forge-text-disabled); font-size: 11px; }
`;

const EmptyState = styled.div`
  border: 1px dashed var(--forge-border-subtle);
  border-radius: 9px;
  padding: 24px;
  color: var(--forge-text-secondary);
  text-align: center;
  font-size: 12px;
`;

const ProviderList = styled.div`
  display: grid;
  gap: 10px;
`;

const ProviderCard = styled.article`
  display: grid;
  gap: 11px;
  border: 1px solid var(--forge-border-subtle);
  border-radius: 10px;
  padding: 13px;
  background: var(--forge-surface-raised, var(--forge-surface));
`;

const LockdownFacts = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 5px 16px;
  border-top: 1px solid var(--forge-border-subtle);
  padding-top: 9px;
  color: var(--forge-text-secondary);
  font-size: 11px;
`;

const ReviewOverlay = styled.div`
  position: fixed;
  z-index: 2000;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.58);
`;

const ReviewCard = styled.div`
  display: grid;
  width: min(520px, 100%);
  gap: 12px;
  border: 1px solid var(--forge-border-subtle);
  border-radius: 12px;
  padding: 18px;
  background: var(--forge-surface);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.35);

  h3, p { margin: 0; }
  p { color: var(--forge-text-secondary); font-size: 12px; }

  @media (max-width: 700px) {
    ${FactGrid} { grid-template-columns: 1fr; }
  }
`;
