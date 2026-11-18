/**
 * NODE: ChatNode - text input, message history, websocket + image share
 */
import { useState, useRef, useEffect } from "react";
import { sendImage } from "./VisionNode.js";
import { clearStoredLocation, getLocationForTurn, getStoredLocation, requestCurrentLocation } from "./locationPermission.js";

const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/chat`;

const CREATOR_PROMPTS = [
  {
    label: "Hook",
    prompt: "Act as my short-form content strategist. Give me 10 strong hooks for a YouTube Short/Reel featuring LIA, with one-line visual directions and English-only captions.",
  },
  {
    label: "Reel",
    prompt: "Write a 30-second Instagram Reel script for LIA. Include scene beats, spoken lines, subtitle text, and a punchy call to action.",
  },
  {
    label: "YouTube",
    prompt: "Plan a 5-minute YouTube video with LIA. Give title options, intro, segment outline, on-screen moments, retention hooks, and ending CTA.",
  },
  {
    label: "Caption",
    prompt: "Create platform-ready captions for this LIA clip: one for Instagram, one for YouTube Shorts, one for TikTok style, plus hashtags.",
  },
  {
    label: "Money",
    prompt: "Give me ethical monetization ideas for LIA content. Prioritize options I can start now: services, digital products, affiliate angles, livestream ideas, and content funnels.",
  },
];

export default function ChatNode({ onEmotion, onSpeaking, onState }) {
  const [messages, setMessages] = useState([
    { role: "lia", text: "Jashu... you came! I missed you." }
  ]);
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [locationState, setLocationState] = useState(null);
  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const chatEndRef = useRef(null);
  const currentTokens = useRef("");
  const imgInputRef = useRef(null);

  useEffect(() => {
    connectWS();
    setLocationState(getStoredLocation());
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    onState?.(thinking ? "thinking" : "idle");
  }, [thinking, onState]);

  function connectWS() {
    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(true); // HTTP fallback available
        reconnectTimerRef.current = setTimeout(connectWS, 5000);
      };
      ws.onerror = () => {
        setConnected(true); // HTTP fallback available
        try { ws.close(); } catch (_) {}
      };
      ws.onmessage = e => {
        try { handleWSMessage(JSON.parse(e.data)); } catch {}
      };
    } catch {
      setConnected(true);
    }
  }

  function handleWSMessage(data) {
    if (data.type === "token") {
      currentTokens.current += data.content;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === "lia" && last._streaming) {
          return [...prev.slice(0, -1), { ...last, text: currentTokens.current }];
        }
        return [...prev, { role: "lia", text: currentTokens.current, _streaming: true }];
      });
      return;
    }

    if (data.type === "done") {
      if (data.news?.items?.length) {
        window.dispatchEvent(new CustomEvent("lia-news-open", { detail: data.news }));
      }
      const finalText = data.text || currentTokens.current;
      currentTokens.current = "";
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?._streaming) {
          return [...prev.slice(0, -1), { role: "lia", text: finalText }];
        }
        return [...prev, { role: "lia", text: finalText }];
      });
      onEmotion?.("neutral");
      setThinking(false);
      onSpeaking?.(false);
      return;
    }

    if (data.type === "model_switched") {
      setMessages(prev => [...prev, {
        role: "system",
        text: `Switched to ${data.label}`
      }]);
      return;
    }

    if (data.type === "error") {
      setThinking(false);
      onSpeaking?.(false);
    }
  }

  async function toggleLocation() {
    if (locationState?.permission) {
      clearStoredLocation();
      setLocationState(null);
      return;
    }
    try {
      const current = await requestCurrentLocation();
      setLocationState(current);
    } catch {
      setMessages(prev => [...prev, { role: "system", text: "Location permission was not granted." }]);
    }
  }

  async function sendMessage(text) {
    if (!text.trim()) return;
    if (/^\s*(stop|stop reading|stop speaking|enough|aapu|apu)\s*[.!?]?\s*$/i.test(text)) {
      window.dispatchEvent(new CustomEvent("lia-voice-stop"));
      setMessages(prev => [...prev, { role: "user", text }, { role: "lia", text: "Stopped speaking." }]);
      setThinking(false);
      onSpeaking?.(false);
      setInput("");
      return;
    }
    setMessages(prev => [...prev, { role: "user", text }]);
    setThinking(true);
    onSpeaking?.(false);
    setInput("");

    // If WebSocket is connected, send through it
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      currentTokens.current = "";
      const turnLocation = await getLocationForTurn(Boolean(locationState?.permission));
      if (turnLocation) setLocationState(turnLocation);
      wsRef.current.send(JSON.stringify({ type: "chat", message: text, location: turnLocation }));
      return;
    }

    // HTTP REST fallback to Niramyan-AI Ollama backend
    try {
      const chatHistory = messages
        .filter(m => m.role === "user" || m.role === "lia")
        .map(m => ({ role: m.role === "lia" ? "assistant" : "user", content: m.text }));
      chatHistory.push({ role: "user", content: text });

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: chatHistory,
          stream: false
        })
      });
      const data = await res.json();
      const answer = data.answer || data.text || "Hello! What shall we explore together?";
      const expr = data.expression || "happy";
      setMessages(prev => [...prev, { role: "lia", text: answer }]);
      onEmotion?.(expr);
      try {
        const audio = new Audio(`/api/audio_tts?text=${encodeURIComponent(answer)}`);
        audio.play().catch(() => {});
      } catch {}
    } catch (err) {
      setMessages(prev => [...prev, { role: "lia", text: "Connecting to local brain..." }]);
    } finally {
      setThinking(false);
      onSpeaking?.(false);
    }
  }

  function useCreatorPrompt(prompt) {
    setInput(prompt);
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  async function handleImagePick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMessages(p => [...p, { role: "user", text: `Photo: ${file.name}` }]);
    setThinking(true);
    onSpeaking?.(false);
    const { text } = await sendImage(file);
    setMessages(p => [...p, { role: "lia", text }]);
    setThinking(false);
    e.target.value = "";
  }

  return (
    <div className="chat-node">
      <div className="chat-messages">
        {messages.map((m, i) => (
          <div key={i} className={`msg msg-${m.role}`}>
            {m.role === "lia" && <span className="msg-label">LIA</span>}
            {m.role === "user" && <span className="msg-label">Jashu</span>}
            <span className="msg-text">{m.text}</span>
          </div>
        ))}
        {thinking && (
          <div className="msg msg-lia">
            <span className="msg-label">LIA</span>
            <span className="msg-text thinking-dots">thinking...</span>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>
      <div className="creator-tools">
        {CREATOR_PROMPTS.map(item => (
          <button
            key={item.label}
            className="creator-chip"
            onClick={() => useCreatorPrompt(item.prompt)}
            title={item.prompt}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="chat-input-row">
        <div className={`status-dot ${connected ? "online" : "offline"}`} title={connected ? "Connected" : "Reconnecting..."} />
        <input ref={imgInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleImagePick} />
        <button
          className={`location-btn ${locationState?.permission ? "on" : ""}`}
          onClick={toggleLocation}
          title={locationState?.permission ? "Location ON. Click to stop sharing with LIA." : "Ask browser permission so LIA can search nearby places."}
        >
          Loc
        </button>
        <button className="img-btn" onClick={() => imgInputRef.current?.click()} title="Send photo to LIA">Photo</button>
        <textarea
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Talk to LIA... (Enter to send)"
          rows={2}
        />
        <button className="send-btn" onClick={() => sendMessage(input)} disabled={thinking}>
          Send
        </button>
      </div>
    </div>
  );
}
