// ==============================================================================
// Niramyan-AI — Reference-Style Anime Voice & Expression Engine
//
// Features:
// 1. Dual-Engine TTS:
//    - Primary: Piper Neural TTS (Local ONNX VITS) for soft, youthful, clear anime female voice
//    - Fallback: Apple Siri-class Web Speech API with tuned pitch & zero-gap chunking
// 2. Audio-driven 60fps Lip-Sync with frame-accurate visemes & volume envelope
// 3. Natural eye blinking with artist blink frame every 3–6 seconds
// 4. Always-on ambient microphone with auto-resume and instant interruption
// 5. Complete settings sync with voice_config.json
// ==============================================================================

(() => {
'use strict';

/* ===================================================================
   DOM Elements
   =================================================================== */
const $ = id => document.getElementById(id);
const stage          = $('stage');
const messages       = $('messages');
const input          = $('input');
const form           = $('form');
const sendBtn        = $('send');
const listenBtn      = $('listen');
const stopBtn        = $('stop');
const clearBtn       = $('clear');
const thinkingEl     = $('thinking');
function showThinking(show) {
  if (!thinkingEl) return;
  thinkingEl.hidden = !show;
  thinkingEl.style.display = show ? 'flex' : 'none';
  if (show) {
    thinkingEl.classList.remove('hidden');
  } else {
    thinkingEl.classList.add('hidden');
  }
}
// Ensure hidden on load
showThinking(false);
const voiceStateEl   = $('voiceState');
const voiceStateHint = $('voiceStateHint');
const micLabel       = $('micLabel');
const micRing        = $('micRing');
const statusEl       = $('status');
const modelSelect    = $('modelSelect');
const footerModel    = $('footerModel');
const avatarBubble   = $('avatarBubble');
const moodText       = $('moodText');
const particles      = $('particles');
const handsFreeBtn   = $('handsFreeBtn');
const avatarWrap     = $('avatarWrap');

// Settings modal elements
const settingsDialog   = $('settingsDialog');
const engineSelect     = $('engineSelect');
const piperVoiceGroup  = $('piperVoiceGroup');
const piperVoiceSelect = $('piperVoiceSelect');
const webVoiceGroup    = $('webVoiceGroup');
const voiceSelect      = $('voiceSelect');
const voiceRate        = $('voiceRate');
const rateVal          = $('rateVal');
const voicePitch       = $('voicePitch');
const pitchVal         = $('pitchVal');
const autoBlinkToggle  = $('autoBlinkToggle');
const soundFxToggle    = $('soundFxToggle');
const testVoiceBtn     = $('testVoiceBtn');
const saveSettingsBtn  = $('saveSettingsBtn');
const voiceSettingsBtn = $('voiceSettingsBtn');
const closeSettings    = $('closeSettings');

/* ===================================================================
   Application State
   =================================================================== */
let history          = [];
let busy             = false;
let listening        = false;
let muted            = false;
let currentMood      = 'idle';
let activeLyr        = 'idle';
let currentMode      = 'girlfriend';
let gestureUnlocked  = false;
let recognitionErrors = 0;     // Consecutive error counter (offline detection)
const MAX_REC_ERRORS  = 3;     // Stop retrying after this many consecutive failures

// English Coach State
let ecLevel    = localStorage.getItem('ec_level')    || 'intermediate';
let ecScenario = localStorage.getItem('ec_scenario') || 'free';

// Audio & TTS State
let activeEngine     = 'piper'; // 'piper' or 'webspeech'
let currentAudio     = null;    // HTMLAudioElement for Piper playback
let isSpeaking       = false;
let piperAvailable   = false;
let voiceConfig      = null;

// Web Speech API State
let recognition      = null;
let availVoices      = [];
let webSpeechVoice   = null;
let speechRate       = 1.0;
let speechPitch      = 1.28;
let speakQueue       = [];
let currentUtterance = null;

// Speech Animation & Viseme State
let speechOpenAmount = 0;       // 0.0 to 1.0 smoothed speech amplitude
let audioAmplitudes  = [];      // 50fps array from backend
let audioVisemes     = [];      // 50fps array from backend
let audioFps         = 50;
let enableBlinking   = true;
let enableSoundFx    = true;

// Blinking State Machine
let blinkTimeout     = null;
let isBlinking       = false;

// Avatar Layers Map
const layers = {
  idle : $('img-idle'),
  smile: $('img-smile'),
  laugh: $('img-laugh'),
  talk : $('img-talk'),
  think: $('img-think'),
  blink: $('img-blink'),
};

const MOODS = {
  idle     : { layer: 'idle',  text: 'Ready when you are',      bubble: 'Ready ✨',      glow: '#6c9dff' },
  listening: { layer: 'idle',  text: 'Listening…',              bubble: 'Listening 🎙️', glow: '#73d6ff' },
  thinking : { layer: 'think', text: 'Thinking…',               bubble: 'Thinking 🤔',   glow: '#ab7eff' },
  speaking : { layer: 'talk',  text: 'Speaking…',               bubble: 'Speaking 🗣️',  glow: '#73d6ff' },
  smiling  : { layer: 'smile', text: 'Happy to help! 😊',       bubble: 'Smiling 😊',    glow: '#ff9bc4' },
  laughing : { layer: 'laugh', text: 'Haha! That\'s fun! 😄',   bubble: 'Hahaha! 😄',    glow: '#ff7ebb' },
  cyber    : { layer: 'idle',  text: 'Cyber Security Mode 🛡️', bubble: 'Cyber 🛡️',     glow: '#00f0aa' },
  girlfriend: { layer: 'smile', text: 'Ramya · Loving Companion ❤️', bubble: 'With you ❤️', glow: '#ff7eb3' },
};

/* ===================================================================
   Web Audio Context & Sound Effects
   =================================================================== */
let audioCtx = null;
function getACtx() {
  if (!audioCtx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (C) audioCtx = new C();
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function beep(freqs, type = 'sine', vol = 0.04) {
  if (!enableSoundFx) return;
  try {
    const ctx = getACtx(); if (!ctx) return;
    const now = ctx.currentTime;
    freqs.forEach(([f, t]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f, now + t);
      g.gain.setValueAtTime(vol, now + t);
      g.gain.exponentialRampToValueAtTime(0.001, now + t + 0.18);
      o.connect(g); g.connect(ctx.destination);
      o.start(now + t); o.stop(now + t + 0.20);
    });
  } catch(_) {}
}
const playChime = () => beep([[523, 0], [659, 0.07], [784, 0.14]], 'sine', 0.035);
const playLaugh = () => beep([[370, 0], [494, 0.06], [622, 0.12], [494, 0.18], [740, 0.24]], 'triangle', 0.05);

/* ===================================================================
   Avatar Speech Layer Sync (Natural Anime Visual Novel Animation)
   Smoothly alternates between talk frame (avatar_talk.png) and
   active emotion base frame based on real audio amplitude.
   NO vector canvas mouth drawing.
   =================================================================== */
function lerp(a, b, t) { return a + (b - a) * t; }

function speechLoop() {
  requestAnimationFrame(speechLoop);

  let targetAperture = 0;

  if (isSpeaking) {
    if (activeEngine === 'piper' && currentAudio && !currentAudio.paused && audioAmplitudes.length > 0) {
      const curTime = currentAudio.currentTime;
      const frameIndex = Math.floor(curTime * audioFps);
      if (frameIndex >= 0 && frameIndex < audioAmplitudes.length) {
        targetAperture = audioAmplitudes[frameIndex] || 0;
      }
    } else if (activeEngine === 'webspeech') {
      targetAperture = getWebSpeechAperture();
    }
  }

  // Smooth amplitude transition
  const rate = targetAperture > speechOpenAmount ? 0.45 : 0.20;
  speechOpenAmount = lerp(speechOpenAmount, targetAperture, rate);

  // Toggle between talk frame and base emotion frame cleanly without any drawn mouth
  if (isSpeaking && speechOpenAmount > 0.22 && !isBlinking) {
    if (activeLyr !== 'talk') showLayer('talk');
  } else if (!isBlinking && activeLyr === 'talk' && (!isSpeaking || speechOpenAmount <= 0.15)) {
    const fallbackLayer = MOODS[currentMood]?.layer || 'idle';
    if (activeLyr !== fallbackLayer) showLayer(fallbackLayer);
  }
}

/* ===================================================================
   Natural Eye Blinking Engine
   Toggles avatar_blink.png frame every 3–6 seconds
   =================================================================== */
function triggerBlink() {
  if (!enableBlinking || isBlinking) return;
  isBlinking = true;

  const previousLayer = activeLyr;
  // Activate blink layer
  showLayer('blink');

  // Eyes stay closed for 130ms (natural human blink duration)
  setTimeout(() => {
    isBlinking = false;
    showLayer(previousLayer);
    scheduleNextBlink();
  }, 130);
}

function scheduleNextBlink() {
  if (blinkTimeout) clearTimeout(blinkTimeout);
  if (!enableBlinking) return;
  // Random delay between 2.8 and 5.5 seconds
  const delay = Math.random() * 2700 + 2800;
  blinkTimeout = setTimeout(triggerBlink, delay);
}

/* ===================================================================
   Avatar Mood & Layer Management
   =================================================================== */
function setMood(mood) {
  currentMood = mood;
  const m = MOODS[mood] || MOODS.idle;
  stage.dataset.mood = mood;
  if (moodText) moodText.textContent = m.text;
  if (avatarBubble) avatarBubble.textContent = m.bubble;

  if (!isBlinking) {
    showLayer(m.layer);
  }

  const halo = stage.querySelector('.halo');
  if (halo) halo.style.background = `radial-gradient(circle, ${m.glow}33, transparent 70%)`;
}

function showLayer(name) {
  if (!layers[name]) return;
  Object.keys(layers).forEach(k => {
    if (layers[k]) layers[k].classList.toggle('active', k === name);
  });
  activeLyr = name;
}

function sparkles() {
  if (!particles) return;
  particles.innerHTML = '';
  const colors = ['#ff8bb5', '#8ad8ff', '#ffd166', '#06d6a0', '#c77dff'];
  for (let i = 0; i < 12; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const sz = Math.random() * 12 + 6;
    Object.assign(p.style, {
      width: sz + 'px', height: sz + 'px',
      left: (Math.random() * 70 + 15) + '%',
      top: (Math.random() * 40 + 40) + '%',
      background: colors[i % colors.length],
      boxShadow: `0 0 10px ${colors[i % colors.length]}`,
      animationDelay: (Math.random() * 0.4) + 's'
    });
    particles.appendChild(p);
    setTimeout(() => p.remove(), 2600);
  }
}

/* ===================================================================
   Microphone & Voice Visual State
   =================================================================== */
function setMicState(state) {
  if (micRing) micRing.className = 'mic-ring mic-' + state;
  const labels = {
    idle     : 'Tap mic to speak',
    listening: '🔴 Listening…',
    muted    : '🔇 Muted — tap to unmute',
    speaking : '🔊 Speaking…',
    thinking : '💭 Thinking…',
    offline  : '📡 Offline — mic paused',
  };
  if (micLabel) micLabel.textContent = labels[state] || 'Ready';
  if (voiceStateEl) voiceStateEl.textContent = 'Voice: ' + state;
  if (voiceStateHint) voiceStateHint.textContent = 'Voice: ' + state;
}

/* ===================================================================
   Emoji Stripper — remove all emoji/pictographic chars before TTS
   so the speech engine never reads out emoji names like "movie camera"
   =================================================================== */
function stripEmojis(text) {
  // Covers emoticons, misc symbols, transport, supplemental symbols,
  // dingbats, enclosed chars, ZWJ sequences, variation selectors, etc.
  return text
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '')   // emoticons
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')   // misc symbols & pictographs
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')   // transport & map
    .replace(/[\u{1F700}-\u{1F77F}]/gu, '')   // alchemical
    .replace(/[\u{1F780}-\u{1F7FF}]/gu, '')   // geometric shapes extended
    .replace(/[\u{1F800}-\u{1F8FF}]/gu, '')   // supplemental arrows-c
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')   // supplemental symbols & pictographs
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '')   // chess symbols
    .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '')   // symbols & pictographs extended-a
    .replace(/[\u{2600}-\u{26FF}]/gu,   '')   // misc symbols (☀ ★ etc)
    .replace(/[\u{2700}-\u{27BF}]/gu,   '')   // dingbats
    .replace(/[\u{FE00}-\u{FE0F}]/gu,   '')   // variation selectors
    .replace(/\u200D/g, '')                   // zero-width joiner
    .replace(/\s{2,}/g, ' ')                  // collapse extra spaces
    .trim();
}

