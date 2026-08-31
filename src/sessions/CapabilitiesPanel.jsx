import styled from "styled-components";

/* Presentational workspace Hooks & Tools manager. All four daemon dispatches
   live in useCapabilities.js. Opaque JSON values are stringified only for
   raw display; they are never interpreted as a form or permission policy. */

function rawJson(value, fallback = "not published") {
  if (value === undefined) return fallback;
  try {
    const serialized = JSON.stringify(value, null, 2);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return "published value could not be displayed";
  }
}

function categoryLabel(category) {
  if (category?.recognized) return category.raw;
  if (category?.raw != null) return `${category.raw} (unrecognized)`;
  return category?.label ?? "not published";
}

function identityText(value, fallback) {
  return value == null ? fallback : value === "" ? "(empty string published)" : value;
}

function HookRow({
  hook,
  pending = null,
  receipt = null,
  onTrust = null,
  onRevoke = null,
}) {
  const name = identityText(hook.name, "name not published");
  const source = identityText(hook.source, "source not published");
  const digest = identityText(hook.digest, "digest not published");
  const canMutate = typeof hook.digest === "string" && pending == null;
  return (
    <HookCard>
      <HookHeader>
        <HookIdentity>
          <strong>{name}</strong>
          <span>source: {source}</span>
          <code>digest: {digest}</code>
        </HookIdentity>
        <TrustBadge
          data-recognized={hook.trust.recognized ? "true" : "false"}
          data-trusted={hook.trust.trusted ? "true" : "false"}
        >
          {hook.trust.label}
        </TrustBadge>
      </HookHeader>

      <HookFacts>
        <span>event: {identityText(hook.event, "not published")}</span>
        <span>decision: {rawJson(hook.decision)}</span>
        <span>timeout_ms: {rawJson(hook.timeoutMs)}</span>
        {hook.kind.raw == null ? (
          <span>Run kind: unspecified (not published). No execution mode inferred.</span>
        ) : (
          <span>
            Published kind: {categoryLabel(hook.kind)}
          </span>
        )}
      </HookFacts>

      {hook.trust.trusted ? (
        <HookActionRow>
          <DangerButton
            disabled={!canMutate}
            onClick={() => onRevoke?.(hook.digest)}
            type="button"
          >
            {pending === "revoke" ? "Revoking…" : "Revoke trust"}
          </DangerButton>
        </HookActionRow>
      ) : (
        <TrustDisclosure>
          <summary>Review trust action for {name}</summary>
          <TrustConfirmation>
            <strong>Trust exactly this daemon-published hook?</strong>
            <span>Name: {name}</span>
            <span>Source: {source}</span>
            <code>Digest: {digest}</code>
            <TrustButton
              disabled={!canMutate}
              onClick={() => onTrust?.(hook.digest)}
              type="button"
            >
              {pending === "trust" ? "Trusting…" : "Trust this published digest"}
            </TrustButton>
          </TrustConfirmation>
        </TrustDisclosure>
      )}

      {receipt != null && (
        <ReceiptNotice>
          Daemon receipt · digest: {identityText(receipt.digest, "not published")}
          {" · trusted: "}{rawJson(receipt.trusted)}
          {receipt.relisted === true
            ? " · fresh hook list read from authority"
            : receipt.relisted === false
              ? " · fresh hook list not received"
              : " · re-listing hook authority…"}
        </ReceiptNotice>
      )}
    </HookCard>
  );
}

function ToolRow({ tool }) {
  return (
    <ToolCard>
      <ToolHeader>
        <strong>{identityText(tool.name, "tool name not published")}</strong>
        <span>{identityText(tool.description, "description not published")}</span>
      </ToolHeader>
      <ToolFacts>
        <RawFact>
          <span>effects</span>
          <code>{rawJson(tool.effects)}</code>
        </RawFact>
        <RawFact>
          <span>dispatch</span>
          <code>{rawJson(tool.dispatch)}</code>
        </RawFact>
        <RawFact data-important="true">
          <span>permission default · daemon fact</span>
          <code>{rawJson(tool.permissionDefault)}</code>
        </RawFact>
      </ToolFacts>
      <OpaqueDetails>
        <summary>Raw input schema · opaque</summary>
        <RawBlock>{rawJson(tool.inputSchema)}</RawBlock>
      </OpaqueDetails>
    </ToolCard>
  );
}

