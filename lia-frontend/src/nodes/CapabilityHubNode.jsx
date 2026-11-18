import { useEffect, useState } from "react";

const OPTIONS = [
  {
    id: "planner",
    label: "Creator Roast",
    switchKey: "cashclaw",
    summary: "Comedy-roast persona, YouTube ideas, scripts, thumbnails, bits, and ethical money plans.",
  },
  {
    id: "plugins",
    label: "Plugins",
    switchKey: "plugins",
    summary: "Local plugins and GitHub-powered tools.",
  },
  {
    id: "places",
    label: "Nearby Places",
    switchKey: "places",
    summary: "Search nearby restaurants, hotels, shops, and travel places after browser location permission.",
  },
  {
    id: "mcp",
    label: "MCP",
    switchKey: "mcp",
    summary: "Connected model context protocol servers.",
  },
  {
    id: "skills",
    label: "Skills",
    summary: "Installed assistant workflows.",
  },
  {
    id: "pending",
    label: "Queue",
    summary: "Draft PC actions waiting for approval.",
  },
  {
    id: "facts",
    label: "Memory",
    summary: "Facts LIA has remembered about you.",
  },
];

const STATUS_COLOR = { ready: "#4caf50", connecting: "#ff9800", error: "#f44336", disconnected: "#666" };
const TRANSPORT_ICON = { sse: "🌐", stdio: "⚙️", streamable_http: "🔗" };