/* ===================================================================
   Speech Synthesis — Unified Dual-Engine Dispatcher with Queue
   =================================================================== */
let speechQueue = [];
let speechQueueBusy = false;

function enqueueSpeech(text, expr = 'smile') {
  const clean = stripEmojis(text);
  if (!clean) return;
  speechQueue.push({ text: clean, expr });
  processSpeechQueue();
}

async function processSpeechQueue() {
  if (speechQueueBusy || !speechQueue.length) return;
  speechQueueBusy = true;
  const item = speechQueue.shift();

  if (activeEngine === 'piper' && piperAvailable) {
    const success = await speakPiper(item.text, item.expr);
    if (!success) {
      console.warn('[TTS] Piper fallback to Web Speech');
      speakWebSpeech(item.text, item.expr);
    }
  } else {
    speakWebSpeech(item.text, item.expr);
  }
}

async function speak(text, expr = 'smile') {
  const cleanText = stripEmojis(text);
  if (!cleanText) return;

  // Immediately stop currently playing speech and clear queue
  stopSpeaking();
  enqueueSpeech(cleanText, expr);
}

function stopSpeaking() {
  speechQueue = [];
  speechQueueBusy = false;

  // Stop Piper Audio
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }

  // Stop Web Speech
  if ('speechSynthesis' in window) {
    speechSynthesis.cancel();
  }

  isSpeaking       = false;
  speakQueue       = [];
  audioAmplitudes  = [];
  audioVisemes     = [];
  speechOpenAmount = 0;

  const vb = $('voiceBars');
  if (vb) vb.style.opacity = '0';

  setMicState('idle');
  setMood('idle');
  showLayer(MOODS[currentMood]?.layer || 'idle');
}

