import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, "..");
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

function frontendSources(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...frontendSources(path));
    if (entry.isFile()
      && /\.(?:js|jsx|mjs)$/.test(entry.name)
      && !/\.test\.(?:js|mjs)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

test("[pin] all three peer commands and both push names live only in usePeers", () => {
  const hook = read("./usePeers.js");
  const sources = frontendSources(SRC_ROOT);
  const commands = ["peer_list", "peer_send", "peer_name"];
  const events = ["peer-message-received", "peer-delivery-changed"];

  assert.match(hook, /invoke\("peer_list"\)/,
    "peer_list must use the pinned argument-free command");
  assert.match(hook, /invoke\("peer_name"\)/,
    "peer_name must use the pinned argument-free command");
  assert.match(hook, /invoke\("peer_send", sendArgs\(target, body, summary\)\)/,
    "peer_send must receive the pure snake_case argument object");

  for (const command of commands) {
    assert.equal((hook.match(new RegExp(`invoke\\("${command}"`, "g")) || []).length, 1,
      `usePeers must own exactly one ${command} dispatch`);
    const owners = sources
      .filter((path) => readFileSync(path, "utf8").includes(`invoke("${command}"`))
      .map((path) => relative(SRC_ROOT, path));
    assert.deepEqual(owners, ["sessions/usePeers.js"],
      `${command} must be invoked only from usePeers.js`);
  }

  for (const eventName of events) {
    assert.equal((hook.match(new RegExp(`listen\\("${eventName}"`, "g")) || []).length, 1,
      `${eventName} must be listened to exactly once`);
    const owners = sources
      .filter((path) => readFileSync(path, "utf8").includes(eventName))
      .map((path) => relative(SRC_ROOT, path));
    assert.deepEqual(owners, ["sessions/usePeers.js"],
      `${eventName} must stay centralized in usePeers.js`);
  }

  assert.doesNotMatch(read("./PeersPanel.jsx"), /invoke\(/,
    "PeersPanel must remain presentational");
});

test("[pin] inbox identity is daemon-only, bounded, deduped, and delivery-event driven", () => {
  const hook = read("./usePeers.js");

  assert.ok(hook.includes("if (row.msgId == null || !mountedRef.current) return;"),
    "keyless message frames must be refused rather than assigned a local id");
  assert.ok(hook.includes("current.some((entry) => entry.msgId === row.msgId)"),
    "inbox frames must dedupe on daemon msg_id");
  assert.ok(hook.includes("].slice(-INBOX_CAP)"),
    "the inbox must remain bounded");
  assert.doesNotMatch(hook, /randomUUID|Date\.now\(|Math\.random\(/,
    "the hook must never synthesize a message identity");

  const sendStart = hook.indexOf("const send = useCallback");
  const sendEnd = hook.indexOf("const handleMessage", sendStart);
  const send = hook.slice(sendStart, sendEnd);
  assert.ok(send.indexOf('await invoke("peer_send"') < send.indexOf("setSentById"),
    "a sent row must not land before the daemon receipt resolves");
  assert.ok(send.includes("delivery: eventDelivery ?? returned.delivery"),
    "the returned delivery must be initial authority unless an actual event won the race");

  const deliveryStart = hook.indexOf("const handleDelivery");
  const listenerStart = hook.indexOf("useEffect(() => {", deliveryStart);
  const delivery = hook.slice(deliveryStart, listenerStart);
  assert.ok(delivery.includes("entry.msgId === msgId ? { ...entry, delivery } : entry"),
    "delivery events must update matching inbox rows by daemon msg_id");
  assert.ok(delivery.includes("{ ...current[msgId], delivery }"),
    "delivery events must update matching sent receipts by daemon msg_id");
});

test("[pin] AppShell owns the app-level hook and SessionSurface mounts the per-session Peers tab", () => {
  const shell = read("../app/AppShell.jsx");
  const surface = read("./SessionSurface.jsx");

  assert.match(shell, /import \{ usePeers \} from "\.\.\/sessions\/usePeers\.js"/);
  assert.match(shell, /const peerApi = usePeers\(\{ enabled: authState === "authenticated" \}\)/,
    "AppShell must own one auth-gated app-level peer hook");
  for (const prop of [
    "peerRoster={peerApi.peers}",
    "peerOwnName={peerApi.ownName}",
    "peerInbox={peerApi.inbox}",
    "peerSentById={peerApi.sentById}",
    "peerError={peerApi.error}",
    "peerLoading={peerApi.loading}",
    "peerSending={peerApi.sending}",
    "peerUnavailable={peerApi.unavailable}",
    "onLoadPeers={peerApi.load}",
    "onSendPeerMessage={peerApi.send}",
  ]) {
    assert.ok(shell.includes(prop), `AppShell must pass ${prop}`);
  }

  assert.match(surface, /import PeersPanel from "\.\/PeersPanel\.jsx"/);
  assert.ok(surface.includes('selectView("peers")'),
    "the per-session view toggle must offer Peers");
  assert.ok(surface.includes('(viewModes[id] || "ui") !== "peers"'),
    "the roster/name load must be gated on entering Peers");
  assert.match(surface, /mode === "peers" && session && session\.id !== "draft"/,
    "PeersPanel must mount only for a real session in Peers mode");
  assert.ok(surface.includes("<PeersPanel"));
  assert.ok(surface.includes("peers={peerRoster}"));
  assert.ok(surface.includes("inbox={peerInbox}"));
  assert.ok(surface.includes("sentById={peerSentById}"));
});

test("[pin] blank compose summaries take an omission-preserving send path", () => {
  const model = read("./peerModel.js");
  const panel = read("./PeersPanel.jsx");
  const surface = read("./SessionSurface.jsx");

  assert.match(model,
    /if \(summary !== undefined && summary !== null\) args\.summary = summary;/,
    "sendArgs must omit only absent summary and preserve explicitly empty");
  assert.match(panel,
    /const receipt = summary === ""\s*\? await onSend\?\.\(target, message\)\s*: await onSend\?\.\(target, message, summary\);/,
    "a blank optional field must call onSend without a summary argument");
  assert.match(surface,
    /summary === undefined\s*\? onSendPeerMessage\?\.\(to, message\)\s*: onSendPeerMessage\?\.\(to, message, summary\)/,
    "the surface callback must preserve the omitted third argument");
});

test("[pin] untrusted marking and plain-text-only remote input are explicit", () => {
  const model = read("./peerModel.js");
  const panel = read("./PeersPanel.jsx");

  assert.ok(panel.includes('return "UNTRUSTED · trust not published"'),
    "absent trust must have a visible fail-closed marker in the panel");
  assert.ok(panel.includes("UNTRUSTED external"),
    "known external content must have a visible untrusted marker");
  assert.match(panel, /if \(trust\?\.trusted === true\) return "Verified Haider";/,
    "only an explicit trusted model fact may take the verified style");
  assert.match(model, /if \(value === "verified_haider"\)/,
    "the model's sole trusted branch must be the pinned verified value");
  assert.match(model, /trusted: false,[\s\S]*kind: "absent"|kind: "absent",[\s\S]*trusted: false/,
    "the absent-trust model path must remain untrusted");

  assert.ok(panel.includes("Remote peer text is displayed as plain text only."));
  assert.match(panel, /<MessageBody>\{entry\.message\}<\/MessageBody>/,
    "remote message data must render through a React text child");
  assert.doesNotMatch(panel, /dangerouslySetInnerHTML|innerHTML\s*=|marked\(|ReactMarkdown|markdown-to-jsx/,
    "the panel must not contain a markup interpretation route");
  assert.doesNotMatch(panel, /setMessage\(entry\.message\)|setSummary\(entry\.summary\)/,
    "inbox input must never auto-fill the composer");
});
