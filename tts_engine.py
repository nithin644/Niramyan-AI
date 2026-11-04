"""
tts_engine.py — High-Performance Neural TTS Engine for Niramyan-AI
Supports:
  1. Piper Neural TTS (Local ONNX VITS) with studio-quality female anime voices
  2. Viseme & frame-by-frame amplitude extraction for accurate lip sync
  3. Custom phonetic pronunciation dictionary (Kali Linux, Indian English, cyber terms)
  4. Dynamic configuration via voice_config.json
"""

import os
import re
import json
import time
import math
import wave
import struct
import hashlib
import logging
import subprocess
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "voice_config.json"
CACHE_DIR = BASE_DIR / "static" / "audio_cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("tts_engine")


def load_config():
    if CONFIG_PATH.exists():
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error loading voice_config.json: {e}")
    return {}


def save_config(cfg):
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
        return True
    except Exception as e:
        logger.error(f"Error saving voice_config.json: {e}")
        return False


def apply_pronunciations(text: str, pronunciations: dict) -> str:
    """Replaces technical terms, names, and acronyms with phonetic pronunciations."""
    if not pronunciations:
        return text
    # Sort keys by length descending to match longest phrases first
    sorted_keys = sorted(pronunciations.keys(), key=len, reverse=True)
    pattern = re.compile(r'\b(' + '|'.join(re.escape(k) for k in sorted_keys) + r')\b', re.IGNORECASE)
    
    def repl(match):
        matched = match.group(0)
        for k, v in pronunciations.items():
            if k.lower() == matched.lower():
                return v
        return matched
        
    return pattern.sub(repl, text)


def clean_text_for_speech(text: str) -> str:
    """Cleans text of Markdown formatting, emotion tags, emojis, code blocks, and URLs."""
    # Remove emotion tags like [smile], [laugh], etc.
    t = re.sub(r'\[(smile|laugh|think|cyber|english|idle|surprised)\]\s*', '', text, flags=re.I)
    # Remove ALL emoji / pictographic Unicode characters so TTS never reads their names
    # Covers: Emoticons, Misc Symbols, Dingbats, Transport, Supplemental Symbols,
    # Enclosed Alphanumeric Supplement, Misc Technical, variation selectors, ZWJ sequences
    t = re.sub(
        u'[\U0001F600-\U0001F64F'   # emoticons
        u'\U0001F300-\U0001F5FF'   # misc symbols & pictographs
        u'\U0001F680-\U0001F6FF'   # transport & map
        u'\U0001F700-\U0001F77F'   # alchemical symbols
        u'\U0001F780-\U0001F7FF'   # geometric shapes extended
        u'\U0001F800-\U0001F8FF'   # supplemental arrows-c
        u'\U0001F900-\U0001F9FF'   # supplemental symbols & pictographs
        u'\U0001FA00-\U0001FA6F'   # chess symbols
        u'\U0001FA70-\U0001FAFF'   # symbols & pictographs extended-a
        u'\U00002702-\U000027B0'   # dingbats
        u'\U000024C2-\U0001F251'   # enclosed characters
        u'\U0000200D'              # zero-width joiner
        u'\U0000FE0F'              # variation selector-16
        u']+',
        '', t
    )
    # Remove code blocks entirely or summarize
    t = re.sub(r'```[\s\S]*?```', 'code block omitted', t)
    # Remove inline code marks
    t = re.sub(r'`([^`]+)`', r'\1', t)
    # Remove markdown bold/italics
    t = re.sub(r'\*\*([^*]+)\*\*', r'\1', t)
    t = re.sub(r'\*([^*]+)\*', r'\1', t)
    # Remove markdown headers
    t = re.sub(r'#{1,6}\s*', '', t)
    # Format developer links for smooth natural speech
    t = re.sub(r'GitHub:\s*https?://\S+', 'his GitHub is linked in the chat', t, flags=re.I)
    t = re.sub(r'Portfolio:\s*https?://\S+', 'his portfolio is linked in the chat', t, flags=re.I)
    # Replace general URLs with the word "link"
    t = re.sub(r'https?://\S+', 'link', t)
    # Clean up whitespace
    t = re.sub(r'\s+', ' ', t).strip()
    return t


