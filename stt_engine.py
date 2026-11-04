"""
Local Offline Speech-to-Text (STT) Engine using Vosk & FFmpeg.
100% offline, zero internet or cloud connection required.
"""

import os
import sys
import json
import wave
import tempfile
import subprocess
import threading

# Add user site-packages just in case
USER_SITE = os.path.expanduser('~/.local/lib/python3.14/site-packages')
if os.path.isdir(USER_SITE) and USER_SITE not in sys.path:
    sys.path.insert(0, USER_SITE)

# Also ensure workspace is in sys.path
WORKSPACE = os.path.dirname(os.path.abspath(__file__))
if WORKSPACE not in sys.path:
    sys.path.insert(0, WORKSPACE)

try:
    import vosk
    # Disable verbose Vosk logs
    vosk.SetLogLevel(-1)
    VOSK_AVAILABLE = True
except ImportError:
    VOSK_AVAILABLE = False

MODEL_PATH = os.path.join(WORKSPACE, 'vosk-model', 'vosk-model-small-en-us-0.15')
_model = None
_model_lock = threading.Lock()


def get_model():
    """Lazily load the Vosk model once."""
    global _model
    if not VOSK_AVAILABLE:
        return None
    with _model_lock:
        if _model is None and os.path.isdir(MODEL_PATH):
            try:
                _model = vosk.Model(MODEL_PATH)
            except Exception as e:
                print(f"[STT] Failed to load Vosk model from {MODEL_PATH}: {e}")
                _model = None
        return _model


def is_available():
    """Check if Vosk STT engine is ready to transcribe."""
    return VOSK_AVAILABLE and os.path.isdir(MODEL_PATH)


def transcribe_audio_bytes(audio_bytes, mime_type='audio/webm'):
    """
    Transcribe raw audio bytes (WebM, WAV, OGG, etc.) to text.
    Uses ffmpeg to convert to 16kHz mono WAV, then Vosk KaldiRecognizer.
    Returns: transcribed string (or empty string on failure).
    """
    model = get_model()
    if not model:
        raise RuntimeError("Vosk STT model not available.")

    # Determine input extension
    ext = '.webm'
    if 'wav' in mime_type:
        ext = '.wav'
    elif 'ogg' in mime_type:
        ext = '.ogg'

    temp_in = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
    temp_wav = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
    temp_wav.close()

    try:
        temp_in.write(audio_bytes)
        temp_in.close()

        # Convert to 16kHz 16-bit mono WAV using ffmpeg
        cmd = [
            'ffmpeg', '-y', '-v', 'error',
            '-i', temp_in.name,
            '-ar', '16000',
            '-ac', '1',
            '-f', 'wav',
            temp_wav.name
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
        if res.returncode != 0:
            print(f"[STT] ffmpeg conversion error: {res.stderr.decode('utf-8', errors='ignore')}")
            return ""

        # Transcribe with Vosk
        with wave.open(temp_wav.name, 'rb') as wf:
            rec = vosk.KaldiRecognizer(model, wf.getframerate())
            rec.SetWords(False)

            results = []
            while True:
                data = wf.readframes(4000)
                if len(data) == 0:
                    break
                if rec.AcceptWaveform(data):
                    part = json.loads(rec.Result())
                    text = part.get('text', '').strip()
                    if text:
                        results.append(text)

            final = json.loads(rec.FinalResult())
            final_text = final.get('text', '').strip()
            if final_text:
                results.append(final_text)

            return " ".join(results).strip()

    finally:
        if os.path.exists(temp_in.name):
            try:
                os.remove(temp_in.name)
            except OSError:
                pass
        if os.path.exists(temp_wav.name):
            try:
                os.remove(temp_wav.name)
            except OSError:
                pass
