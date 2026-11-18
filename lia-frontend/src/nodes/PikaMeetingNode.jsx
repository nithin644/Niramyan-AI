import { useEffect, useState } from "react";

export default function PikaMeetingNode() {
  const [enabled, setEnabled] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [keyPreview, setKeyPreview] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [botName, setBotName] = useState("LIA");
  const [status, setStatus] = useState("Loading Pika settings...");
  const [busy, setBusy] = useState(false);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    try {
      const data = await fetch("/api/pika/config").then(r => r.json());
      setEnabled(Boolean(data.enabled));
      setHasKey(Boolean(data.has_key));
      setKeyPreview(data.key_preview || "");
      setBotName(data.bot_name || "LIA");
      setStatus(data.has_key ? "Pika key saved. Meeting mode is ready." : "Enter your Pika Developer key.");
    } catch {
      setStatus("Could not load Pika settings.");
    }
  }

  async function save() {
    setBusy(true);
    setStatus("Saving Pika settings...");
    try {
      const payload = {
        enabled,
        bot_name: botName.trim() || "LIA",
      };
      if (apiKey.trim()) payload.api_key = apiKey.trim();

      const res = await fetch("/api/pika/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Save failed");
      setApiKey("");
      setEnabled(Boolean(data.enabled));
      setHasKey(Boolean(data.has_key));
      setKeyPreview(data.key_preview || "");
      setStatus("Pika saved.");
    } catch (error) {
      setStatus(error.message || "Pika save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function clearKey() {
    setBusy(true);
    setStatus("Removing Pika key...");
    try {
      const res = await fetch("/api/pika/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: "", enabled: false, bot_name: botName.trim() || "LIA" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Remove failed");
      setApiKey("");
      setEnabled(false);
      setHasKey(false);
      setKeyPreview("");
      setStatus("Pika key removed.");
    } catch (error) {
      setStatus(error.message || "Could not remove Pika key.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pika-node">
      <div className="pika-head">
        <div>
          <span className="panel-label">Pika</span>
          <strong>Meeting Mode</strong>
        </div>
        <label className="api-toggle">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          ON
        </label>
      </div>

      <input
        className="api-input"
        value={botName}
        onChange={e => setBotName(e.target.value)}
        placeholder="Bot name"
      />

      <input
        className="api-input"
        type="password"
        value={apiKey}
        onChange={e => setApiKey(e.target.value)}
        placeholder={hasKey ? `Saved ${keyPreview}` : "Pika Developer key, starts with dk_"}
        autoComplete="off"
      />

      <div className="pika-status">
        {status}
        {hasKey && <span> Saved key: {keyPreview}</span>}
      </div>

      <div className="pika-actions">
        <button onClick={save} disabled={busy || (!apiKey.trim() && !hasKey)}>
          Save
        </button>
        <button onClick={clearKey} disabled={busy || !hasKey}>
          Clear
        </button>
      </div>

      <div className="pika-note">
        Google Meet avatar joining needs Pika credits and will stay optional. Normal LIA does not use it unless this is ON.
      </div>
    </div>
  );
}
