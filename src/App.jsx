import { invoke } from "@tauri-apps/api/core";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useRef, useState } from "react";
import styled, { createGlobalStyle, keyframes } from "styled-components";
import { CloudDone } from "@styled-icons/material-rounded/CloudDone";
import { ErrorOutline } from "@styled-icons/material-rounded/ErrorOutline";
import { Login } from "@styled-icons/material-rounded/Login";
import { Logout } from "@styled-icons/material-rounded/Logout";
import { OpenInBrowser } from "@styled-icons/material-rounded/OpenInBrowser";
import { Pending } from "@styled-icons/material-rounded/Pending";
import { Refresh } from "@styled-icons/material-rounded/Refresh";
import { Settings } from "@styled-icons/material-rounded/Settings";

const API_BASE_URL = "https://diffforge.ai/api";
const WEB_LOGIN_URL = "https://diffforge.ai/desktop/login";
const SESSION_TOKEN_KEY = "diffforge.desktop.sessionToken";
const SESSION_USER_KEY = "diffforge.desktop.user";
const PENDING_STATE_KEY = "diffforge.desktop.pendingAuthState";
const AUTH_VALUE_PATTERN = /^[A-Za-z0-9_-]{24,192}$/;

const WORKSPACES = ["Personal", "Client work", "Scratch"];
const TERMINALS = [
  { id: "main", name: "Main", prompt: "$ diffforge" },
  { id: "tasks", name: "Tasks", prompt: "$ ready" },
];
const RIGHT_TABS = [
  { id: "vault", label: "Vault" },
  { id: "web", label: "Web" },
  { id: "policies", label: "Policies" },
];
const VAULT_ITEMS = ["src", "policy-diffforge", "README.md"];
const POLICY_ITEMS = ["Auth handoff", "Dashboard shell", "SQL contract"];

function createAuthState() {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);

  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function isSafeAuthValue(value) {
  return typeof value === "string" && AUTH_VALUE_PATTERN.test(value);
}

function getStoredUser() {
  try {
    const user = JSON.parse(localStorage.getItem(SESSION_USER_KEY) || "null");

    return user && typeof user === "object" ? user : null;
  } catch {
    return null;
  }
}

function parseAuthCallback(urlValue) {
  try {
    const url = new URL(urlValue);

    if (url.protocol !== "diffforge:" || url.hostname !== "auth" || url.pathname !== "/callback") {
      return null;
    }

    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";

    if (!isSafeAuthValue(code) || !isSafeAuthValue(state)) {
      return null;
    }

    return { code, state };
  } catch {
    return null;
  }
}

function clearStoredSession() {
  localStorage.removeItem(SESSION_TOKEN_KEY);
  localStorage.removeItem(SESSION_USER_KEY);
}

function clearPendingLogin() {
  localStorage.removeItem(PENDING_STATE_KEY);
}

function saveStoredSession(session) {
  if (!session?.token || !session?.user) {
    throw new Error("Desktop session is missing.");
  }

  localStorage.setItem(SESSION_TOKEN_KEY, session.token);
  localStorage.setItem(SESSION_USER_KEY, JSON.stringify(session.user));
}

