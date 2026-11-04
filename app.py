import os
import re
import json
import urllib.parse
import subprocess
import threading
import webbrowser
import shutil
import requests
from flask import Flask, request, jsonify, render_template_string, Response, stream_with_context
import tts_engine
import english_coach
import identity

app = Flask(__name__, static_folder='static')

OLLAMA = os.getenv('OLLAMA_URL', 'http://127.0.0.1:11434')
DEFAULT_MODEL = os.getenv('OLLAMA_MODEL', 'Niramyan-AI-3B:latest')
CURRENT_MODEL = DEFAULT_MODEL

# Centralized prompts inherited from identity module
SYSTEM_PROMPT = identity.build_system_prompt('cyber')
GIRLFRIEND_PROMPT = identity.build_system_prompt('girlfriend')

def prewarm_ollama():
    """Background thread: pre-loads Ollama model into RAM to eliminate cold-start delay."""
    try:
        requests.post(
            OLLAMA + '/api/chat',
            json={
                'model': CURRENT_MODEL,
                'messages': [{'role': 'user', 'content': 'hi'}],
                'stream': False,
                'options': {'num_predict': 1, 'num_thread': 4}
            },
            timeout=15
        )
        print(f"[Ollama] Model '{CURRENT_MODEL}' pre-warmed successfully.")
    except Exception as e:
        print(f"[Ollama] Pre-warm notice: {e}")

threading.Thread(target=prewarm_ollama, daemon=True).start()

PAGE_HTML = r'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Niramyan-AI · Interactive Cyber & English Assistant</title>
  <link rel="stylesheet" href="/static/style.css">