export default function CapabilitiesPanel({
  cwd = "",
  hooks = null,
  tools = null,
  hookError = "",
  toolError = "",
  hookLoading = false,
  toolLoading = false,
  hooksUnavailable = false,
  toolsUnavailable = false,
  hookPendingByDigest = {},
  hookReceiptByDigest = {},
  onRefreshHooks = null,
  onRefreshTools = null,
  onTrust = null,
  onRevoke = null,
}) {
  return (
    <CapabilitiesRoot aria-label="Hooks & Tools">
      <PanelHeading>
        <div>
          <PanelTitle>Hooks &amp; Tools</PanelTitle>
          <PanelSubtitle>
            Workspace hook trust and the session&apos;s daemon-published tool inventory.
          </PanelSubtitle>
        </div>
      </PanelHeading>

      <SectionCard aria-labelledby="workspace-hooks-title">
        <SectionHeader>
          <div>
            <SectionTitle id="workspace-hooks-title">Workspace hooks</SectionTitle>
            <SectionSubtitle>
              Trust is digest-identified and fail-closed. Viewing this list changes nothing.
            </SectionSubtitle>
          </div>
          <HeaderButton
            disabled={hookLoading || hooksUnavailable || !cwd}
            onClick={() => onRefreshHooks?.()}
            type="button"
          >
            {hookLoading ? "Reading…" : "Refresh hooks"}
          </HeaderButton>
        </SectionHeader>

        {hooksUnavailable ? (
          <MutedState>Workspace hooks are unavailable on this daemon.</MutedState>
        ) : (
          <>
            {!cwd && (
              <MutedState>
                Workspace path not published for this session; effective hooks were not read.
              </MutedState>
            )}
            {hookError && <ErrorNotice role="alert">{hookError}</ErrorNotice>}
            {cwd && hooks == null && !hookError && (
              <MutedState>Effective workspace hooks not read yet.</MutedState>
            )}
            {hooks != null && (
              <>
                <AuthorityFacts>
                  <span>
                    policy: <strong data-recognized={hooks.policy.recognized ? "true" : "false"}>
                      {categoryLabel(hooks.policy)}
                    </strong>
                  </span>
                  <span>revision: <strong>{rawJson(hooks.revision)}</strong></span>
                  <span>cwd: <code>{cwd}</code></span>
                </AuthorityFacts>
                {hooks.rows.length === 0 ? (
                  <MutedState>No effective hooks are published for this workspace.</MutedState>
                ) : (
                  <HookList>
                    {hooks.rows.map((hook, index) => (
                      <HookRow
                        hook={hook}
                        key={hook.digest ?? `hook-without-digest:${index}`}
                        onRevoke={onRevoke}
                        onTrust={onTrust}
                        pending={hook.digest == null ? null : hookPendingByDigest[hook.digest]}
                        receipt={hook.digest == null ? null : hookReceiptByDigest[hook.digest]}
                      />
                    ))}
                  </HookList>
                )}
              </>
            )}
          </>
        )}
      </SectionCard>

      <SectionCard aria-labelledby="session-tools-title">
        <SectionHeader>
          <div>
            <SectionTitle id="session-tools-title">Session tool inventory</SectionTitle>
            <SectionSubtitle>
              Schemas, effects, dispatch, and permissions are displayed as daemon facts.
            </SectionSubtitle>
          </div>
          <HeaderButton
            disabled={toolLoading || toolsUnavailable}
            onClick={() => onRefreshTools?.()}
            type="button"
          >
            {toolLoading ? "Reading…" : "Refresh tools"}
          </HeaderButton>
        </SectionHeader>

        {toolsUnavailable ? (
          <MutedState>Canonical tool inventory is unavailable on this daemon.</MutedState>
        ) : (
          <>
            {toolError && <ErrorNotice role="alert">{toolError}</ErrorNotice>}
            {tools == null && !toolError && (
              <MutedState>Session tool inventory not read yet.</MutedState>
            )}
            {tools != null && (
              <>
                <AuthorityFacts>
                  <span>
                    daemon session id: <code>{identityText(tools.sessionId, "not published")}</code>
                  </span>
                </AuthorityFacts>
                {tools.tools.length === 0 ? (
                  <MutedState>No tools are published for this session.</MutedState>
                ) : (
                  <ToolList>
                    {tools.tools.map((tool, index) => (
                      <ToolRow key={tool.name ?? `tool-without-name:${index}`} tool={tool} />
                    ))}
                  </ToolList>
                )}
                <RememberedSection>
                  <RememberedTitle>Remembered permission decisions</RememberedTitle>
                  {tools.rememberedDecisions.length === 0 ? (
                    <MutedState>
                      No remembered permission decisions are published for this session.
                    </MutedState>
                  ) : (
                    <RememberedList>
                      {tools.rememberedDecisions.map((decision, index) => (
                        <OpaqueDetails key={`remembered-decision:${index}`}>
                          <summary>Remembered decision {index + 1} · raw daemon fact</summary>
                          <RawBlock>{rawJson(decision)}</RawBlock>
                        </OpaqueDetails>
                      ))}
                    </RememberedList>
                  )}
                </RememberedSection>
              </>
            )}
          </>
        )}
      </SectionCard>
    </CapabilitiesRoot>
  );
}

