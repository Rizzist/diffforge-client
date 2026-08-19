# Wiring AuthFlow into AppShell

`src/auth/` is self-contained (imports only `react` + `styled-components`; palette
copied locally in `theme.js`). Nothing here touches AppShell — wire it up like this.

## Layering

`<AuthFlow />` is a `position: fixed; inset: 0; z-index: 1000` overlay. Render it as a
**sibling after** the workspace tree, and mount the real workspace beneath it as soon as
`status === "authenticated"` — the launch detonation fades the backdrop + canvas to
reveal whatever is already there. After `onLaunchComplete`, stop rendering it (unmount);
that destroys the particle engine and drops the layer.

```jsx
import { AuthFlow, PHASES, SUCCESS_HOLD_MS } from "../auth";
```

## Status → phase mapping

Drive `phase` from `useAuthSnapshot().status` (`src/authStore.js`). No timer may
advance auth on its own — the ceremony beats (success → launch) are the only host
timers, and they run *after* authentication is already real.

| authStore status | phase | notes |
| --- | --- | --- |
| `checking` | `"boot"` | Boot plays; when `onBootDone` fires and status is still `checking`, keep `"boot"` — the formed logo holds steady (no drift) until auth state is known. |
| `signedOut` | `"entry"` | Sign in / Create account card. |
| `waiting` | `"waiting"` | Browser handoff in flight. |
| `exchanging` | `"waiting"` | Same card, with `statusMessage="Browser callback matched…"`. |
| `authenticated` | `"success"` then `"launch"` | Set `"success"`; after `SUCCESS_HOLD_MS` (950 ms, exported) set `"launch"`. |

Never show `"entry"` before `onBootDone` has fired, even if `signedOut` resolves early —
let the formation finish, then flip.

Sketch (state machine, not literal code):

```jsx
const auth = useAuthSnapshot();
const [bootDone, setBootDone] = useState(false);
const [ceremony, setCeremony] = useState("idle"); // idle | success | launch | done

useEffect(() => {
  if (auth.status !== "authenticated") { setCeremony("idle"); return undefined; }
  const t = setTimeout(() => setCeremony("launch"), SUCCESS_HOLD_MS);
  setCeremony((c) => (c === "idle" ? "success" : c));
  return () => clearTimeout(t);
}, [auth.status]);

const phase =
  !bootDone || auth.status === "checking" ? "boot"
  : auth.status === "signedOut" ? "entry"
  : auth.status === "waiting" || auth.status === "exchanging" ? "waiting"
  : ceremony === "launch" ? "launch"
  : "success";

{ceremony !== "done" && (
  <AuthFlow
    phase={phase}
    mode={authMode}                    // "signin" | "register", set by which button was clicked
    statusMessage={auth.status === "exchanging" ? "Browser callback matched…" : ""}
    onSignIn={startWebLogin}
    onRegister={startWebLogin /* see below */}
    onCancel={cancelWebLogin}
    onBootDone={() => setBootDone(true)}
    onLaunchComplete={() => setCeremony("done")}
  />
)}
```

## Handlers

- **onSignIn** → the existing `startWebLogin` callback in AppShell (wraps
  `authStore.startLogin()` → `openUrl(login_url)` → `authStore.setStage("deep_link", …)`).
  Keep its error path: failures land back in `signedOut` with `auth.error`, which maps to
  `"entry"` automatically.
- **onRegister** → no dedicated register flow exists in the client today. Reuse
  `startWebLogin` (the web login page offers account creation) and set
  `mode="register"` so the waiting card reads "Finishing your account in the browser";
  if/when the cloud grows a register-intent login URL, branch there.
- **onCancel** → return to `signedOut` without nuking the saved session:
  `authStore.setSignedOut({ message: DEFAULT_AUTH_MESSAGE, clearPending: true, clearSession: false })`
  (same call AppShell's login error path uses). Also bump `authFlowIdRef` the way
  `startWebLogin` does so a late deep-link callback from the cancelled attempt is ignored.
- **code** (optional) — pass a confirm code like `"H7KQ·2MRD"` if the login handshake
  exposes one; omitted, the waiting card shows just the status line (no code row, no
  "approve the request" hint). The mockup's client-side fake code generator was not ported.

## Restored sessions (cold start, already authenticated)

`checking` resolving straight to `authenticated` still runs boot → (onBootDone) →
success → launch, which is the intended "returning user" ceremony. If a quieter path is
ever wanted, that's a product decision — the component supports starting at any phase.

## Cleanup guarantees (already handled inside AuthFlow)

- Engine is created once per mount and `destroy()`ed on unmount (RAF + resize listener).
- `onBootDone` fires exactly once per boot run (engine-guarded).
- `onLaunchComplete` fires once, `LAUNCH_FADE_TOTAL_MS` (1850 ms) after entering
  `"launch"` — matching the CSS fade (1.5 s ease, 0.35 s delay). During launch the layer
  is `pointer-events: none`, so the workspace is interactive while the fade finishes.
- `prefers-reduced-motion`: particles form instantly (boot completes ~350 ms), shockwave
  rings are suppressed; everything else degrades gracefully.