/* ===================================================================
   Startup Welcome Greeting
   =================================================================== */
const WELCOME_TEXT = "Hello! I'm Ramya, your local cyber security mentor and English coach. What would you like to explore today? 🛡️✨";
let welcomeSpoken = false;

async function playWelcomeGreeting() {
  if (welcomeSpoken) return;
  welcomeSpoken = true;

  try {
    if (!voiceConfig) {
      await loadVoiceConfig();
    }
    await speak(WELCOME_TEXT, 'smile');
  } catch (e) {
    console.warn('[Greeting] Autoplay postponed until user gesture:', e);
    welcomeSpoken = false;
  }
}

/* --- Engine 1: Piper Neural TTS --- */
async function speakPiper(text, expr) {
  setMicState('speaking');
  applyMoodForExpression(expr);

  const vb = $('voiceBars');
  if (vb) vb.style.opacity = '1';

  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text,
        voice: piperVoiceSelect ? piperVoiceSelect.value : undefined
      })
    });

    const data = await res.json();
    if (!data.ok || !data.audio_url) {
      return false;
    }

    // Playback
    isSpeaking       = true;
    audioAmplitudes  = data.amplitudes || [];
    audioVisemes     = data.visemes || [];
    audioFps         = data.fps || 50;

    const audio = new Audio(data.audio_url);
    currentAudio = audio;

    audio.onended = () => {
      onSpeechComplete();
    };

    audio.onerror = (e) => {
      console.error('[Piper] Audio playback error:', e);
      onSpeechComplete();
    };

    try {
      await audio.play();
      gestureUnlocked = true;
      return true;
    } catch (playErr) {
      console.warn('[Piper] Audio play prevented by browser policy (awaiting user gesture):', playErr);
      isSpeaking = false;
      return false;
    }

  } catch(err) {
    console.error('[Piper] Request failed:', err);
    return false;
  }
}

/* --- Engine 2: Siri-Class Web Speech API Fallback --- */
let phonemePattern = null;
let phonemeStart = 0;

function speakWebSpeech(text, expr) {
  if (!('speechSynthesis' in window)) return;

  applyMoodForExpression(expr);
  setMicState('speaking');

  const vb = $('voiceBars');
  if (vb) vb.style.opacity = '1';

  speakQueue = splitSentencesForWebSpeech(text, 160);
  if (!speakQueue.length) return;

  isSpeaking = true;
  playNextWebSpeechChunk(expr);
}

function playNextWebSpeechChunk(expr) {
  if (!speakQueue.length) {
    onSpeechComplete();
    return;
  }

  const chunk = speakQueue.shift();
  const u = new SpeechSynthesisUtterance(chunk);

  u.rate   = speechRate;
  u.pitch  = speechPitch;
  u.lang   = 'en-US';
  u.volume = 1.0;
  if (webSpeechVoice) u.voice = webSpeechVoice;

  currentUtterance = u;
  let startFired = false;
  let stallWatchdog = null;

  u.onstart = () => {
    startFired = true;
    clearTimeout(stallWatchdog);
    startWebSpeechPhonemes(chunk);
  };

  u.onboundary = (e) => {
    if (e.name === 'word' && e.charIndex !== undefined) {
      phonemeStart = performance.now() - (e.elapsedTime || 0) * 1000;
    }
  };

  const finalize = (e) => {
    clearTimeout(stallWatchdog);
    currentUtterance = null;
    if (e && e.type === 'error' && e.error === 'canceled') return;
    playNextWebSpeechChunk(expr);
  };

  u.onend   = finalize;
  u.onerror = finalize;

  // Linux Chrome stall watchdog
  stallWatchdog = setTimeout(() => {
    if (!startFired) {
      speechSynthesis.cancel();
      setTimeout(() => {
        speakQueue.unshift(chunk);
        playNextWebSpeechChunk(expr);
      }, 120);
    }
  }, 750);

  speechSynthesis.speak(u);
}

function startWebSpeechPhonemes(text) {
  const syllables = text.replace(/[^a-zA-Z ]/g, '').split(/\s+/)
    .map(w => Math.max(1, w.split(/[aeiou]/i).length - 1));
  const pattern = [];
  let t = 0;
  const avgDur = 200;
  for (const syl of syllables) {
    for (let s = 0; s < syl; s++) {
      pattern.push({ t: t, open: 0.18 });
      pattern.push({ t: t + avgDur * 0.35, open: 0.75 });
      pattern.push({ t: t + avgDur * 0.75, open: 0.18 });
      t += avgDur;
    }
    t += 50;
  }
  pattern.push({ t: t, open: 0 });
  phonemePattern = pattern;
  phonemeStart   = performance.now();
}