export default function App() {
  const [apiState, setApiState] = useState("checking");
  const [apiMessage, setApiMessage] = useState("Checking backend");
  const [authState, setAuthState] = useState("signedOut");
  const [authMessage, setAuthMessage] = useState("Sign in with your Diffforge web account.");
  const [authError, setAuthError] = useState("");
  const [user, setUser] = useState(() => getStoredUser());
  const [activeView, setActiveView] = useState("dashboard");
  const [activeRightTab, setActiveRightTab] = useState("vault");
  const initializedRef = useRef(false);
  const authFlowIdRef = useRef(0);
  const pendingStateRef = useRef(localStorage.getItem(PENDING_STATE_KEY) || "");

  const setSignedOut = useCallback((message = "Sign in with your Diffforge web account.") => {
    setAuthState("signedOut");
    setAuthMessage(message);
    setAuthError("");
    setUser(null);
    setActiveView("dashboard");
  }, []);

  const setAuthenticated = useCallback((sessionUser) => {
    setAuthState("authenticated");
    setAuthMessage("You are logged in now.");
    setAuthError("");
    setUser(sessionUser);
    setActiveView("dashboard");
  }, []);

  const checkBackend = useCallback(async () => {
    setApiState("checking");
    setApiMessage("Checking backend");

    try {
      const result = await invoke("backend_ping");
      setApiState("online");
      setApiMessage(result.message || "Backend connected");
    } catch (error) {
      setApiState("offline");
      setApiMessage(error || "Backend unavailable");
    }
  }, []);

  const validateStoredSession = useCallback(async () => {
    const token = localStorage.getItem(SESSION_TOKEN_KEY);
    const validationFlowId = authFlowIdRef.current;

    if (!isSafeAuthValue(token)) {
      clearStoredSession();
      clearPendingLogin();
      pendingStateRef.current = "";
      setSignedOut();
      return;
    }

    setAuthState("signedOut");
    setAuthMessage("Checking saved desktop session. You can still sign in with the web app.");
    setAuthError("");

    try {
      const session = await invoke("validate_desktop_session", { token });
      if (validationFlowId !== authFlowIdRef.current) {
        return;
      }

      localStorage.setItem(SESSION_USER_KEY, JSON.stringify(session.user));
      setAuthenticated(session.user);
    } catch {
      if (validationFlowId !== authFlowIdRef.current) {
        return;
      }

      clearStoredSession();
      clearPendingLogin();
      pendingStateRef.current = "";
      setSignedOut("Your desktop session expired. Sign in again with the web app.");
    }
  }, [setAuthenticated, setSignedOut]);

  const completeDesktopLogin = useCallback(async (callbackUrl) => {
    const callback = parseAuthCallback(callbackUrl);

    if (!callback) {
      return false;
    }

    authFlowIdRef.current += 1;

    if (!pendingStateRef.current || callback.state !== pendingStateRef.current) {
      setAuthState("signedOut");
      setAuthMessage("Sign in with your Diffforge web account.");
      setAuthError("Desktop login state did not match. Start again from this app.");
      clearPendingLogin();
      pendingStateRef.current = "";
      return true;
    }

    setAuthState("exchanging");
    setAuthMessage("Finishing desktop sign in...");
    setAuthError("");

    try {
      const session = await invoke("exchange_desktop_auth_code", {
        code: callback.code,
        state: callback.state,
      });

      saveStoredSession(session);
      clearPendingLogin();
      pendingStateRef.current = "";
      setAuthenticated(session.user);
    } catch (error) {
      clearStoredSession();
      clearPendingLogin();
      pendingStateRef.current = "";
      setAuthState("signedOut");
      setAuthMessage("Sign in with your Diffforge web account.");
      setAuthError(error || "Desktop login expired. Try again.");
    }

    return true;
  }, [setAuthenticated]);

  const startWebLogin = useCallback(async () => {
    authFlowIdRef.current += 1;
    const state = createAuthState();
    pendingStateRef.current = state;
    localStorage.setItem(PENDING_STATE_KEY, state);
    setAuthState("waiting");
    setAuthMessage("Finish sign in in your browser, then return here.");
    setAuthError("");

    try {
      const loginUrl = `${WEB_LOGIN_URL}?state=${encodeURIComponent(state)}`;
      await openUrl(loginUrl);
    } catch (error) {
      pendingStateRef.current = "";
      clearPendingLogin();
      setAuthState("signedOut");
      setAuthMessage("Sign in with your Diffforge web account.");
      setAuthError(error || "Unable to open the web login.");
    }
  }, []);

  const logout = useCallback(async () => {
    authFlowIdRef.current += 1;
    const token = localStorage.getItem(SESSION_TOKEN_KEY);

    if (isSafeAuthValue(token)) {
      try {
        await invoke("logout_desktop_session", { token });
      } catch {
        // Local session cleanup still wins if the remote revoke cannot complete.
      }
    }

    clearStoredSession();
    clearPendingLogin();
    pendingStateRef.current = "";
    setSignedOut();
  }, [setSignedOut]);

  useEffect(() => {
    checkBackend();
  }, [checkBackend]);

  useEffect(() => {
    if (initializedRef.current) {
      return undefined;
    }

    initializedRef.current = true;
    let isMounted = true;
    let unlistenDeepLinks = null;

    async function initializeAuth() {
      try {
        const startUrls = await getCurrent();
        let handledDeepLink = false;

        if (Array.isArray(startUrls)) {
          for (const url of startUrls) {
            handledDeepLink = (await completeDesktopLogin(url)) || handledDeepLink;
          }
        }

        if (!handledDeepLink && isMounted) {
          await validateStoredSession();
        }

        unlistenDeepLinks = await onOpenUrl(async (urls) => {
          for (const url of urls) {
            await completeDesktopLogin(url);
          }
        });
      } catch (error) {
        if (isMounted) {
          clearStoredSession();
          setSignedOut("Unable to initialize desktop sign in.");
          setAuthError(error || "Desktop sign in is unavailable.");
        }
      }
    }

    initializeAuth();

    return () => {
      isMounted = false;

      if (typeof unlistenDeepLinks === "function") {
        unlistenDeepLinks();
      }
    };
  }, [completeDesktopLogin, setSignedOut, validateStoredSession]);

  const StatusIcon = {
    checking: PendingIcon,
    offline: ErrorIcon,
    online: ConnectedIcon,
  }[apiState];
  const isAuthBusy = authState === "waiting" || authState === "exchanging";
  const authPanelTitle = {
    waiting: "Waiting for web sign in",
    exchanging: "Finishing desktop sign in",
    signedOut: "Continue in browser",
  }[authState] || "Continue in browser";
  const authButtonLabel = {
    waiting: "Waiting...",
    exchanging: "Finishing...",
  }[authState] || "Sign in with web";
  const displayName = user?.name || user?.email || "there";
  const activeTabLabel = RIGHT_TABS.find((tab) => tab.id === activeRightTab)?.label || "Vault";

  return (
    <>
      <GlobalStyle />
      {authState === "authenticated" ? (
        <DashboardShell>
          <WorkspaceRail aria-label="Workspace navigation">
            <RailTop>
              <BrandMark as="div" aria-label="Diffforge">
                <img src="/logo.webp" alt="" />
                <strong>Diffforge</strong>
              </BrandMark>
              <RailSectionTitle>Workspaces</RailSectionTitle>
              <WorkspaceList>
                {WORKSPACES.map((workspace, index) => (
                  <WorkspaceButton
                    data-active={index === 0}
                    key={workspace}
                    type="button"
                  >
                    <span>{workspace.slice(0, 1)}</span>
                    <strong>{workspace}</strong>
                  </WorkspaceButton>
                ))}
              </WorkspaceList>
            </RailTop>

            <RailFooter>
              <RailActionButton
                data-active={activeView === "dashboard"}
                onClick={() => setActiveView("dashboard")}
                type="button"
              >
                <ConnectedIcon aria-hidden="true" />
                <span>Dashboard</span>
              </RailActionButton>
              <RailActionButton
                data-active={activeView === "settings"}
                onClick={() => setActiveView("settings")}
                type="button"
              >
                <ButtonSettingsIcon aria-hidden="true" />
                <span>Settings</span>
              </RailActionButton>
              <RailActionButton onClick={logout} type="button">
                <ButtonLogoutIcon aria-hidden="true" />
                <span>Sign out</span>
              </RailActionButton>
            </RailFooter>
          </WorkspaceRail>

          {activeView === "settings" ? (
            <SettingsPage>
              <PageHeader>
                <div>
                  <Kicker>Settings</Kicker>
                  <DashboardTitle>Desktop settings</DashboardTitle>
                </div>
                <SecondaryButton onClick={() => setActiveView("dashboard")} type="button">
                  <ConnectedIcon aria-hidden="true" />
                  <span>Back</span>
                </SecondaryButton>
              </PageHeader>

              <SettingsGrid>
                <SettingsBlock>
                  <SettingsLabel>Account</SettingsLabel>
                  <SettingsValue>{displayName}</SettingsValue>
                  <SettingsHint>You are logged in now.</SettingsHint>
                </SettingsBlock>
                <SettingsBlock>
                  <SettingsLabel>Backend</SettingsLabel>
                  <SettingsValue>{apiMessage}</SettingsValue>
                  <SettingsHint>{API_BASE_URL}</SettingsHint>
                  <SecondaryButton disabled={apiState === "checking"} onClick={checkBackend} type="button">
                    <ButtonRefreshIcon aria-hidden="true" />
                    <span>Check API</span>
                  </SecondaryButton>
                </SettingsBlock>
                <SettingsBlock>
                  <SettingsLabel>Session</SettingsLabel>
                  <SettingsValue>Desktop session active</SettingsValue>
                  <SettingsHint>Signing out clears this device session.</SettingsHint>
                  <PrimaryDangerButton onClick={logout} type="button">
                    <ButtonLogoutIcon aria-hidden="true" />
                    <span>Sign out</span>
                  </PrimaryDangerButton>
                </SettingsBlock>
              </SettingsGrid>
            </SettingsPage>
          ) : (
            <>
              <TerminalWorkspace>
                <PageHeader>
                  <div>
                    <Kicker>Workspace</Kicker>
                    <DashboardTitle>Terminals</DashboardTitle>
                  </div>
                  <UserPill>
                    <ConnectedIcon aria-hidden="true" />
                    <span>{displayName}</span>
                  </UserPill>
                </PageHeader>

                <TerminalGrid>
                  {TERMINALS.map((terminal) => (
                    <TerminalPane key={terminal.id}>
                      <TerminalHeader>
                        <span>{terminal.name}</span>
                        <small>idle</small>
                      </TerminalHeader>
                      <TerminalBody>
                        <TerminalLine>{terminal.prompt}</TerminalLine>
                      </TerminalBody>
                    </TerminalPane>
                  ))}
                </TerminalGrid>
              </TerminalWorkspace>

              <RightDock aria-label={`${activeTabLabel} panel`}>
                <DockTabs>
                  {RIGHT_TABS.map((tab) => (
                    <DockTab
                      data-active={activeRightTab === tab.id}
                      key={tab.id}
                      onClick={() => setActiveRightTab(tab.id)}
                      type="button"
                    >
                      {tab.label}
                    </DockTab>
                  ))}
                </DockTabs>

                <DockContent>
                  {activeRightTab === "vault" && (
                    <PanelList>
                      {VAULT_ITEMS.map((item) => (
                        <PanelListItem key={item}>{item}</PanelListItem>
                      ))}
                    </PanelList>
                  )}

                  {activeRightTab === "web" && (
                    <EmptyPanel>
                      <ButtonBrowserIcon aria-hidden="true" />
                      <span>Web view placeholder</span>
                    </EmptyPanel>
                  )}

                  {activeRightTab === "policies" && (
                    <PanelList>
                      {POLICY_ITEMS.map((item) => (
                        <PanelListItem key={item}>{item}</PanelListItem>
                      ))}
                    </PanelList>
                  )}
                </DockContent>
              </RightDock>
            </>
          )}
        </DashboardShell>
      ) : (
        <LoginScreen>
          <BrandPanel aria-labelledby="desktop-title">
            <BrandMark href="#" aria-label="Diffforge">
              <img src="/logo.webp" alt="" />
              <strong>Diffforge</strong>
            </BrandMark>

            <IntroCopy>
              <Kicker>Web sign in</Kicker>
              <Headline id="desktop-title">Sign in to Diffforge</Headline>
              <Lede>
                Use your browser for secure Diffforge authentication, then return to this native app.
              </Lede>
            </IntroCopy>

            <ApiStatus data-state={apiState}>
              <StatusSummary>
                <StatusBadge aria-hidden="true">
                  <StatusIcon />
                </StatusBadge>
                <span>{apiMessage}</span>
              </StatusSummary>
              <StatusButton disabled={apiState === "checking"} onClick={checkBackend} type="button">
                <ButtonRefreshIcon aria-hidden="true" />
                <span>Check API</span>
              </StatusButton>
              <ApiBase>{API_BASE_URL}</ApiBase>
            </ApiStatus>
          </BrandPanel>

          <LoginCard aria-label="Desktop sign in">
            <LoginPanel>
              <LoginIconWrap aria-hidden="true">
                {isAuthBusy ? <PendingIcon /> : <ButtonLoginIcon />}
              </LoginIconWrap>
              <SessionTitle>{authPanelTitle}</SessionTitle>
              <SessionText>{authMessage}</SessionText>
              {authError && <FormMessage $state="error">{authError}</FormMessage>}
              <PrimaryButton disabled={isAuthBusy} onClick={startWebLogin} type="button">
                <ButtonBrowserIcon aria-hidden="true" />
                <span>{authButtonLabel}</span>
              </PrimaryButton>
            </LoginPanel>
          </LoginCard>
        </LoginScreen>
      )}
    </>
  );
}