def analyze_wav_visemes(wav_path: Path, fps: int = 50):
    """
    Extracts frame-by-frame RMS volume amplitude and acoustic viseme classification.
    Runs at specified fps (default 50 fps = 20ms window).
    """
    try:
        with wave.open(str(wav_path), 'rb') as w:
            framerate = w.getframerate()
            n_frames = w.getnframes()
            sampwidth = w.getsampwidth()
            n_channels = w.getnchannels()
            raw = w.readframes(n_frames)

        duration_ms = int((n_frames / framerate) * 1000)
        frame_size = int(framerate / fps)
        
        if sampwidth == 2:
            # 16-bit PCM
            samples = struct.unpack(f'<{n_frames * n_channels}h', raw)
            if n_channels > 1:
                # average channels to mono
                samples = [sum(samples[i:i+n_channels]) // n_channels for i in range(0, len(samples), n_channels)]
        else:
            # Fallback for 8-bit
            samples = [s - 128 for s in raw]

        total_samples = len(samples)
        amplitudes = []
        visemes = []

        for i in range(0, total_samples, frame_size):
            chunk = samples[i:i + frame_size]
            if not chunk:
                continue

            # RMS volume calculation
            rms = math.sqrt(sum(s * s for s in chunk) / len(chunk))
            norm_vol = min(1.0, (rms / 32768.0) * 3.4)
            amplitudes.append(round(norm_vol, 3))

            # Zero-Crossing Rate for fricatives/sibilants
            zcr = sum(
                1 for j in range(1, len(chunk))
                if (chunk[j] >= 0 and chunk[j - 1] < 0) or (chunk[j] < 0 and chunk[j - 1] >= 0)
            )
            zcr_rate = zcr / len(chunk)

            # Acoustic viseme assignment
            if norm_vol < 0.08:
                v = 'sil'
            elif zcr_rate > 0.24:
                v = 'fricative'  # s, sh, ch, f, th (teeth together, slightly parted)
            elif norm_vol > 0.62:
                v = 'open_wide'  # ah, aa, aw (mouth wide open)
            elif norm_vol > 0.32:
                v = 'open_mid'   # eh, ae, uh (medium mouth open)
            else:
                v = 'spread'     # ee, iy, ih (smiling spread mouth)

            visemes.append(v)

        return {
            "duration_ms": duration_ms,
            "sample_rate": framerate,
            "fps": fps,
            "amplitudes": amplitudes,
            "visemes": visemes
        }
    except Exception as e:
        logger.error(f"Error analyzing WAV {wav_path}: {e}")
        return {
            "duration_ms": 1000,
            "sample_rate": 22050,
            "fps": fps,
            "amplitudes": [0.0],
            "visemes": ["sil"]
        }


def cleanup_old_cache(max_age_seconds: int = 3600, max_files: int = 100):
    """Prunes audio cache files to conserve disk space."""
    try:
        now = time.time()
        files = list(CACHE_DIR.glob("*.wav"))
        for f in files:
            if now - f.stat().st_mtime > max_age_seconds:
                f.unlink(missing_ok=True)
                
        # If still too many, delete oldest
        files = sorted(CACHE_DIR.glob("*.wav"), key=lambda x: x.stat().st_mtime)
        if len(files) > max_files:
            for f in files[:-max_files]:
                f.unlink(missing_ok=True)
    except Exception as e:
        logger.warning(f"Error cleaning audio cache: {e}")


def synthesize_speech(text: str, voice_override: str = None) -> dict:
    """
    Synthesizes speech using Piper Neural TTS.
    Returns dictionary with audio URL and frame-accurate lipsync metadata.
    """
    cfg = load_config()
    clean_text = clean_text_for_speech(text)
    
    if not clean_text:
        return {"error": "Empty text after cleaning", "ok": False}

    # Apply phonetic substitutions
    spoken_text = apply_pronunciations(clean_text, cfg.get("pronunciations", {}))
    
    piper_cfg = cfg.get("piper", {})
    if not piper_cfg.get("enabled", True):
        return {"ok": False, "reason": "Piper disabled in config", "fallback_to_web": True}

    binary_rel = piper_cfg.get("binary_path", "piper/piper")
    binary_path = (BASE_DIR / binary_rel).resolve()
    
    if not binary_path.exists() or not os.access(binary_path, os.X_OK):
        logger.warning(f"Piper binary not found or not executable at {binary_path}")
        return {"ok": False, "reason": "Piper binary not available", "fallback_to_web": True}

    # Select voice
    voice_id = voice_override or piper_cfg.get("selected_voice", "en_US-hfc_female-medium")
    model_path = (BASE_DIR / "voices" / f"{voice_id}.onnx").resolve()
    config_path = (BASE_DIR / "voices" / f"{voice_id}.onnx.json").resolve()

    if not model_path.exists():
        # Fallback to any available .onnx in voices/
        available_models = list((BASE_DIR / "voices").glob("*.onnx"))
        if available_models:
            model_path = available_models[0]
            config_path = model_path.with_suffix(".onnx.json")
            voice_id = model_path.stem
        else:
            return {"ok": False, "reason": "No Piper ONNX voice models found", "fallback_to_web": True}

    # Parameters
    length_scale = str(piper_cfg.get("length_scale", 1.05))
    noise_scale = str(piper_cfg.get("noise_scale", 0.667))
    noise_w = str(piper_cfg.get("noise_w", 0.8))
    sentence_silence = str(piper_cfg.get("sentence_silence", 0.22))

    # Generate cache key
    cache_hash = hashlib.md5(f"{spoken_text}_{voice_id}_{length_scale}_{noise_scale}".encode("utf-8")).hexdigest()
    out_wav = CACHE_DIR / f"{cache_hash}.wav"

    if not out_wav.exists():
        cmd = [
            str(binary_path),
            "--model", str(model_path),
            "--config", str(config_path),
            "--length_scale", length_scale,
            "--noise_scale", noise_scale,
            "--noise_w", noise_w,
            "--sentence_silence", sentence_silence,
            "--output_file", str(out_wav),
            "-q"
        ]

        start_time = time.time()
        try:
            proc = subprocess.run(
                cmd,
                input=spoken_text.encode("utf-8"),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=15,
                check=True
            )
            elapsed = time.time() - start_time
            logger.info(f"Synthesized {len(spoken_text)} chars in {elapsed:.3f}s with {voice_id}")
        except subprocess.TimeoutExpired:
            logger.error("Piper synthesis timed out")
            return {"ok": False, "reason": "Piper timed out", "fallback_to_web": True}
        except subprocess.CalledProcessError as e:
            logger.error(f"Piper error: {e.stderr.decode('utf-8', errors='ignore')}")
            return {"ok": False, "reason": "Piper process error", "fallback_to_web": True}

    if not out_wav.exists() or out_wav.stat().st_size == 0:
        return {"ok": False, "reason": "WAV file was not created", "fallback_to_web": True}

    # Analyze audio envelope and visemes
    fps = cfg.get("animation", {}).get("viseme_fps", 50)
    analysis = analyze_wav_visemes(out_wav, fps=fps)

    # Clean old cache periodically
    cleanup_old_cache()

    return {
        "ok": True,
        "audio_url": f"/static/audio_cache/{out_wav.name}",
        "voice": voice_id,
        "text": clean_text,
        "spoken_text": spoken_text,
        **analysis
    }


def is_piper_available() -> bool:
    """Checks if Piper binary and at least one model exist and are executable."""
    cfg = load_config()
    binary_rel = cfg.get("piper", {}).get("binary_path", "piper/piper")
    binary_path = (BASE_DIR / binary_rel).resolve()
    if not (binary_path.exists() and os.access(binary_path, os.X_OK)):
        return False
    models = list((BASE_DIR / "voices").glob("*.onnx"))
    return len(models) > 0


if __name__ == "__main__":
    print("Checking Piper availability:", is_piper_available())
    res = synthesize_speech("Hello, I am Niramyan! Welcome to your cyber security and English assistant.")
    print("Result:", {k: (v if k != 'amplitudes' and k != 'visemes' else f'{len(v)} frames') for k, v in res.items()})