function getWebSpeechAperture() {
  if (!phonemePattern || !phonemePattern.length) return 0;
  const elapsed = performance.now() - phonemeStart;
  if (elapsed >= phonemePattern[phonemePattern.length - 1].t) return 0;

  let before = phonemePattern[0], after = phonemePattern[0];
  for (let i = 0; i < phonemePattern.length - 1; i++) {
    if (phonemePattern[i].t <= elapsed && phonemePattern[i + 1].t >= elapsed) {
      before = phonemePattern[i];
      after  = phonemePattern[i + 1];
      break;
    }
  }
  const frac = after.t > before.t ? (elapsed - before.t) / (after.t - before.t) : 0;
  return lerp(before.open, after.open, Math.sin(frac * Math.PI * 0.5));
}

function splitSentencesForWebSpeech(text, maxLen = 160) {
  const clean = text
    .replace(/\[(smile|laugh|think|cyber|english|idle|surprised)\]/gi, '')
    .replace(/\*\*/g, '').replace(/`+/g, '')
    .replace(/#{1,6}\s/g, '').replace(/_/g, '')
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/\s+/g, ' ').trim();

  if (clean.length <= maxLen) return [clean];

  const sentences = clean.match(/[^.!?]+[.!?]+\s*/g) || [clean];
  const chunks = [];
  let current = '';

  for (const s of sentences) {
    if ((current + s).length <= maxLen) {
      current += s;
    } else {
      if (current.trim()) chunks.push(current.trim());
      if (s.length > maxLen) {
        const parts = s.split(/[,;]\s+/);
        let sub = '';
        for (const p of parts) {
          if ((sub + p).length <= maxLen) sub += (sub ? ', ' : '') + p;
          else { if (sub.trim()) chunks.push(sub.trim()); sub = p; }
        }
        if (sub.trim()) chunks.push(sub.trim());
        current = '';
      } else {
        current = s;
      }
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

function applyMoodForExpression(expr) {
  if (expr === 'laugh') {
    setMood('laughing'); sparkles(); playLaugh();
  } else if (expr === 'cyber') {
    setMood('cyber');
  } else if (expr === 'think') {
    setMood('thinking');
  } else if (expr === 'smile' || expr === 'english') {
    setMood('smiling');
  } else {
    setMood('speaking');
  }
}

function onSpeechComplete() {
  speechQueueBusy = false;
  if (speechQueue.length > 0) {
    processSpeechQueue();
    return;
  }

  isSpeaking       = false;
  currentAudio     = null;
  audioAmplitudes  = [];
  audioVisemes     = [];
  speechOpenAmount = 0;

  const vb = $('voiceBars');
  if (vb) vb.style.opacity = '0';

  setMicState('idle');
  setMood('idle');
  showLayer(MOODS[currentMood]?.layer || 'idle');

  // Ambient Always-On Mic auto-resume
  if (!muted && recognition && !busy) {
    setTimeout(() => safeStartRecognition(), 400);
  }
}

/* ===================================================================
   Speech Recognition (STT) — Always-on Ambient Microphone
   =================================================================== */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

/** Safely start speech recognition — skips if offline or error-throttled */
function safeStartRecognition() {
  if (!recognition || muted || busy || isSpeaking || listening) return;
  if (!navigator.onLine) {
    recognitionErrors = MAX_REC_ERRORS;
    setMicState('offline');
    return;
  }
  if (recognitionErrors >= MAX_REC_ERRORS) {
    setMicState('offline');
    return;
  }
  try { recognition.start(); } catch(_) {}
}

function initRecognition() {
  if (!SR) return;
  recognition = new SR();
  recognition.lang            = 'en-US';
  recognition.continuous      = false;
  recognition.interimResults  = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    listening = true;
    recognitionErrors = 0;  // Reset — we're online and working
    setMicState('listening');
    setMood('listening');
  };

  recognition.onresult = (e) => {
    let t = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      t += e.results[i][0].transcript;
    }
    input.value = t;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 130) + 'px';
  };

  recognition.onerror = (e) => {
    listening = false;
    if (e.error === 'not-allowed') {
      muted = true;
      setMicState('muted');
      addMsg('assistant', '⚠️ Microphone blocked. Click the lock icon in your browser address bar → allow microphone permissions, then refresh.');
      return;
    }
    // Track consecutive errors (network failures when offline)
    recognitionErrors++;
    if (recognitionErrors >= MAX_REC_ERRORS) {
      // Too many consecutive failures — likely offline
      setMicState('offline');
      setMood('idle');
      console.warn('[STT] Mic paused — too many consecutive errors (offline?).');
      return; // STOP retrying — onOnlineResume() will restart
    }
    if (!muted && !busy && !isSpeaking) {
      setTimeout(() => safeStartRecognition(), 350);
    }
  };

  recognition.onend = () => {
    listening = false;
    const t = input.value.trim();

    if (t && !busy) {
      input.value = '';
      input.style.height = 'auto';
      send(t);
    } else if (recognitionErrors >= MAX_REC_ERRORS) {
      // Offline — don't retry, stay in offline state
      setMicState('offline');
    } else if (!muted && !busy && !isSpeaking) {
      setMicState('idle');
      setTimeout(() => safeStartRecognition(), 200);
    } else {
      setMicState('idle');
    }
  };
}

initRecognition();

// Auto-resume mic when connectivity is restored
window.addEventListener('online', () => {
  console.log('[STT] Network restored — resuming mic.');
  recognitionErrors = 0;
  if (!muted && recognition && !listening && !busy && !isSpeaking) {
    setMicState('idle');
    setTimeout(() => safeStartRecognition(), 500);
  }
});
window.addEventListener('offline', () => {
  console.log('[STT] Network lost — pausing mic.');
  if (recognition && listening) {
    try { recognition.stop(); } catch(_) {}
  }
  recognitionErrors = MAX_REC_ERRORS; // Prevent retry loop
  setMicState('offline');
  setMood('idle');
});

// Unlock browser audio & mic on first user interaction
function unlockAll() {
  const wasUnlocked = gestureUnlocked;
  gestureUnlocked = true;

  getACtx();

  if ('speechSynthesis' in window) {
    const silent = new SpeechSynthesisUtterance('');
    speechSynthesis.speak(silent);
    speechSynthesis.cancel();
    loadWebVoices();
  }

  // Play welcome greeting if it hasn't played yet (e.g. was postponed by browser autoplay policy)
  if (!welcomeSpoken) {
    playWelcomeGreeting();
  } else if (!wasUnlocked && !muted && recognition && !listening && !isSpeaking) {
    setTimeout(() => safeStartRecognition(), 300);
  }
}

document.addEventListener('click',   unlockAll, { once: true });
document.addEventListener('keydown', unlockAll, { once: true });

// Listen button toggle
if (listenBtn) {
  listenBtn.onclick = () => {
    unlockAll();
    if (muted) {
      muted = false;
      listenBtn.style.opacity = '1';
      setMicState('idle');
      if (recognition) { recognitionErrors = 0; safeStartRecognition(); }
    } else {
      muted = true;
      if (recognition && listening) recognition.stop();
      stopSpeaking();
      listening = false;
      listenBtn.style.opacity = '0.4';
      setMicState('muted');
      setMood('idle');
    }
  };
}

// Stop button — instant speech & listening cancellation
if (stopBtn) {
  stopBtn.onclick = () => {
    stopSpeaking();
    if (recognition && listening) recognition.stop();
    listening = false;
    setMicState('idle');
    setMood('idle');
    if (!muted && recognition) {
      setTimeout(() => safeStartRecognition(), 350);
    }
  };
}

if (handsFreeBtn) {
  handsFreeBtn.onclick = () => {
    unlockAll();
    muted = !muted;
    handsFreeBtn.textContent = muted ? '🎧 Hands-Free: Off' : '🎧 Hands-Free: Active';
    handsFreeBtn.classList.toggle('active', !muted);
    if (!muted && recognition && !listening) {
      recognitionErrors = 0;
      safeStartRecognition();
    }
  };
}

/* ===================================================================
   Web Voices Discovery & Prioritization
   =================================================================== */
function pickBestWebVoice(voices) {
  const PREF = [
    /google uk english female/i,
    /google us english/i,
    /samantha/i,
    /victoria/i,
    /karen/i,
    /moira/i,
    /aria/i,
    /jenny/i,
    /zira/i,
    /google.*english/i,
    /female/i,
  ];
  for (const re of PREF) {
    const v = voices.find(v => re.test(v.name));
    if (v) return v;
  }
  return voices.find(v => /en[-_]/i.test(v.lang)) || voices[0] || null;
}

function loadWebVoices() {
  if (!('speechSynthesis' in window)) return;
  const raw = speechSynthesis.getVoices();
  if (!raw.length) return;
  availVoices = raw;
  webSpeechVoice = pickBestWebVoice(availVoices);

  if (voiceSelect) {
    voiceSelect.innerHTML = '';
    availVoices.forEach((v, i) => {
      const o = document.createElement('option');
      o.value = i;
      o.textContent = `${v.name} (${v.lang})`;
      o.selected = (v === webSpeechVoice);
      voiceSelect.appendChild(o);
    });
  }
}

if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = loadWebVoices;
  loadWebVoices();
  setTimeout(loadWebVoices, 300);
  setTimeout(loadWebVoices, 1000);
}

/* ===================================================================
   Messages & Chat UI
   =================================================================== */
function formatMsgText(text) {
  let html = esc(text);
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  // Auto-hyperlink URLs
  html = html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="chat-inline-link">$1</a>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

function addMsg(role, text, expr = null, actionUrl = null, actionTitle = null, actionType = null, contactName = null) {
  const d = document.createElement('div');
  d.className = 'msg ' + (role === 'user' ? 'user' : '');

  const badge = document.createElement('div');
  badge.className = 'badge';
  badge.textContent = role === 'user' ? 'Y' : 'N';

  const body = document.createElement('div');
  body.className = 'msg-body';

  const hdr = document.createElement('small');
  const em = { laugh: '😄', smile: '😊', cyber: '🛡️', english: '🎓', think: '🤔' };
  hdr.textContent = (role === 'user' ? 'You' : 'Ramya') + (expr && em[expr] ? ' ' + em[expr] : '') + ' · now';

  const p = document.createElement('p');
  p.innerHTML = formatMsgText(text);

  body.append(hdr, p);

  if (actionUrl) {
    const link = document.createElement('a');
    link.href = actionUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    
    if (actionType === 'whatsapp' || actionUrl.includes('whatsapp.com')) {
      link.className = 'wa-link-btn';
      if (contactName) {
        link.innerHTML = `💬 Open WhatsApp: Message to ${esc(contactName)}`;
      } else {
        link.innerHTML = '💬 Open in WhatsApp Web';
      }
    } else {
      link.className = 'yt-link-btn';
      const isPlaying = actionUrl.includes('watch?v=');
      if (isPlaying) {
        link.innerHTML = actionTitle ? `▶ Now Playing: ${esc(actionTitle)}` : '▶ Now Playing on YouTube';
      } else {
        link.innerHTML = '🔍 Open YouTube Search';
      }
    }
    body.appendChild(link);
  }

  d.append(badge, body);
  messages.append(d);
  messages.scrollTop = messages.scrollHeight;
  return { root: d, body, hdr, p };
}

function addMsgStreaming(role) {
  const d = document.createElement('div');
  d.className = 'msg ' + (role === 'user' ? 'user' : '');

  const badge = document.createElement('div');
  badge.className = 'badge';
  badge.textContent = role === 'user' ? 'Y' : 'N';

  const body = document.createElement('div');
  body.className = 'msg-body';

  const hdr = document.createElement('small');
  hdr.textContent = (role === 'user' ? 'You' : 'Ramya 😊') + ' · now';

  const p = document.createElement('p');
  p.innerHTML = '<span class="typing-cursor">▊</span>';

  body.append(hdr, p);
  d.append(badge, body);
  messages.append(d);
  messages.scrollTop = messages.scrollHeight;
  return { root: d, body, hdr, p };
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/* ===================================================================
   Send / Chat Pipeline — Streaming SSE with Early Voice Synthesis
   =================================================================== */
async function send(text) {
  text = text.trim();
  if (!text || busy) return;
  unlockAll();

  if (recognition && listening) recognition.stop();

  addMsg('user', text);
  history.push({ role: 'user', content: text });
  input.value = '';
  input.style.height = 'auto';

  busy = true;
  sendBtn.disabled = true;
  showThinking(true);
  setMicState('thinking');
  setMood('thinking');

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify({
        messages: history,
        mode: currentMode,
        model: modelSelect ? modelSelect.value : undefined,
        ec_level: ecLevel,
        ec_scenario: ecScenario,
        stream: true
      })
    });

    const contentType = res.headers.get('content-type') || '';

    // Handle instant JSON responses (YouTube, WhatsApp, App Launch, Mode Switch, Errors)
    if (!contentType.includes('text/event-stream')) {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Server error');

      showThinking(false);
      sendBtn.disabled = false;
      busy = false;

      const answer = data.answer || '';
      const expr   = data.expression || 'smile';
      const actionUrl = data.url || null;
      const actionTitle = data.title || null;
      const actionType = data.action || null;
      const contactName = data.contact || null;

      history.push({ role: 'assistant', content: data.raw_answer || answer });
      addMsg('assistant', answer, expr, actionUrl, actionTitle, actionType, contactName);

      if (data.new_mode && data.new_mode !== currentMode) {
        const targetChip = document.querySelector(`.mode-chip[data-mode="${data.new_mode}"]`);
        if (targetChip) targetChip.click();
      }
      if (data.ec_level && ecLevelSelect) {
        ecLevel = data.ec_level;
        ecLevelSelect.value = ecLevel;
        localStorage.setItem('ec_level', ecLevel);
      }
      if (data.ec_scenario && ecScenarioSelect) {
        ecScenario = data.ec_scenario;
        ecScenarioSelect.value = ecScenario;
        localStorage.setItem('ec_scenario', ecScenario);
      }

      speak(answer, expr);
      return;
    }

    // Handle Server-Sent Events (SSE) Streaming
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let streamMsg = null;
    let fullRaw = '';
    let displayedText = '';
    let detectedExpr = 'smile';
    let sentence1Spoken = false;
    let sentence1Text = '';
    let buffer = '';

    const emMap = { laugh: '😄', smile: '😊', cyber: '🛡️', english: '🎓', think: '🤔' };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop(); // keep remainder

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        let payload;
        try {
          payload = JSON.parse(trimmed.slice(5).trim());
        } catch (_) {
          continue;
        }

        if (payload.error) {
          throw new Error(payload.error);
        }

        // On FIRST token: immediately hide thinking indicator and show bubble
        if (payload.token && !streamMsg) {
          showThinking(false);
          streamMsg = addMsgStreaming('assistant');
        }

        if (payload.token) {
          fullRaw += payload.token;

          // Check for initial emotion tag e.g. [smile]
          let textToShow = fullRaw;
          const tagMatch = fullRaw.match(/^\[(smile|laugh|think|cyber|english)\]\s*/i);
          if (tagMatch) {
            detectedExpr = tagMatch[1].toLowerCase();
            textToShow = fullRaw.slice(tagMatch[0].length);
            if (streamMsg) {
              streamMsg.hdr.textContent = 'Ramya ' + (emMap[detectedExpr] || '😊') + ' · now';
              applyMoodForExpression(detectedExpr);
            }
          }

          displayedText = textToShow;
          if (streamMsg) {
            streamMsg.p.innerHTML = formatMsgText(displayedText) + '<span class="typing-cursor">▊</span>';
            messages.scrollTop = messages.scrollHeight;
          }

          // Early TTS: synthesize Sentence 1 as soon as first punctuation arrives
          if (!sentence1Spoken && displayedText.length >= 12) {
            const sm = displayedText.match(/^([^.!?\n]+[.!?])(?:\s+|$)/);
            if (sm && sm[1].trim().length >= 10) {
              sentence1Spoken = true;
              sentence1Text = sm[1].trim();
              enqueueSpeech(sentence1Text, detectedExpr);
            }
          }
        }

        if (payload.done) {
          showThinking(false);
          sendBtn.disabled = false;
          busy = false;

          const finalAnswer = payload.answer || displayedText || '';
          const expr = payload.expression || detectedExpr || 'smile';

          if (streamMsg) {
            streamMsg.p.innerHTML = formatMsgText(finalAnswer);
            streamMsg.hdr.textContent = 'Ramya ' + (emMap[expr] || '😊') + ' · now';

            if (payload.url) {
              const link = document.createElement('a');
              link.href = payload.url;
              link.target = '_blank';
              link.rel = 'noopener noreferrer';
              link.className = 'wa-link-btn';
              link.innerHTML = '🔗 Open Link';
              streamMsg.body.appendChild(link);
            }
            messages.scrollTop = messages.scrollHeight;
          }

          history.push({ role: 'assistant', content: payload.raw_answer || finalAnswer });

          // Queue remaining speech after sentence 1
          if (sentence1Spoken) {
            const remainder = finalAnswer.slice(sentence1Text.length).trim();
            if (remainder.length > 3) {
              enqueueSpeech(remainder, expr);
            }
          } else if (finalAnswer) {
            enqueueSpeech(finalAnswer, expr);
          }
        }
      }
    }

  } catch(err) {
    showThinking(false);
    sendBtn.disabled = false;
    busy = false;
    addMsg('assistant', `⚠️ ${err.message}\n\nPlease verify Ollama is running: ollama serve`);
    setMood('idle');
    setMicState('idle');
    if (!muted && recognition) {
      setTimeout(() => safeStartRecognition(), 500);
    }
  }
}

form.onsubmit = e => { e.preventDefault(); send(input.value); };
input.onkeydown = e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
};
input.oninput = () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 130) + 'px';
};

clearBtn.onclick = () => {
  history = [];
  messages.innerHTML = '';
  addMsg('assistant', 'Fresh start! 😊 What would you like to explore?');
  stopSpeaking();
  setMood('idle');
};

/* ===================================================================
   Topic Pills & Learning Modes
   =================================================================== */
const MODE_PILLS = {
  girlfriend: [
    { label: "💬 How was your day?", prompt: "How was your day, Ramya? What did you do today?" },
    { label: "❤️ Do you love me?", prompt: "Do you love me?" },
    { label: "🎵 Play a relaxing song", prompt: "Open youtube and play a relaxing song" },
    { label: "📱 Open WhatsApp", prompt: "Open WhatsApp" },
  ],
  cyber: [
    { label: "🌐 TCP Handshake", prompt: "Explain TCP 3-way handshake in 2 simple sentences!" },
    { label: "💉 SQL Injection", prompt: "What is SQL Injection and how to prevent it?" },
    { label: "🐧 Kali Commands", prompt: "Teach me 3 essential Kali Linux terminal commands." },
    { label: "🎯 Cyber Quiz", prompt: "Quiz me on ethical hacking concepts!" },
  ],
  english: [
    { label: "🗣️ Daily Conversation", prompt: "Hey Ramya! How's your day going? Let's have a chat." },
    { label: "👔 Job Interview", prompt: "Let's practice a job interview conversation." },
    { label: "💡 Learn Vocabulary", prompt: "Teach me one useful English vocabulary word with an example sentence!" },
    { label: "📊 Today's Progress", prompt: "How is my English progress today?" },
  ],
  quiz: [
    { label: "🎯 Quiz Me", prompt: "Give me an interactive quiz question!" },
    { label: "🛡️ Cyber Quiz", prompt: "Give me a challenging cybersecurity quiz question!" },
    { label: "🎓 English Quiz", prompt: "Give me an English grammar quiz question!" },
    { label: "💡 Explain Answer", prompt: "Explain the answer to that quiz question in simple terms." },
  ]
};

function renderTopicPills(mode) {
  const container = $('topicSuggestions');
  if (!container) return;
  const pills = MODE_PILLS[mode] || MODE_PILLS.girlfriend;
  container.innerHTML = '';
  pills.forEach(p => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'topic-pill';
    btn.textContent = p.label;
    btn.dataset.prompt = p.prompt;
    btn.onclick = () => send(p.prompt);
    container.appendChild(btn);
  });
}

document.querySelectorAll('.mode-chip').forEach(chip => {
  chip.onclick = () => {
    document.querySelectorAll('.mode-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentMode = chip.dataset.mode;
    playChime();
    renderTopicPills(currentMode);
    if (currentMode === 'cyber') setMood('cyber');
    else if (currentMode === 'english') {
      setMood('smiling');
      showEnglishToolbar(true);
      // Auto-start a session when English mode is selected
      fetch('/api/english/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: ecLevel })
      }).catch(() => {});
    } else {
      showEnglishToolbar(false);
      if (currentMode === 'girlfriend') setMood('girlfriend');
      else setMood('idle');
    }
  };
});

/* ===================================================================
   English Coach Toolbar — level + scenario controls
   =================================================================== */
function showEnglishToolbar(show) {
  const bar = $('englishToolbar');
  if (bar) bar.style.display = show ? 'flex' : 'none';
}

// Level selector
const ecLevelSelect = $('ecLevelSelect');
if (ecLevelSelect) {
  ecLevelSelect.value = ecLevel;
  ecLevelSelect.onchange = () => {
    ecLevel = ecLevelSelect.value;
    localStorage.setItem('ec_level', ecLevel);
    fetch('/api/english/pref', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'level', value: ecLevel })
    }).catch(() => {});
    addMsg('assistant', `[english] Level set to ${ecLevel.charAt(0).toUpperCase() + ecLevel.slice(1)}! Let's adjust our conversation accordingly.`);
  };
}

