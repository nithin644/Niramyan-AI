/**
 * NODE: StatsNode — real-time CPU / RAM / VRAM monitor bar at the top.
 * Polls /api/stats every 2s.
 */
import { useState, useEffect, useRef } from "react";

function Bar({ value, max, color }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div style={{ background: "#ffffff18", borderRadius: 3, height: 4, width: 60, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.5s" }} />
    </div>
  );
}

export default function StatsNode() {
  const [stats, setStats] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    async function poll() {
      try {
        const r = await fetch("/api/stats");
        if (r.ok) setStats(await r.json());
      } catch {}
    }
    poll();
    timerRef.current = setInterval(poll, 2000);
    return () => clearInterval(timerRef.current);
  }, []);

  if (!stats) return null;

  const vramPct = stats.vram_total_mb > 0
    ? Math.round((stats.vram_used_mb / stats.vram_total_mb) * 100)
    : 0;

  return (
    <div className="stats-bar">
      <Stat label="CPU" value={`${stats.cpu_pct}%`}
        bar={<Bar value={stats.cpu_pct} max={100} color="#a78bfa" />} />
      <div className="stats-sep" />
      <Stat label="RAM"
        value={`${(stats.ram_used_mb / 1024).toFixed(1)}G`}
        bar={<Bar value={stats.ram_used_mb} max={stats.ram_total_mb} color="#60a5fa" />} />
      <div className="stats-sep" />
      <Stat label="VRAM"
        value={`${(stats.vram_used_mb / 1024).toFixed(1)}G`}
        bar={<Bar value={stats.vram_used_mb} max={stats.vram_total_mb} color="#34d399" />} />
      <div className="stats-sep" />
      <Stat label="GPU" value={`${stats.gpu_pct}%`}
        bar={<Bar value={stats.gpu_pct} max={100} color="#f472b6" />} />
    </div>
  );
}

function Stat({ label, value, bar }) {
  return (
    <div className="stats-item">
      <span className="stats-label">{label}</span>
      <span className="stats-value">{value}</span>
      {bar}
    </div>
  );
}
