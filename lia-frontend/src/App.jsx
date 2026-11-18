import { useState, useRef, useEffect, Suspense } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Environment } from "@react-three/drei";
import VRMAvatarNode     from "./nodes/VRMAvatarNode";
import VoiceNode         from "./nodes/VoiceNode";
import ChatNode          from "./nodes/ChatNode";
import ModelSwitchNode   from "./nodes/ModelSwitchNode";
import VoiceSwitchNode   from "./nodes/VoiceSwitchNode";
import DesktopToggleNode from "./nodes/DesktopToggleNode";
import FaceTrackNode     from "./nodes/FaceTrackNode";
import ScreenShareNode   from "./nodes/ScreenShareNode";
import VRMSwitcherNode   from "./nodes/VRMSwitcherNode";
import StatsNode         from "./nodes/StatsNode";
import CapabilityHubNode from "./nodes/CapabilityHubNode";
import NewsBrowserNode   from "./nodes/NewsBrowserNode";
import SensorFeedNode   from "./nodes/SensorFeedNode";
import PikaMeetingNode  from "./nodes/PikaMeetingNode";
import RAGFlowNode      from "./nodes/RAGFlowNode";
import HermesNode       from "./nodes/HermesNode";
import LiveChatNode     from "./nodes/LiveChatNode";
import "./styles/app.css";

const CAM_POS    = [0, 0.55, 1.8];
const CAM_TARGET = [0, 0.55, 0];
const DEFAULT_SOUL_EMOTIONS = {
  happy: 0.5,
  sad: 0.1,
  angry: 0.05,
  fear: 0.05,
  disgust: 0.03,
  surprised: 0.1,
  neutral: 0.4,
  relaxed: 0.3,
  love: 0.7,
  arousal: 0.2,
  devotion: 0.8,
};

function CameraReset({ locked }) {
  const { camera } = useThree();
  useEffect(() => {
    if (locked) {
      camera.position.set(...CAM_POS);
      camera.lookAt(...CAM_TARGET);
    }
  }, [locked, camera]);
  return null;
}

// PC-Control quick toggle chip
function PcToggle() {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  async function refresh() {
    try {
      const data = await fetch("/api/capabilities").then(r => r.json());
      setOn(data?.switches?.pc_control ?? false);
    } catch {}
  }

  async function toggle() {
    const next = !on;
    setBusy(true);
    try {
      const data = await fetch("/api/capabilities/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "pc_control", enabled: next }),
      }).then(r => r.json());
      setOn(data?.switches?.pc_control ?? next);
      window.dispatchEvent(new CustomEvent("lia-capabilities-changed", { detail: data }));
    } catch {
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      className={`opt-chip pc-chip ${on ? "on" : ""}`}
      onClick={toggle}
      disabled={busy}
      title={on ? "PC Control ON - click to disable" : "PC Control OFF - click to enable"}
    >
      PC <span className={`chip-dot ${on ? "on" : ""}`} />
    </button>
  );
}