// Scenario selector
const ecScenarioSelect = $('ecScenarioSelect');
if (ecScenarioSelect) {
  ecScenarioSelect.value = ecScenario;
  ecScenarioSelect.onchange = () => {
    ecScenario = ecScenarioSelect.value;
    localStorage.setItem('ec_scenario', ecScenario);
    const labels = {
      free: 'Free Conversation',
      job_interview: 'Job Interview',
      restaurant: 'Restaurant',
      shopping: 'Shopping',
      travel: 'Travel',
      college: 'College Life',
      friends: 'Talking with Friends',
      self_intro: 'Self Introduction',
      workplace: 'Workplace',
    };
    const label = labels[ecScenario] || ecScenario;
    send(`Let's practice a ${label} conversation.`);
  };
}

// Progress button
const ecProgressBtn = $('ecProgressBtn');
if (ecProgressBtn) {
  ecProgressBtn.onclick = async () => {
    try {
      const res = await fetch('/api/english/summary');
      const data = await res.json();
      const spoken = data.spoken || "No data yet. Start practicing!";
      addMsg('assistant', spoken, 'english');
      speak(spoken, 'english');
    } catch(e) {
      addMsg('assistant', "Couldn't load progress right now. Keep practicing!");
    }
  };
}

/* ===================================================================
   Settings Modal & Voice Configuration Sync
   =================================================================== */