const CapabilitiesRoot = styled.section`
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  overflow: auto;
  color: var(--forge-text);
  background: var(--forge-bg);
`;

const PanelHeading = styled.header`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
`;

const PanelTitle = styled.h2`
  margin: 0;
  color: var(--forge-text);
  font-size: 14px;
  font-weight: 760;
`;

const PanelSubtitle = styled.p`
  margin: 3px 0 0;
  color: var(--forge-text-muted);
  font-size: 9.5px;
`;

const SectionCard = styled.section`
  display: grid;
  gap: 9px;
  padding: 10px;
  border: 1px solid var(--forge-border);
  border-radius: 10px;
  background: var(--forge-surface);
`;

const SectionHeader = styled.header`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
`;

const SectionTitle = styled.h3`
  margin: 0;
  color: var(--forge-text);
  font-size: 11px;
  font-weight: 760;
`;

const SectionSubtitle = styled.p`
  margin: 2px 0 0;
  color: var(--forge-text-muted);
  font-size: 8.5px;
`;

const HeaderButton = styled.button`
  flex: none;
  padding: 5px 8px;
  border: 1px solid var(--forge-border);
  border-radius: 6px;
  color: var(--forge-text-soft);
  background: var(--forge-surface-control);
  font: inherit;
  font-size: 9px;
  cursor: pointer;

  &:disabled { cursor: default; opacity: 0.48; }
`;

const MutedState = styled.div`
  padding: 8px;
  border: 1px dashed var(--forge-border);
  border-radius: 7px;
  color: var(--forge-text-muted);
  font-size: 9px;
`;

const ErrorNotice = styled.div`
  padding: 7px 8px;
  border: 1px solid color-mix(in srgb, var(--forge-red) 42%, var(--forge-border));
  border-radius: 7px;
  color: var(--forge-red);
  background: color-mix(in srgb, var(--forge-red) 7%, transparent);
  font-size: 9px;
`;

const AuthorityFacts = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 5px 12px;
  padding: 7px 8px;
  border-radius: 7px;
  color: var(--forge-text-muted);
  background: var(--forge-surface-control);
  font-size: 8.5px;

  strong, code { color: var(--forge-text-soft); }
  strong[data-recognized="false"] { color: var(--forge-amber); }
  code { overflow-wrap: anywhere; }
`;

const HookList = styled.div`
  display: grid;
  gap: 8px;
`;

const HookCard = styled.article`
  display: grid;
  gap: 8px;
  padding: 9px;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  background: var(--forge-surface-control);
`;

const HookHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
`;

