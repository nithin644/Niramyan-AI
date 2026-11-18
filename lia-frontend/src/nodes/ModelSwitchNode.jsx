/**
 * NODE: ModelSwitchNode - switch LIA brain.
 * Neuro/Riko use Ollama. API mode uses the selected external provider.
 */
import { useEffect, useState } from "react";

const OLLAMA_MODELS = [
  { id: "lia-neuro", label: "Neuro", desc: "Neuro-sama 3B — Telugu + personality" },
];

const PROVIDER_ORDER = ["openai", "claude", "gemini", "openrouter", "nvidia"];
const TEACHER_ORDER  = ["claude", "openai", "gemini", "openrouter", "nvidia", "deepseek"];

export default function ModelSwitchNode() {
  const [active, setActive] = useState("lia-neuro");
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState("");
  const [errorKind, setErrorKind] = useState("error");
  const [apiOpen, setApiOpen] = useState(false);
  const [apiBrain, setApiBrain] = useState({ active_provider: "openai", providers: {} });
  const [drafts, setDrafts] = useState({});

  // UPskill teacher state
  const [teacherOpen, setTeacherOpen]     = useState(false);
  const [teacher, setTeacher]             = useState({ active_provider: "", providers: {} });
  const [teacherDrafts, setTeacherDrafts] = useState({});
  const [teacherBusy, setTeacherBusy]     = useState(false);
  const [genTask, setGenTask]             = useState("");
  const [genStatus, setGenStatus]         = useState(null); // null | {running,status,lines,error}

  useEffect(() => {
    refreshConfig();
    refreshTeacher();
  }, []);

  async function refreshConfig() {
    try {
      const data = await fetch("/api/config").then(r => r.json());
      if (data.active_brain) setActive(data.active_brain);
      if (data.api_brain) {
        setApiBrain(data.api_brain);
        seedDrafts(data.api_brain);
      } else {
        await refreshApiBrain();
      }
    } catch {}
  }

  // ── Teacher helpers ──────────────────────────────────────────────────────

  async function refreshTeacher() {
    try {
      const data = await fetch("/api/upskill/teacher").then(r => r.json());
      setTeacher(data);
      seedTeacherDrafts(data);
    } catch {}
  }

  function seedTeacherDrafts(config) {
    setTeacherDrafts(prev => {
      const next = { ...prev };
      for (const [id, p] of Object.entries(config.providers ?? {})) {
        next[id] = {
          api_key: "",
          model: next[id]?.model ?? p.model ?? "",
        };
      }
      return next;
    });
  }

  function updateTeacherDraft(provider, patch) {
    setTeacherDrafts(prev => ({ ...prev, [provider]: { ...(prev[provider] ?? {}), ...patch } }));
  }

  async function saveTeacherProvider(provider) {
    setTeacherBusy(true);
    const draft = teacherDrafts[provider] ?? {};
    try {
      const payload = { provider, model: draft.model };
      if (draft.api_key?.trim()) payload.api_key = draft.api_key.trim();
      const res  = await fetch("/api/upskill/teacher/provider", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Save failed");
      setTeacher(data);
      seedTeacherDrafts(data);
      updateTeacherDraft(provider, { api_key: "" });
      showNotice("Saved", "ok");
    } catch (err) { showNotice(err.message || "Save failed"); }
    finally { setTeacherBusy(false); }
  }

  async function deleteTeacherProvider(provider) {
    try {
      const res  = await fetch(`/api/upskill/teacher/provider/${provider}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Delete failed");
      setTeacher(data);
      seedTeacherDrafts(data);
    } catch (err) { showNotice(err.message); }
  }

  async function activateTeacher(provider) {
    setTeacherBusy(true);
    try {
      const draft = teacherDrafts[provider] ?? {};
      const current = teacher.providers?.[provider] ?? {};
      if (!current.has_key && !draft.api_key?.trim()) {
        throw new Error(`Paste ${current.label || provider} API key first`);
      }
      // save key+model first
      const payload = { provider, model: draft.model || current.model };
      if (draft.api_key?.trim()) payload.api_key = draft.api_key.trim();
      await fetch("/api/upskill/teacher/provider", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const res  = await fetch("/api/upskill/teacher/activate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Activate failed");
      setTeacher(data);
      seedTeacherDrafts(data);
      updateTeacherDraft(provider, { api_key: "" });
      showNotice(`${current.label || provider} set as teacher`, "ok");
    } catch (err) { showNotice(err.message || "Activate failed"); }
    finally { setTeacherBusy(false); }
  }

  async function startGenerate() {
    if (!genTask.trim()) { showNotice("Enter a skill task first"); return; }
    setTeacherBusy(true);
    setGenStatus({ running: true, status: "starting", lines: [], error: "" });
    try {
      const res  = await fetch("/api/upskill/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: genTask.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.detail || data.error || "Start failed");
      pollGenStatus();
    } catch (err) {
      setGenStatus({ running: false, status: "error", lines: [], error: err.message });
      setTeacherBusy(false);
    }
  }

  function pollGenStatus() {
    const interval = setInterval(async () => {
      try {
        const data = await fetch("/api/upskill/status").then(r => r.json());
        setGenStatus(data);
        if (!data.running) {
          clearInterval(interval);
          setTeacherBusy(false);
        }
      } catch { clearInterval(interval); setTeacherBusy(false); }
    }, 2000);
  }

  async function refreshApiBrain() {
    try {
      const data = await fetch("/api/api_brain").then(r => r.json());
      setApiBrain(data);
      seedDrafts(data);
      return data;
    } catch {
      showNotice("Restart backend to load API brain");
      return null;
    }
  }

  function seedDrafts(config) {
    setDrafts(prev => {
      const next = { ...prev };
      for (const [id, provider] of Object.entries(config.providers ?? {})) {
        next[id] = {
          api_key: "",
          model: next[id]?.model ?? provider.model ?? "",
          enabled: Boolean(provider.enabled),
        };
      }
      return next;
    });
  }

  function updateDraft(provider, patch) {
    setDrafts(prev => ({
      ...prev,
      [provider]: { ...(prev[provider] ?? {}), ...patch },
    }));
  }

  function clearNotice() {
    setErrorKind("error");
    setError("");
  }

  function showNotice(message, kind = "error") {
    setErrorKind(kind);
    setError(message);
  }

  async function switchModel(modelId) {
    if (modelId === "api") {
      const opening = !apiOpen;
      setApiOpen(opening);
      clearNotice();
      if (opening) await refreshApiBrain();
      return;
    }
    if (modelId === active || switching) return;
    setSwitching(true);
    clearNotice();
    try {
      const res = await fetch("/api/switch_model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId }),
      });
      const data = await res.json();
      if (!res.ok || data.error) showNotice(data.detail || data.error || "Switch failed");
      else {
        setActive(modelId);
        setApiOpen(false);
      }
    } catch {
      showNotice("Switch failed");
    } finally {
      setSwitching(false);
    }
  }

  async function saveProvider(provider) {
    clearNotice();
    const draft = drafts[provider] ?? {};
    try {
      const payload = {
        provider,
        model: draft.model,
        enabled: draft.enabled,
      };
      if (draft.api_key?.trim()) payload.api_key = draft.api_key.trim();
      const res = await fetch("/api/api_brain/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Save failed");
      setApiBrain(data);
      seedDrafts(data);
      updateDraft(provider, { api_key: "" });
    } catch (err) {
      showNotice(err.message || "Save failed");
    }
  }

  async function deleteProvider(provider) {
    clearNotice();
    try {
      const res = await fetch(`/api/api_brain/provider/${provider}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Delete failed");
      setApiBrain(data);
      seedDrafts(data);
      updateDraft(provider, { api_key: "", enabled: false });
    } catch (err) {
      showNotice(err.message || "Delete failed");
    }
  }

  async function stopProvider(provider) {
    setSwitching(true);
    clearNotice();
    try {
      const res = await fetch("/api/api_brain/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, fallback_model: "lia-riko" }),
      });
      const data = await res.json();
      if (data.api_brain) { setApiBrain(data.api_brain); seedDrafts(data.api_brain); }
      setActive("lia-riko");
    } catch {
      showNotice("Stop failed");
    } finally {
      setSwitching(false);
    }
  }

  async function startProvider(provider) {
    setSwitching(true);
    clearNotice();
    try {
      const draft = drafts[provider] ?? {};
      const current = apiBrain.providers?.[provider] ?? {};
      if (!current.has_key && !draft.api_key) {
        throw new Error(`Paste ${current.label || provider} API key first`);
      }

      const payload = {
        provider,
        model: draft.model || current.model,
        enabled: true,
      };
      if (draft.api_key?.trim()) payload.api_key = draft.api_key.trim();
      const saveRes = await fetch("/api/api_brain/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const saved = await saveRes.json();
      if (!saveRes.ok) throw new Error(saved.detail || "Save failed");
      setApiBrain(saved);
      seedDrafts(saved);
      updateDraft(provider, { api_key: "", enabled: true });

      const res = await fetch("/api/api_brain/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "Start failed");
      setApiBrain(data.api_brain);
      seedDrafts(data.api_brain);
      setActive("api");
      setApiOpen(true);
      if (data.warning) showNotice(data.warning, "warn");
    } catch (err) {
      showNotice(err.message || "Start failed");
    } finally {
      setSwitching(false);
    }
  }

  async function testProvider(provider) {
    setSwitching(true);
    clearNotice();
    try {
      const draft = drafts[provider] ?? {};
      const current = apiBrain.providers?.[provider] ?? {};
      if (!current.has_key && !draft.api_key) {
        throw new Error(`Paste ${current.label || provider} API key first`);
      }

      const payload = {
        provider,
        model: draft.model || current.model,
        enabled: draft.enabled,
      };
      if (draft.api_key?.trim()) payload.api_key = draft.api_key.trim();
      const saveRes = await fetch("/api/api_brain/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const saved = await saveRes.json();
      if (!saveRes.ok) throw new Error(saved.detail || "Save failed");
      setApiBrain(saved);
      seedDrafts(saved);
      updateDraft(provider, { api_key: "" });

      const res = await fetch("/api/api_brain/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Test failed");
      if (data.ok === false) {
        showNotice(data.warning || `${data.label || provider} test did not finish. Chat will fallback.`, "warn");
      } else {
        showNotice(`${data.label || provider} connected`, "ok");
      }
    } catch (err) {
      showNotice(err.message || "Test failed");
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className="model-switch-node">
      <div className="brain-top-row">
        <span className="panel-label">Brain</span>
        <div className="model-buttons">
          {OLLAMA_MODELS.map(m => (
            <button
              key={m.id}
              className={`model-btn ${active === m.id ? "active" : ""}`}
              onClick={() => switchModel(m.id)}
              disabled={switching}
              title={m.desc}
            >
              {switching && m.id !== active ? "..." : m.label}
            </button>
          ))}
          <button
            className={`model-btn ${active === "api" ? "active" : ""}`}
            onClick={() => switchModel("api")}
            disabled={switching}
            title="Use external API as LIA brain"
          >
            API
          </button>
          <button
            className={`model-btn ${teacherOpen ? "active" : ""}`}
            onClick={() => { setTeacherOpen(o => !o); if (!teacherOpen) refreshTeacher(); clearNotice(); }}
            title="UPskill — generate better skills using a teacher model"
          >
            Skills
          </button>
        </div>
      </div>

      {teacherOpen && (
        <div className="api-brain-box">
          <div className="api-provider-head" style={{ marginBottom: 6 }}>
            <strong style={{ color: "#a5b4fc" }}>Teacher Model</strong>
            <span style={{ fontSize: 10, color: "#6b7280" }}>
              active: {teacher.providers?.[teacher.active_provider]?.label || teacher.active_provider || "none"}
            </span>
          </div>

          {TEACHER_ORDER.map(pid => {
            const p = teacher.providers?.[pid];
            if (!p) return null;
            const draft   = teacherDrafts[pid] ?? {};
            const isActive = teacher.active_provider === pid;
            return (
              <div key={pid} className={`api-provider ${isActive ? "live" : ""}`}>
                <div className="api-provider-head">
                  <strong>{p.label}</strong>
                  {isActive && <span style={{ fontSize: 10, color: "#86efac" }}>ACTIVE TEACHER</span>}
                </div>
                <input
                  className="api-input"
                  type="password"
                  value={draft.api_key ?? ""}
                  onChange={e => updateTeacherDraft(pid, { api_key: e.target.value })}
                  placeholder={p.has_key ? "Key saved" : "Paste API key"}
                />
                <input
                  className="api-input"
                  value={draft.model ?? p.model ?? ""}
                  onChange={e => updateTeacherDraft(pid, { model: e.target.value })}
                  placeholder="fastagent model name"
                  title="e.g. anthropic.claude-3-5-sonnet-20241022 or google.gemini-2.0-flash"
                />
                <div className="api-actions">
                  <button onClick={() => saveTeacherProvider(pid)} disabled={teacherBusy}>Save</button>
                  <button onClick={() => deleteTeacherProvider(pid)} disabled={teacherBusy}>Clear Key</button>
                  <button
                    onClick={() => activateTeacher(pid)}
                    disabled={teacherBusy || (!p.has_key && !draft.api_key?.trim())}
                    style={isActive ? { background: "#1e3a2f", color: "#86efac" } : {}}
                  >
                    {isActive ? "Active" : "Set Active"}
                  </button>
                </div>
              </div>
            );
          })}

          <div style={{ borderTop: "1px solid #374151", marginTop: 8, paddingTop: 8 }}>
            <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 4 }}>Generate Skill from Conversations</div>
            <input
              className="api-input"
              value={genTask}
              onChange={e => setGenTask(e.target.value)}
              placeholder='e.g. "speak Telugu naturally as a Telugu wife"'
              disabled={teacherBusy}
            />
            <div className="api-actions">
              <button onClick={startGenerate} disabled={teacherBusy || !genTask.trim()}>
                {teacherBusy && genStatus?.running ? "Generating..." : "Generate"}
              </button>
            </div>
            {genStatus && (
              <div style={{ marginTop: 6, background: "#111827", borderRadius: 4, padding: "4px 6px", maxHeight: 120, overflowY: "auto", fontSize: 10, color: "#9ca3af", fontFamily: "monospace" }}>
                <div style={{ color: genStatus.status === "done" ? "#86efac" : genStatus.status === "error" ? "#f87171" : "#fbbf24", marginBottom: 2 }}>
                  [{genStatus.status}] {genStatus.error || ""}
                </div>
                {genStatus.lines?.slice(-20).map((l, i) => <div key={i}>{l}</div>)}
              </div>
            )}
          </div>
        </div>
      )}

      {apiOpen && (
        <div className="api-brain-box">
          {PROVIDER_ORDER.every(providerId => !apiBrain.providers?.[providerId]) && (
            <div className="api-empty">
              API brain box is loading. If this stays empty, restart backend.
            </div>
          )}
          {PROVIDER_ORDER.map(providerId => {
            const provider = apiBrain.providers?.[providerId];
            if (!provider) return null;
            const draft = drafts[providerId] ?? {};
            const isLive = active === "api" && apiBrain.active_provider === providerId;
            return (
              <div key={providerId} className={`api-provider ${isLive ? "live" : ""}`}>
                <div className="api-provider-head">
                  <strong>{provider.label}</strong>
                  <label className="api-toggle">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.enabled)}
                      onChange={e => {
                        updateDraft(providerId, { enabled: e.target.checked });
                        if (!e.target.checked && isLive) stopProvider(providerId);
                      }}
                    />
                    <span>{draft.enabled ? "ON" : "OFF"}</span>
                  </label>
                </div>
                <input
                  className="api-input"
                  type="password"
                  value={draft.api_key ?? ""}
                  onChange={e => updateDraft(providerId, { api_key: e.target.value })}
                  placeholder={provider.has_key ? "Saved key hidden" : "Paste API key"}
                />
                <input
                  className="api-input"
                  value={draft.model ?? provider.model ?? ""}
                  onChange={e => updateDraft(providerId, { model: e.target.value })}
                  placeholder={providerId === "nvidia" ? "e.g. minimaxai/minimax-m2.7" : "Model name"}
                  title={providerId === "nvidia" ? "Change model name here when quota runs out, then press Start" : ""}
                />
                <div className="api-actions">
                  <button onClick={() => saveProvider(providerId)}>Save</button>
                  <button onClick={() => testProvider(providerId)} disabled={switching || (!provider.has_key && !draft.api_key)}>
                    Test
                  </button>
                  <button onClick={() => deleteProvider(providerId)}>Delete</button>
                  <button onClick={() => startProvider(providerId)} disabled={switching || (!provider.has_key && !draft.api_key)}>
                    {isLive ? "Running" : "Start"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {switching && <span className="switching-text">Swapping brain...</span>}
      {error && (
        <span
          className="switching-text"
          style={{ color: errorKind === "ok" ? "#86efac" : errorKind === "warn" ? "#fbbf24" : "#f87171" }}
        >
          {error}
        </span>
      )}
    </div>
  );
}