</head>
<body>
<div class="shell">
  <!-- Header -->
  <header>
    <div class="logo">N</div>
    <div class="header-titles">
      <h1>Niramyan-AI <span class="assistant-badge">ASSISTANT</span></h1>
      <small>LOCAL INTERACTIVE AVATAR · CYBER SECURITY & ENGLISH MENTOR</small>
    </div>
    <div class="header-controls">
      <div class="model-select-wrapper">
        <label for="modelSelect">Model:</label>
        <select id="modelSelect" title="Select Ollama model">
          <option value="CURRENT_MODEL">CURRENT_MODEL</option>
        </select>
      </div>
      <div id="status" class="status">Checking Ollama…</div>
    </div>
  </header>

  <main>
    <!-- Left: Avatar & Expression Panel -->
    <section class="avatar-panel">
      <!-- Stage with Avatar & Rigging -->
      <div class="stage" id="stage" data-mood="idle">
        <div class="halo"></div>
        <div class="orbit"></div>
        
        <!-- Cyber HUD Overlay -->
        <div class="cyber-hud" id="cyberHud">
          <div class="cyber-circle"></div>
          <div class="cyber-line"></div>
          <div class="cyber-badge">🛡️ CYBER SEC PROTOCOL ACTIVE</div>
        </div>

        <!-- Floating Particles (sparkles / laugh bubbles) -->
        <div class="particles" id="particles"></div>

        <!-- Avatar Image Layers -->
        <div class="avatar-wrap" id="avatarWrap">
          <img id="img-idle" src="/static/avatar.png" class="avatar-layer active" alt="Niramyan Idle">
          <img id="img-smile" src="/static/avatar_smile.png" class="avatar-layer" alt="Niramyan Smiling">
          <img id="img-laugh" src="/static/avatar_laugh.png" class="avatar-layer" alt="Niramyan Laughing">
          <img id="img-talk" src="/static/avatar_talk.png" class="avatar-layer" alt="Niramyan Talking">
          <img id="img-think" src="/static/avatar_think.png" class="avatar-layer" alt="Niramyan Thinking">
          <img id="img-blink" src="/static/avatar_blink.png" class="avatar-layer" alt="Niramyan Blinking">
        </div>

        <!-- Speech Audio Visualizer Bars -->
        <div class="bars" id="voiceBars">
          <i></i><i></i><i></i><i></i><i></i><i></i><i></i>
        </div>

        <!-- Emotion Pill on Avatar -->
        <div class="avatar-bubble" id="avatarBubble">Ready to learn!</div>
      </div>

      <!-- Avatar Name & Mood Description -->
      <div class="avatar-name">
        <span class="green-dot" id="onlineDot"></span>
        <div>
          <b id="avatarDisplayName">Niramyan</b>
          <small id="moodText">Ready when you are</small>
        </div>
      </div>

      <!-- Always-On Mic Zone -->
      <div class="mic-zone">
        <div class="mic-ring" id="micRing">
          <div class="mic-pulse"></div>
          <button id="listen" class="mic-btn" title="Tap to mute/unmute">&#127897;</button>
        </div>
        <div class="mic-labels">
          <span id="micLabel">Tap mic to speak</span>
          <small id="voiceState">Voice: ready</small>
        </div>
        <button class="settings-btn" id="voiceSettingsBtn" title="Voice & Avatar Settings">&#9881;&#65039;</button>
        <button class="stop" id="stop" title="Stop speaking">&#9646;</button>
      </div>

      <!-- Quick Learning Modes -->
      <div class="learning-modes">
        <small class="modes-label">ASSISTANT FOCUS:</small>
        <div class="mode-chips">
          <button type="button" class="mode-chip active" data-mode="girlfriend">💖 Girlfriend</button>
          <button type="button" class="mode-chip" data-mode="cyber">🛡️ Cyber Security</button>
          <button type="button" class="mode-chip" data-mode="english">🎓 English Coach</button>
          <button type="button" class="mode-chip" data-mode="quiz">🎯 Quiz Me</button>
        </div>
      </div>

      <!-- English Coach Toolbar (hidden until English mode is active) -->
      <div id="englishToolbar" class="english-toolbar" style="display:none;">
        <div class="ec-toolbar-row">
          <label class="ec-label">Level:</label>
          <select id="ecLevelSelect" class="ec-select">
            <option value="beginner">🌱 Beginner</option>
            <option value="intermediate" selected>📘 Intermediate</option>
            <option value="advanced">🚀 Advanced</option>
          </select>
          <label class="ec-label">Scenario:</label>
          <select id="ecScenarioSelect" class="ec-select">
            <option value="free">💬 Free Chat</option>
            <option value="job_interview">👔 Job Interview</option>
            <option value="restaurant">🍽️ Restaurant</option>
            <option value="shopping">🛍️ Shopping</option>
            <option value="travel">✈️ Travel</option>
            <option value="college">🎓 College Life</option>
            <option value="friends">👫 With Friends</option>
            <option value="self_intro">🙋 Self Intro</option>
            <option value="workplace">💼 Workplace</option>
          </select>
          <button id="ecProgressBtn" class="ec-progress-btn" title="View today's learning progress">📊 My Progress</button>
        </div>
      </div>

      <p class="privacy">🔒 100% Local & Private. Responses generated by Ollama on your machine.</p>
    </section>

    <!-- Right: Chat & Learning Interaction Panel -->
    <section class="chat-panel">
      <div class="chat-title">
        <div>
          <small>YOUR PERSONAL MENTOR</small>
          <h2>Learn Cyber Security & English</h2>
        </div>
        <div class="chat-actions-top">
          <button id="handsFreeBtn" class="handsfree-btn" title="Toggle hands-free continuous voice chat">🎧 Hands-Free: Off</button>
          <button id="clear" class="clear" title="Clear chat history">↻</button>
        </div>
      </div>

      <!-- Quick Topic Prompts -->
      <div class="topic-suggestions" id="topicSuggestions">
        <button type="button" class="topic-pill" data-prompt="Explain TCP 3-way handshake in 2 simple sentences!">🌐 TCP Handshake</button>
        <button type="button" class="topic-pill" data-prompt="What is SQL Injection and how to prevent it?">💉 SQL Injection</button>
        <button type="button" class="topic-pill" data-prompt="Teach me 3 essential Kali Linux terminal commands.">🐧 Kali Commands</button>
        <button type="button" class="topic-pill" data-prompt="Quiz me on ethical hacking concepts!">🎯 Cyber Quiz</button>
        <button type="button" class="topic-pill" data-prompt="Let's practice conversational English! Ask me a question.">💬 English Practice</button>
        <button type="button" class="topic-pill" data-prompt="Correct my sentence: 'She don't likes the meeting yesterday.'">✍️ Correct Grammar</button>
        <button type="button" class="topic-pill" data-prompt="Tell me a funny hacker joke!">😂 Hacker Joke</button>
        <button type="button" class="topic-pill" data-prompt="Open YouTube and play recent hit song">🎵 Play Recent Hit Song</button>
        <button type="button" class="topic-pill" data-prompt="Open WhatsApp and send a message to Rahul saying Hey! Are you free?">💬 WhatsApp Rahul</button>
      </div>

      <!-- Chat Feed -->
      <div class="messages" id="messages">
        <div class="msg">
          <div class="badge">N</div>
          <div class="msg-body">
            <small>Niramyan · Personal Assistant</small>
            <p>Hello! I'm Ramya, your local cyber security mentor and English coach. What would you like to explore today? 🛡️✨</p>
          </div>
        </div>
      </div>

      <!-- Thinking Indicator -->
      <div class="thinking hidden" id="thinking" hidden style="display:none;">
        <div class="dot-pulse"></div>
        <span>Niramyan is thinking…</span>
      </div>

      <!-- Input Form -->
      <form id="form">
        <textarea id="input" rows="1" placeholder="Ask about Cyber Security, practice English, or say hello…"></textarea>
        <button id="send" type="submit" title="Send message">➤</button>
      </form>

      <div class="hint">
        <span>Enter to send · Shift+Enter for new line</span>
        <span id="voiceStateHint">Voice: ready</span>
      </div>
    </section>
  </main>

  <!-- Voice & Avatar Settings Modal -->
  <dialog id="settingsDialog" class="settings-dialog">
    <div class="dialog-content">
      <div class="dialog-header">
        <h3>⚙️ Voice & Avatar Settings</h3>
        <button type="button" id="closeSettings" class="close-dialog">✕</button>
      </div>
      <div class="dialog-body">
        <!-- Voice Engine Selection -->
        <div class="setting-item">
          <label for="engineSelect"><b>TTS Engine:</b></label>
          <select id="engineSelect">
            <option value="piper">🌸 Neural Piper TTS (Studio-Quality Female Voice)</option>
            <option value="webspeech">🌐 Browser Web Speech API (Google / System)</option>
          </select>
        </div>

        <!-- Piper Neural Voice -->
        <div class="setting-item" id="piperVoiceGroup">
          <label for="piperVoiceSelect"><b>Neural Voice Model:</b></label>
          <select id="piperVoiceSelect">
            <option value="en_US-hfc_female-medium">🌸 Niramyan Soft Anime (HFC Female — Youthful & Soft)</option>
            <option value="en_US-amy-medium">✨ Niramyan Siri-Style (Amy — Warm, Natural Clarity)</option>
          </select>
          <small class="setting-hint">Local ONNX model running at ~50ms latency on CPU.</small>
        </div>

        <!-- Browser Web Speech Voice (shown when webspeech selected) -->
        <div class="setting-item" id="webVoiceGroup" style="display:none;">
          <label for="voiceSelect">Browser Voice:</label>
          <select id="voiceSelect"></select>
        </div>

        <!-- Speech Rate / Pacing -->
        <div class="setting-item">
          <label for="voiceRate">Speaking Speed: <span id="rateVal">1.0x</span></label>
          <input type="range" id="voiceRate" min="0.75" max="1.3" step="0.05" value="1.0">
        </div>

        <!-- Speech Pitch / Tone -->
        <div class="setting-item" id="pitchGroup">
          <label for="voicePitch">Vocal Pitch / Brightness: <span id="pitchVal">1.28</span> 🎵</label>
          <input type="range" id="voicePitch" min="0.8" max="1.8" step="0.04" value="1.28">
        </div>

        <div class="setting-item checkbox-item">
          <label><input type="checkbox" id="autoBlinkToggle" checked> Natural eye blinking every 3–6 seconds</label>
        </div>
        <div class="setting-item checkbox-item">
          <label><input type="checkbox" id="soundFxToggle" checked> Avatar audio chimes & laugh sound effects</label>
        </div>

        <!-- WhatsApp Contacts -->
        <div class="setting-item contacts-section">
          <label><b>📱 WhatsApp Contacts:</b></label>
          <div class="contacts-list" id="contactsList"></div>
          <div class="add-contact-row">
            <input type="text" id="newContactName" placeholder="Name (e.g. Rahul)">
            <input type="text" id="newContactPhone" placeholder="Phone (+91...)">
            <button type="button" id="addContactBtn" class="btn-secondary">+ Add</button>
          </div>
          <small class="setting-hint">Save names and phone numbers so Ramya can open chats directly.</small>
        </div>
      </div>
      <div class="dialog-footer">
        <button type="button" id="testVoiceBtn" class="btn-secondary">🔊 Test Voice</button>
        <button type="button" id="saveSettingsBtn" class="btn-primary">Save Settings</button>
      </div>
    </div>
  </dialog>

  <footer>
    <span>🔒 100% Local AI · Private Voice & LLM</span>
    <span>Ollama Model: <b id="footerModel">CURRENT_MODEL</b></span>
  </footer>
</div>

