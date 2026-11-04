"""
english_coach.py — English Coach Module for Niramyan-AI
========================================================
Handles:
 - Dedicated system prompts per learning level (beginner / intermediate / advanced)
 - SQLite-backed progress tracking (sessions, mistakes, vocabulary, sentences)
 - Progress summary generation
 - Common-mistake pattern detection & personalization hints
"""

import sqlite3
import os
import re
import json
from datetime import date, datetime

# ---------------------------------------------------------------------------
# Database Setup
# ---------------------------------------------------------------------------
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'english_progress.db')


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Create all tables if they don't exist."""
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS sessions (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                date        TEXT NOT NULL,
                level       TEXT NOT NULL DEFAULT 'intermediate',
                started_at  TEXT NOT NULL,
                ended_at    TEXT,
                sentences   INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS mistakes (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id  INTEGER,
                date        TEXT NOT NULL,
                original    TEXT NOT NULL,
                corrected   TEXT NOT NULL,
                mistake_type TEXT,
                created_at  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS vocabulary (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                word        TEXT NOT NULL UNIQUE,
                example     TEXT,
                learned_on  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_prefs (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        """)


# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------
_current_session_id = None


def start_session(level: str = 'intermediate') -> int:
    global _current_session_id
    init_db()
    now = datetime.now().isoformat()
    today = date.today().isoformat()
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO sessions (date, level, started_at) VALUES (?,?,?)",
            (today, level, now)
        )
        _current_session_id = cur.lastrowid
    return _current_session_id


def end_session():
    global _current_session_id
    if not _current_session_id:
        return
    with get_db() as conn:
        conn.execute(
            "UPDATE sessions SET ended_at=? WHERE id=?",
            (datetime.now().isoformat(), _current_session_id)
        )
    _current_session_id = None


def get_or_start_session(level: str = 'intermediate') -> int:
    global _current_session_id
    if _current_session_id:
        return _current_session_id
    return start_session(level)


def increment_sentences(session_id: int, count: int = 1):
    with get_db() as conn:
        conn.execute(
            "UPDATE sessions SET sentences = sentences + ? WHERE id=?",
            (count, session_id)
        )


# ---------------------------------------------------------------------------
# Mistake logging
# ---------------------------------------------------------------------------

MISTAKE_PATTERNS = [
    (r'\b(he|she|it)\s+go\b',                    'subject-verb agreement'),
    (r'\b(i|you|we|they)\s+goes\b',              'subject-verb agreement'),
    (r'\bI\s+am\s+go\b',                         'verb form'),
    (r'\b(was|were)\s+go\b',                     'verb form'),
    (r'\b(you|we|they)\s+is\b',                  'is / am / are'),
    (r'\b(he|she|it)\s+are\b',                   'is / am / are'),
    (r'\bI\s+is\b',                              'is / am / are'),
    (r'\b(he|she|it)\s+have\b',                  'has / have'),
    (r'\b(i|you|we|they)\s+has\b',               'has / have'),
    (r'\b(you|we|they)\s+was\b',                 'was / were'),
    (r'\b(he|she|it|i)\s+were\b',                'was / were'),
    (r'\b(a)\s+[aeiouAEIOU]',                    'articles (a / an)'),
    (r'\ban\s+[^aeiouAEIOU\s]',                  'articles (a / an)'),
    (r'\bdid\s+\w+ed\b',                         'double past tense'),
    (r'\bdoesn\'t\s+\w+s\b',                    'subject-verb agreement'),
    (r'\bdon\'t\s+\w+s\b',                      'subject-verb agreement'),
    (r'\bmore\s+\w+er\b',                        'comparative form'),
    (r'\bmore\s+better\b',                       'double comparative'),
    (r'\byesterday\s+I\s+(?:go|see|eat|come)\b', 'past tense'),
    (r'\bin\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b', 'prepositions'),
    (r'\bat\s+(?:the\s+)?morning\b',             'prepositions'),
    (r'\blisten\s+(?:to\s+)?(?:music|song)\b',  'prepositions'),
    (r'\b(?:many|two|three)\s+peoples\b',        'irregular plurals'),
    (r'\bchilds\b',                              'irregular plurals'),
]


def classify_mistake(sentence: str) -> str:
    """Return a rough category for a mistake sentence."""
    s = sentence.lower()
    for pattern, label in MISTAKE_PATTERNS:
        if re.search(pattern, s, re.I):
            return label
    return 'general grammar'


def log_mistake(original: str, corrected: str, session_id: int = None):
    """Store a correction in the mistakes table."""
    init_db()
    if not session_id:
        session_id = _current_session_id
    today = date.today().isoformat()
    now = datetime.now().isoformat()
    mtype = classify_mistake(original)
    with get_db() as conn:
        conn.execute(
            "INSERT INTO mistakes (session_id, date, original, corrected, mistake_type, created_at) VALUES (?,?,?,?,?,?)",
            (session_id, today, original[:500], corrected[:500], mtype, now)
        )


def log_vocabulary(word: str, example: str = None):
    """Store a new vocabulary word."""
    init_db()
    today = date.today().isoformat()
    with get_db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO vocabulary (word, example, learned_on) VALUES (?,?,?)",
            (word.lower().strip(), example, today)
        )


def process_exchange_feedback(user_text: str, ai_reply: str, session_id: int = None):
    """
    Examines the assistant's reply for grammar corrections and vocabulary suggestions,
    and logs them into the database automatically.
    """
    if not ai_reply or not user_text:
        return
    
    # 1. Grammar correction detection
    corr_match = re.search(
        r'(?:say|correct(?:ed|ion)?(?:\s+is)?|instead(?:\s+of\s+[^,\.]+)?,\s*(?:say)?|should\s+be)\s*[:\-]?\s*["\']([^"\'\n]+)["\']',
        ai_reply,
        re.I
    )
    if corr_match:
        corrected = corr_match.group(1).strip()
        if len(corrected) > 2 and corrected.lower() != user_text.lower():
            log_mistake(user_text, corrected, session_id=session_id)
            
    # 2. Vocabulary suggestions detection
    vocab_matches = re.findall(
        r'(?:say|use|word(?:s)?\s+like|try)\s+["\']([a-zA-Z]{3,20})["\']',
        ai_reply,
        re.I
    )
    stop_words = {'the', 'and', 'for', 'you', 'that', 'with', 'this', 'have', 'from', 'they', 'will', 'would', 'could', 'should'}
    for w in vocab_matches:
        w_clean = w.strip().lower()
        if w_clean not in stop_words:
            log_vocabulary(w_clean, example=ai_reply[:200])


def detect_scenario_intent(text: str) -> str | None:
    """Detect voice requests to switch roleplay scenario."""
    t = text.lower().strip()
    scenario_map = [
        ('job_interview', r'\b(?:job\s+interview|interview\s+practice|practice\s+(?:an?\s+)?interview)\b'),
        ('restaurant',    r'\b(?:restaurant|order(?:ing)?\s+food|waiter|server|cafe|menu)\b'),
        ('shopping',      r'\b(?:shopping|buy(?:ing)?\s+(?:clothes|things|groceries)|store|supermarket)\b'),
        ('travel',        r'\b(?:travel(?:ing)?|airport|flight|hotel|tourist|directions)\b'),
        ('college',       r'\b(?:college|university|campus|professors?|class(?:es)?|assignment)\b'),
        ('friends',       r'\b(?:(?:talk|chat)\s+(?:as|with)\s+friends?|casual\s+chat)\b'),
        ('self_intro',    r'\b(?:self\s*intro(?:duction)?|introduce\s+myself)\b'),
        ('workplace',     r'\b(?:workplace|office|meeting|colleagues?|business\s+english)\b'),
        ('free',          r'\b(?:free\s+(?:chat|conversation)|normal\s+(?:chat|talk))\b'),
    ]
    if re.search(r'\b(?:practice|roleplay|scenario|let\'s\s+do|pretend|simulate|act\s+as|switch\s+to)\b', t):
        for s_key, pat in scenario_map:
            if re.search(pat, t):
                return s_key
    return None


def detect_level_intent(text: str) -> str | None:
    """Detect voice requests to change learning level."""
    t = text.lower().strip()
    m = re.search(r'\b(?:switch|change|set)\s+(?:level\s+to\s+|to\s+)?(beginner|intermediate|advanced)(?:\s+level)?\b', t)
    if m:
        return m.group(1).lower()
    return None


# ---------------------------------------------------------------------------
# User preferences
# ---------------------------------------------------------------------------

def set_pref(key: str, value):
    init_db()
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO user_prefs (key, value) VALUES (?,?)",
            (key, json.dumps(value))
        )


def get_pref(key: str, default=None):
    init_db()
    with get_db() as conn:
        row = conn.execute("SELECT value FROM user_prefs WHERE key=?", (key,)).fetchone()
        if row:
            try:
                return json.loads(row['value'])
            except Exception:
                return row['value']
    return default


# ---------------------------------------------------------------------------
# Progress summary
# ---------------------------------------------------------------------------

def get_today_summary() -> dict:
    """Return today's learning stats."""
    init_db()
    today = date.today().isoformat()
    with get_db() as conn:
        sessions = conn.execute(
            "SELECT COUNT(*) as cnt, SUM(sentences) as total_sentences FROM sessions WHERE date=?",
            (today,)
        ).fetchone()

        mistakes_today = conn.execute(
            "SELECT COUNT(*) as cnt FROM mistakes WHERE date=?", (today,)
        ).fetchone()

        mistake_types = conn.execute(
            "SELECT mistake_type, COUNT(*) as cnt FROM mistakes WHERE date=? GROUP BY mistake_type ORDER BY cnt DESC LIMIT 3",
            (today,)
        ).fetchall()

        vocab_today = conn.execute(
            "SELECT COUNT(*) as cnt FROM vocabulary WHERE learned_on=?", (today,)
        ).fetchone()

    top_mistakes = [r['mistake_type'] for r in mistake_types]

    return {
        'date': today,
        'sessions': sessions['cnt'] or 0,
        'sentences_practiced': sessions['total_sentences'] or 0,
        'mistakes_corrected': mistakes_today['cnt'] or 0,
        'top_mistake_types': top_mistakes,
        'vocabulary_learned': vocab_today['cnt'] or 0,
    }


def get_all_time_summary() -> dict:
    """Return overall learning stats."""
    init_db()
    with get_db() as conn:
        totals = conn.execute(
            "SELECT COUNT(*) as sessions, SUM(sentences) as sentences FROM sessions"
        ).fetchone()

        total_mistakes = conn.execute(
            "SELECT COUNT(*) as cnt FROM mistakes"
        ).fetchone()

        frequent_mistakes = conn.execute(
            "SELECT mistake_type, COUNT(*) as cnt FROM mistakes GROUP BY mistake_type ORDER BY cnt DESC LIMIT 5"
        ).fetchall()

        total_vocab = conn.execute(
            "SELECT COUNT(*) as cnt FROM vocabulary"
        ).fetchone()

    return {
        'total_sessions': totals['sessions'] or 0,
        'total_sentences': totals['sentences'] or 0,
        'total_mistakes': total_mistakes['cnt'] or 0,
        'frequent_mistake_types': [{'type': r['mistake_type'], 'count': r['cnt']} for r in frequent_mistakes],
        'total_vocabulary': total_vocab['cnt'] or 0,
    }


def format_summary_for_speech(summary: dict) -> str:
    """Turn a summary dict into a natural spoken summary."""
    s = summary
    lines = []
    if s.get('sentences_practiced'):
        lines.append(f"You practiced {s['sentences_practiced']} sentences today.")
    if s.get('mistakes_corrected'):
        lines.append(f"I helped you fix {s['mistakes_corrected']} grammar mistakes.")
    if s.get('top_mistake_types'):
        area = ' and '.join(s['top_mistake_types'][:2])
        lines.append(f"Your main areas to work on are {area}.")
    if s.get('vocabulary_learned'):
        lines.append(f"You learned {s['vocabulary_learned']} new words today.")
    if not lines:
        lines.append("No practice data yet for today. Let's get started!")
    return ' '.join(lines)


# ---------------------------------------------------------------------------
# Weakness personalization hint for system prompt
# ---------------------------------------------------------------------------

def get_weakness_hint() -> str:
    """Return a short note about recurring mistakes to inject into the system prompt."""
    init_db()
    with get_db() as conn:
        rows = conn.execute(
            "SELECT mistake_type, COUNT(*) as cnt FROM mistakes GROUP BY mistake_type ORDER BY cnt DESC LIMIT 3"
        ).fetchall()
    if not rows:
        return ""
    items = ', '.join(f"{r['mistake_type']} ({r['cnt']}x)" for r in rows)
    return (
        f"\n\n## PERSONALIZED WEAKNESS TARGETING\n"
        f"Nithin has recurring difficulty with: {items}.\n"
        f"Naturally guide him to practice these structures and provide encouraging feedback when he gets them right."
    )


# ---------------------------------------------------------------------------
# Sentence Grammar & Tense Analyzer
# ---------------------------------------------------------------------------

def analyze_sentence(user_text: str) -> dict:
    """
    Analyzes the user's sentence for high-frequency English grammar, tense,
    and phrasing mistakes, providing an immediate correction directive for the coach.
    """
    if not user_text:
        return {'has_error': False}
    t = user_text.strip()

    # 1. Simple present 'go' with future time indicator ('I go to college tomorrow')
    m = re.search(r'\b(i|we|they|you)\s+go\s+(?:to\s+([^,.\?!]+?)\s+)?(tomorrow|tonight|next\s+(?:week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b', t, re.I)
    if m:
        subj = m.group(1).capitalize()
        dest = f" to {m.group(2).strip()}" if m.group(2) else ""
        time_adv = m.group(3)
        corr1 = f"{subj} am going{dest} {time_adv}" if subj == 'I' else f"{subj} are going{dest} {time_adv}"
        corr2 = f"{subj} will go{dest} {time_adv}"
        return {
            'has_error': True,
            'original': t,
            'corrected': corr1,
            'alt': corr2,
            'mistake_type': 'future tense / verb form',
            'explanation': f'when talking about future plans happening {time_adv}, say "{corr1}" or "{corr2}" instead of simple present "go".'
        }

    # 2. 'am/is/are' + base verb ('Today I am go to college', 'I am study')
    m = re.search(r'\b(i\s+am|he\s+is|she\s+is|it\s+is|we\s+are|they\s+are|you\s+are)\s+(go|study|work|play|eat|watch|do|come|visit|travel|learn|read|write)\b', t, re.I)
    if m:
        aux = m.group(1)
        base = m.group(2).lower()
        ing_verb = base + 'ing' if not base.endswith('e') else base[:-1] + 'ing'
        if base == 'study': ing_verb = 'studying'
        elif base == 'travel': ing_verb = 'traveling'
        corr = re.sub(r'\b' + re.escape(aux) + r'\s+' + re.escape(base) + r'\b', f'{aux} {ing_verb}', t, flags=re.I)
        return {
            'has_error': True,
            'original': t,
            'corrected': corr,
            'alt': re.sub(r'\b' + re.escape(aux) + r'\s+' + re.escape(base) + r'\b', base, t, flags=re.I),
            'mistake_type': 'verb form / continuous tense',
            'explanation': f'after "{aux}", use the continuous form with "-ing" (say "{aux} {ing_verb}") or simple present.'
        }

    # 3. Third-person singular without -s ('He go to school', 'She work')
    m = re.search(r'\b(he|she|it|everyone|someone)\s+(go|work|want|like|come|see|make|take|know|think|live|speak)\b', t, re.I)
    if m:
        subj = m.group(1).capitalize()
        base = m.group(2).lower()
        s_verb = base + 'es' if base in ('go', 'do') else base + 's'
        corr = re.sub(r'\b' + re.escape(m.group(1)) + r'\s+' + re.escape(base) + r'\b', f'{m.group(1)} {s_verb}', t, flags=re.I)
        return {
            'has_error': True,
            'original': t,
            'corrected': corr,
            'alt': None,
            'mistake_type': 'subject-verb agreement',
            'explanation': f'in simple present tense with {subj}, add "-s" or "-es" to the verb (say "{subj} {s_verb}").'
        }

    # 4. 'He/She don\'t' -> 'doesn\'t'
    m = re.search(r'\b(he|she|it|everyone)\s+don\'?t\b', t, re.I)
    if m:
        corr = re.sub(r'\bdon\'?t\b', "doesn't", t, flags=re.I)
        return {
            'has_error': True,
            'original': t,
            'corrected': corr,
            'alt': None,
            'mistake_type': 'subject-verb agreement',
            'explanation': "with he, she, and it, use 'doesn't' instead of 'don't'."
        }

    # 5. 'He/She have' -> 'has'
    m = re.search(r'\b(he|she|it)\s+have\b', t, re.I)
    if m:
        corr = re.sub(r'\bhave\b', 'has', t, flags=re.I)
        return {
            'has_error': True,
            'original': t,
            'corrected': corr,
            'alt': None,
            'mistake_type': 'subject-verb agreement',
            'explanation': "with he, she, and it in simple present, use 'has' instead of 'have'."
        }

    # 6. 'Yesterday / Last ...' with present tense
    m = re.search(r'\b(yesterday|last\s+(?:night|week|month|year))\b.*?\b(go|see|come|buy|meet|eat|take|am|is|are)\b', t, re.I)
    if m:
        pres = m.group(2).lower()
        past_map = {'go': 'went', 'see': 'saw', 'come': 'came', 'buy': 'bought', 'meet': 'met', 'eat': 'ate', 'take': 'took', 'am': 'was', 'is': 'was', 'are': 'were'}
        past = past_map.get(pres, pres + 'ed')
        corr = re.sub(r'\b' + re.escape(pres) + r'\b', past, t, count=1)
        return {
            'has_error': True,
            'original': t,
            'corrected': corr,
            'alt': None,
            'mistake_type': 'past tense',
            'explanation': f'we use past tense (say "{past}") when describing actions that happened in the past.'
        }

    # 7. 'I am agree' -> 'I agree'
    if re.search(r'\b(?:i\s+am\s+agree|i\'m\s+agree)\b', t, re.I):
        corr = re.sub(r'\b(?:i\s+am\s+agree|i\'m\s+agree)\b', 'I agree', t, flags=re.I)
        return {
            'has_error': True,
            'original': t,
            'corrected': corr,
            'alt': None,
            'mistake_type': 'stative verb form',
            'explanation': 'we say "I agree" rather than "I am agree" because agree is already a verb.'
        }

    # 8. 'Did / didn\'t' + past tense ('did went', 'didn\'t saw')
    m = re.search(r'\b(did|didn\'?t)(?:\s+[a-z]+)?\s+(went|saw|came|ate|took|bought|met)\b', t, re.I)
    if m:
        aux = m.group(1)
        past = m.group(2).lower()
        base_map = {'went': 'go', 'saw': 'see', 'came': 'come', 'ate': 'eat', 'took': 'take', 'bought': 'buy', 'met': 'meet'}
        base = base_map.get(past, past)
        corr = re.sub(r'\b' + re.escape(past) + r'\b', base, t, flags=re.I)
        return {
            'has_error': True,
            'original': t,
            'corrected': corr,
            'alt': None,
            'mistake_type': 'past auxiliary verb form',
            'explanation': f'after "{aux}", always use the base form of the verb (say "{aux} {base}").'
        }

    return {'has_error': False}


# ---------------------------------------------------------------------------
# System Prompts per Level
# ---------------------------------------------------------------------------

ENGLISH_COACH_BASE = """You are Ramya, Nithin's active and caring English conversation coach and speaking tutor.

YOUR #1 PRIORITY IN EVERY SINGLE TURN:
1. ACTIVELY INSPECT Nithin's sentence for grammar, tense, or phrasing mistakes (e.g. saying 'I go to college tomorrow' instead of 'I am going to college tomorrow', or 'He go' instead of 'He goes').
2. IF THERE IS A MISTAKE: You MUST ALWAYS gently correct it in your very first sentence!
   - Tag: Start with [english].
   - Format: "A small correction: say '[Corrected sentence]' because [1 short sentence explanation]."
   - Example: "[english] That's great! Just a quick correction: say 'I am going to college tomorrow' or 'I will go to college tomorrow' since it's happening tomorrow. What are you going to study at college, Nithin?"
3. IF THERE IS NO MISTAKE: Praise his English, suggest a richer vocabulary word if relevant, and ask a question.
4. Keep spoken replies short (2 sentences max). Be friendly and encouraging.
5. End with ONE natural follow-up question to keep Nithin talking!"""

LEVEL_ADDITIONS = {
    'beginner': """
LEVEL: BEGINNER — Use simple sentences under 12 words. Correct only basic mistakes (tense, articles). Ask simple questions.""",
    'intermediate': """
LEVEL: INTERMEDIATE — Everyday natural English. Correct tense and prepositions. Encourage complete sentences.""",
    'advanced': """
LEVEL: ADVANCED — Fluent natural English with idioms and professional vocabulary. Refine phrasing."""
}

SCENARIOS = {
    'job_interview': "CURRENT SCENARIO: Job Interview Practice — You are the interviewer. Start by asking \"Tell me about yourself.\" Ask professional follow-up questions.",
    'restaurant': "CURRENT SCENARIO: Restaurant Conversation — You are a friendly server. Start by welcoming the user and asking for their order.",
    'shopping': "CURRENT SCENARIO: Shopping Conversation — You are a shop assistant. Help the user practice asking for items, prices, and sizes.",
    'travel': "CURRENT SCENARIO: Travel Conversation — You are a helpful local or airport staff. Practice directions, bookings, and travel situations.",
    'college': "CURRENT SCENARIO: College / University Conversation — Talk about classes, professors, assignments, and campus life.",
    'friends': "CURRENT SCENARIO: Talking with Friends — Have a casual friendly conversation about hobbies, weekend plans, movies, and daily life.",
    'self_intro': "CURRENT SCENARIO: Self Introduction Practice — Help the user practice introducing themselves confidently in different situations.",
    'workplace': "CURRENT SCENARIO: Workplace Communication — Practice professional conversations: meetings, emails, colleagues, and workplace situations.",
    'free': ""  # No scenario restriction
}


def build_english_coach_prompt(level: str = 'intermediate', scenario: str = 'free') -> str:
    """Compose the full system prompt for English Coach mode, inheriting CORE_IDENTITY."""
    try:
        from identity import CORE_IDENTITY
    except ImportError:
        CORE_IDENTITY = ""

    level = level if level in LEVEL_ADDITIONS else 'intermediate'
    scenario_note = SCENARIOS.get(scenario, '')
    weakness_note = get_weakness_hint()

    prompt = (CORE_IDENTITY + "\n\n" if CORE_IDENTITY else "") + ENGLISH_COACH_BASE
    prompt += LEVEL_ADDITIONS[level]
    if scenario_note:
        prompt += f"\n{scenario_note}"
    if weakness_note:
        prompt += weakness_note
    prompt += "\n\nRemember: Keep ALL replies short and conversational. You are speaking out loud, not writing an essay."
    return prompt


# Initialise DB on import
init_db()

