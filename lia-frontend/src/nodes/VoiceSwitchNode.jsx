/**
 * NODE: VoiceSwitchNode - select the TTS engine (Fish voice clone or Piper fallback).
 */
import { useEffect, useState } from "react";

export default function VoiceSwitchNode() {
  const [engine,      setEngine]      = useState("fish");
  const [fishReady,   setFishReady]   = useState(null);
  const [indicReady,  setIndicReady]  = useState(null);
  const [f5telReady,  setF5telReady]  = useState(null);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState("");

  useEffect(() => {
    refreshConfig();
    const timer = setInterval(refreshConfig, 5000);
    window.addEventListener("focus", refreshConfig);
    document.addEventListener("visibilitychange", refreshConfig);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refreshConfig);
      document.removeEventListener("visibilitychange", refreshConfig);
    };
  }, []);

  async function refreshConfig() {
    try {
      const d = await fetch("/api/tts/config").then(r => r.json());
      if (d.engine)  setEngine(d.engine);
      if (d.fish)    setFishReady(d.fish);
      if (d.indicf5) setIndicReady(d.indicf5);
      if (d.f5tel)   setF5telReady(d.f5tel);
    } catch {}
  }

  async function switchEngine(newEngine) {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/tts/switch", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ engine: newEngine }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Switch failed");
      setEngine(data.engine);
      await refreshConfig();
    } catch (e) {
      setError(e.message || "Failed");
    } finally {
      setSaving(false);
    }
  }

  const fishFilesOk = !fishReady || Boolean(fishReady.files_ready ?? fishReady.ready);
  const fishMissing = fishReady?.missing?.length ? fishReady.missing.join(", ") : "required files";
  const indicOk = !indicReady || Boolean(indicReady.weights && indicReady.vocab);
  const f5telOk = !f5telReady || Boolean(f5telReady.weights && f5telReady.vocab);

  return (
    <div className="voice-switch-node">
      <span className="panel-label">Voice</span>
      <span className="voice-hint">One voice active at a time</span>

      <div className="voice-engine-row">
        <VoiceCard
          active={engine === "fish"}
          label="Fish"
          sub="EN clone"
          title="Fish Speech 1.5 — English voice cloned from liavoice1.mp3."
          disabled={saving || !fishFilesOk}
          onClick={() => switchEngine("fish")}
        />

        <VoiceCard
          active={engine === "piper"}
          label="Piper"
          sub="Offline EN"
          title="Piper ONNX — offline English fallback."
          disabled={saving}
          onClick={() => switchEngine("piper")}
        />

        <VoiceCard
          active={engine === "indicf5"}
          label="IndicF5"
          sub="Telugu"
          title="IndicF5 — native Telugu voice clone (AI4Bharat). Tenglish is converted to Telugu script automatically."
          disabled={saving || !indicOk}
          onClick={() => switchEngine("indicf5")}
        />

        <VoiceCard
          active={engine === "f5tel"}
          label="F5-Telugu"
          sub="Telugu"
          title="F5-TTS-TELUGU — native Telugu voice clone (CC-BY-NC)."
          disabled={saving || !f5telOk}
          onClick={() => switchEngine("f5tel")}
        />
      </div>

      {saving && <span className="switching-text">Switching...</span>}
      {error  && <span className="switching-text" style={{ color: "#f87171" }}>{error}</span>}

      {fishReady && !fishFilesOk && (
        <span className="switching-text" style={{ color: "#fbbf24" }}>Fish missing: {fishMissing}</span>
      )}
      {indicReady && indicReady.enabled && !indicOk && (
        <span className="switching-text" style={{ color: "#fbbf24" }}>IndicF5 weights missing</span>
      )}
    </div>
  );
}

function VoiceCard({ active, label, sub, title, disabled, onClick }) {
  return (
    <div className={`voice-card ${active ? "active" : ""}`}>
      <button
        className="voice-card-btn"
        onClick={onClick}
        disabled={disabled}
        title={title}
      >
        {label}
      </button>
      <span className="voice-card-sub">{sub}</span>
      {active && <span className="voice-live-dot" />}
    </div>
  );
}
