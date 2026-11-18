/**
 * NODE: AnimaSyncNode - GoodGangLabs AnimaSync V1 WASM.
 * Converts TTS audio into VRM mouth/blink expression weights.
 */

let _lipsync = null;
let _ready = false;

const DEFAULT_VRM_NAMES = [
  "aa", "ih", "ou", "ee", "oh",
  "happy", "angry", "sad", "relaxed", "surprised",
  "blink", "blinkLeft", "blinkRight",
  "lookUp", "lookDown", "lookLeft", "lookRight",
  "neutral",
];

const ZERO_FRAME = {
  aa: 0,
  ih: 0,
  ou: 0,
  ee: 0,
  oh: 0,
  blink: 0,
  blinkLeft: 0,
  blinkRight: 0,
};

function clamp01(v) {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

function zeroFrame() {
  return { ...ZERO_FRAME };
}

export async function initAnimaSync() {
  if (_ready) return true;
  try {
    const pkg = "@goodganglabs/lipsync-wasm-v1/lipsync-wasm-wrapper.js";
    const { LipSyncWasmWrapper } = await import(/* @vite-ignore */ pkg);
    _lipsync = new LipSyncWasmWrapper();
    await _lipsync.init({ onProgress: () => {} });
    _ready = true;
    return true;
  } catch (e) {
    console.warn("AnimaSync init skipped, falling back to text/amplitude lip sync:", e.message);
    _lipsync = null;
    _ready = false;
    return false;
  }
}

/**
 * Process an audio blob. Returns AnimaSync's ProcessResult or null.
 */
export async function processAudio(audioBlob) {
  if (!_ready || !_lipsync) return null;
  try {
    const wavBlob = await toWavBlob(audioBlob);
    const file = new File([wavBlob], "lia_voice.wav", { type: "audio/wav" });
    return await _lipsync.processFile(file);
  } catch (e) {
    console.warn("AnimaSync processAudio failed:", e.message);
    return null;
  }
}

async function toWavBlob(audioBlob) {
  if (audioBlob.type === "audio/wav" || audioBlob.type === "audio/wave") {
    return audioBlob;
  }

  const arrayBuffer = await audioBlob.arrayBuffer();
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    return encodeWav(audioBuffer);
  } finally {
    await ctx.close().catch(() => {});
  }
}

function encodeWav(audioBuffer) {
  const sampleRate = audioBuffer.sampleRate;
  const channels = Math.min(2, audioBuffer.numberOfChannels || 1);
  const length = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const channelData = [];
  for (let ch = 0; ch < channels; ch++) channelData.push(audioBuffer.getChannelData(ch));

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < channels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][i] || 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

function getSafeFrameIndex(result, frameIdx) {
  const maxFrame = Math.max(0, (result.frame_count ?? result.frameCount ?? frameIdx + 1) - 1);
  return Math.min(maxFrame, Math.max(0, frameIdx));
}

function mapVrmFrame(result, frameIdx) {
  const names = _lipsync.getVrmExpressionNames?.() ?? DEFAULT_VRM_NAMES;
  const frame = _lipsync.getVrmFrame(result, frameIdx);
  const out = zeroFrame();

  names.forEach((name, i) => {
    if (name in out) out[name] = clamp01(frame[i] ?? 0);
  });

  return out;
}

function mapArkitFrame(result, frameIdx) {
  const frame = _lipsync.getFrame(result, frameIdx);

  // AnimaSync V1 follows ARKit's first 52 names:
  // 8/9 blink, 24 jawOpen, 31 mouthFunnel, 37 mouthPucker, 43/44 smile.
  const jaw = clamp01(frame[24] ?? 0);
  const funnel = clamp01(frame[31] ?? 0);
  const pucker = clamp01(frame[37] ?? 0);
  const smile = Math.max(clamp01(frame[43] ?? 0), clamp01(frame[44] ?? 0));

  return {
    aa: Math.max(0, jaw - funnel * 0.25 - pucker * 0.20),
    ih: Math.max(0, jaw - funnel - pucker) * 0.30,
    ee: smile * 0.20,
    oh: funnel * 0.85,
    ou: pucker * 0.85,
    blink: 0,
    blinkLeft: clamp01(frame[8] ?? 0),
    blinkRight: clamp01(frame[9] ?? 0),
  };
}

/**
 * Get the blendshape frame for a given frame index.
 * Prefer native VRM 18-dim output, then corrected ARKit fallback.
 */
export function getBlendshapesAtFrame(result, frameIdx) {
  if (!_lipsync || !result) return null;
  try {
    const safeFrameIdx = getSafeFrameIndex(result, frameIdx);
    if (result.vrm_blendshapes) return mapVrmFrame(result, safeFrameIdx);
    return mapArkitFrame(result, safeFrameIdx);
  } catch {
    return zeroFrame();
  }
}

export function isReady() {
  return _ready;
}