const GlobalStyle = createGlobalStyle`
  :root {
    color: #f7fafc;
    background: #071015;
    font-family:
      Inter,
      ui-sans-serif,
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      sans-serif;
    font-synthesis: none;
    text-rendering: optimizeLegibility;
  }

  * {
    box-sizing: border-box;
  }

  html,
  body,
  #app {
    min-width: 320px;
    min-height: 100vh;
    margin: 0;
  }

  body {
    background:
      linear-gradient(145deg, rgba(7, 16, 21, 0.98), rgba(16, 19, 24, 0.96) 58%, rgba(18, 16, 12, 0.98)),
      #071015;
  }

  button {
    cursor: pointer;
    font: inherit;
  }

  button:disabled {
    cursor: wait;
  }
`;

const LoginScreen = styled.main`
  display: grid;
  width: min(1080px, calc(100% - 48px));
  min-height: 100vh;
  grid-template-columns: minmax(0, 1fr) minmax(340px, 430px);
  align-items: center;
  gap: 56px;
  margin: 0 auto;
  padding: 48px 0;

  @media (max-width: 860px) {
    width: min(100% - 28px, 620px);
    grid-template-columns: 1fr;
    gap: 28px;
    padding: 28px 0;
  }
`;

const BrandPanel = styled.section`
  display: grid;
  min-height: 600px;
  align-content: space-between;
  gap: 48px;
  padding: 20px 0;

  @media (max-width: 860px) {
    min-height: auto;
    gap: 34px;
    padding: 0;
  }
`;

