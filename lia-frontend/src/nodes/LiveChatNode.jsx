/**
 * NODE: LiveChatNode — VTuber live chat viewer for YouTube/Twitch streams.
 * Shows real-time chat, LIA responses, viewer points/levels, top viewers.
 */
import { useState, useRef, useEffect, useCallback } from "react";

const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/live_chat`;
const API    = "/live_chat";

const LEVEL_COLORS = {
  "Stranger":     "#888",
  "Visitor":      "#8bc34a",
  "Regular":      "#2196f3",
  "Friend":       "#9c27b0",
  "Close Friend": "#ff9800",
  "Best Friend":  "#f44336",
  "Soulmate":     "#ffd700",
};

const TYPE_ICONS = {
  comment:   "💬",
  gift:      "🎁",
  follow:    "⭐",
  raid:      "⚔️",
  superchar: "💰",
  proactive: "🎙️",
};

export default function LiveChatNode() {
  const [status,    setStatus]    = useState({ running: false, platform: "", channel_id: "", queue_size: 0 });
  const [platform,  setPlatform]  = useState("youtube");
  const [channelId, setChannelId] = useState("");
  const [events,    setEvents]    = useState([]);
  const [topViewers, setTopViewers] = useState([]);
  const [connected, setConnected] = useState(false);
  const [tab,       setTab]       = useState("chat");   // chat | viewers
  const wsRef      = useRef(null);
  const eventsRef  = useRef(null);

  // ── WebSocket ────────────────────────────────────────────────────────────────
  useEffect(() => {
    connect();
    fetchStatus();
    fetchViewers();
    return () => wsRef.current?.close();
  }, []);

  function connect() {
    const ws = new WebSocket(WS_URL);
    ws.onopen  = () => setConnected(true);
    ws.onclose = () => { setConnected(false); setTimeout(connect, 3000); };
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        handleEvent(data);
      } catch {}
    };
    wsRef.current = ws;
  }

  function handleEvent(data) {
    const { event, ...rest } = data;

    if (event === "chat_message") {
      addEvent({ type: rest.type || "comment", username: rest.username, text: rest.text,
                 platform: rest.platform, gift: rest.gift, ts: Date.now() });
    } else if (event === "lia_response") {
      addEvent({ type: "lia", username: "LIA", text: rest.reply || rest.text,
                 replyTo: rest.username, ts: Date.now() });
    } else if (event === "viewer_update") {
      // Refresh top viewers on level-up or achievement
      fetchViewers();
    } else if (event === "proactive") {
      addEvent({ type: "proactive", username: "LIA", text: rest.text, ts: Date.now() });
    }
  }

  const addEvent = useCallback((ev) => {
    setEvents(prev => [...prev.slice(-199), ev]);
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (eventsRef.current) {
      eventsRef.current.scrollTop = eventsRef.current.scrollHeight;
    }
  }, [events]);

  // ── API calls ─────────────────────────────────────────────────────────────
  async function fetchStatus() {
    try {
      const r = await fetch(`${API}/status`);
      if (r.ok) setStatus(await r.json());
    } catch {}
  }

  async function fetchViewers() {
    try {
      const r = await fetch(`${API}/viewers?top=10`);
      if (r.ok) {
        const d = await r.json();
        setTopViewers(d.top || []);
      }
    } catch {}
  }

  async function startStream() {
    if (!channelId.trim()) return;
    const r = await fetch(`${API}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform, channel_id: channelId.trim() }),
    });
    if (r.ok) fetchStatus();
  }

  async function stopStream() {
    await fetch(`${API}/stop`, { method: "POST" });
    fetchStatus();
  }

  async function injectMessage() {
    const text = prompt("Test message text:");
    if (!text) return;
    const user = prompt("Viewer username:", "TestViewer");
    await fetch(`${API}/inject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user || "TestViewer", text }),
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "monospace", fontSize: 13, color: "#e0e0e0",
                  background: "#1a1a2e", borderRadius: 10, padding: 12,
                  height: 520, display: "flex", flexDirection: "column", gap: 8 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ color: "#e040fb", fontWeight: "bold", fontSize: 15 }}>
          📺 Live Chat
        </span>
        <span style={{
          width: 8, height: 8, borderRadius: "50%",
          background: connected ? "#4caf50" : "#f44336",
          display: "inline-block",
        }} />
        <span style={{ color: "#888", fontSize: 11 }}>
          {status.running ? `● ${status.platform} — ${status.channel_id} (${status.queue_size} queued)` : "offline"}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <button onClick={() => setTab("chat")}
            style={{ background: tab === "chat" ? "#333" : "transparent",
                     border: "1px solid #444", color: "#ccc", borderRadius: 4,
                     padding: "2px 8px", cursor: "pointer" }}>Chat</button>
          <button onClick={() => { setTab("viewers"); fetchViewers(); }}
            style={{ background: tab === "viewers" ? "#333" : "transparent",
                     border: "1px solid #444", color: "#ccc", borderRadius: 4,
                     padding: "2px 8px", cursor: "pointer" }}>Viewers</button>
        </div>
      </div>

      {/* Connect form */}
      {!status.running && (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <select value={platform} onChange={e => setPlatform(e.target.value)}
            style={{ background: "#222", color: "#ccc", border: "1px solid #444",
                     borderRadius: 4, padding: "3px 6px" }}>
            <option value="youtube">YouTube</option>
            <option value="twitch">Twitch</option>
          </select>
          <input value={channelId} onChange={e => setChannelId(e.target.value)}
            placeholder="Video ID / Channel"
            style={{ flex: 1, background: "#222", color: "#fff", border: "1px solid #444",
                     borderRadius: 4, padding: "4px 8px", fontSize: 12 }} />
          <button onClick={startStream}
            style={{ background: "#4caf50", color: "#fff", border: "none",
                     borderRadius: 4, padding: "4px 10px", cursor: "pointer" }}>
            Start
          </button>
        </div>
      )}

      {status.running && (
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={stopStream}
            style={{ background: "#f44336", color: "#fff", border: "none",
                     borderRadius: 4, padding: "4px 10px", cursor: "pointer" }}>
            Stop Stream
          </button>
          <button onClick={injectMessage}
            style={{ background: "#333", color: "#ccc", border: "1px solid #555",
                     borderRadius: 4, padding: "4px 10px", cursor: "pointer" }}>
            + Test Msg
          </button>
        </div>
      )}

      {/* Tab: Chat */}
      {tab === "chat" && (
        <div ref={eventsRef} style={{
          flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4,
        }}>
          {events.length === 0 && (
            <div style={{ color: "#555", textAlign: "center", marginTop: 40 }}>
              Start a stream to see live chat here
            </div>
          )}
          {events.map((ev, i) => (
            <ChatEventRow key={i} ev={ev} />
          ))}
        </div>
      )}

      {/* Tab: Viewers */}
      {tab === "viewers" && (
        <div style={{ flex: 1, overflowY: "auto" }}>
          {topViewers.length === 0 && (
            <div style={{ color: "#555", textAlign: "center", marginTop: 40 }}>
              No viewers yet
            </div>
          )}
          {topViewers.map((v, i) => (
            <ViewerRow key={i} viewer={v} rank={i + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChatEventRow({ ev }) {
  const isLia      = ev.type === "lia" || ev.username === "LIA";
  const isGift     = ev.type === "gift" || ev.type === "superchar";
  const isProactive = ev.type === "proactive";

  return (
    <div style={{
      padding: "4px 8px", borderRadius: 6,
      background: isLia ? "#1e1e3a" : isGift ? "#2a1a00" : isProactive ? "#1a2a1a" : "transparent",
      borderLeft: isLia ? "3px solid #e040fb" : isGift ? "3px solid #ffd700" : "none",
    }}>
      <span style={{ color: isLia ? "#e040fb" : isGift ? "#ffd700" : "#4dd0e1", fontWeight: "bold" }}>
        {TYPE_ICONS[ev.type] || "💬"} {ev.username}
      </span>
      {ev.replyTo && (
        <span style={{ color: "#666", marginLeft: 4, fontSize: 11 }}>→ {ev.replyTo}</span>
      )}
      {isGift && ev.gift > 0 && (
        <span style={{ color: "#ffd700", marginLeft: 4, fontSize: 11 }}>(${ev.gift})</span>
      )}
      <span style={{ color: "#ccc", marginLeft: 6 }}>{ev.text}</span>
    </div>
  );
}

function ViewerRow({ viewer, rank }) {
  const color = LEVEL_COLORS[viewer.level_name] || "#888";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "5px 8px", borderRadius: 6,
      background: rank <= 3 ? "#1a1a2e" : "transparent",
    }}>
      <span style={{ color: "#555", width: 20, textAlign: "right" }}>#{rank}</span>
      <span style={{ color: "#4dd0e1", fontWeight: "bold", minWidth: 100 }}>
        {viewer.display_name || viewer.username}
      </span>
      <span style={{
        background: color + "33", color, border: `1px solid ${color}`,
        borderRadius: 10, padding: "1px 7px", fontSize: 11,
      }}>{viewer.level_name}</span>
      <span style={{ color: "#ffd700", marginLeft: "auto" }}>
        {viewer.points.toLocaleString()} pts
      </span>
      <span style={{ color: "#888", fontSize: 11 }}>
        {viewer.message_count} msgs
      </span>
      {viewer.total_gifted > 0 && (
        <span style={{ color: "#4caf50", fontSize: 11 }}>
          🎁 ${viewer.total_gifted.toFixed(0)}
        </span>
      )}
    </div>
  );
}