export default function CapabilityHubNode() {
  const [state, setState] = useState(null);
  const [pending, setPending] = useState([]);
  const [open, setOpen] = useState("planner");
  const [form, setForm] = useState({ name: "", source: "", description: "" });
  const [mcpServers, setMcpServers] = useState([]);
  const [mcpForm, setMcpForm] = useState({ id: "", label: "", transport: "sse", url: "", description: "" });
  const [plugins, setPlugins] = useState([]);
  const [facts, setFacts] = useState([]);

  useEffect(() => {
    refresh();
    refreshMcp();
    refreshPlugins();
    refreshFacts();
  }, []);

  async function refresh() {
    const resp = await fetch("/api/capabilities");
    const data = await resp.json();
    setState(data);
    window.dispatchEvent(new CustomEvent("lia-capabilities-changed", { detail: data }));
    fetch("/api/pc/pending")
      .then(r => r.json())
      .then(d => setPending(d.actions ?? []))
      .catch(() => {});
  }

  async function refreshMcp() {
    try {
      const r = await fetch("/api/mcp/servers");
      if (r.ok) setMcpServers((await r.json()).servers ?? []);
    } catch {}
  }

  async function refreshPlugins() {
    try {
      const r = await fetch("/api/plugins");
      if (r.ok) setPlugins((await r.json()).plugins ?? []);
    } catch {}
  }

  async function setSwitch(name, enabled) {
    const resp = await fetch("/api/capabilities/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, enabled }),
    });
    const data = await resp.json();
    setState(data);
    window.dispatchEvent(new CustomEvent("lia-capabilities-changed", { detail: data }));
  }

  async function addItem(kind) {
    if (!form.name.trim()) return;
    await fetch(`/api/capabilities/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setForm({ name: "", source: "", description: "" });
    refresh();
  }

  async function setPendingStatus(id, status) {
    await fetch(`/api/pc/pending/${id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    refresh();
  }

  async function toggleMcpServer(id, enabled) {
    await fetch(`/api/mcp/servers/${id}/toggle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    setTimeout(refreshMcp, 800);
  }

  async function addMcpServer() {
    if (!mcpForm.id.trim() || !mcpForm.url.trim()) return;
    await fetch("/api/mcp/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...mcpForm }),
    });
    setMcpForm({ id: "", label: "", transport: "sse", url: "", description: "" });
    setTimeout(refreshMcp, 800);
  }

  async function removeMcpServer(id) {
    if (!confirm(`Remove MCP server "${id}"?`)) return;
    await fetch(`/api/mcp/servers/${id}`, { method: "DELETE" });
    refreshMcp();
  }

  async function reloadPlugins() {
    await fetch("/api/plugins/reload", { method: "POST" });
    setTimeout(refreshPlugins, 500);
  }

  async function refreshFacts() {
    try {
      const r = await fetch("/api/facts");
      if (r.ok) setFacts((await r.json()).facts ?? []);
    } catch {}
  }

  async function deleteFact(key) {
    await fetch(`/api/facts/${encodeURIComponent(key)}`, { method: "DELETE" });
    refreshFacts();
  }

  const switches = state?.switches ?? {};
  const pluginList = state?.plugins ?? [];
  const mcpList = state?.mcp_connections ?? [];
  const skillList = state?.skills ?? [];
  const pendingList = pending.filter(action => action.status === "pending");

  return (
    <div className="capability-hub">
      {OPTIONS.map(option => {
        const isOpen = open === option.id;
        const enabled = option.switchKey ? Boolean(switches[option.switchKey]) : true;
        return (
          <section key={option.id} className={`cap-option ${isOpen ? "open" : ""}`}>
            <button className="cap-option-head" onClick={() => setOpen(isOpen ? "" : option.id)}>
              <span className={`cap-dot ${enabled ? "on" : ""}`} />
              <span className="cap-option-title">
                <strong>{option.label}</strong>
                <small>
                  {option.switchKey
                    ? (enabled ? "connected" : "off")
                    : getOptionCount(option.id, pluginList, mcpList, skillList, pendingList, facts)}
                </small>
              </span>
              <span className="cap-chevron">{isOpen ? "Close" : "Open"}</span>
            </button>

            {isOpen && (
              <div className="cap-option-body">
                <p className="cap-summary">{option.summary}</p>
                {option.switchKey && (
                  <button
                    className={`cap-inline-switch ${enabled ? "active" : ""}`}
                    onClick={() => setSwitch(option.switchKey, !enabled)}
                  >
                    {enabled ? "Turn off" : "Turn on"}
                  </button>
                )}
                {renderOptionBody({
                  optionId: option.id,
                  pluginList: plugins,
                  mcpList: state?.mcp_connections ?? [],
                  skillList,
                  pendingList,
                  form,
                  setForm,
                  addItem,
                  setPendingStatus,
                  // MCP Hub
                  mcpServers,
                  mcpForm,
                  setMcpForm,
                  addMcpServer,
                  toggleMcpServer,
                  removeMcpServer,
                  reloadPlugins,
                  // Facts
                  facts,
                  deleteFact,
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function getOptionCount(id, plugins, mcp, skills, pending, facts) {
  const counts = {
    plugins: plugins.length,
    mcp: mcp.length,
    skills: skills.length,
    pending: pending.length,
    facts: facts.length,
  };
  return `${counts[id] ?? 0} items`;
}

function renderOptionBody({ optionId, pluginList, mcpList, skillList, pendingList, form, setForm, addItem, setPendingStatus,
  mcpServers, mcpForm, setMcpForm, addMcpServer, toggleMcpServer, removeMcpServer, reloadPlugins,
  facts, deleteFact }) {
  if (optionId === "planner") {
    return (
      <div className="cap-mini-copy">
        Ask LIA for funny YouTube ideas, Shorts scripts, roasts, thumbnails, titles, trend angles, and creator plans.
      </div>
    );
  }

  if (optionId === "places") {
    return (
      <div className="cap-mini-copy">
        Turn on Location in Chat or Voice, then ask for nearby restaurants, cafes, hotels, shops, petrol, ATMs, or low and high price places.
      </div>
    );
  }

  if (optionId === "skills") {
    return (
      <div className="cap-list">
        {skillList.map(skill => (
          <div key={skill} className="cap-item">{skill}</div>
        ))}
        {skillList.length === 0 && <div className="cap-item">No skills installed.</div>}
      </div>
    );
  }

  if (optionId === "pending") {
    return (
      <div className="cap-list">
        {pendingList.map(action => (
          <div key={action.id} className="cap-item">
            <strong>{action.app} draft</strong>
            <span>{action.contact || "manual contact"} - {action.message || "no message"}</span>
            <small>{action.note}</small>
            <div className="cap-action-row">
              <button onClick={() => setPendingStatus(action.id, "approved")}>Approve</button>
              <button onClick={() => setPendingStatus(action.id, "dismissed")}>Dismiss</button>
            </div>
          </div>
        ))}
        {pendingList.length === 0 && <div className="cap-item">No pending actions.</div>}
      </div>
    );
  }

  if (optionId === "mcp") {
    const readyCount = (mcpServers || []).filter(s => s.status === "ready").length;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ color: "#888", fontSize: 11 }}>
          {readyCount} of {mcpServers.length} servers connected
        </div>

        {/* Server list */}
        <div className="cap-list" style={{ maxHeight: 220, overflowY: "auto" }}>
          {mcpServers.map(s => (
            <div key={s.id} style={{ padding: "5px 0", borderBottom: "1px solid #222" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 13 }}>{TRANSPORT_ICON[s.transport] || "🔌"}</span>
                <strong style={{ color: "#e0e0e0" }}>{s.label || s.id}</strong>
                <span style={{
                  fontSize: 10, padding: "1px 6px", borderRadius: 8,
                  background: (STATUS_COLOR[s.status] || "#666") + "33",
                  color: STATUS_COLOR[s.status] || "#666",
                }}>
                  {s.status}{s.tools > 0 ? ` · ${s.tools} tools` : ""}
                </span>
                <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                  <button
                    onClick={() => toggleMcpServer(s.id, !s.enabled)}
                    style={{
                      background: s.enabled ? "#4caf5022" : "#55555522",
                      border: `1px solid ${s.enabled ? "#4caf50" : "#555"}`,
                      color: s.enabled ? "#4caf50" : "#888",
                      borderRadius: 4, padding: "1px 7px", fontSize: 11, cursor: "pointer",
                    }}
                  >{s.enabled ? "On" : "Off"}</button>
                  <button
                    onClick={() => removeMcpServer(s.id)}
                    style={{ background: "transparent", border: "1px solid #333",
                             color: "#666", borderRadius: 4, padding: "1px 6px",
                             fontSize: 11, cursor: "pointer" }}
                  >✕</button>
                </div>
              </div>
              {s.description && <div style={{ color: "#666", fontSize: 11, marginTop: 2 }}>{s.description}</div>}
              {s.error && <div style={{ color: "#f44336", fontSize: 10, marginTop: 2 }}>⚠ {s.error}</div>}
              {s.tool_names?.length > 0 && (
                <div style={{ color: "#555", fontSize: 10, marginTop: 2 }}>
                  {s.tool_names.slice(0, 4).join(", ")}{s.tool_names.length > 4 ? ` +${s.tool_names.length - 4}` : ""}
                </div>
              )}
            </div>
          ))}
          {mcpServers.length === 0 && <div className="cap-item">No servers configured.</div>}
        </div>

        {/* Add server form */}
        <details style={{ marginTop: 4 }}>
          <summary style={{ color: "#888", fontSize: 12, cursor: "pointer" }}>+ Add MCP Server</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
            <input value={mcpForm.id} onChange={e => setMcpForm(f => ({ ...f, id: e.target.value }))}
              placeholder="id (e.g. my_server)"
              style={{ background: "#1a1a1a", color: "#ccc", border: "1px solid #333",
                       borderRadius: 4, padding: "4px 8px", fontSize: 12 }} />
            <input value={mcpForm.label} onChange={e => setMcpForm(f => ({ ...f, label: e.target.value }))}
              placeholder="Display label"
              style={{ background: "#1a1a1a", color: "#ccc", border: "1px solid #333",
                       borderRadius: 4, padding: "4px 8px", fontSize: 12 }} />
            <select value={mcpForm.transport} onChange={e => setMcpForm(f => ({ ...f, transport: e.target.value }))}
              style={{ background: "#1a1a1a", color: "#ccc", border: "1px solid #333",
                       borderRadius: 4, padding: "4px 8px", fontSize: 12 }}>
              <option value="sse">SSE (HTTP)</option>
              <option value="streamable_http">Streamable HTTP</option>
            </select>
            <input value={mcpForm.url} onChange={e => setMcpForm(f => ({ ...f, url: e.target.value }))}
              placeholder="URL  e.g. http://127.0.0.1:8891/sse"
              style={{ background: "#1a1a1a", color: "#ccc", border: "1px solid #333",
                       borderRadius: 4, padding: "4px 8px", fontSize: 12 }} />
            <input value={mcpForm.description} onChange={e => setMcpForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Description (optional)"
              style={{ background: "#1a1a1a", color: "#ccc", border: "1px solid #333",
                       borderRadius: 4, padding: "4px 8px", fontSize: 12 }} />
            <button onClick={addMcpServer}
              style={{ background: "#4caf50", color: "#fff", border: "none",
                       borderRadius: 4, padding: "5px", cursor: "pointer", fontSize: 12 }}>
              Connect Server
            </button>
          </div>
        </details>
      </div>
    );
  }

  if (optionId === "plugins") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "#888", fontSize: 11 }}>{pluginList.length} plugins loaded</span>
          <button onClick={reloadPlugins}
            style={{ background: "#333", color: "#ccc", border: "1px solid #444",
                     borderRadius: 4, padding: "2px 8px", fontSize: 11, cursor: "pointer" }}>
            ↺ Reload
          </button>
        </div>
        <div className="cap-list">
          {pluginList.map((p, i) => (
            <div key={i} style={{ padding: "4px 0", borderBottom: "1px solid #1a1a1a" }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <strong style={{ color: "#e040fb" }}>{p.name}</strong>
                <span style={{ color: "#555", fontSize: 11 }}>v{p.version}</span>
                {p.has_api && <span style={{ color: "#2196f3", fontSize: 10 }}>API</span>}
                {p.has_skills && <span style={{ color: "#ff9800", fontSize: 10 }}>Skills</span>}
                <span style={{
                  fontSize: 10, marginLeft: "auto",
                  color: p.enabled ? "#4caf50" : "#555",
                }}>{p.enabled ? "enabled" : "disabled"}</span>
              </div>
              {p.description && <div style={{ color: "#666", fontSize: 11 }}>{p.description}</div>}
            </div>
          ))}
          {pluginList.length === 0 && (
            <div className="cap-item">
              Drop plugin folders in <code>backend/plugins/</code> — see PLUGIN_GUIDE.md
            </div>
          )}
        </div>

        {/* GitHub installer */}
        <GithubInstaller onInstalled={reloadPlugins} />
      </div>
    );
  }

  if (optionId === "facts") {
    const categories = [...new Set((facts || []).map(f => f.category || "note"))];
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ color: "#888", fontSize: 11 }}>
          {facts.length} facts stored — LIA remembers these about you
        </div>
        <div className="cap-list" style={{ maxHeight: 260, overflowY: "auto" }}>
          {(facts || []).map(f => (
            <div key={f.key} style={{ padding: "4px 0", borderBottom: "1px solid #1a1a1a", display: "flex", gap: 6, alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <span style={{ color: "#7c3aed", fontSize: 11, fontWeight: 600 }}>{f.key}</span>
                <span style={{ color: "#ccc", fontSize: 12, marginLeft: 6 }}>{f.value}</span>
                <span style={{ color: "#444", fontSize: 10, marginLeft: 6 }}>[{f.category}]</span>
              </div>
              <button
                onClick={() => deleteFact(f.key)}
                style={{ background: "transparent", border: "1px solid #333", color: "#555",
                         borderRadius: 3, padding: "0px 5px", fontSize: 10, cursor: "pointer" }}
              >✕</button>
            </div>
          ))}
          {facts.length === 0 && (
            <div className="cap-item">No facts yet. Tell LIA something to remember.</div>
          )}
        </div>
      </div>
    );
  }

  return null;
}

function GithubInstaller({ onInstalled }) {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function install() {
    if (!url.trim()) return;
    setBusy(true);
    setStatus("Installing…");
    try {
      const r = await fetch("/api/plugins/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const d = await r.json();
      if (d.ok) {
        setStatus(`Installed: ${d.installed}`);
        setUrl("");
        onInstalled?.();
      } else {
        setStatus(`Error: ${d.detail || "unknown"}`);
      }
    } catch (e) {
      setStatus(`Error: ${e.message}`);
    }
    setBusy(false);
  }

  return (
    <details style={{ marginTop: 2 }}>
      <summary style={{ color: "#888", fontSize: 12, cursor: "pointer" }}>+ Install from GitHub</summary>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://github.com/user/lia-plugin-name"
          style={{ background: "#1a1a1a", color: "#ccc", border: "1px solid #333",
                   borderRadius: 4, padding: "4px 8px", fontSize: 12 }}
        />
        <button
          onClick={install}
          disabled={busy}
          style={{ background: "#7c3aed", color: "#fff", border: "none",
                   borderRadius: 4, padding: "5px", cursor: busy ? "not-allowed" : "pointer",
                   fontSize: 12, opacity: busy ? 0.6 : 1 }}
        >
          {busy ? "Installing…" : "Install Plugin"}
        </button>
        {status && <div style={{ color: status.startsWith("Error") ? "#f44336" : "#4caf50", fontSize: 11 }}>{status}</div>}
      </div>
    </details>
  );
}