const BrandMark = styled.a`
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 12px;
  color: #ffffff;
  font-size: 17px;
  text-decoration: none;

  img {
    display: block;
    width: 38px;
    height: 38px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 8px;
    background: #050607;
    object-fit: cover;
  }
`;

const IntroCopy = styled.div`
  display: grid;
  gap: 18px;
`;

const Kicker = styled.p`
  margin: 0;
  color: #78f3cf;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
`;

const Headline = styled.h1`
  max-width: 620px;
  margin: 0;
  color: #ffffff;
  font-size: clamp(44px, 6vw, 74px);
  font-weight: 820;
  letter-spacing: 0;
  line-height: 0.98;

  @media (max-width: 860px) {
    font-size: clamp(40px, 13vw, 58px);
  }
`;

const Lede = styled.p`
  max-width: 560px;
  margin: 0;
  color: #bdc6ce;
  font-size: 18px;
  line-height: 1.75;
`;

const ApiStatus = styled.div`
  display: grid;
  width: min(100%, 560px);
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px 18px;
  padding: 18px;
  border: 1px solid rgba(255, 255, 255, 0.11);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.055);

  @media (max-width: 860px) {
    grid-template-columns: 1fr;
  }
`;

const StatusSummary = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  color: #eef4f8;
  font-size: 14px;
  font-weight: 760;