async function loadVoiceConfig() {
  try {
    const res = await fetch('/api/voice/config');
    const cfg = await res.json();
    voiceConfig = cfg;
    piperAvailable = !!cfg.piper_available;

    activeEngine = cfg.active_engine || (piperAvailable ? 'piper' : 'webspeech');
    if (engineSelect) engineSelect.value = activeEngine;

    // Piper voice
    if (piperVoiceSelect && cfg.piper?.selected_voice) {
      piperVoiceSelect.value = cfg.piper.selected_voice;
    }

    // Sliders
    if (voiceRate && cfg.web_speech?.rate) {
      speechRate = cfg.web_speech.rate;
      voiceRate.value = speechRate;
      if (rateVal) rateVal.textContent = speechRate + 'x';
    }
    if (voicePitch && cfg.web_speech?.pitch) {
      speechPitch = cfg.web_speech.pitch;
      voicePitch.value = speechPitch;
      if (pitchVal) pitchVal.textContent = speechPitch;
    }

    updateSettingsVisibility();

  } catch(e) {
    console.warn('[Config] Failed to load voice config from server:', e);
  }
}

function updateSettingsVisibility() {
  const isPiper = (engineSelect && engineSelect.value === 'piper');
  if (piperVoiceGroup) piperVoiceGroup.style.display = isPiper ? 'block' : 'none';
  if (webVoiceGroup)   webVoiceGroup.style.display   = isPiper ? 'none' : 'block';
}