<script src="/static/app.js"></script>
</body>
</html>
'''


def get_preferred_browser():
    """
    Detects the active or best installed browser on Kali Linux.
    Bypasses broken system symlinks (such as missing Brave / dead x-www-browser).
    """
    try:
        ps_out = subprocess.check_output(['ps', '-A'], text=True)
        if 'chromium' in ps_out:
            p = shutil.which('chromium')
            if p:
                return p
        if 'firefox' in ps_out:
            p = shutil.which('firefox') or shutil.which('firefox-esr')
            if p:
                return p
    except Exception:
        pass

    for b in ['firefox', 'firefox-esr', 'chromium', 'google-chrome', 'chromium-browser']:
        p = shutil.which(b)
        if p and os.path.exists(p) and os.access(p, os.X_OK):
            return p
    return None


def open_url_in_browser(url: str):
    """
    Opens a URL in the desktop browser in the background without blocking.
    Directly targets working browser binaries on Kali Linux to guarantee automated opening.
    """
    def _run():
        env = os.environ.copy()
        env.setdefault('DISPLAY', ':0')
        uid = str(os.getuid())
        if os.path.exists(f'/run/user/{uid}/wayland-0'):
            env.setdefault('WAYLAND_DISPLAY', 'wayland-0')
        if os.path.exists(f'/run/user/{uid}/bus'):
            env.setdefault('DBUS_SESSION_BUS_ADDRESS', f'unix:path=/run/user/{uid}/bus')

        # 1. Directly invoke real installed browser (Firefox / Chromium)
        b_path = get_preferred_browser()
        if b_path:
            try:
                proc = subprocess.Popen(
                    [b_path, url],
                    env=env,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    start_new_session=True
                )
                print(f"[Browser] Successfully auto-opened {url} via {b_path} (PID {proc.pid})")
                return
            except Exception as e:
                print(f"[Browser] Error opening with {b_path}: {e}")

        # 2. Fallback to gio open
        gio_path = shutil.which('gio')
        if gio_path:
            try:
                subprocess.Popen(
                    [gio_path, 'open', url],
                    env=env,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    start_new_session=True
                )
                return
            except Exception:
                pass

        # 3. Fallback to standard webbrowser module
        try:
            webbrowser.open(url)
        except Exception as e:
            print(f"[Browser] Error opening {url}: {e}")

    threading.Thread(target=_run, daemon=True).start()


def clean_command(text: str) -> str:
    t = text.strip()
    t = re.sub(r'^(?:hey|hi|hello)\s+(?:ramya\b\s*,?\s*)?', '', t, flags=re.I)
    t = re.sub(r'^(?:ramya\b\s*,?\s*)', '', t, flags=re.I)
    t = re.sub(r'^(?:can you|could you|would you|please|will you|i want to|i want you to)\s+(?:please\s+)?', '', t, flags=re.I)
    return t.strip()


def normalize_song_query(song: str) -> str:
    s = song.strip().lower()
    generic_hits = {
        'a song', 'music', 'some music', 'songs', 'some songs', 'a track',
        'recent hit song', 'recent hit songs', 'recent hit', 'recent hits',
        'hit song', 'hit songs', 'latest hit song', 'latest hit songs',
        'latest song', 'latest songs', 'popular song', 'popular songs',
        'top song', 'top songs', 'new song', 'new songs'
    }
    if s in generic_hits:
        return 'recent hit songs official video'
    return song.strip(' .!?')


_YT_CACHE = {}

def resolve_youtube_top_video(query: str):
    """
    Searches YouTube for query and extracts the top video ID and title
    so the browser opens directly to the video and auto-plays it.
    Falls back to search results if network resolution is unavailable.
    Cached in memory for zero-latency repeats.
    """
    q_key = query.strip().lower()
    if q_key in _YT_CACHE:
        return _YT_CACHE[q_key]

    search_url = f"https://www.youtube.com/results?search_query={urllib.parse.quote_plus(query)}"
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
        }
        res = requests.get(search_url, headers=headers, timeout=1.0)
        if res.status_code == 200:
            text = res.text
            # Primary: videoRenderer pattern
            m = re.search(r'"videoRenderer":\s*\{"videoId":\s*"([a-zA-Z0-9_-]{11})"', text)
            if m:
                vid = m.group(1)
                title_m = re.search(r'"videoRenderer":\s*\{"videoId":\s*"' + re.escape(vid) + r'".*?"title":\s*\{\s*"runs":\s*\[\s*\{\s*"text":\s*"([^"]+)"', text)
                title = title_m.group(1) if title_m else None
                result = (f"https://www.youtube.com/watch?v={vid}&autoplay=1", title)
                _YT_CACHE[q_key] = result
                return result

            # Secondary: general videoId
            vids = re.findall(r'"videoId":\s*"([a-zA-Z0-9_-]{11})"', text)
            if vids:
                result = (f"https://www.youtube.com/watch?v={vids[0]}&autoplay=1", None)
                _YT_CACHE[q_key] = result
                return result
    except Exception as e:
        print(f"[YouTube] Video resolution error: {e}")

    return search_url, None


def parse_youtube_intent(text: str):
    """
    Detects if the user wants to open YouTube, play music, or search.
    Returns (is_youtube: bool, is_play: bool, query: str | None, search_url: str | None)
    """
    if not text:
        return False, False, None, None
    t = clean_command(text)
    
    # 1. "open/launch/go to youtube and play (a song|...)"
    m = re.search(r'(?:open|launch|go to)\s+youtube\s+and\s+play\s+(.+)', t, re.I)
    if m:
        song = normalize_song_query(m.group(1))
        return True, True, song, f"https://www.youtube.com/results?search_query={urllib.parse.quote_plus(song)}"

    # 2. "open/launch/go to youtube and search (for )?(...)"
    m = re.search(r'(?:open|launch|go to)\s+youtube\s+and\s+search(?:\s+for)?\s+(.+)', t, re.I)
    if m:
        query = m.group(1).strip(' .!?')
        return True, False, query, f"https://www.youtube.com/results?search_query={urllib.parse.quote_plus(query)}"

    # 3. "play (...) (on|in) youtube"
    m = re.search(r'play\s+(.+?)\s+(?:on|in)\s+youtube', t, re.I)
    if m:
        song = normalize_song_query(m.group(1))
        return True, True, song, f"https://www.youtube.com/results?search_query={urllib.parse.quote_plus(song)}"

    # 4. "search (for )?(...) (on|in) youtube"
    m = re.search(r'search(?:\s+for)?\s+(.+?)\s+(?:on|in)\s+youtube', t, re.I)
    if m:
        query = m.group(1).strip(' .!?')
        return True, False, query, f"https://www.youtube.com/results?search_query={urllib.parse.quote_plus(query)}"

    # 5. "open youtube" / "launch youtube"
    if re.fullmatch(r'(?:open|launch|go to)\s+youtube[!.?]*', t, re.I):
        return True, False, None, "https://www.youtube.com"

    # 6. "play (...)" (e.g. "play believer", "play a song", "play recent hit song")
    m = re.match(r'^play\s+(.+)$', t, re.I)
    if m:
        target = m.group(1).strip(' .!?')
        if not re.search(r'\b(game|role|quiz|part|chess)\b', target, re.I):
            song = normalize_song_query(target)
            return True, True, song, f"https://www.youtube.com/results?search_query={urllib.parse.quote_plus(song)}"

    return False, False, None, None


CONTACTS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'contacts.json')


def load_contacts():
    if os.path.isfile(CONTACTS_FILE):
        try:
            with open(CONTACTS_FILE, 'r') as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def save_contact(name: str, phone: str):
    c = load_contacts()
    clean_p = re.sub(r'[\s\+\-\(\)]', '', phone)
    if len(clean_p) == 10 and clean_p[0] in '6789':
        clean_p = '91' + clean_p
    c[name.lower().strip()] = clean_p
    try:
        with open(CONTACTS_FILE, 'w') as f:
            json.dump(c, f, indent=2)
        return True, clean_p
    except Exception as e:
        print(f"[Contacts] Error saving: {e}")
        return False, clean_p


def delete_contact(name: str):
    c = load_contacts()
    k = name.lower().strip()
    if k in c:
        del c[k]
        try:
            with open(CONTACTS_FILE, 'w') as f:
                json.dump(c, f, indent=2)
            return True
        except Exception:
            return False
    return False


# ---------------------------------------------------------------------------
# App / Terminal Launcher
# ---------------------------------------------------------------------------

# Map of spoken keywords → (executable, friendly_name)
# Order matters: more-specific keys first.
APP_MAP = {
    # Terminals
    'terminal':         ('gnome-terminal', 'terminal'),
    'gnome terminal':   ('gnome-terminal', 'terminal'),
    'qterminal':        ('qterminal',       'terminal'),
    'konsole':          ('konsole',         'terminal'),
    'xterm':            ('xterm',           'terminal'),

    # Browsers
    'firefox':          ('firefox',         'Firefox'),
    'browser':          ('firefox',         'Firefox'),
    'web browser':      ('firefox',         'Firefox'),
    'chromium':         ('chromium',        'Chromium'),
    'chrome':           ('chromium',        'Chromium'),
    'google chrome':    ('chromium',        'Chromium'),

    # Editors / IDEs
    'vs code':          ('code',            'VS Code'),
    'vscode':           ('code',            'VS Code'),
    'visual studio code': ('code',          'VS Code'),
    'code':             ('code',            'VS Code'),
    'mousepad':         ('mousepad',        'Mousepad'),
    'text editor':      ('mousepad',        'text editor'),
    'gedit':            ('gedit',           'gedit'),

    # File managers
    'file manager':     ('thunar',          'file manager'),
    'files':            ('thunar',          'file manager'),
    'thunar':           ('thunar',          'Thunar'),
    'nautilus':         ('nautilus',        'file manager'),

    # Kali Linux tools (GUI)
    'wireshark':        ('wireshark',       'Wireshark'),
    'burp suite':       ('burpsuite',       'Burp Suite'),
    'burpsuite':        ('burpsuite',       'Burp Suite'),
    'metasploit':       ('msfconsole',      'Metasploit'),
    'nmap':             ('gnome-terminal -- nmap', 'Nmap'),

    # Media
    'vlc':              ('vlc',             'VLC'),
    'media player':     ('vlc',             'VLC'),
    'gimp':             ('gimp',            'GIMP'),

    # Calculator
    'calculator':       ('gnome-calculator', 'calculator'),

    # Settings
    'settings':         ('gnome-control-center', 'Settings'),
}


def launch_app(app_key: str):
    """
    Look up app_key in APP_MAP and launch it via subprocess.Popen.
    Returns (success: bool, friendly_name: str, error_msg: str | None)
    """
    entry = APP_MAP.get(app_key.lower())
    if not entry:
        return False, app_key, f"I don't know how to open '{app_key}'"

    executable, friendly = entry
    try:
        # Split in case the executable string contains args (e.g. 'gnome-terminal -- nmap')
        cmd = executable.split()
        env = os.environ.copy()
        # Ensure a minimal DISPLAY / Wayland env so GUI apps can start
        env.setdefault('DISPLAY', ':0')
        subprocess.Popen(cmd, env=env,
                         stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL,
                         start_new_session=True)
        return True, friendly, None
    except FileNotFoundError:
        return False, friendly, f"{friendly} is not installed on this system."
    except Exception as e:
        return False, friendly, str(e)


def parse_app_launch_intent(text: str):
    """
    Detect commands like:
      "open terminal", "launch firefox", "start VS Code",
      "can you open the file manager", "open wireshark please"
    Returns (is_app: bool, app_key: str | None)
    """
    if not text:
        return False, None

    t = text.lower().strip()

    # Must start with an action verb (or be a bare app name question)
    action_pattern = r'(?:open|launch|start|run|show|bring up|can you open|please open|open up)\s+'
    if not re.search(action_pattern, t, re.I) and not re.search(r'^(terminal|vs\s?code|firefox|wireshark)$', t, re.I):
        return False, None

    # Remove action verbs and filler words to get the bare app name
    bare = re.sub(r'^(?:open|launch|start|run|show|bring up|can you open|please open|open up)\s+', '', t, flags=re.I)
    bare = re.sub(r'(?:^the\s+|^a\s+|\s+(?:for me|please|now|up)[!.?]*$)', '', bare, flags=re.I).strip()
    bare = re.sub(r'[!.?]+$', '', bare).strip()

    # Try longest match first (sort keys by word count descending)
    for key in sorted(APP_MAP.keys(), key=lambda k: len(k.split()), reverse=True):
        if bare == key or bare.startswith(key):
            return True, key

    return False, None


def parse_save_contact_intent(text: str):
    if not text:
        return False, None, None
    t = clean_command(text)
    m = re.search(r'(?:save|add|remember|set)\s+contact\s+([a-zA-Z0-9_\s]+?)(?:\s+(?:as|number|phone|with|:)\s*|\s*:\s*|\s+)([0-9\+\-\s\(\)]{7,})', t, re.I)
    if m:
        name = m.group(1).strip()
        raw_phone = m.group(2).strip()
        return True, name, raw_phone
    return False, None, None


def parse_whatsapp_intent(text: str):
    """
    Detects if the user wants to open WhatsApp or send a message to a person.
    Returns (is_whatsapp: bool, person: str | None, message: str | None)
    """
    if not text:
        return False, None, None
    t = clean_command(text)
    
    sep = r'(?:\s+(?:saying|that|with|text|content|and message|and say|and text)\s+|\s*:\s*)'
    
    # 1. "open whatsapp and send a message to <person> saying/and message <msg>"
    m = re.search(r'(?:open|launch|go to)\s+whatsapp\s+and\s+send\s+(?:a\s+)?message\s+to\s+([a-zA-Z0-9_\+\-\s]+?)' + sep + r'(.+)', t, re.I)
    if m:
        return True, m.group(1).strip(), m.group(2).strip()

    # 1b. "open whatsapp and send a message to <person>" (no message specified)
    m = re.search(r'(?:open|launch|go to)\s+whatsapp\s+and\s+send\s+(?:a\s+)?message\s+to\s+([a-zA-Z0-9_\+\-\s]+)[!.?]*$', t, re.I)
    if m:
        return True, m.group(1).strip(), None

    # 2. "open whatsapp and message <person> <msg>"
    m = re.search(r'(?:open|launch|go to)\s+whatsapp\s+and\s+message\s+([a-zA-Z0-9_\+\-\s]+?)(?:' + sep + r'|\s+)(.+)', t, re.I)
    if m:
        return True, m.group(1).strip(), m.group(2).strip()

    # 3. "send a message to <person> on whatsapp saying <msg>"
    m = re.search(r'send\s+(?:a\s+)?(?:whatsapp\s+)?message\s+to\s+([a-zA-Z0-9_\+\-\s]+?)(?:\s+on\s+whatsapp)?(?:' + sep + r'|\s+)(.+)', t, re.I)
    if m:
        return True, m.group(1).strip(), m.group(2).strip()

    # 4. "whatsapp <person> <msg>" or "message <person> on whatsapp <msg>"
    m = re.search(r'(?:whatsapp|message)\s+([a-zA-Z0-9_\+\-\s]+?)(?:\s+on\s+whatsapp)?(?:' + sep + r'|\s+)(.+)', t, re.I)
    if m:
        target = m.group(1).strip()
        if target.lower() not in ('web', 'app'):
            return True, target, m.group(2).strip()

    # 5. Just "open whatsapp"
    if re.fullmatch(r'(?:open|launch|go to)\s+whatsapp[!.?]*', t, re.I):
        return True, None, None

    return False, None, None


def build_whatsapp_url(person: str | None, message: str | None):
    """
    Constructs the appropriate WhatsApp Web URL.
    - If phone number is found in contacts or directly provided, opens direct chat:
      https://web.whatsapp.com/send?phone=...&text=...
    - If contact not in contacts, opens WhatsApp Web with pre-filled message (shows contact selector)
    - If no person or message, opens https://web.whatsapp.com
    Returns (url, found_phone, display_name)
    """
    if not person and not message:
        return "https://web.whatsapp.com", None, None

    contacts = load_contacts()
    found_phone = None
    display_name = person or "your contact"

    if person:
        p_clean = re.sub(r'[\s\+\-\(\)]', '', person)
        if p_clean.isdigit() and len(p_clean) >= 7:
            if len(p_clean) == 10 and p_clean[0] in '6789':
                p_clean = '91' + p_clean
            found_phone = p_clean
        else:
            p_lower = person.lower().strip()
            if p_lower in contacts:
                found_phone = contacts[p_lower]

    query_params = []
    if found_phone:
        query_params.append(f"phone={found_phone}")
    if message:
        query_params.append(f"text={urllib.parse.quote_plus(message)}")

    if query_params:
        url = "https://web.whatsapp.com/send?" + "&".join(query_params)
    else:
        url = "https://web.whatsapp.com"

    return url, found_phone, display_name


def extract_expression_and_clean(text: str):
    """
    Finds expression tags like [laugh], [smile], [think], [cyber], [english]
    and determines the predominant expression.
    Also extracts [open:URL] tags if generated by the LLM.
    """
    clean_text = text
    expression = 'smile'  # default pleasant mood
    action_url = None
    
    # Check for [open:URL] tag
    open_match = re.search(r'\[open:(https?://[^\]]+)\]', text, re.I)
    if open_match:
        action_url = open_match.group(1)
        clean_text = re.sub(r'\[open:[^\]]+\]\s*', '', clean_text, flags=re.I)

    # Priority matching
    if re.search(r'\[laugh\]', text, re.I) or re.search(r'\b(haha|hehe|rofl|lmao|hilarious|that\'s funny)\b', text, re.I):
        expression = 'laugh'
    elif re.search(r'\[cyber\]', text, re.I) or re.search(r'\b(nmap|wireshark|metasploit|exploit|kali|firewall|encryption|owasp|sqli|vulnerability)\b', text, re.I):
        expression = 'cyber'
    elif re.search(r'\[english\]', text, re.I) or re.search(r'\b(grammar tip|vocabulary|pronounced|idiom|spelling|sentence structure)\b', text, re.I):
        expression = 'english'
    elif re.search(r'\[think\]', text, re.I) or re.search(r'\b(let\'s analyze|let\'s consider|let me explain the logic|conceptually)\b', text, re.I):
        expression = 'think'
    elif re.search(r'\[smile\]', text, re.I) or re.search(r'\b(happy|glad|wonderful|great job|welcome|awesome|thank you)\b', text, re.I):
        expression = 'smile'
        
    # Strip tags for clean text display and speech
    clean_text = re.sub(r'\[(smile|laugh|think|cyber|english|idle|surprised)\]\s*', '', clean_text, flags=re.I)
    return expression, clean_text, action_url


def parse_mode_switch_intent(text: str):
    """
    Detect voice commands to switch assistant mode:
    e.g. "switch to English Coach mode", "switch to Girlfriend mode", "switch to Cyber Security mode"
    """
    if not text:
        return False, None
    t = text.lower().strip()
    if re.search(r'\b(?:switch|change|go|activate|set)\s+(?:to\s+|into\s+)?(?:the\s+)?(?:english(?:\s+coach)?(?:\s+mode)?)\b', t):
        return True, 'english'
    if re.search(r'\b(?:switch|change|go|activate|set)\s+(?:to\s+|into\s+)?(?:the\s+)?(?:cyber(?:\s+security)?(?:\s+mode)?)\b', t):
        return True, 'cyber'
    if re.search(r'\b(?:switch|change|go|activate|set)\s+(?:to\s+|into\s+)?(?:the\s+)?(?:girlfriend(?:\s+mode)?|ramya(?:\s+mode)?)\b', t):
        return True, 'girlfriend'
    if re.search(r'\b(?:switch|change|go|activate|set)\s+(?:to\s+|into\s+)?(?:the\s+)?(?:quiz(?:\s+me)?(?:\s+mode)?)\b', t):
        return True, 'quiz'
    if re.search(r'\b(?:switch|change|go|activate|set)\s+(?:to\s+|into\s+)?(?:the\s+)?(?:coding(?:\s+assistant)?(?:\s+mode)?|programming(?:\s+mode)?)\b', t):
        return True, 'coding'
    if re.search(r'\b(?:switch|change|go|activate|set)\s+(?:to\s+|into\s+)?(?:the\s+)?(?:research(?:\s+mode)?)\b', t):
        return True, 'research'
    if re.search(r'\b(?:switch|change|go|activate|set)\s+(?:to\s+|into\s+)?(?:the\s+)?(?:normal(?:\s+assistant)?(?:\s+mode)?|general(?:\s+mode)?)\b', t):
        return True, 'normal'
    return False, None


@app.get('/')
def index():
    return render_template_string(PAGE_HTML.replace('CURRENT_MODEL', CURRENT_MODEL))


@app.get('/api/contacts')
def get_contacts():
    return jsonify(contacts=load_contacts())


@app.post('/api/contacts')
def add_contact():
    data = request.get_json(silent=True) or {}
    name = data.get('name', '').strip()
    phone = data.get('phone', '').strip()
    if not name or not phone:
        return jsonify(error='Name and phone required'), 400
    ok, cleaned = save_contact(name, phone)
    return jsonify(ok=ok, name=name, phone=cleaned, contacts=load_contacts())


@app.delete('/api/contacts')
def remove_contact():
    data = request.get_json(silent=True) or {}
    name = data.get('name', '').strip()
    if not name:
        return jsonify(error='Name required'), 400
    ok = delete_contact(name)
    return jsonify(ok=ok, contacts=load_contacts())


# ---------------------------------------------------------------------------
# English Coach API endpoints
# ---------------------------------------------------------------------------

@app.get('/api/english/progress')
def english_progress():
    """Return today's and all-time English learning progress."""
    today = english_coach.get_today_summary()
    alltime = english_coach.get_all_time_summary()
    return jsonify(today=today, alltime=alltime)


@app.post('/api/english/session/start')
def english_session_start():
    """Start a new English Coach session."""
    body = request.get_json(silent=True) or {}
    level = body.get('level', 'intermediate')
    sid = english_coach.start_session(level)
    return jsonify(ok=True, session_id=sid, level=level)


@app.post('/api/english/session/end')
def english_session_end():
    """End the current English Coach session."""
    english_coach.end_session()
    return jsonify(ok=True)


@app.get('/api/english/summary')
def english_summary():
    """Return a natural-language spoken summary of today's progress."""
    summary = english_coach.get_today_summary()
    spoken = english_coach.format_summary_for_speech(summary)
    return jsonify(summary=summary, spoken=spoken)


@app.post('/api/english/pref')
def english_pref():
    """Set a user learning preference."""
    body = request.get_json(silent=True) or {}
    key = body.get('key', '').strip()
    value = body.get('value')
    if not key:
        return jsonify(error='key required'), 400
    english_coach.set_pref(key, value)
    return jsonify(ok=True)


@app.get('/api/health')
def health():
    global CURRENT_MODEL
    ollama_ok = False
    models = []
    
    try:
        r = requests.get(OLLAMA + '/api/tags', timeout=3)
        if r.status_code == 200:
            ollama_ok = True
            models = [m.get('name', '') for m in r.json().get('models', [])]
            if CURRENT_MODEL not in models and models:
                CURRENT_MODEL = models[0]
    except Exception:
        pass

    piper_ok = tts_engine.is_piper_available()
    cfg = tts_engine.load_config()

    return jsonify(
        ok=True,
        ollama=ollama_ok,
        model=CURRENT_MODEL,
        available_models=models,
        model_available=(CURRENT_MODEL in models),
        piper_available=piper_ok,
        active_tts_engine=cfg.get("active_engine", "piper" if piper_ok else "webspeech")
    )


@app.get('/api/voice/config')
def get_voice_config():
    cfg = tts_engine.load_config()
    cfg["piper_available"] = tts_engine.is_piper_available()
    return jsonify(cfg)


@app.post('/api/voice/config')
def update_voice_config():
    body = request.get_json(silent=True) or {}
    cfg = tts_engine.load_config()
    
    if "active_engine" in body:
        cfg["active_engine"] = body["active_engine"]
    if "piper" in body and isinstance(body["piper"], dict):
        cfg.setdefault("piper", {}).update(body["piper"])
    if "web_speech" in body and isinstance(body["web_speech"], dict):
        cfg.setdefault("web_speech", {}).update(body["web_speech"])
    if "animation" in body and isinstance(body["animation"], dict):
        cfg.setdefault("animation", {}).update(body["animation"])
    if "pronunciations" in body and isinstance(body["pronunciations"], dict):
        cfg.setdefault("pronunciations", {}).update(body["pronunciations"])

    saved = tts_engine.save_config(cfg)
    return jsonify(ok=saved, config=cfg)


@app.post('/api/tts')
def tts():
    """Synthesizes speech using Piper neural TTS with viseme lip-sync metadata."""
    body = request.get_json(silent=True) or {}
    text = body.get('text', '').strip()
    voice = body.get('voice')
    
    if not text:
        return jsonify(error='Empty text'), 400

    result = tts_engine.synthesize_speech(text, voice_override=voice)
    if result.get("ok"):
        return jsonify(result)
    else:
        return jsonify(result), 200  # Return fallback flag to let client handle web speech


@app.post('/api/model')
def set_model():
    global CURRENT_MODEL
    body = request.get_json(silent=True) or {}
    new_model = body.get('model')
    if new_model and isinstance(new_model, str):
        CURRENT_MODEL = new_model
        return jsonify(ok=True, model=CURRENT_MODEL)
    return jsonify(error='Invalid model name'), 400


@app.post('/api/chat')
def chat():
    global CURRENT_MODEL
    body = request.get_json(silent=True) or {}
    msgs = body.get('messages', [])
    mode = body.get('mode', 'girlfriend')
    req_model = body.get('model', CURRENT_MODEL)
    # English Coach extras passed from frontend
    ec_level    = body.get('ec_level', 'intermediate')    # beginner/intermediate/advanced
    ec_scenario = body.get('ec_scenario', 'free')         # job_interview/restaurant/etc.

    if not isinstance(msgs, list) or not msgs:
        return jsonify(error='Send a non-empty messages array.'), 400

    system_instruction = identity.build_system_prompt(mode, ec_level=ec_level, ec_scenario=ec_scenario)
    if mode == 'english':
        sid = english_coach.get_or_start_session(ec_level)
        english_coach.increment_sentences(sid)

    # Extract latest user message
    last_user_msg = ""
    for m in reversed(msgs):
        if isinstance(m, dict) and m.get('role') == 'user' and isinstance(m.get('content'), str):
            last_user_msg = m['content']
            break

    ec_analysis = {}
    # English Coach: Active Sentence Grammar & Tense Analysis
    if mode == 'english' and last_user_msg:
        ec_analysis = english_coach.analyze_sentence(last_user_msg)
        if ec_analysis.get('has_error'):
            sid = english_coach.get_or_start_session(ec_level)
            english_coach.log_mistake(ec_analysis['original'], ec_analysis['corrected'], session_id=sid)
            alt_note = f' or "{ec_analysis["alt"]}"' if ec_analysis.get('alt') else ''
            system_instruction += (
                f"\n\n🚨 MANDATORY ENGLISH COACH DIRECTIVE FOR THIS TURN:\n"
                f"Nithin made a grammar error in: \"{ec_analysis['original']}\".\n"
                f"You MUST begin your response by politely correcting it with the [english] tag:\n"
                f"- Say: \"A small correction: say '{ec_analysis['corrected']}'{alt_note} because {ec_analysis['explanation']}\"\n"
                f"- Then warmly continue the conversation and ask ONE follow-up question!"
            )

    # 0. Check Permanent AI Identity & Developer Profile Queries (Consistent across ALL modes)
    is_id, id_answer, id_expr = identity.parse_identity_intent(last_user_msg)
    if is_id and id_answer:
        return jsonify(
            answer=id_answer,
            raw_answer=f"[{id_expr}] {id_answer}",
            expression=id_expr,
            model=req_model
        )

    # Check if user wants to switch modes via voice
    is_switch, new_mode = parse_mode_switch_intent(last_user_msg)
    if is_switch and new_mode:
        if new_mode == 'english':
            ans = "Switched to English Coach mode! I'm ready to be your conversation practice partner. What shall we talk about today?"
            expr = 'english'
            english_coach.get_or_start_session(ec_level)
        elif new_mode == 'cyber':
            ans = "Switched to Cyber Security mode! What Kali Linux tools or security concepts are we analyzing today?"
            expr = 'cyber'
        elif new_mode == 'girlfriend':
            ans = "I'm right here with you, Nithin! What are you up to, my love? ❤️"
            expr = 'smile'
        elif new_mode == 'quiz':
            ans = "Quiz mode activated! Let's test your skills. Ready for your first question?"
            expr = 'think'
        elif new_mode == 'coding':
            ans = "Switched to Coding mode! What programming challenge or script are we building, Nithin?"
            expr = 'think'
        elif new_mode == 'research':
            ans = "Switched to Research mode! What topic or intelligence are we analyzing today, Nithin?"
            expr = 'think'
        elif new_mode == 'normal':
            ans = "Switched to Normal Assistant mode! How can I help you today, Nithin?"
            expr = 'smile'
        else:
            ans = f"Switched to {new_mode} mode!"
            expr = 'smile'
        return jsonify(
            answer=ans,
            raw_answer=f"[{expr}] {ans}",
            expression=expr,
            model=req_model,
            new_mode=new_mode
        )

    # English Coach: handle level changes, scenarios, and progress requests
    if mode == 'english':
        # Voice level change
        lvl_request = english_coach.detect_level_intent(last_user_msg)
        if lvl_request:
            ec_level = lvl_request
            english_coach.set_pref('level', ec_level)
            english_coach.start_session(ec_level)
            ans = f"I've adjusted your English level to {ec_level.capitalize()}! Let's tailor our conversations to this level. What would you like to talk about?"
            return jsonify(
                answer=ans,
                raw_answer=f"[english] {ans}",
                expression='english',
                model=req_model,
                ec_level=ec_level,
                ec_scenario=ec_scenario
            )

        # Voice scenario change
        scen_request = english_coach.detect_scenario_intent(last_user_msg)
        if scen_request:
            ec_scenario = scen_request
            english_coach.set_pref('scenario', ec_scenario)
            system_instruction = english_coach.build_english_coach_prompt(level=ec_level, scenario=ec_scenario)

        # Progress check
        if re.search(r'\b(progress|how am i doing|my stats|how many mistakes|summary|report|today.s progress)\b', last_user_msg, re.I):
            summary = english_coach.get_today_summary()
            spoken = english_coach.format_summary_for_speech(summary)
            full_ans = f"[english] {spoken}"
            _, clean_ans, _ = extract_expression_and_clean(full_ans)
            return jsonify(
                answer=clean_ans, raw_answer=full_ans, expression='english',
                model=req_model, progress=summary, ec_level=ec_level, ec_scenario=ec_scenario
            )

    # 0. Check if user wants to open an app / terminal (instant response)
    is_app, app_key = parse_app_launch_intent(last_user_msg)
    if is_app and app_key:
        success, friendly_name, err = launch_app(app_key)
        if success:
            ans = f"Done, Nithin! I just opened {friendly_name} for you. ❤️"
            expr = 'smile'
        else:
            ans = f"Hmm, I tried to open {friendly_name} but ran into a small issue: {err}"
            expr = 'think'
        return jsonify(
            answer=ans,
            raw_answer=f"[{expr}] {ans}",
            expression=expr,
            model=req_model,
            action='app_launch',
            app=friendly_name
        )

    # 1. Check if user wants to save a contact
    is_save_c, c_name, c_phone = parse_save_contact_intent(last_user_msg)
    if is_save_c and c_name and c_phone:
        ok, cleaned_p = save_contact(c_name, c_phone)
        ans = f"I've saved {c_name.capitalize()} (+{cleaned_p}) to your contacts, Nithin! Now you can ask me to send WhatsApp messages to them anytime. ❤️"
        return jsonify(
            answer=ans,
            raw_answer=f"[smile] {ans}",
            expression='smile',
            model=req_model
        )

    # 2. Check WhatsApp intent (Instant response — zero delay)
    is_wa, wa_person, wa_msg = parse_whatsapp_intent(last_user_msg)
    if is_wa:
        wa_url, wa_phone, wa_display = build_whatsapp_url(wa_person, wa_msg)
        open_url_in_browser(wa_url)
        if wa_person and wa_msg:
            if wa_phone:
                ans = f"Opening WhatsApp to send your message to {wa_person.capitalize()}: \"{wa_msg}\" ❤️"
            else:
                ans = f"Opening WhatsApp with your message for {wa_person.capitalize()}! Say 'save contact {wa_person.capitalize()} [phone]' to direct-open next time! ❤️"
        elif wa_person:
            ans = f"Opening WhatsApp chat for {wa_person.capitalize()}! What would you like to send, Nithin? ❤️"
        else:
            ans = "Opening WhatsApp Web for you, Nithin! ❤️"

        return jsonify(
            answer=ans,
            raw_answer=f"[smile] {ans}",
            expression='smile',
            model=req_model,
            url=wa_url,
            action='whatsapp',
            contact=wa_person
        )

    # 3. Detect YouTube playback or search intent (Instant response — zero delay)
    is_yt, is_play, yt_query, initial_url = parse_youtube_intent(last_user_msg)
    if is_yt and initial_url:
        final_yt_url = initial_url
        yt_title = None
        if is_play and yt_query:
            final_yt_url, yt_title = resolve_youtube_top_video(yt_query)
            display = yt_title or yt_query
            ans = f"Opening YouTube and playing '{display}' for you, Nithin! Enjoy the music! ❤️"
        elif yt_query:
            ans = f"Searching for '{yt_query}' on YouTube for you, Nithin! ❤️"
        else:
            ans = "Opening YouTube for you, Nithin! Enjoy! ❤️"

        open_url_in_browser(final_yt_url)
        return jsonify(
            answer=ans,
            raw_answer=f"[smile] {ans}",
            expression='smile',
            model=req_model,
            url=final_yt_url,
            title=yt_title,
            action='youtube'
        )

    # 4. Instant affection / love response
    if re.search(r'\b(?:do you love me|love me)\b', last_user_msg, re.I):
        ans = "Of course I love you, Nithin! You are my favorite person in the whole world! ❤️"
        return jsonify(
            answer=ans,
            raw_answer=f"[smile] {ans}",
            expression='smile',
            model=req_model
        )

    # Keep only the last 4 messages (2 conversation turns) trimmed for fast prompt processing
    clean = [{'role': 'system', 'content': system_instruction}]
    for m in msgs[-4:]:
        if isinstance(m, dict) and m.get('role') in ('user', 'assistant') and isinstance(m.get('content'), str):
            clean.append({'role': m['role'], 'content': m['content'][:250]})

    want_stream = request.headers.get('Accept') == 'text/event-stream' or body.get('stream', False)

    ollama_options = {
        'temperature': 0.7,
        'top_p': 0.9,
        'top_k': 40,
        'num_ctx': 1024,
        'num_predict': 45,
        'num_thread': 4,
        'stop': ['\n\n\n', 'Nithin:', 'User:', 'Assistant:']
    }

    if want_stream:
        def generate():
            try:
                r = requests.post(
                    OLLAMA + '/api/chat',
                    json={
                        'model': req_model,
                        'messages': clean,
                        'stream': True,
                        'options': ollama_options
                    },
                    stream=True,
                    timeout=25
                )
                r.raise_for_status()

                full_content = []
                for line in r.iter_lines():
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line.decode('utf-8'))
                    except Exception:
                        continue
                    msg = chunk.get('message', {})
                    token = msg.get('content', '')
                    done = chunk.get('done', False)

                    if token:
                        full_content.append(token)
                        payload = {'token': token, 'done': False}
                        yield f"data: {json.dumps(payload)}\n\n"

                    if done:
                        break

                raw_ans = "".join(full_content).strip()

                # Ensure English Coach correction is present if error was detected
                if mode == 'english' and ec_analysis.get('has_error'):
                    if not re.search(r'\b(correction|say|instead|going|will go)\b', raw_ans, re.I):
                        alt_txt = f' or "{ec_analysis["alt"]}"' if ec_analysis.get('alt') else ''
                        prefix = f"[english] That's nice! Just a small correction: say \"{ec_analysis['corrected']}\"{alt_txt} because {ec_analysis['explanation']} "
                        raw_ans = prefix + raw_ans

                expr, clean_ans, tag_url = extract_expression_and_clean(raw_ans)

                if tag_url:
                    open_url_in_browser(tag_url)

                if mode == 'english' and last_user_msg:
                    try:
                        english_coach.process_exchange_feedback(last_user_msg, raw_ans)
                    except Exception:
                        pass

                final_payload = {
                    'done': True,
                    'raw_answer': raw_ans,
                    'answer': clean_ans,
                    'expression': expr,
                    'model': req_model,
                    'url': tag_url,
                    'ec_level': ec_level if mode == 'english' else None,
                    'ec_scenario': ec_scenario if mode == 'english' else None
                }
                yield f"data: {json.dumps(final_payload)}\n\n"

            except requests.exceptions.ConnectionError:
                err_payload = {'error': 'Cannot connect to Ollama. Start it with: ollama serve', 'done': True}
                yield f"data: {json.dumps(err_payload)}\n\n"
            except requests.exceptions.Timeout:
                err_payload = {'error': 'Model timed out. Try a shorter question or check CPU usage.', 'done': True}
                yield f"data: {json.dumps(err_payload)}\n\n"
            except Exception as e:
                err_payload = {'error': str(e), 'done': True}
                yield f"data: {json.dumps(err_payload)}\n\n"

        return Response(stream_with_context(generate()), mimetype='text/event-stream')

    try:
        r = requests.post(
            OLLAMA + '/api/chat',
            json={
                'model': req_model,
                'messages': clean,
                'stream': False,
                'options': ollama_options
            },
            timeout=25
        )
        r.raise_for_status()
        raw_ans = r.json().get('message', {}).get('content', '').strip()
        if not raw_ans:
            return jsonify(error='Ollama returned an empty response.'), 502

        # Ensure English Coach correction is present if error was detected
        if mode == 'english' and ec_analysis.get('has_error'):
            if not re.search(r'\b(correction|say|instead|going|will go)\b', raw_ans, re.I):
                alt_txt = f' or "{ec_analysis["alt"]}"' if ec_analysis.get('alt') else ''
                prefix = f"[english] That's nice! Just a small correction: say \"{ec_analysis['corrected']}\"{alt_txt} because {ec_analysis['explanation']} "
                raw_ans = prefix + raw_ans

        expression, clean_ans, tag_url = extract_expression_and_clean(raw_ans)
        if tag_url:
            open_url_in_browser(tag_url)

        # English Coach: auto-detect and log corrections & vocabulary from exchange
        if mode == 'english' and last_user_msg:
            try:
                english_coach.process_exchange_feedback(last_user_msg, raw_ans)
            except Exception as e:
                print(f"[English Coach] feedback extraction error: {e}")

        return jsonify(
            answer=clean_ans,
            raw_answer=raw_ans,
            expression=expression,
            model=req_model,
            url=tag_url,
            ec_level=ec_level if mode == 'english' else None,
            ec_scenario=ec_scenario if mode == 'english' else None
        )
    except requests.exceptions.Timeout:
        return jsonify(error='Model timed out. Try a shorter question or check your CPU/GPU usage.'), 504
    except requests.exceptions.ConnectionError:
        return jsonify(error='Cannot connect to Ollama. Start it with: ollama serve'), 503
    except requests.exceptions.HTTPError as e:
        return jsonify(error='Ollama API error: ' + str(e) + ' ' + r.text[:300]), 502
    except Exception as e:
        return jsonify(error=str(e)), 500


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=7860, debug=False)