`;

const StatusBadge = styled.span`
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 8px;
  color: #101318;
  background: #f5bf4f;

  ${ApiStatus}[data-state="online"] & {
    background: #78f3cf;
  }

  ${ApiStatus}[data-state="offline"] & {
    background: #ff8c8c;
  }
`;

const iconPulse = keyframes`
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
`;

const statusIconSize = `
  width: 18px;
  height: 18px;
`;

const ConnectedIcon = styled(CloudDone)`
  ${statusIconSize}
`;

const ErrorIcon = styled(ErrorOutline)`
  ${statusIconSize}
`;

const PendingIcon = styled(Pending)`
  ${statusIconSize}
  animation: ${iconPulse} 1.2s linear infinite;
`;

const StatusButton = styled.button`
  display: inline-flex;
  min-height: 40px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 14px;
  border: 1px solid rgba(120, 243, 207, 0.28);
  border-radius: 8px;
  color: #eafcf6;
  background: rgba(120, 243, 207, 0.08);
  font-size: 13px;
  font-weight: 800;

  &:hover:not(:disabled) {
    border-color: rgba(120, 243, 207, 0.5);
    background: rgba(120, 243, 207, 0.13);
  }

  &:disabled {
    opacity: 0.68;
  }

  @media (max-width: 860px) {
    width: 100%;
  }
`;

const ApiBase = styled.p`
  grid-column: 1 / -1;
  margin: 0;
  overflow-wrap: anywhere;
  color: #8f9aa5;
  font-size: 12px;
  font-weight: 700;
