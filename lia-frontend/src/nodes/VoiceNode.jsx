/**
 * NODE: VoiceNode — PRIMARY voice interaction
 * WebSocket voice: mic → STT → one complete LIA TTS reply → audio queue
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { initAnimaSync, processAudio, getBlendshapesAtFrame, isReady } from "./AnimaSyncNode.js";
import { textToVisemes, getVisemesAtTime } from "./LipSyncTextNode.js";
import { clearStoredLocation, getLocationForTurn, getStoredLocation, requestCurrentLocation } from "./locationPermission.js";

// WebSocket URL — proxied by Vite dev server
const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/voice`;


export default function VoiceNode({ onEmotion, onAudioLevel, onSpeaking, onBlendshapes, onSubtitle, onState, compact = false }) {
  const [state,    setState]    = useState("idle"); // idle|recording|thinking|speaking
  const [messages, setMessages] = useState([
    { role: "lia", text: "Jashu... you came! Talk to me" }
  ]);
  const [subtitle,  setSubtitle]  = useState("");
  const [showSubs,  setShowSubs]  = useState(true);
  const [locationState, setLocationState] = useState(null);

  // WebSocket
  const wsRef          = useRef(null);
  const wsReadyRef     = useRef(false);
  const wsReconnectTimerRef = useRef(null);
  const wsMountedRef   = useRef(true);
  const responseTimeoutRef = useRef(null);
  const speechRecognitionRef = useRef(null);
  const speechHintRef = useRef("");

  // Recording
  const mediaRecorderRef = useRef(null);
  const chunksRef        = useRef([]);
  const streamRef        = useRef(null);
  const recordAudioCtxRef = useRef(null);
  const recordSourceRef   = useRef(null);
  const recordProcessorRef = useRef(null);
  const recordGainRef     = useRef(null);
  const recordSampleRateRef = useRef(48000);
  const micAnalyserRef   = useRef(null);
  const micAudioCtxRef   = useRef(null);
  const micLevelFrameRef = useRef(null);
  const maxMicLevelRef   = useRef(0);

  // Audio playback
  const audioRef         = useRef(null);
  const audioCtxRef      = useRef(null);
  const analyserRef      = useRef(null);
  const animFrameRef     = useRef(null);
  const animaSyncResult  = useRef(null);
  const fpsRef           = useRef(24);
  const textVisemeSeq    = useRef(null);
  const sourceRef        = useRef(null);

  // Sentence queue
  const audioQueueRef  = useRef([]);
  const isPlayingRef   = useRef(false);
  const doneReceivedRef = useRef(false);
  const sentenceCounterRef = useRef(0);  // recreate AudioContext every N to prevent node leak

  // Auto-listen (FastRTC WebRTC VAD — server-side Silero)
  const [autoListen, setAutoListen]  = useState(false);
  const autoListenRef  = useRef(false);
  const autoRTCRef     = useRef(null); // RTCPeerConnection
  const autoSSERef     = useRef(null); // EventSource for AdditionalOutputs
  const autoStreamRef  = useRef(null); // MediaStream (mic)

  // State ref so callbacks see current value
  const stateRef = useRef("idle");
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { onState?.(state); }, [state]);
  useEffect(() => { autoListenRef.current = autoListen; }, [autoListen]);

  // ── Init AnimaSync on mount ──────────────────────────────────────────────
  useEffect(() => {
    initAnimaSync();
    setLocationState(getStoredLocation());
    return () => {
      stopAutoListen();
      stopLevelLoop();
      stopMicLevelMonitor();
      clearResponseTimeout();
      stopBrowserRecognition();
      try { recordProcessorRef.current?.disconnect(); } catch {}
      try { recordSourceRef.current?.disconnect(); } catch {}
      try { recordGainRef.current?.disconnect(); } catch {}
      try { recordAudioCtxRef.current?.close(); } catch {}
      audioRef.current?.pause();
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  // ── Auto-listen: start/stop when toggle changes ──────────────────────────
  useEffect(() => {
    if (autoListen) startAutoListen();
    else stopAutoListen();
  }, [autoListen]);

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
      showStatusText("Location permission was not granted.");
    }
  }

  // ── WebSocket — persistent connection ────────────────────────────────────
  useEffect(() => {
    wsMountedRef.current = true;
    connectWS();
    return () => {
      wsMountedRef.current = false;
      if (wsReconnectTimerRef.current) {
        clearTimeout(wsReconnectTimerRef.current);
        wsReconnectTimerRef.current = null;
      }
      try { wsRef.current?.close(); } catch {}
      wsRef.current = null;
    };
  }, []);

  useEffect(() => {
    const stopReading = () => {
      interruptPlayback();
      clearResponseTimeout();
      setState("idle");
      setMessages(p => [...p, { role: "lia", text: "Stopped reading, jashu." }]);
    };
    window.addEventListener("lia-voice-stop", stopReading);
    return () => window.removeEventListener("lia-voice-stop", stopReading);
  }, []);

  function connectWS() {
    if (!wsMountedRef.current) return;  // unmounted — don't reconnect
    const ws = new WebSocket(WS_URL);
    ws.onopen  = () => { wsReadyRef.current = true; };
    ws.onclose = () => {
      wsReadyRef.current = false;
      if (stateRef.current === "thinking") {
        clearResponseTimeout();
        speakLocalStatus("Voice connection reset. Try again, jashu.");
      }
      // Schedule reconnect only if still mounted
      if (wsMountedRef.current) {
        wsReconnectTimerRef.current = setTimeout(connectWS, 2000);
      }
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (e) => {
      try { handleWSMessage(JSON.parse(e.data)); } catch {}
    };
    wsRef.current = ws;
  }

  function handleWSMessage(msg) {
    switch (msg.type) {
      case "thinking":
        armResponseTimeout();
        setState("thinking");
        break;

      case "stt":
        if (msg.text) {
          setMessages(p => [...p, { role: "user", text: msg.text }]);
        }
        break;

      case "sentence":
        armResponseTimeout();
        if (msg.news?.items?.length) {
          window.dispatchEvent(new CustomEvent("lia-news-open", { detail: msg.news }));
        }
        enqueueAudio({
          text:     msg.text     ?? "",
          audio_b64: msg.audio_b64 ?? "",
          emotion:  msg.emotion  ?? "neutral",
          pause_ms: msg.pause_ms,
        });
        break;

      case "done":
        if (msg.news?.items?.length) {
          window.dispatchEvent(new CustomEvent("lia-news-open", { detail: msg.news }));
        }
        clearResponseTimeout();
        doneReceivedRef.current = true;
        // If queue already drained before done arrived, finalize
        if (!isPlayingRef.current && audioQueueRef.current.length === 0) {
          finalizePlayback();
        }
        break;

      case "proactive":
        // LIA speaks on her own (life engine greeting, proactive line, alert).
        // Skip if a turn is in flight — never talk over Jashu's conversation.
        if (stateRef.current === "recording" || stateRef.current === "thinking") break;
        if (msg.audio_b64) {
          doneReceivedRef.current = true;
          enqueueAudio({ text: msg.text ?? "", audio_b64: msg.audio_b64, emotion: msg.emotion ?? "neutral" });
        } else if (msg.text) {
          showStatusText(msg.text);
        }
        break;

      case "empty":
        clearResponseTimeout();
        speakStatus(msg.message || "No speech detected. Hold the mic longer.", msg.audio_b64 || "");
        break;

      case "error":
        clearResponseTimeout();
        speakStatus(msg.message || "Voice failed. Check backend logs.", msg.audio_b64 || "");
        break;
    }
  }

  // ── Audio queue ──────────────────────────────────────────────────────────
  function enqueueAudio(item) {
    audioQueueRef.current.push(item);
    if (!isPlayingRef.current) {
      drainQueue();
    }
  }

  function showStatusText(text) {
    setMessages(p => {
      const last = p[p.length - 1];
      if (last?.role === "lia" && last.text === text) return p;
      return [...p, { role: "lia", text }];
    });
    setState("idle");
  }

  function speakStatus(text, audio_b64 = "") {
    if (audio_b64) {
      doneReceivedRef.current = true;
      enqueueAudio({ text, audio_b64, emotion: "worried" });
      return;
    }
    showStatusText(text);
  }

  async function speakLocalStatus(text) {
    try {
      const resp = await fetch(`/api/audio_tts?text=${encodeURIComponent(text)}`);
      if (!resp.ok) throw new Error("tts failed");
      const blob = await resp.blob();
      if (blob.size > 200) {
        const audio_b64 = await blobToBase64(blob);
        speakStatus(text, audio_b64);
        return;
      }
    } catch {}
    showStatusText(text);
  }

  async function drainQueue() {
    if (audioQueueRef.current.length === 0) {
      // If we've received "done" already and nothing left, finalize
      if (doneReceivedRef.current) {
        finalizePlayback();
      }
      // else wait for the reply audio to arrive
      isPlayingRef.current = false;
      return;
    }

    isPlayingRef.current = true;
    const item = audioQueueRef.current.shift();

    setState("speaking");
    onSpeaking?.(true);

    if (item.text) {
      setSubtitle(item.text);
      onSubtitle?.(item.text);
      setMessages(p => {
        // Keep LIA's reply in one message block
        const last = p[p.length - 1];
        if (last?.role === "lia" && last._streaming) {
          return [...p.slice(0, -1), { ...last, text: last.text + " " + item.text }];
        }
        return [...p, { role: "lia", text: item.text, _streaming: true }];
      });
    }
    if (item.emotion) onEmotion?.(item.emotion, 0);

    if (item.audio_b64) {
      try { await playSentenceAudio(item.audio_b64, item.text); } catch {}
    } else if (item.text) {
      // No audio (TTS failed) — hold subtitle for reading time so text isn't instant-flash
      const readMs = Math.min(3500, Math.max(1200, item.text.length * 55));
      await new Promise(r => setTimeout(r, readMs));
    }

    const pauseMs = Number.isFinite(item.pause_ms) ? item.pause_ms : 70;
    if (pauseMs > 0) await new Promise(r => setTimeout(r, pauseMs));
    onEmotion?.("neutral", 2000);
    drainQueue();
  }

  function interruptPlayback() {
    audioQueueRef.current = [];
    doneReceivedRef.current = false;
    isPlayingRef.current = false;
    audioRef.current?.pause();
    stopLevelLoop();
    animaSyncResult.current = null;
    textVisemeSeq.current = null;
    onSpeaking?.(false);
    setSubtitle("");
    onSubtitle?.("");
  }

  function finalizePlayback() {
    clearResponseTimeout();
    isPlayingRef.current = false;
    doneReceivedRef.current = false;
    audioQueueRef.current = [];
    setState("idle");
    onSpeaking?.(false);
    onEmotion?.("neutral");
    setSubtitle("");
    onSubtitle?.("");
    // Seal streaming message
    setMessages(p => p.map(m => m._streaming ? { ...m, _streaming: false } : m));
  }

  function clearResponseTimeout() {
    if (responseTimeoutRef.current) clearTimeout(responseTimeoutRef.current);
    responseTimeoutRef.current = null;
  }

  function armResponseTimeout() {
    clearResponseTimeout();
    responseTimeoutRef.current = setTimeout(() => {
      if (stateRef.current !== "thinking") return;
      speakLocalStatus("That turn got stuck. Try again, jashu.");
    }, 45000);
  }

  // ── Play one reply WAV ────────────────────────────────────────────────────
  function playSentenceAudio(audio_b64, text) {
    return new Promise(async (resolve) => {
      // Decode base64
      const bytes  = Uint8Array.from(atob(audio_b64), c => c.charCodeAt(0));
      // Auto-detect format: WAV="RIFF", MP3=ID3 tag or 0xFF sync byte
      let mimeType = "audio/wav";
      if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) mimeType = "audio/mpeg";
      else if (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0) mimeType = "audio/mpeg";
      const blob   = new Blob([bytes], { type: mimeType });

      // Fallback visemes are scaled after audio metadata tells us real duration.
      textVisemeSeq.current = null;
      animaSyncResult.current = null;

      const url   = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.preload = "auto";
      audioRef.current = audio;

      // Start playback immediately. AnimaSync upgrades the mouth frames mid-stream
      // when ready, instead of delaying the sentence before the audio begins.
      if (isReady()) {
        processAudio(blob).then(result => {
          if (!result || audioRef.current !== audio || audio.ended) return;
          animaSyncResult.current = result;
          fpsRef.current = result.fps ?? 24;
          textVisemeSeq.current = null;
        }).catch(() => {});
      }

      // AudioContext for level analysis. Recreate every 50 sentences to prevent
      // long-session node accumulation (createMediaElementSource leaks references).
      sentenceCounterRef.current = (sentenceCounterRef.current || 0) + 1;
      if (audioCtxRef.current && sentenceCounterRef.current >= 50) {
        try { audioCtxRef.current.close(); } catch {}
        audioCtxRef.current = null;
        sentenceCounterRef.current = 0;
      }
      if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
        audioCtxRef.current = new AudioContext();
      }
      const ctx      = audioCtxRef.current;
      if (ctx.state === "suspended") {
        await ctx.resume().catch(() => {});
      }
      const source   = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.55;
      analyserRef.current = analyser;
      sourceRef.current = source;
      source.connect(analyser);
      analyser.connect(ctx.destination);

      audio.onloadedmetadata = () => {
        if (!animaSyncResult.current && text) {
          textVisemeSeq.current = textToVisemes(text, audio.duration * 1000);
        }
      };
      audio.onplay  = () => startLevelLoop(audio);
      audio.onended = () => {
        stopLevelLoop();
        animaSyncResult.current = null;
        textVisemeSeq.current   = null;
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onerror = () => {
        stopLevelLoop();
        animaSyncResult.current = null;
        textVisemeSeq.current = null;
        URL.revokeObjectURL(url);
        resolve();
      };

      audio.play().catch(() => resolve());
    });
  }

  // ── Level + blendshape loop ──────────────────────────────────────────────
  function startLevelLoop(audio) {
    const buf = new Uint8Array(analyserRef.current?.frequencyBinCount ?? 128);

    function tick() {
      analyserRef.current?.getByteFrequencyData(buf);
      const avg = buf.reduce((s, v) => s + v, 0) / buf.length / 255;
      onAudioLevel?.(avg);

      const elapsedMs = (audio?.currentTime ?? 0) * 1000;
      const zero = { aa: 0, ee: 0, ih: 0, oh: 0, ou: 0, blink: 0, blinkLeft: 0, blinkRight: 0 };
      if (animaSyncResult.current) {
        const frameIdx = Math.floor((elapsedMs / 1000) * fpsRef.current);
        onBlendshapes?.(getBlendshapesAtFrame(animaSyncResult.current, frameIdx) ?? zero);
      } else if (textVisemeSeq.current) {
        onBlendshapes?.(getVisemesAtTime(textVisemeSeq.current, elapsedMs) ?? zero);
      } else {
        onBlendshapes?.(zero);
      }
      animFrameRef.current = requestAnimationFrame(tick);
    }
    animFrameRef.current = requestAnimationFrame(tick);
  }

  function stopLevelLoop() {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = null;
    try { sourceRef.current?.disconnect(); } catch {}
    try { analyserRef.current?.disconnect(); } catch {}
    sourceRef.current = null;
    analyserRef.current = null;
    onAudioLevel?.(0);
    onBlendshapes?.({ aa: 0, ee: 0, ih: 0, oh: 0, ou: 0, blink: 0, blinkLeft: 0, blinkRight: 0 });
  }

  // ── Recording ────────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    if (autoListenRef.current) return; // PTT disabled while auto-listen is on
    if (stateRef.current === "speaking") {
      interruptPlayback();
    } else if (stateRef.current !== "idle") {
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 48000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,   // boosts quiet mic so STT can hear it
        }
      });
      streamRef.current = stream;
      startMicLevelMonitor(stream);

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx({ sampleRate: 48000 });
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const zeroGain = ctx.createGain();
      zeroGain.gain.value = 0;

      chunksRef.current = [];
      speechHintRef.current = "";
      startBrowserRecognition();
      recordSampleRateRef.current = ctx.sampleRate;
      processor.onaudioprocess = event => {
        if (stateRef.current !== "recording") return;
        const input = event.inputBuffer.getChannelData(0);
        chunksRef.current.push(new Float32Array(input));
      };
      source.connect(processor);
      processor.connect(zeroGain);
      zeroGain.connect(ctx.destination);

      recordAudioCtxRef.current = ctx;
      recordSourceRef.current = source;
      recordProcessorRef.current = processor;
      recordGainRef.current = zeroGain;
      mediaRecorderRef.current = null;
      stateRef.current = "recording";
      setState("recording");
    } catch (err) {
      console.error("Mic error:", err);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (stateRef.current !== "recording") return;
    stateRef.current = "thinking";
    try { recordProcessorRef.current?.disconnect(); } catch {}
    try { recordSourceRef.current?.disconnect(); } catch {}
    try { recordGainRef.current?.disconnect(); } catch {}
    try { recordAudioCtxRef.current?.close(); } catch {}
    stopBrowserRecognition();
    recordProcessorRef.current = null;
    recordSourceRef.current = null;
    recordGainRef.current = null;
    recordAudioCtxRef.current = null;
    mediaRecorderRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    stopMicLevelMonitor();
    setState("thinking");
    sendAudioToWS();
  }, []);

  // ── Auto-listen (FastRTC WebRTC — server-side Silero VAD) ───────────────
  async function startAutoListen() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: 48000, echoCancellation: true,
                 noiseSuppression: true, autoGainControl: true },
      });
      autoStreamRef.current = stream;
      startMicLevelMonitor(stream);

      // WebRTC peer connection to FastRTC backend
      const pc = new RTCPeerConnection();
      autoRTCRef.current = pc;

      // Add mic track so server receives audio
      stream.getAudioTracks().forEach(t => pc.addTrack(t, stream));

      // Remote audio (server TTS via WebRTC) — discarded here; reply comes via WS
      pc.ontrack = () => {};

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Wait for ICE gathering to complete
      await new Promise(resolve => {
        if (pc.iceGatheringState === "complete") { resolve(); return; }
        pc.addEventListener("icegatheringstatechange", () => {
          if (pc.iceGatheringState === "complete") resolve();
        });
        setTimeout(resolve, 3000); // fallback timeout
      });

      const resp = await fetch("/rtc/webrtc/offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sdp: pc.localDescription.sdp,
          type: pc.localDescription.type,
        }),
      });

      if (!resp.ok) throw new Error(`FastRTC offer failed: ${resp.status}`);
      const answer = await resp.json();

      // answer contains { sdp, type, webrtc_id }
      await pc.setRemoteDescription({ sdp: answer.sdp, type: answer.type });

      const webrtcId = answer.webrtc_id;

      // SSE for AdditionalOutputs (STT text from server)
      const sse = new EventSource(`/rtc/outputs?webrtc_id=${webrtcId}`);
      autoSSERef.current = sse;

      sse.addEventListener("output", e => {
        if (!autoListenRef.current) return;
        try {
          const data = JSON.parse(e.data);
          if (data.type === "stt" && data.text) {
            // Speech interrupt (Open-LLM-VTuber pattern):
            // If LIA is mid-speech, stop her immediately and process the new input.
            if (stateRef.current === "speaking") {
              interruptPlayback();
            }
            // Skip if already processing a previous turn
            if (stateRef.current === "thinking") return;
            stateRef.current = "thinking";
            setState("thinking");
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({
                type: "text",
                text: data.text,
                emotion: data.emotion ?? "neutral",
              }));
            }
          }
        } catch {}
      });

      sse.onerror = () => {
        if (!autoListenRef.current) return;
        // Server restarted or connection dropped — restart
        stopAutoListen();
        setTimeout(() => { if (autoListenRef.current) startAutoListen(); }, 2000);
      };

    } catch (err) {
      console.error("FastRTC auto-listen error:", err);
      setAutoListen(false);
    }
  }

  function stopAutoListen() {
    autoSSERef.current?.close();
    autoSSERef.current = null;
    try { autoRTCRef.current?.close(); } catch {}
    autoRTCRef.current = null;
    autoStreamRef.current?.getTracks().forEach(t => t.stop());
    autoStreamRef.current = null;
    stopMicLevelMonitor();
  }

  function startMicLevelMonitor(stream) {
    try {
      stopMicLevelMonitor();
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      micAudioCtxRef.current = ctx;
      micAnalyserRef.current = analyser;
      maxMicLevelRef.current = 0;
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) {
          const d = (v - 128) / 128;
          sum += d * d;
        }
        const rms = Math.sqrt(sum / buf.length);
        maxMicLevelRef.current = Math.max(maxMicLevelRef.current, rms);
        micLevelFrameRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {}
  }

  function stopMicLevelMonitor() {
    if (micLevelFrameRef.current) cancelAnimationFrame(micLevelFrameRef.current);
    micLevelFrameRef.current = null;
    try { micAudioCtxRef.current?.close(); } catch {}
    micAudioCtxRef.current = null;
    micAnalyserRef.current = null;
  }

  // ── Send recorded audio to WS ────────────────────────────────────────────
  async function sendAudioToWS() {
    const blob = createWavBlob(chunksRef.current, recordSampleRateRef.current);

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      // Fallback to REST if WS not ready
      return sendAudioREST(blob);
    }

    // Reset queue for new turn
    audioQueueRef.current = [];
    isPlayingRef.current  = false;
    doneReceivedRef.current = false;
    armResponseTimeout();

    const b64 = await blobToBase64(blob);
    const turnLocation = await getLocationForTurn(Boolean(locationState?.permission));
    if (turnLocation) setLocationState(turnLocation);
    wsRef.current.send(JSON.stringify({
      type: "audio",
      audio_b64: b64,
      transcript_hint: speechHintRef.current,
      location: turnLocation,
    }));
  }

  function startBrowserRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    try {
      stopBrowserRecognition();
      const rec = new SpeechRecognition();
      rec.lang = "en-IN";   // hint lang: user speaks English/Tenglish primarily
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 3;
      rec.onresult = event => {
        const parts = [];
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          const best = result?.[0]?.transcript || "";
          if (best.trim()) parts.push(best.trim());
        }
        speechHintRef.current = parts.join(" ").trim();
      };
      rec.onerror = () => {};
      rec.onend = () => {};
      speechRecognitionRef.current = rec;
      rec.start();
    } catch {}
  }

  function stopBrowserRecognition() {
    const rec = speechRecognitionRef.current;
    speechRecognitionRef.current = null;
    if (!rec) return;
    try { rec.onresult = null; rec.onerror = null; rec.onend = null; rec.stop(); } catch {}
  }

  // ── REST fallback (if WS unavailable) ───────────────────────────────────
  async function sendAudioREST(blob) {
      const form = new FormData();
      form.append("file", blob, "voice.wav");
      form.append("transcript_hint", speechHintRef.current || "");
      const turnLocation = await getLocationForTurn(Boolean(locationState?.permission));
      if (turnLocation) {
        setLocationState(turnLocation);
        form.append("latitude", String(turnLocation.latitude));
        form.append("longitude", String(turnLocation.longitude));
        form.append("accuracy", String(turnLocation.accuracy ?? 0));
        form.append("location_permission", "granted");
      }
    try {
      const resp = await fetch("/api/voice_chat", { method: "POST", body: form });
      if (!resp.ok) throw new Error();
      const sttText = decodeURIComponent(resp.headers.get("X-LIA-STT")  ?? "");
      const liaText = decodeURIComponent(resp.headers.get("X-LIA-Text") ?? "");
      const emotion = resp.headers.get("X-LIA-Emotion") ?? "neutral";
      const audioBlob = await resp.blob();
      if (sttText) setMessages(p => [...p, { role: "user", text: sttText }]);
      if (liaText) setMessages(p => [...p, { role: "lia",  text: liaText }]);
      onEmotion?.(emotion, 0);
      setSubtitle(liaText);
      onSubtitle?.(liaText);
      if (audioBlob.size > 200) {
        enqueueAudio({ text: liaText, audio_b64: await blobToBase64(audioBlob), emotion });
      } else {
        setState("idle");
      }
    } catch {
      setState("idle");
    }
  }

  // ── Spacebar push-to-talk ────────────────────────────────────────────────
  useEffect(() => {
    const dn = e => {
      if (e.code === "Space" && e.target.tagName !== "TEXTAREA" && e.target.tagName !== "INPUT") {
        e.preventDefault();
        startRecording();
      }
    };
    const up = e => { if (e.code === "Space") stopRecording(); };
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup",   up);
    return () => {
      window.removeEventListener("keydown", dn);
      window.removeEventListener("keyup",   up);
    };
  }, [startRecording, stopRecording]);

  const stateLabel = autoListen ? {
    idle:      "Auto — waiting for voice...",
    recording: "Auto — speech detected",
    thinking:  "LIA is thinking...",
    speaking:  "LIA is speaking...",
  }[state] : {
    idle:      "Hold to speak",
    recording: "Listening...",
    thinking:  "LIA is thinking...",
    speaking:  "LIA is speaking...",
  }[state];

  // ── Compact mode ─────────────────────────────────────────────────────────
  if (compact) {
    return (
      <div className="voice-compact">
        <div className={`voice-status voice-status-${state}`}>{stateLabel}</div>
        <button
          className={`mic-btn mic-btn-${state} mic-btn-lg`}
          onPointerDown={startRecording}
          onPointerUp={stopRecording}
          onPointerLeave={stopRecording}
          disabled={state === "thinking" || autoListen}
          aria-label="Hold to speak"
        >
          {state === "recording" ? <MicActiveIcon /> : <MicIcon />}
        </button>
        <p className="mic-hint">{autoListen ? "Auto-listen active" : "Hold mic or hold Space"}</p>
        <button
          className={`auto-btn ${autoListen ? "active" : ""}`}
          onClick={() => { if (state === "thinking") return; setAutoListen(a => !a); }}
          title="Auto-listen: mic stays on, VAD detects speech automatically"
        >
          Auto {autoListen ? "ON" : "OFF"}
        </button>
        <button className={`sub-toggle ${showSubs ? "active" : ""}`} onClick={() => setShowSubs(s => !s)}>
          EN {showSubs ? "ON" : "OFF"}
        </button>
        <button className={`location-btn ${locationState?.permission ? "on" : ""}`} onClick={toggleLocation}>
          Loc {locationState?.permission ? "ON" : "OFF"}
        </button>
      </div>
    );
  }

  return (
    <div className="voice-node">
      {showSubs && subtitle && (
        <div className="subtitle-strip">{subtitle}</div>
      )}

      <div className="voice-messages">
        {messages.map((m, i) => (
          <div key={i} className={`vmsg vmsg-${m.role}`}>
            <span className="vmsg-label">{m.role === "lia" ? "LIA" : "Jashu"}</span>
            <span className="vmsg-text">{m.text}</span>
          </div>
        ))}
      </div>

      <div className={`voice-status voice-status-${state}`}>{stateLabel}</div>

      <button
        className={`mic-btn mic-btn-${state}`}
        onPointerDown={startRecording}
        onPointerUp={stopRecording}
        onPointerLeave={stopRecording}
        disabled={state === "thinking" || autoListen}
        aria-label="Hold to speak"
      >
        {state === "recording" ? <MicActiveIcon /> : <MicIcon />}
      </button>

      <p className="mic-hint">{autoListen ? "Auto-listen active — just speak naturally" : "Hold mic or hold Space"}</p>

      <button
        className={`auto-btn ${autoListen ? "active" : ""}`}
        onClick={() => { if (state === "thinking") return; setAutoListen(a => !a); }}
        title="Auto-listen: mic stays on, VAD auto-detects when you speak and stop"
      >
        Auto-listen {autoListen ? "ON" : "OFF"}
      </button>

      <button className={`sub-toggle ${showSubs ? "active" : ""}`} onClick={() => setShowSubs(s => !s)}>
        EN subtitles {showSubs ? "ON" : "OFF"}
      </button>
      <button className={`location-btn ${locationState?.permission ? "on" : ""}`} onClick={toggleLocation}>
        Location {locationState?.permission ? "ON" : "OFF"}
      </button>
    </div>
  );
}

function createWavBlob(buffers, sampleRate) {
  const input = mergeAudioBuffers(buffers);
  const targetSampleRate = 16000;
  const samples = sampleRate === targetSampleRate
    ? input
    : resampleLinear(input, sampleRate, targetSampleRate);
  const total = samples.length;
  const wav = new ArrayBuffer(44 + total * 2);
  const view = new DataView(wav);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + total * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, targetSampleRate, true);
  view.setUint32(28, targetSampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, total * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([view.buffer], { type: "audio/wav" });
}

function mergeAudioBuffers(buffers) {
  const total = buffers.reduce((sum, b) => sum + b.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const buffer of buffers) {
    merged.set(buffer, offset);
    offset += buffer.length;
  }
  return merged;
}

function resampleLinear(input, fromRate, toRate) {
  if (!input.length || !fromRate || fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const newLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const sourceIndex = i * ratio;
    const left = Math.floor(sourceIndex);
    const right = Math.min(left + 1, input.length - 1);
    const weight = sourceIndex - left;
    output[i] = input[left] * (1 - weight) + input[right] * weight;
  }
  return output;
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function MicIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12v-2h-2z"/>
    </svg>
  );
}
function MicActiveIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2H3v2a9 9 0 0 0 8 8.94V23h2v-2.06A9 9 0 0 0 21 12v-2h-2z"/>
    </svg>
  );
}
