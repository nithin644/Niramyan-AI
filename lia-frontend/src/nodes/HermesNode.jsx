import { useEffect, useRef, useState } from "react";

export default function HermesNode() {
  const [status, setStatus] = useState(null);
  const [userId, setUserId] = useState("");
  const [testText, setTestText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const editingUserIdRef = useRef(false);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, []);

  async function refresh() {
    try {
      const data = await fetch("/api/hermes/status").then(r => r.json());
      setStatus(data);
      if (!editingUserIdRef.current) {
        setUserId(String(data.allowed_id || ""));
      }
    } catch {
      setMessage("Hermes offline");
    }
  }

  async function saveConfig(patch) {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/hermes/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Hermes update failed");
      setStatus(data.status);
      setUserId(String(data.status?.allowed_id || ""));
      if (patch.enabled && !data.status?.running) {
        setMessage("Saved, but bot is not running");
      } else {
        setMessage("Saved");
      }
    } catch (e) {
      setMessage(e.message);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function saveUserId() {
    if (!userId.trim()) {
      await saveConfig({ allowed_user_id: 0 });
      return;
    }
    await saveConfig({ allowed_user_id: userId.trim() });
  }

  async function sendTest() {
    if (!testText.trim() || sending || !status?.enabled) return;
    setSending(true);
    setMessage("");
    try {
      const res = await fetch("/api/hermes/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: testText.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Send failed");
      setMessage(data.ok ? "Sent" : "Not sent");
      if (data.ok) setTestText("");
    } catch (e) {
      setMessage(e.message);
    } finally {
      setSending(false);
    }
  }

  const enabled = Boolean(status?.enabled);
  const running = Boolean(status?.running);
  const configured = Boolean(status?.configured);
  const voiceMode = status?.reply_mode === "voice";
  const statusColor = running ? "#4ade80" : enabled ? "#fbbf24" : "#94a3b8";
  const statusText = running ? "online" : enabled ? "waiting" : "off";

  return (
    <div className="hermes-node">
      <div className="hermes-header">
        <span className="panel-label">Hermes</span>
        <span className="hermes-status" style={{ color: statusColor }}>{statusText}</span>
      </div>

      <div className="hermes-row hermes-main-row">
        <div>
          <strong>Telegram chat</strong>
          <small>{configured ? "locked to Jashu" : "needs user ID"}</small>
        </div>
        <button
          className={`cap-inline-switch ${enabled ? "active" : ""}`}
          onClick={() => saveConfig({ enabled: !enabled })}
          disabled={busy || !configured}
          title={configured ? "Toggle Telegram chat" : "Save your Telegram ID first"}
        >
          {enabled ? "Turn off" : "Turn on"}
        </button>
      </div>

      <div className="hermes-row">
        <input
          className="ragflow-input"
          inputMode="numeric"
          placeholder="Telegram user ID"
          value={userId}
          onChange={e => {
            editingUserIdRef.current = true;
            setUserId(e.target.value);
          }}
          onBlur={() => {
            editingUserIdRef.current = false;
            refresh();
          }}
          onKeyDown={e => e.key === "Enter" && saveUserId()}
        />
        <button className="ragflow-btn" onClick={saveUserId} disabled={busy}>
          Save
        </button>
      </div>

      <div className="hermes-row hermes-main-row">
        <div>
          <strong>Replies</strong>
          <small>{voiceMode ? "voice notes" : "text messages"}</small>
        </div>
        <button
          className={`cap-inline-switch ${voiceMode ? "active" : ""}`}
          onClick={() => saveConfig({ reply_mode: voiceMode ? "text" : "voice" })}
          disabled={busy}
        >
          {voiceMode ? "Voice" : "Text"}
        </button>
      </div>

      <div className="hermes-row">
        <input
          className="ragflow-input"
          placeholder="Send test message"
          value={testText}
          onChange={e => setTestText(e.target.value)}
          onKeyDown={e => e.key === "Enter" && sendTest()}
          disabled={!enabled}
        />
        <button className="ragflow-btn" onClick={sendTest} disabled={sending || !testText.trim() || !enabled}>
          {sending ? "..." : "Send"}
        </button>
      </div>

      {status && !status.has_token && (
        <p className="hermes-note">Add bot token in models.json.</p>
      )}
      {enabled && !running && configured && (
        <p className="hermes-note">Restart backend if polling did not start.</p>
      )}
      {message && <p className="hermes-message">{message}</p>}
    </div>
  );
}
