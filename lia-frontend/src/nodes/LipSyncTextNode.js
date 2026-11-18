/**
 * NODE: LipSyncTextNode — English text → timed VRM viseme sequence
 * Inspired by TalkingHead lipsync-en approach (phoneme timing from text).
 * Used as fallback when AnimaSync WASM is unavailable.
 */

// Average ms per viseme
const BASE_MS = 62;

// Two-letter combos → VRM viseme
const DIGRAPH = {
  th: "ih", ch: "oh", sh: "ih", ph: null,
  wh: "ou", oo: "ou", ou: "oh", ow: "oh",
  oi: "oh", oy: "oh", ay: "aa", ai: "aa",
  au: "aa", aw: "aa", ea: "ee", ee: "ee",
  ie: "ee", ue: "ou", ew: "ou", ng: null,
  ck: null, qu: "ou", gh: null,
};

// Single letter → VRM viseme (null = consonant / closed-ish)
const CHAR_VISEME = {
  a: "aa", e: "ee", i: "ih", o: "oh", u: "ou",
  b: null, c: null, d: null, f: null, g: null,
  h: null, j: null, k: null, l: "ih", m: null,
  n: null, p: null, q: null, r: "oh", s: null,
  t: null, v: null, w: "ou", x: null, y: "ih",
  z: null,
};

// Duration multiplier per viseme (longer = more prominent mouth shape)
const VISEME_DUR = {
  aa: 1.0, ee: 0.92, ih: 0.88, oh: 0.98, ou: 0.96,
};


/**
 * Convert English text to a timed viseme frame sequence.
 * Returns { frames: [{timeMs, viseme, durationMs}], totalMs }
 */
export function textToVisemes(text, targetMs = 0) {
  const s = text.toLowerCase().replace(/[^a-z\s.,!?\-]/g, "");
  const frames = [];
  let t = 0;
  let i = 0;

  while (i < s.length) {
    const ch = s[i];

    // Punctuation pauses
    if (ch === " " || ch === "\n")  { t += 55;  i++; continue; }
    if (ch === "," || ch === ";")   { t += 110; i++; continue; }
    if (ch === "." || ch === "!" || ch === "?") { t += 190; i++; continue; }
    if (ch === "-")                 { t += 60;  i++; continue; }

    // Digraph check
    const di = s.slice(i, i + 2);
    if (DIGRAPH[di] !== undefined) {
      const v = DIGRAPH[di];
      if (v) {
        const dur = (VISEME_DUR[v] ?? 0.9) * BASE_MS;
        frames.push({ timeMs: t, viseme: v, durationMs: dur });
        t += dur;
      } else {
        t += BASE_MS * 0.65;
      }
      i += 2;
      continue;
    }

    // Single character
    const v = CHAR_VISEME[ch] ?? null;
    if (v) {
      const dur = (VISEME_DUR[v] ?? 0.9) * BASE_MS;
      frames.push({ timeMs: t, viseme: v, durationMs: dur });
      t += dur;
    } else {
      t += BASE_MS * 0.60;
    }
    i++;
  }

  if (targetMs > 0 && t > 0) {
    const scale = Math.min(2.2, Math.max(0.55, targetMs / t));
    for (const frame of frames) {
      frame.timeMs *= scale;
      frame.durationMs *= scale;
    }
    t *= scale;
  }

  return { frames, totalMs: t };
}


/**
 * Query the active viseme at elapsedMs into playback.
 * Returns { aa, ee, ih, oh, ou } weights (0–1), or null if silent.
 */
export function getVisemesAtTime(sequence, elapsedMs) {
  if (!sequence?.frames?.length) return { aa: 0, ee: 0, ih: 0, oh: 0, ou: 0 };

  const frames = sequence.frames;
  // Binary-search for current frame
  let lo = 0, hi = frames.length - 1, cur = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].timeMs <= elapsedMs) { cur = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  if (cur < 0) return { aa: 0, ee: 0, ih: 0, oh: 0, ou: 0 };

  const f = frames[cur];
  const progress = (elapsedMs - f.timeMs) / f.durationMs;

  // Smooth bell curve: peaks at 0.3, fades by 1.2
  const weight = Math.max(0, Math.min(1, progress < 0.3
    ? progress / 0.3
    : 1 - (progress - 0.3) / 0.9
  ));

  if (weight < 0.02) return { aa: 0, ee: 0, ih: 0, oh: 0, ou: 0 };

  const out = { aa: 0, ee: 0, ih: 0, oh: 0, ou: 0 };
  out[f.viseme] = weight;
  return out;
}