`;

const DashboardShell = styled.main`
  display: grid;
  min-width: 320px;
  min-height: 100vh;
  grid-template-columns: 230px minmax(360px, 1fr) minmax(280px, 340px);
  color: #f7fafc;
  background: #0a0d10;

  @media (max-width: 980px) {
    grid-template-columns: 220px minmax(0, 1fr);
  }

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

const WorkspaceRail = styled.aside`
  display: flex;
  min-height: 100vh;
  flex-direction: column;
  justify-content: space-between;
  gap: 28px;
  padding: 20px;
  border-right: 1px solid rgba(255, 255, 255, 0.09);
  background: #11161b;

  @media (max-width: 760px) {
    min-height: auto;
    border-right: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.09);
  }
`;

const RailTop = styled.div`
  display: grid;
  gap: 22px;
`;

const RailSectionTitle = styled.p`
  margin: 0;
  color: #8f9aa5;
  font-size: 12px;
  font-weight: 850;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const WorkspaceList = styled.div`
  display: grid;
  gap: 8px;
`;

const WorkspaceButton = styled.button`
  display: grid;
  min-height: 44px;
  grid-template-columns: 28px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: #e8eef3;
  background: transparent;
  text-align: left;

  span {
    display: grid;
    width: 28px;
    height: 28px;
    place-items: center;
    border-radius: 8px;
    color: #071015;
    background: #78f3cf;
    font-size: 12px;
    font-weight: 900;
  }

  strong {
    min-width: 0;
    overflow: hidden;
    font-size: 14px;
    font-weight: 780;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &[data-active="true"],
  &:hover {
    border-color: rgba(120, 243, 207, 0.22);
    background: rgba(120, 243, 207, 0.08);
  }
`;

const RailFooter = styled.div`
  display: grid;
  gap: 8px;
`;

const RailActionButton = styled.button`
  display: inline-flex;
  min-height: 40px;
  align-items: center;
  gap: 9px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: #c5cdd6;
  background: transparent;
  font-size: 13px;
  font-weight: 780;

  svg {
    width: 17px;
    height: 17px;
  }

  &[data-active="true"],
  &:hover {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.07);
  }
`;

const TerminalWorkspace = styled.section`
  display: grid;
  min-width: 0;
  align-content: start;
  gap: 18px;
  padding: 24px;
`;

const PageHeader = styled.header`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 16px;

  @media (max-width: 760px) {
    align-items: flex-start;
    flex-direction: column;
  }
`;

const DashboardTitle = styled.h1`
  margin: 6px 0 0;
  color: #ffffff;
  font-size: 28px;
  font-weight: 850;
  letter-spacing: 0;
`;

const UserPill = styled.div`
  display: inline-flex;
  max-width: 260px;
  min-height: 36px;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border: 1px solid rgba(120, 243, 207, 0.2);
  border-radius: 8px;
  color: #dff9f0;
  background: rgba(120, 243, 207, 0.08);
  font-size: 13px;
  font-weight: 780;

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const TerminalGrid = styled.div`
  display: grid;
  min-height: calc(100vh - 116px);
  grid-template-rows: 1fr 1fr;
  gap: 14px;

  @media (max-width: 760px) {
    min-height: 520px;
  }
`;

const TerminalPane = styled.section`
  display: grid;
  min-height: 220px;
  grid-template-rows: auto 1fr;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: #020304;
`;

const TerminalHeader = styled.div`
  display: flex;
  min-height: 36px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  color: #cfd7df;
  background: #0a0d10;
  font-size: 13px;
  font-weight: 760;

  small {
    color: #78f3cf;
    font-size: 11px;
    font-weight: 820;
    text-transform: uppercase;
  }
`;

const TerminalBody = styled.div`
  padding: 16px;
  color: #78f3cf;
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 13px;
`;

const TerminalLine = styled.p`
  margin: 0;
`;

const RightDock = styled.aside`
  display: grid;
  min-height: 100vh;
  grid-template-rows: auto 1fr;
  border-left: 1px solid rgba(255, 255, 255, 0.09);
  background: #11161b;

  @media (max-width: 980px) {
    grid-column: 1 / -1;
    min-height: 320px;
    border-top: 1px solid rgba(255, 255, 255, 0.09);
    border-left: 0;
  }
`;

const DockTabs = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  padding: 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.09);
`;

const DockTab = styled.button`
  min-height: 34px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: #aeb8c2;
  background: transparent;
  font-size: 12px;
  font-weight: 820;

  &[data-active="true"],
  &:hover {
    color: #071015;
    background: #78f3cf;
  }
