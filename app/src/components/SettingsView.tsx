import { useState } from "react";
import type { PublicConfig } from "../lib/types";

interface SettingsViewProps {
  config: PublicConfig;
  busy: boolean;
  onConfig: (patch: Record<string, unknown>) => void;
  onDisconnect: (provider: string) => void;
}

export function SettingsView({ config, busy, onConfig, onDisconnect }: SettingsViewProps) {
  const [githubUser, setGithubUser] = useState(config.github.username);
  const [githubToken, setGithubToken] = useState("");
  const [leetcodeUser, setLeetcodeUser] = useState(config.leetcode.username);
  const [renderKey, setRenderKey] = useState("");
  const [saveDir, setSaveDir] = useState(config.saveDir);

  const toggle = (key: keyof PublicConfig["prefs"]) =>
    onConfig({ prefs: { [key]: !config.prefs[key] } });

  return (
    <div className="view">
      <div className="section">
        <h3 className="section__title">Behaviour</h3>
        <div className="card" style={{ padding: "4px 14px" }}>
          <div className="setting">
            <div className="setting__text">
              <div className="setting__name">Keep the island open</div>
              <div className="setting__desc">Stops MAX from folding back into the pill after a command.</div>
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
              <div className="setting__name">Reduce motion</div>
              <div className="setting__desc">Calmer pet and panel animations.</div>
            </div>
            <button className="switch" data-on={config.prefs.reduceMotion} onClick={() => toggle("reduceMotion")} aria-label="Toggle reduced motion" />
          </div>
        </div>
      </div>

      <div className="section">
        <h3 className="section__title">Integrations</h3>
        <div className="card" style={{ padding: "4px 14px" }}>
          <div className="provider">
            <div className="provider__head">
              <span className="provider__name">GitHub</span>
              <span className="provider__status" data-on={config.github.connected}>
                {config.github.connected ? `@${config.github.username || "connected"}` : "not connected"}
              </span>
            </div>
            <div className="field">
              <input className="input" placeholder="github username" value={githubUser} onChange={(event) => setGithubUser(event.target.value)} />
              <input
                className="input"
                type="password"
                placeholder="personal access token (optional)"
                value={githubToken}
                onChange={(event) => setGithubToken(event.target.value)}
              />
            </div>
            <div className="field">
              <button
                className="btn"
                data-variant="primary"
                disabled={busy || (!githubUser.trim() && !githubToken.trim())}
                onClick={() => {
                  onConfig({
                    github: {
                      username: githubUser.trim(),
                      ...(githubToken.trim() ? { token: githubToken.trim() } : {}),
                    },
                  });
                  setGithubToken("");
                }}
              >
                {githubUser || githubToken ? "Connect GitHub" : "Add a handle first"}
              </button>
              {config.github.connected && (
                <button className="btn" data-variant="quiet" onClick={() => onDisconnect("github")}>
                  Disconnect
                </button>
              )}
            </div>
          </div>

          <div className="provider">
            <div className="provider__head">
              <span className="provider__name">LeetCode</span>
              <span className="provider__status" data-on={config.leetcode.connected}>
                {config.leetcode.connected ? config.leetcode.username : "not connected"}
              </span>
            </div>
            <div className="field">
              <input className="input" placeholder="leetcode handle" value={leetcodeUser} onChange={(event) => setLeetcodeUser(event.target.value)} />
              <button
                className="btn"
                disabled={busy || !leetcodeUser.trim()}
                onClick={() => onConfig({ leetcode: { username: leetcodeUser.trim() } })}
              >
                Connect
              </button>
              {config.leetcode.connected && (
                <button className="btn" data-variant="quiet" onClick={() => onDisconnect("leetcode")}>
                  Disconnect
                </button>
              )}
            </div>
          </div>

          <div className="provider">
            <div className="provider__head">
              <span className="provider__name">Render</span>
              <span className="provider__status" data-on={config.render.connected}>
                {config.render.connected ? "connected" : "not connected"}
              </span>
            </div>
            <div className="field">
              <input
                className="input"
                type="password"
                placeholder="render API key"
                value={renderKey}
                onChange={(event) => setRenderKey(event.target.value)}
              />
              <button
                className="btn"
                disabled={busy || !renderKey.trim()}
                onClick={() => {
                  onConfig({ render: { apiKey: renderKey.trim() } });
                  setRenderKey("");
                }}
              >
                Connect
              </button>
              {config.render.connected && (
                <button className="btn" data-variant="quiet" onClick={() => onDisconnect("render")}>
                  Disconnect
                </button>
              )}
            </div>
          </div>

          <div className="provider">
            <div className="provider__head">
              <span className="provider__name">VS Code</span>
              <span className="provider__status" data-on>
                local
              </span>
            </div>
            <div className="hint" style={{ marginTop: 4 }}>
              Read straight from VS Code's own workspace history on this machine. Nothing is uploaded.
            </div>
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
          Every “save note” writes a plain Markdown file here. Keys and settings stay in a local JSON file on this
          machine — no account, no telemetry, no cloud.
        </div>
      </div>
    </div>
  );
}
