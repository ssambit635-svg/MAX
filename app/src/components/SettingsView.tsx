import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { LANGUAGES } from "../lib/i18n";
import { latestRelease, RELEASES } from "../lib/changelog";
import type { DiagnosticsPayload, PublicConfig } from "../lib/types";
import { shellBridge } from "../lib/shell";

interface SettingsViewProps {
  config: PublicConfig;
  busy: boolean;
  onConfig: (patch: Record<string, unknown>) => void;
  onDisconnect: (provider: string) => void;
  onVerify: (provider: "github" | "leetcode" | "render", values: Record<string, string>) =>
    Promise<{ ok: boolean; message: string }>;
  onNotice: (text: string, tone: "ok" | "error") => void;
}

function openExternal(url: string) {
  const bridge = shellBridge();
  if (bridge) bridge.openExternal(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

function HelpLine({ text, link, label }: { text: string; link?: string; label?: string }) {
  return (
    <div className="provider__help">
      <span>{text}</span>
      {link && (
        <button type="button" className="linkish" onClick={() => openExternal(link)}>
          {label ?? "Open"} ↗
        </button>
      )}
    </div>
  );
}

function StatusPill({ on, text }: { on: boolean; text: string }) {
  return (
    <span className="provider__status" data-on={on}>
      <span className="dot" data-tone={on ? "live" : undefined} />
      {text}
    </span>
  );
}

export function SettingsView({ config, busy, onConfig, onDisconnect, onVerify, onNotice }: SettingsViewProps) {
  const bridge = shellBridge();
  const latest = latestRelease();
  const [update, setUpdate] = useState<{ state: string; version: string | null; message: string }>({
    state: "idle",
    version: null,
    message: "Not checked yet.",
  });
  const [updateBusy, setUpdateBusy] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsPayload | null>(null);
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);

  useEffect(() => {
    if (!bridge?.onUpdate) return undefined;
    void bridge.updateStatus().then(setUpdate).catch(() => undefined);
    return bridge.onUpdate(setUpdate);
  }, [bridge]);

  const checkUpdates = () => {
    if (!bridge) return;
    setUpdateBusy(true);
    bridge.checkForUpdates();
    window.setTimeout(() => setUpdateBusy(false), 3000);
  };

  const loadDiagnostics = async () => {
    setDiagnosticsBusy(true);
    try {
      setDiagnostics(await api.diagnostics());
    } catch {
      onNotice("I couldn't build that report. Try again.", "error");
    } finally {
      setDiagnosticsBusy(false);
    }
  };

  const [githubUser, setGithubUser] = useState(config.github.username);
  const [githubToken, setGithubToken] = useState("");
  const [leetcodeUser, setLeetcodeUser] = useState(config.leetcode.username);
  const [renderKey, setRenderKey] = useState("");
  const [saveDir, setSaveDir] = useState(config.saveDir);
  const [checking, setChecking] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [result, setResult] = useState<{ provider: string; ok: boolean; message: string } | null>(null);

  const toggle = (key: keyof PublicConfig["prefs"]) => onConfig({ prefs: { [key]: !config.prefs[key] } });

  async function connect(provider: "github" | "leetcode" | "render", values: Record<string, string>) {
    if (checking) return;
    setChecking(provider);
    setResult(null);
    try {
      const verdict = await onVerify(provider, values);
      setResult({ provider, ...verdict });
      if (!verdict.ok) {
        onNotice(verdict.message, "error");
        return;
      }
      if (provider === "github") {
        await onConfig({ github: { username: values.username ?? "", ...(values.token ? { token: values.token } : {}) } });
        setGithubToken("");
      } else if (provider === "leetcode") {
        await onConfig({ leetcode: { username: values.username ?? "" } });
      } else {
        await onConfig({ render: { apiKey: values.apiKey ?? "" } });
        setRenderKey("");
      }
      onNotice(verdict.message, "ok");
    } finally {
      setChecking(null);
    }
  }

  const busyNow = busy || checking !== null;

  return (
    <div className="view">
      <div className="section">
        <h3 className="section__title">Behaviour</h3>
        <div className="card" style={{ padding: "4px 14px" }}>
          <div className="setting">
            <div className="setting__text">
              <div className="setting__name">Keep the island open</div>
              <div className="setting__desc">Esc won't fold it — only the chevron will.</div>
            </div>
            <button className="switch" data-on={config.prefs.keepIslandOpen} onClick={() => toggle("keepIslandOpen")} aria-label="Toggle pinned island" />
          </div>
          <div className="setting">
            <div className="setting__text">
              <div className="setting__name">Start with my computer</div>
              <div className="setting__desc">MAX opens quietly, no window flash.</div>
            </div>
            <button className="switch" data-on={config.prefs.launchAtLogin} onClick={() => toggle("launchAtLogin")} aria-label="Toggle launch at login" />
          </div>
          <div className="setting">
            <div className="setting__text">
              <div className="setting__name">Always on top</div>
              <div className="setting__desc">Stays above other windows. Also lives in the tray menu.</div>
            </div>
            <button
              className="switch"
              data-on={config.prefs.alwaysOnTop}
              onClick={() => toggle("alwaysOnTop")}
              aria-label="Toggle always on top"
            />
          </div>
          <div className="setting">
            <div className="setting__text">
              <div className="setting__name">Reduce motion</div>
              <div className="setting__desc">Calmer pet and panel animations.</div>
            </div>
            <button className="switch" data-on={config.prefs.reduceMotion} onClick={() => toggle("reduceMotion")} aria-label="Toggle reduced motion" />
          </div>
          <div className="setting">
            <div className="setting__text">
              <div className="setting__name">Language</div>
              <div className="setting__desc">Labels and the pet’s lines. Commands stay in English.</div>
            </div>
            <select
              className="input settings__select"
              value={config.prefs.language ?? "en"}
              onChange={(event) => onConfig({ prefs: { language: event.target.value } })}
              aria-label="Language"
            >
              {LANGUAGES.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="section">
        <h3 className="section__title">What’s new</h3>
        <div className="card" style={{ padding: "10px 14px" }}>
          <div className="release">
            <div className="release__head">
              <strong>{latest.title}</strong>
              <span className="release__version">v{latest.version}</span>
            </div>
            <ul className="release__list">
              {latest.changes.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <details className="release__older">
            <summary>Older versions</summary>
            {RELEASES.slice(1).map((release) => (
              <div className="release" key={release.version}>
                <div className="release__head">
                  <strong>{release.title}</strong>
                  <span className="release__version">v{release.version}</span>
                </div>
                <ul className="release__list">
                  {release.changes.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ))}
          </details>
        </div>
      </div>

      <div className="section">
        <h3 className="section__title">Connect your accounts</h3>
        <div className="hint" style={{ margin: "0 4px 8px" }}>
          All three are optional and read-only. Everything is stored on this PC only — MAX checks the
          details before saving, so a wrong handle tells you why instead of showing empty numbers.
        </div>

        <div className="card" style={{ padding: "4px 14px" }}>
          {/* ------------------------------------------------------------ GitHub */}
          <div className="provider">
            <div className="provider__head">
              <span className="provider__name">GitHub</span>
              <StatusPill on={config.github.connected} text={config.github.connected ? `@${config.github.username || "token"}` : "not connected"} />
            </div>
            <HelpLine
              text="Username = the last part of your profile URL (github.com/your-name). Token is optional — without it MAX reads public data only."
              link="https://github.com/settings/tokens"
              label="Get a token"
            />
            <div className="field">
              <input
                className="input"
                placeholder="your GitHub username"
                value={githubUser}
                autoComplete="off"
                onChange={(event) => setGithubUser(event.target.value.trim())}
              />
              <input
                className="input"
                type={showToken ? "text" : "password"}
                placeholder="token — only for private repos (optional)"
                value={githubToken}
                autoComplete="off"
                onChange={(event) => setGithubToken(event.target.value.trim())}
              />
            </div>
            <div className="field field--actions">
              <button
                className="btn"
                data-variant="primary"
                disabled={busyNow || (!githubUser && !githubToken)}
                onClick={() => void connect("github", { username: githubUser, token: githubToken })}
              >
                {checking === "github" ? "Checking…" : config.github.connected ? "Update" : "Connect"}
              </button>
              <button type="button" className="btn" data-variant="quiet" onClick={() => setShowToken((value) => !value)}>
                {showToken ? "Hide token" : "Show token"}
              </button>
              {config.github.connected && (
                <button className="btn" data-variant="quiet" onClick={() => onDisconnect("github")}>
                  Disconnect
                </button>
              )}
            </div>
            <div className="provider__help">
              Token steps: <b>Generate new token (classic)</b> → tick <b>public_repo</b> (or <b>repo</b> for
              private repos) → copy it once → paste here. MAX never writes to GitHub.
            </div>
            {result?.provider === "github" && (
              <div className="provider__result" data-ok={result.ok}>
                {result.message}
              </div>
            )}
          </div>

          {/* ---------------------------------------------------------- LeetCode */}
          <div className="provider">
            <div className="provider__head">
              <span className="provider__name">LeetCode</span>
              <StatusPill on={config.leetcode.connected} text={config.leetcode.connected ? config.leetcode.username : "not connected"} />
            </div>
            <HelpLine
              text="Handle = the last part of leetcode.com/u/your-handle. No password, no key, public stats only."
              link="https://leetcode.com/profile/"
              label="Find my handle"
            />
            <div className="field">
              <input
                className="input"
                placeholder="leetcode handle"
                value={leetcodeUser}
                autoComplete="off"
                onChange={(event) => setLeetcodeUser(event.target.value.trim())}
              />
              <button
                className="btn"
                data-variant={config.leetcode.connected ? "quiet" : "primary"}
                disabled={busyNow || !leetcodeUser}
                onClick={() => void connect("leetcode", { username: leetcodeUser })}
              >
                {checking === "leetcode" ? "Checking…" : config.leetcode.connected ? "Update" : "Connect"}
              </button>
              {config.leetcode.connected && (
                <button className="btn" data-variant="quiet" onClick={() => onDisconnect("leetcode")}>
                  Disconnect
                </button>
              )}
            </div>
            {result?.provider === "leetcode" && (
              <div className="provider__result" data-ok={result.ok}>
                {result.message}
              </div>
            )}
          </div>

          {/* ------------------------------------------------------------ Render */}
          <div className="provider">
            <div className="provider__head">
              <span className="provider__name">Render</span>
              <StatusPill on={config.render.connected} text={config.render.connected ? "connected" : "not connected"} />
            </div>
            <HelpLine
              text="API key from Render → Account Settings → API Keys. Read-only use: MAX lists your services and their latest deploy."
              link="https://dashboard.render.com/u/settings#api-keys"
              label="Open Render keys"
            />
            <div className="field">
              <input
                className="input"
                type="password"
                placeholder="render API key (starts with rnd_)"
                value={renderKey}
                autoComplete="off"
                onChange={(event) => setRenderKey(event.target.value.trim())}
              />
              <button
                className="btn"
                data-variant={config.render.connected ? "quiet" : "primary"}
                disabled={busyNow || !renderKey}
                onClick={() => void connect("render", { apiKey: renderKey })}
              >
                {checking === "render" ? "Checking…" : config.render.connected ? "Update" : "Connect"}
              </button>
              {config.render.connected && (
                <button className="btn" data-variant="quiet" onClick={() => onDisconnect("render")}>
                  Disconnect
                </button>
              )}
            </div>
            {result?.provider === "render" && (
              <div className="provider__result" data-ok={result.ok}>
                {result.message}
              </div>
            )}
          </div>

          {/* ------------------------------------------------------------ VS Code */}
          <div className="provider">
            <div className="provider__head">
              <span className="provider__name">VS Code</span>
              <StatusPill on text="local, no setup" />
            </div>
            <HelpLine text="Read straight from VS Code's own workspace history on this PC. Nothing to connect, nothing uploaded." />
          </div>
        </div>
      </div>

      <div className="section">
        <h3 className="section__title">Notes folder</h3>
        <div className="field">
          <input className="input" value={saveDir} onChange={(event) => setSaveDir(event.target.value)} />
          <button className="btn" disabled={busy || !saveDir.trim()} onClick={() => onConfig({ saveDir: saveDir.trim() })}>
            Save
          </button>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          Every “save note” writes a plain Markdown file here. Click the folder path in Explorer to see them.
        </div>
      </div>

      <div className="section">
        <h3 className="section__title">Updates and diagnostics</h3>
        <div className="card" style={{ padding: "10px 14px" }}>
          <div className="field">
            <button className="btn" disabled={!bridge || updateBusy} onClick={checkUpdates}>
              Check for updates
            </button>
            {update.state === "ready" && (
              <button className="btn" data-variant="primary" onClick={() => bridge?.installUpdate()}>
                Restart to install {update.version ?? ""}
              </button>
            )}
          </div>
          <div className="hint" style={{ marginTop: 8 }}>
            {bridge ? update.message : "Updates arrive with the installed app; this preview never phones home."}
          </div>

          <div className="field" style={{ marginTop: 14 }}>
            <button className="btn" data-variant="quiet" disabled={diagnosticsBusy} onClick={loadDiagnostics}>
              {diagnosticsBusy ? "Collecting…" : "Copy a diagnostics report"}
            </button>
            <button
              className="btn"
              data-variant="quiet"
              disabled={!diagnostics}
              onClick={() => {
                void navigator.clipboard.writeText(diagnostics?.summary ?? "").then(
                  () => onNotice("Diagnostics copied. Tokens, paths and e-mail are removed.", "ok"),
                  () => onNotice("I couldn't reach the clipboard.", "error"),
                );
              }}
            >
              Copy to clipboard
            </button>
          </div>
          <div className="hint" style={{ marginTop: 8 }}>
            {diagnostics
              ? "Nothing was sent anywhere. The report stays on your clipboard until you paste it."
              : "A short, redacted summary you can paste into a GitHub issue: versions, preferences, recent failures."}
          </div>
          {diagnostics && <pre className="diag">{diagnostics.summary}</pre>}
        </div>
      </div>

      <div className="section">
        <h3 className="section__title">Your data</h3>
        <div className="card" style={{ padding: "10px 14px" }}>
          <div className="hint">
            Settings and keys: <code>%APPDATA%\MAX\state\config.json</code>
            <br />
            Notes: <code>{config.saveDir}</code>
            <br />
            No account, no telemetry, no cloud model. Network calls happen only for the accounts above.
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <button className="btn" data-variant="quiet" onClick={() => openExternal("https://github.com/ssambit635-svg/MAX")}>
              Open MAX on GitHub ↗
            </button>
            {shellBridge() && (
              <button className="btn" data-variant="quiet" onClick={() => shellBridge()?.quit()}>
                Quit MAX
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