`;

const DockContent = styled.div`
  min-width: 0;
  padding: 16px;
`;

const PanelList = styled.div`
  display: grid;
  gap: 8px;
`;

const PanelListItem = styled.div`
  overflow: hidden;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 8px;
  color: #e8eef3;
  background: rgba(255, 255, 255, 0.045);
  font-size: 13px;
  font-weight: 760;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const EmptyPanel = styled.div`
  display: grid;
  min-height: 190px;
  place-items: center;
  gap: 10px;
  border: 1px dashed rgba(255, 255, 255, 0.16);
  border-radius: 8px;
  color: #aeb8c2;
  font-size: 14px;
  font-weight: 760;

  svg {
    width: 22px;
    height: 22px;
  }
`;

const SettingsPage = styled.section`
  display: grid;
  grid-column: 2 / -1;
  align-content: start;
  gap: 22px;
  padding: 24px;

  @media (max-width: 760px) {
    grid-column: 1;
  }
`;

const SettingsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;

  @media (max-width: 1080px) {
    grid-template-columns: 1fr;
  }
`;

const SettingsBlock = styled.section`
  display: grid;
  align-content: start;
  gap: 12px;
  min-height: 180px;
  padding: 18px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: #11161b;
`;

const SettingsLabel = styled.p`
  margin: 0;
  color: #78f3cf;
  font-size: 12px;
  font-weight: 850;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const SettingsValue = styled.p`
  margin: 0;
  overflow-wrap: anywhere;
  color: #ffffff;
  font-size: 18px;
  font-weight: 820;
`;

const SettingsHint = styled.p`
  margin: 0;
  overflow-wrap: anywhere;
  color: #aeb8c2;
  font-size: 13px;
  line-height: 1.55;
`;

const LoginCard = styled.section`
  width: 100%;
  padding: 30px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.065);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.28);

  @media (max-width: 860px) {
    padding: 24px;
  }
`;

const LoginPanel = styled.div`
  display: grid;
  gap: 16px;
`;

const SessionPanel = styled.div`
  display: grid;
  gap: 16px;
`;

const LoginIconWrap = styled.span`
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border-radius: 8px;
  color: #071015;
  background: #78f3cf;
`;

const SuccessBadge = styled(LoginIconWrap)`
  background: #8fb7ff;
`;

const SessionTitle = styled.h2`
  margin: 0;
  color: #ffffff;
  font-size: 24px;
  font-weight: 820;
  letter-spacing: 0;
`;

const SessionText = styled.p`
  margin: 0;
  overflow-wrap: anywhere;
  color: #bdc6ce;
  font-size: 15px;
  line-height: 1.65;
`;

const PrimaryButton = styled.button`
  display: inline-flex;
  min-height: 50px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: 8px;
  color: #071015;
  background: #78f3cf;
  font-weight: 850;

  &:hover:not(:disabled) {
    background: #9ff8dc;
  }

  &:disabled {
    opacity: 0.7;
  }
`;

const SecondaryButton = styled(PrimaryButton)`
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #f6f8fb;
  background: rgba(7, 13, 18, 0.76);

  &:hover:not(:disabled) {
    border-color: rgba(120, 243, 207, 0.36);
    background: rgba(255, 255, 255, 0.08);
  }
`;

const PrimaryDangerButton = styled(SecondaryButton)`
  border-color: rgba(255, 140, 140, 0.28);
  color: #ffd2d2;

  &:hover:not(:disabled) {
    border-color: rgba(255, 140, 140, 0.5);
    background: rgba(255, 140, 140, 0.1);
  }
`;

const FormMessage = styled.p`
  margin: 0;
  color: ${({ $state }) => ($state === "error" ? "#ffd2d2" : "#aeb8c2")};
  font-size: 14px;
  line-height: 1.55;
`;

const buttonIconSize = `
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
`;

const ButtonRefreshIcon = styled(Refresh)`
  ${buttonIconSize}
`;

const ButtonLoginIcon = styled(Login)`
  ${buttonIconSize}
`;

const ButtonBrowserIcon = styled(OpenInBrowser)`
  ${buttonIconSize}
`;

const ButtonLogoutIcon = styled(Logout)`
  ${buttonIconSize}
`;

const ButtonSettingsIcon = styled(Settings)`
  ${buttonIconSize}
`;