const HookIdentity = styled.div`
  display: grid;
  min-width: 0;
  gap: 2px;
  color: var(--forge-text-muted);
  font-size: 8.5px;

  strong { color: var(--forge-text); font-size: 10.5px; }
  span, code { overflow-wrap: anywhere; }
  code { color: var(--forge-text-soft); }
`;

const TrustBadge = styled.span`
  flex: none;
  padding: 3px 6px;
  border: 1px solid color-mix(in srgb, var(--forge-red) 48%, var(--forge-border));
  border-radius: 999px;
  color: var(--forge-red);
  background: color-mix(in srgb, var(--forge-red) 8%, transparent);
  font-size: 8px;
  font-weight: 800;

  &[data-trusted="true"] {
    border-color: color-mix(in srgb, var(--forge-green) 42%, var(--forge-border));
    color: var(--forge-green);
    background: color-mix(in srgb, var(--forge-green) 8%, transparent);
  }
  &[data-recognized="false"] { border-style: dashed; }
`;

const HookFacts = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 3px 10px;
  color: var(--forge-text-muted);
  font-size: 8.5px;
`;

const HookActionRow = styled.div`
  display: flex;
  justify-content: flex-end;
`;

const DangerButton = styled(HeaderButton)`
  color: var(--forge-red);
`;

const TrustDisclosure = styled.details`
  padding: 7px 8px;
  border: 1px solid color-mix(in srgb, var(--forge-amber) 40%, var(--forge-border));
  border-radius: 7px;
  background: color-mix(in srgb, var(--forge-amber) 5%, transparent);
  font-size: 9px;

  summary { color: var(--forge-amber); cursor: pointer; font-weight: 700; }
`;

const TrustConfirmation = styled.div`
  display: grid;
  gap: 4px;
  margin-top: 8px;
  color: var(--forge-text-muted);

  strong { color: var(--forge-text); }
  code { overflow-wrap: anywhere; color: var(--forge-text-soft); }
`;

const TrustButton = styled(HeaderButton)`
  justify-self: end;
  margin-top: 4px;
  color: var(--forge-amber);
  font-weight: 750;
`;

const ReceiptNotice = styled.div`
  color: var(--forge-text-muted);
  font-size: 8.5px;
`;

const ToolList = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 8px;
`;

const ToolCard = styled.article`
  display: grid;
  align-content: start;
  gap: 8px;
  padding: 9px;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  background: var(--forge-surface-control);
`;

const ToolHeader = styled.div`
  display: grid;
  gap: 2px;

  strong { color: var(--forge-text); font-size: 10.5px; }
  span { color: var(--forge-text-muted); font-size: 8.5px; }
`;

const ToolFacts = styled.div`
  display: grid;
  gap: 5px;
`;

const RawFact = styled.div`
  display: grid;
  grid-template-columns: minmax(82px, 0.35fr) minmax(0, 1fr);
  gap: 7px;
  padding: 5px 6px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--forge-bg) 45%, transparent);
  font-size: 8px;

  span { color: var(--forge-text-muted); }
  code { overflow-wrap: anywhere; color: var(--forge-text-soft); white-space: pre-wrap; }
  &[data-important="true"] span { color: var(--forge-amber); }
`;

const OpaqueDetails = styled.details`
  border: 1px solid var(--forge-border);
  border-radius: 6px;
  font-size: 8.5px;

  summary {
    padding: 6px 7px;
    color: var(--forge-text-muted);
    cursor: pointer;
  }
`;

const RawBlock = styled.pre`
  max-height: 240px;
  margin: 0;
  padding: 7px;
  overflow: auto;
  border-top: 1px solid var(--forge-border);
  color: var(--forge-text-soft);
  background: color-mix(in srgb, var(--forge-bg) 55%, transparent);
  font: 8px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: pre-wrap;
`;

const RememberedSection = styled.section`
  display: grid;
  gap: 6px;
  padding-top: 3px;
`;

const RememberedTitle = styled.h4`
  margin: 0;
  color: var(--forge-text-soft);
  font-size: 9.5px;
`;

const RememberedList = styled.div`
  display: grid;
  gap: 5px;
`;