if (engineSelect) {
  engineSelect.onchange = () => {
    activeEngine = engineSelect.value;
    updateSettingsVisibility();
  };
}

if (voiceRate) {
  voiceRate.oninput = e => {
    speechRate = parseFloat(e.target.value);
    if (rateVal) rateVal.textContent = speechRate + 'x';
  };
}

if (voicePitch) {
  voicePitch.oninput = e => {
    speechPitch = parseFloat(e.target.value);
    if (pitchVal) pitchVal.textContent = speechPitch;
  };
}


if (autoBlinkToggle) {
  autoBlinkToggle.onchange = e => {
    enableBlinking = e.target.checked;
    if (enableBlinking) scheduleNextBlink();
    else if (blinkTimeout) clearTimeout(blinkTimeout);
  };
}

if (soundFxToggle) {
  soundFxToggle.onchange = e => {
    enableSoundFx = e.target.checked;
  };
}

if (testVoiceBtn) {
  testVoiceBtn.onclick = () => {
    stopSpeaking();
    speak("Hi! I'm Niramyan, your anime cyber security and English assistant. Welcome!", 'smile');
  };
}

if (saveSettingsBtn) {
  saveSettingsBtn.onclick = async () => {
    activeEngine = engineSelect ? engineSelect.value : 'piper';
    if (voiceSelect && availVoices[voiceSelect.value]) {
      webSpeechVoice = availVoices[voiceSelect.value];
    }

    // Persist to backend
    try {
      await fetch('/api/voice/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          active_engine: activeEngine,
          piper: {
            selected_voice: piperVoiceSelect ? piperVoiceSelect.value : 'en_US-hfc_female-medium',
            length_scale: 1.0 / speechRate
          },
          web_speech: {
            rate: speechRate,
            pitch: speechPitch
          },
          animation: {
            sound_fx_enabled: enableSoundFx
          }
        })
      });
    } catch(_) {}

    settingsDialog.close();
  };
}

