import { useState, useEffect, useRef } from "react";

const DOMAIN_ICONS = {
  news:     "📰",
  weather:  "🌤",
  trending: "🔥",
  market:   "📈",
  repo:     "🐙",
};

const DOMAIN_COLORS = {
  news:     "#60a5fa",
  weather:  "#34d399",
  trending: "#f97316",
  market:   "#a78bfa",
  repo:     "#fb923c",
};

function timeAgo(isoStr) {
  try {
    const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  } catch {
    return "";
  }
}

export default function SensorFeedNode() {
  const [signals,   setSignals]   = useState([]);
  const [status,    setStatus]    = useState(null);
  const [expanded,  setExpanded]  = useState(false);
  const [filter,    setFilter]    = useState("");  // domain filter
  const [tick,      setTick]      = useState(0);
  const tickRef = useRef(null);

  useEffect(() => {
    fetchSignals();
    fetchStatus();
    const timer = setInterval(() => {
      fetchSignals();
      fetchStatus();
      setTick(t => t + 1);
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  async function fetchSignals() {
    try {
      const data = await fetch("/api/sensors/signals?limit=40").then(r => r.json());
      setSignals(data.signals || []);
    } catch {}
  }

  async function fetchStatus() {
    try {
      const data = await fetch("/api/sensors/status").then(r => r.json());
      setStatus(data);
    } catch {}
  }

  const running = status?.running ?? false;
  const sigCount = status?.signal_count ?? 0;

  const filtered = filter
    ? signals.filter(s => s.source?.domain === filter)
    : signals;

  const domains = [...new Set(signals.map(s => s.source?.domain).filter(Boolean))];

  // Latest signal per domain for compact view
  const latestByDomain = {};
  for (const sig of signals) {
    const d = sig.source?.domain;
    if (d && !latestByDomain[d]) latestByDomain[d] = sig;
  }

  if (!expanded) {
    return (
      <div
        className="sensor-badge"
        onClick={() => setExpanded(true)}
        title="W2A World Sensors — click to expand"
      >
        <span className={`sensor-dot ${running ? "live" : "off"}`} />
        <span className="sensor-label">SENSORS</span>
        <span className="sensor-count">{sigCount}</span>
        <div className="sensor-domain-row">
          {Object.entries(latestByDomain).slice(0, 4).map(([domain, sig]) => (
            <span
              key={domain}
              className="sensor-domain-chip"
              style={{ borderColor: DOMAIN_COLORS[domain] || "#888" }}
              title={sig.event?.summary || domain}
            >
              {DOMAIN_ICONS[domain] || "🔵"} {domain}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="sensor-panel">
      <div className="sensor-panel-header">
        <span className={`sensor-dot ${running ? "live" : "off"}`} />
        <span className="sensor-panel-title">W2A World Signals</span>
        <span className="sensor-panel-count">{sigCount} total</span>
        <div className="sensor-panel-filters">
          <button
            className={`sensor-filter-btn ${!filter ? "active" : ""}`}
            onClick={() => setFilter("")}
          >all</button>
          {domains.map(d => (
            <button
              key={d}
              className={`sensor-filter-btn ${filter === d ? "active" : ""}`}
              style={filter === d ? { borderColor: DOMAIN_COLORS[d] } : {}}
              onClick={() => setFilter(filter === d ? "" : d)}
            >
              {DOMAIN_ICONS[d] || "•"} {d}
            </button>
          ))}
        </div>
        <button className="sensor-close-btn" onClick={() => setExpanded(false)}>✕</button>
      </div>

      <div className="sensor-signal-list">
        {filtered.length === 0 && (
          <div className="sensor-empty">
            {running ? "Fetching live signals…" : "Sensors offline"}
          </div>
        )}
        {filtered.slice(0, 25).map(sig => {
          const domain = sig.source?.domain || "other";
          const color  = DOMAIN_COLORS[domain] || "#888";
          const icon   = DOMAIN_ICONS[domain] || "🔵";
          const url    = sig.attachments?.[0]?.url;
          return (
            <div key={sig.signal_id} className="sensor-signal-row">
              <span className="sensor-sig-icon" style={{ color }}>{icon}</span>
              <div className="sensor-sig-body">
                <div className="sensor-sig-summary">
                  {url
                    ? <a href={url} target="_blank" rel="noreferrer">{sig.event?.summary}</a>
                    : sig.event?.summary}
                </div>
                <div className="sensor-sig-meta">
                  <span className="sensor-sig-domain" style={{ color }}>{sig.event?.name}</span>
                  <span className="sensor-sig-time">{timeAgo(sig.emitted_at)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="sensor-panel-footer">
        <span className="sensor-schema">schema: {filtered[0]?.schema_version || "w2a/0.1"}</span>
        <button
          className="sensor-refresh-btn"
          onClick={() => { fetchSignals(); fetchStatus(); }}
        >↻ refresh</button>
      </div>
    </div>
  );
}