export default function App() {
  const [emotion,        setEmotion]        = useState("neutral");
  const [audioLevel,     setAudioLevel]     = useState(0);
  const [speaking,       setSpeaking]       = useState(false);
  const [blendshapes,    setBlendshapes]    = useState(null);
  const [subtitle,       setSubtitle]       = useState("");
  const [tab,            setTab]            = useState("voice");
  const [panelOpen,      setPanelOpen]      = useState(false);
  const [openChip,       setOpenChip]       = useState("");   // "engine" | "caps" | "pika" | "rag" | "hermes" | ""
  const [orbitFree,      setOrbitFree]      = useState(false);
  const [cameraOn,       setCameraOn]       = useState(false);
  const [screenShare,    setScreenShare]    = useState(false);
  const [streamMode,     setStreamMode]     = useState(false);
  const [vrmPath,        setVrmPath]        = useState("/models/lia.vrm");
  const [backgroundPath, setBackgroundPath] = useState("/bg.jpg");
  const [thinking,       setThinking]       = useState(false);
  const [listening,      setListening]      = useState(false);
  const [newsView,       setNewsView]       = useState(null);
  const [newsPopupOpen,  setNewsPopupOpen]  = useState(false);
  const [creatorRoastOn, setCreatorRoastOn] = useState(false);
  const [soulEmotions,   setSoulEmotions]   = useState(DEFAULT_SOUL_EMOTIONS);

  const facePosRef      = useRef(null);
  const emotionTimerRef = useRef(null);
  const faceEmoTimerRef = useRef(null);
  const orbitRef        = useRef(null);

  useEffect(() => {
    fetch("/api/vrm/active")
      .then(r => r.json())
      .then(d => { if (d.filename) setVrmPath(`/models/${d.filename}`); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function refreshSoul() {
      try {
        const data = await fetch("/api/soul/status").then(r => r.json());
        const next = data?.animation || data?.normalized;
        if (!cancelled && next) {
          setSoulEmotions({ ...DEFAULT_SOUL_EMOTIONS, ...next });
        }
      } catch {}
    }
    refreshSoul();
    const timer = setInterval(refreshSoul, 10000);
    window.addEventListener("focus", refreshSoul);
    window.addEventListener("lia-soul-refresh", refreshSoul);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", refreshSoul);
      window.removeEventListener("lia-soul-refresh", refreshSoul);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function refreshCreatorMode(event) {
      try {
        const data = event?.detail?.switches
          ? event.detail
          : await fetch("/api/capabilities").then(r => r.json());
        if (!cancelled) setCreatorRoastOn(Boolean(data?.switches?.cashclaw));
      } catch {}
    }
    refreshCreatorMode();
    const timer = setInterval(refreshCreatorMode, 3000);
    window.addEventListener("focus", refreshCreatorMode);
    window.addEventListener("lia-capabilities-changed", refreshCreatorMode);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", refreshCreatorMode);
      window.removeEventListener("lia-capabilities-changed", refreshCreatorMode);
    };
  }, []);

  useEffect(() => {
    function onNewsOpen(event) {
      const news = event.detail;
      if (!news?.items?.length) return;
      // Update the data so News tab shows it, but DON'T auto-pop the modal —
      // user must explicitly click News tab. Avoids news panel hijacking voice/chat.
      setNewsView(news);
    }
    window.addEventListener("lia-news-open", onNewsOpen);
    return () => window.removeEventListener("lia-news-open", onNewsOpen);
  }, []);

  function triggerEmotion(emo, holdMs = 2000) {
    if (emotionTimerRef.current) clearTimeout(emotionTimerRef.current);
    if (!emo || emo === "neutral") {
      setEmotion("neutral");
      return;
    }
    setEmotion(emo);
    window.dispatchEvent(new CustomEvent("lia-soul-refresh"));
    if (holdMs > 0) {
      emotionTimerRef.current = setTimeout(() => setEmotion("neutral"), holdMs);
    }
  }

  function onFaceEmotion(emo) {
    if (!speaking) return;
    if (!emo || emo === "neutral") return;
    if (faceEmoTimerRef.current) clearTimeout(faceEmoTimerRef.current);
    triggerEmotion(emo);
    faceEmoTimerRef.current = setTimeout(() => {}, 4000);
  }

  function onFacePos(x, y) { facePosRef.current = { x, y }; }

  function onScreenReaction(text) {
    setSubtitle(text);
    setTimeout(() => setSubtitle(""), 6000);
  }

  useEffect(() => {
    fetch("/api/obs_subtitle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: subtitle }),
    }).catch(() => {});
  }, [subtitle]);

  function onVoiceState(s) {
    setThinking(s === "thinking");
    setListening(s === "recording");
    if (s === "thinking" || s === "idle" || s === "recording") triggerEmotion("neutral");
  }

  function onChatState(s) {
    setThinking(s === "thinking");
    setListening(false);
    if (s === "thinking" || s === "idle") triggerEmotion("neutral");
  }

  function switchVrm(path) {
    setVrmPath(path);
    fetch("/api/vrm/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: path.split("/").pop() }),
    }).catch(() => {});
  }

  function lockAvatar() {
    setOrbitFree(false);
    setTimeout(() => orbitRef.current?.reset(), 30);
  }

  function toggleChip(name) {
    setOpenChip(c => c === name ? "" : name);
  }

  // Shared voice node props
  const voiceProps = {
    onEmotion: triggerEmotion,
    onAudioLevel: setAudioLevel,
    onSpeaking: setSpeaking,
    onBlendshapes: setBlendshapes,
    onSubtitle: setSubtitle,
    onState: onVoiceState,
  };

  return (
    <div className={`app-root ${streamMode ? "stream-mode" : ""}`}>

      {!streamMode && <StatsNode />}

      {/* Full-screen 3D Avatar */}
      <div
        className="avatar-bg"
        style={{ backgroundImage: streamMode ? "none" : `url('${backgroundPath}')` }}
      >
        <Canvas
          camera={{ position: CAM_POS, fov: 34 }}
          gl={{ antialias: true, alpha: true }}
          onCreated={({ gl }) => gl.setClearAlpha(0)}
          style={{ width: "100%", height: "100%" }}
        >
          <Suspense fallback={null}>
            <ambientLight intensity={0.7} />
            <directionalLight position={[1.5, 5, 3]} intensity={1.3} />
            <pointLight position={[-2, 2, -1]} color="#c084fc" intensity={0.55} />
            <pointLight position={[2, 0.5, 2]} color="#f0abfc" intensity={0.3} />

            <VRMAvatarNode
              key={vrmPath}
              vrmPath={vrmPath}
              emotion={emotion}
              audioLevel={audioLevel}
              speaking={speaking}
              thinking={thinking}
              listening={listening}
              blendshapes={blendshapes}
              facePosRef={cameraOn ? facePosRef : null}
              creatorRoastMode={creatorRoastOn}
              soulEmotions={soulEmotions}
            />

            <OrbitControls
              ref={orbitRef}
              enabled={orbitFree}
              enablePan={false}
              minDistance={1.0}
              maxDistance={6}
              target={CAM_TARGET}
            />
            <CameraReset locked={!orbitFree} />
            <Environment preset="night" />
          </Suspense>
        </Canvas>

        {speaking && (
          <div className="speaking-ring" style={{ transform: `scale(${1 + audioLevel * 0.7})` }} />
        )}
        {emotion !== "neutral" && (
          <div className="emotion-badge">{emojiFor(emotion)}</div>
        )}
        {subtitle && (
          <div className="movie-subtitle">{subtitle}</div>
        )}
      </div>

      {/* Hidden nodes */}
      <FaceTrackNode enabled={cameraOn} onEmotion={onFaceEmotion} onFacePos={onFacePos} onFaceActive={() => {}} />
      <ScreenShareNode enabled={screenShare} onReaction={onScreenReaction} />

      {/* Main UI (hidden in stream mode) */}
      {!streamMode && (
        <>
          {/* Top-left toolbar */}
          <div className="top-left-bar">
            <button
              className={`toolbar-btn ${orbitFree ? "active" : ""}`}
              onClick={() => orbitFree ? lockAvatar() : setOrbitFree(true)}
              title={orbitFree ? "Lock camera" : "Free camera"}
            >
              <span className={orbitFree ? "ui-icon icon-lock" : "ui-icon icon-unlock"} aria-hidden="true" />
            </button>
            <button
              className={`toolbar-btn ${cameraOn ? "active" : ""}`}
              onClick={() => setCameraOn(v => !v)}
              title={cameraOn ? "Camera ON" : "Enable face tracking"}
            >
              <span className="ui-icon icon-camera" aria-hidden="true" /><span className={`btn-dot ${cameraOn ? "on" : ""}`} />
            </button>
            <button
              className={`toolbar-btn ${screenShare ? "active" : ""}`}
              onClick={() => setScreenShare(v => !v)}
              title={screenShare ? "Screen share ON" : "Share screen"}
            >
              <span className="ui-icon icon-screen" aria-hidden="true" /><span className={`btn-dot ${screenShare ? "on" : ""}`} />
            </button>
            <button
              className="toolbar-btn"
              onClick={() => setStreamMode(true)}
              title="Stream mode"
            >
              <span className="ui-icon icon-video" aria-hidden="true" />
            </button>
          </div>

          {/* VRM model switcher - bottom-left */}
          <VRMSwitcherNode
            currentPath={vrmPath}
            onSwitch={switchVrm}
            currentBackground={backgroundPath}
            onBackground={setBackgroundPath}
          />

          {/* Panel toggle */}
          {!panelOpen && (
            <button className="panel-toggle" onClick={() => setPanelOpen(true)} aria-label="Open menu">
              <span className="ui-icon icon-menu" aria-hidden="true" />
            </button>
          )}

          {/* Side panel */}
          {panelOpen && (
            <div className="side-panel">

              {/* Top: LIA title + close */}
              <div className="side-top">
                <div className="lia-title">
                  <span className="lia-name">LIA</span>
                  <span className="lia-sub">your wife</span>
                </div>
                <button className="panel-close-btn" onClick={() => setPanelOpen(false)}>X</button>
              </div>

              {/* Brain + Desktop */}
              <div className="panel-top-controls">
                <ModelSwitchNode />
                <DesktopToggleNode />
              </div>

              {/* Option chips */}
              <div className="opts-strip">
                <button
                  className={`opt-chip ${openChip === "engine" ? "active" : ""}`}
                  onClick={() => toggleChip("engine")}
                  title="Voice engine settings"
                >
                  Voice
                </button>
                <PcToggle />
                <button
                  className={`opt-chip ${openChip === "caps" ? "active" : ""}`}
                  onClick={() => toggleChip("caps")}
                  title="Capabilities and skills"
                >
                  Skills
                </button>
                <button
                  className={`opt-chip ${openChip === "pika" ? "active" : ""}`}
                  onClick={() => toggleChip("pika")}
                  title="Pika meeting mode"
                >
                  Pika
                </button>
                <button
                  className={`opt-chip ${openChip === "rag" ? "active" : ""}`}
                  onClick={() => toggleChip("rag")}
                  title="RAGFlow document knowledge base"
                >
                  RAG
                </button>
                <button
                  className={`opt-chip ${openChip === "hermes" ? "active" : ""}`}
                  onClick={() => toggleChip("hermes")}
                  title="Telegram chat"
                >
                  TG
                </button>
                <button
                  className={`opt-chip ${openChip === "stream" ? "active" : ""}`}
                  onClick={() => toggleChip("stream")}
                  title="VTuber live chat mode"
                >
                  📺 Stream
                </button>
              </div>

              {openChip !== "" && (
                <div className="opt-box">
                  {openChip === "engine" && <VoiceSwitchNode />}
                  {openChip === "caps"   && <CapabilityHubNode />}
                  {openChip === "pika"   && <PikaMeetingNode />}
                  {openChip === "rag"    && <RAGFlowNode />}
                  {openChip === "hermes" && <HermesNode />}
                  {openChip === "stream" && <LiveChatNode />}
                </div>
              )}

              {/* Status indicators */}
              {(cameraOn || screenShare) && (
                <div className="status-bar">
                  {cameraOn    && <span className="status-pill cam">Face ON</span>}
                  {screenShare && <span className="status-pill screen">Screen ON</span>}
                </div>
              )}

              {/* Voice / Chat - always at bottom */}
              <div className="voice-chat-wrap">
                <div className="tab-bar">
                  <button className={`tab-btn ${tab === "voice" ? "active" : ""}`} onClick={() => setTab("voice")}>Voice</button>
                  <button className={`tab-btn ${tab === "chat"  ? "active" : ""}`} onClick={() => setTab("chat")}>Chat</button>
                  <button className={`tab-btn ${tab === "news"  ? "active" : ""}`} onClick={() => setTab("news")}>News</button>
                </div>
                <div className="tab-content">
                  {tab === "voice" && <VoiceNode {...voiceProps} />}
                  {tab === "chat"  && <ChatNode  onEmotion={triggerEmotion} onAudio={setAudioLevel} onSpeaking={setSpeaking} onState={onChatState} />}
                  {tab === "news"  && <NewsBrowserNode news={newsView} />}
                </div>
              </div>

            </div>
          )}

          {/* Compact mic overlay (panel closed) */}
          {!panelOpen && (
            <div className="voice-overlay">
              <VoiceNode {...voiceProps} compact={true} />
            </div>
        )}

        {newsPopupOpen && newsView?.items?.length && (
          <div className="news-popup-backdrop">
            <div className="news-popup">
              <div className="news-popup-head">
                <div>
                  <span className="news-popup-kicker">LIA News</span>
                  <h2>{newsView.topic || "Latest news"}</h2>
                </div>
                <button className="news-popup-close" onClick={() => setNewsPopupOpen(false)}>X</button>
              </div>
              <NewsBrowserNode news={newsView} large />
            </div>
          </div>
        )}
      </>
    )}

      {/* W2A Sensor Feed */}
      {!streamMode && <SensorFeedNode />}

      {/* Stream mode */}
      {streamMode && (
        <>
          <button className="stream-exit-btn" onClick={() => setStreamMode(false)} title="Exit stream mode">X</button>
          <div className="stream-mic">
            <VoiceNode {...voiceProps} compact={true} />
          </div>
        </>
      )}
    </div>
  );
}

function emojiFor(e) {
  return { happy:"🥰", sad:"😢", angry:"😠", surprised:"😮", loving:"💕", worried:"😨", flustered:"😳", jealous:"😒", neutral:"" }[e] ?? "";
}