/* ===================================================================
   WhatsApp Contacts Management
   =================================================================== */
async function loadContactsUI() {
  const list = $('contactsList');
  if (!list) return;
  try {
    const res = await fetch('/api/contacts');
    const data = await res.json();
    const contacts = data.contacts || {};
    list.innerHTML = '';
    const keys = Object.keys(contacts);
    if (keys.length === 0) {
      list.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:4px 0;">No saved contacts yet.</div>';
      return;
    }
    keys.forEach(k => {
      const item = document.createElement('div');
      item.className = 'contact-item';
      item.innerHTML = `
        <span><b>${esc(k.charAt(0).toUpperCase() + k.slice(1))}</b> <small>+${esc(contacts[k])}</small></span>
        <button type="button" class="contact-del-btn" title="Delete contact" data-name="${esc(k)}">✕</button>
      `;
      item.querySelector('.contact-del-btn').onclick = async () => {
        await fetch('/api/contacts', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: k })
        });
        loadContactsUI();
      };
      list.appendChild(item);
    });
  } catch(e) {
    console.warn('[Contacts] Failed to load:', e);
  }
}

const addContactBtn = $('addContactBtn');
if (addContactBtn) {
  addContactBtn.onclick = async () => {
    const nameIn = $('newContactName');
    const phoneIn = $('newContactPhone');
    const name = nameIn ? nameIn.value.trim() : '';
    const phone = phoneIn ? phoneIn.value.trim() : '';
    if (!name || !phone) return;
    try {
      await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone })
      });
      if (nameIn) nameIn.value = '';
      if (phoneIn) phoneIn.value = '';
      loadContactsUI();
    } catch(e) {
      console.warn('[Contacts] Failed to add:', e);
    }
  };
}

if (voiceSettingsBtn) voiceSettingsBtn.onclick = () => {
  loadVoiceConfig();
  loadContactsUI();
  settingsDialog.showModal();
};
if (closeSettings) closeSettings.onclick = () => settingsDialog.close();

/* ===================================================================
   Health Check & Model Polling
   =================================================================== */
async function checkHealth() {
  try {
    const data = await fetch('/api/health').then(r => r.json());
    piperAvailable = !!data.piper_available;

    if (data.available_models?.length) {
      if (modelSelect.children.length <= 1 || modelSelect.options[0]?.value === 'CURRENT_MODEL') {
        modelSelect.innerHTML = '';
        data.available_models.forEach(m => {
          const o = document.createElement('option');
          o.value = m; o.textContent = m; o.selected = (m === data.model);
          modelSelect.appendChild(o);
        });
      }
    }
    if (footerModel) footerModel.textContent = data.model || '—';

    if (data.ollama && data.model_available) {
      statusEl.textContent = '● Ollama Connected' + (piperAvailable ? ' · 🌸 Neural Voice' : '');
      statusEl.className = 'status ok';
      const dot = $('onlineDot');
      if (dot) dot.style.cssText = 'background:#67e9bc;box-shadow:0 0 12px #67e9bc';
    } else {
      statusEl.textContent = data.ollama ? 'Model not found' : 'Ollama Offline';
      statusEl.className = 'status';
      const dot = $('onlineDot');
      if (dot) dot.style.cssText = 'background:#f87171;box-shadow:0 0 12px #f87171';
    }
  } catch(_) {
    statusEl.textContent = 'Backend Offline';
    statusEl.className = 'status';
  }
}

if (modelSelect) {
  modelSelect.onchange = async () => {
    try {
      await fetch('/api/model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelSelect.value })
      });
      if (footerModel) footerModel.textContent = modelSelect.value;
    } catch(_) {}
  };
}

/* ===================================================================
   Preload Assets & Initialization
   =================================================================== */
['/static/avatar.png', '/static/avatar_smile.png', '/static/avatar_laugh.png',
 '/static/avatar_talk.png', '/static/avatar_think.png', '/static/avatar_blink.png']
.forEach(s => { const i = new Image(); i.src = s; });

checkHealth();
setInterval(checkHealth, 15000);
loadVoiceConfig().then(() => {
  // Automatically speak welcome greeting when project starts
  setTimeout(() => {
    playWelcomeGreeting();
  }, 400);
});
setMood('idle');
setMicState('idle');
renderTopicPills(currentMode);
showEnglishToolbar(currentMode === 'english');

window.addEventListener('load', () => {
  speechLoop();
  scheduleNextBlink();
});

if (document.readyState === 'complete') {
  speechLoop();
  scheduleNextBlink();
}

})();
