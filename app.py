"""
Garmin Dashboard – Backend Flask
Lancer : python app.py  →  http://localhost:5000
"""
import os, json, zipfile, tempfile, subprocess, sqlite3, re, base64, uuid, threading, hashlib
from pathlib import Path
from datetime import datetime, timezone
from flask import Flask, render_template, request, jsonify, send_from_directory
import rarfile

# Charger .env si présent (ANTHROPIC_API_KEY, etc.)
_env_file = Path(__file__).parent / ".env"
if _env_file.exists():
    for _line in _env_file.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _, _v = _line.partition("=")
            os.environ[_k.strip()] = _v.strip()

try:
    import anthropic as _anthropic
    _ANTHROPIC_AVAILABLE = True
except ImportError:
    _ANTHROPIC_AVAILABLE = False

try:
    from openai import OpenAI as _OpenAI
    _OPENAI_AVAILABLE = True
except ImportError:
    _OPENAI_AVAILABLE = False

try:
    from garminconnect import Garmin as _GarminConnect
    _GARMIN_AVAILABLE = True
except ImportError:
    _GARMIN_AVAILABLE = False

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 500 * 1024 * 1024
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", os.urandom(24).hex())

def _file_hash(path):
    try:
        with open(path, 'rb') as f:
            return hashlib.md5(f.read()).hexdigest()[:8]
    except:
        return '0'

def _dir_hash(directory):
    """Hash combiné de tous les .js du dossier — change dès qu'un fichier est modifié."""
    import glob as _glob
    h = hashlib.md5()
    for path in sorted(_glob.glob(os.path.join(directory, '**', '*.js'), recursive=True)):
        try:
            h.update(str(os.path.getmtime(path)).encode())
            h.update(path.encode())
        except Exception:
            pass
    return h.hexdigest()[:8]

@app.context_processor
def inject_static_version():
    base = os.path.dirname(os.path.abspath(__file__))
    return {
        'css_v': _dir_hash(os.path.join(base, 'static', 'css')),
        'js_v':  _dir_hash(os.path.join(base, 'static', 'js')),
    }

# DATA_DIR : répertoire persistant (volume Railway) ou local par défaut
DATA_DIR       = Path(os.environ.get("DATA_DIR", Path(__file__).parent))
DATABASE       = DATA_DIR / "garmin_data.db"
MEALS_DIR      = DATA_DIR / "meals"
GARMIN_TOKENS  = DATA_DIR / ".garmin_tokens"
MEALS_DIR.mkdir(parents=True, exist_ok=True)

# En production, servir les photos via Flask (Railway n'a pas de static externe)
@app.route("/static/meals/<path:filename>")
def serve_meal_image(filename):
    return send_from_directory(MEALS_DIR, filename)

# ──────────────────────────────────────────────
# SQLITE PERSISTENCE
# ──────────────────────────────────────────────
def init_db():
    with sqlite3.connect(DATABASE) as c:
        c.execute("""CREATE TABLE IF NOT EXISTS latest(
            id INTEGER PRIMARY KEY CHECK(id=1),
            imported_at TEXT,
            data TEXT
        )""")
        c.execute("""CREATE TABLE IF NOT EXISTS training_week(
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            uploaded_at TEXT,
            week_label  TEXT,
            sessions    TEXT
        )""")
        c.execute("""CREATE TABLE IF NOT EXISTS meals(
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            analyzed_at TEXT,
            meal_date   TEXT,
            description TEXT,
            calories    INTEGER,
            proteines   INTEGER,
            glucides    INTEGER,
            lipides     INTEGER,
            fibres      INTEGER,
            confiance   TEXT,
            aliments    TEXT,
            image_file  TEXT
        )""")
        # ── Flashcards ──
        c.execute("""CREATE TABLE IF NOT EXISTS fc_decks(
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL UNIQUE,
            created_at TEXT,
            anki_name  TEXT
        )""")
        c.execute("""CREATE TABLE IF NOT EXISTS fc_cards(
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            deck_id       INTEGER REFERENCES fc_decks(id) ON DELETE CASCADE,
            front         TEXT NOT NULL,
            back          TEXT NOT NULL,
            anki_note_id  INTEGER,
            interval      INTEGER DEFAULT 1,
            ease_factor   REAL    DEFAULT 2.5,
            repetitions   INTEGER DEFAULT 0,
            due_date      TEXT    DEFAULT (date('now')),
            last_reviewed TEXT,
            total_reviews INTEGER DEFAULT 0,
            correct_reviews INTEGER DEFAULT 0
        )""")

def save_to_db(data: dict):
    with sqlite3.connect(DATABASE) as c:
        c.execute("""INSERT INTO latest(id,imported_at,data) VALUES(1,?,?)
            ON CONFLICT(id) DO UPDATE SET
                imported_at=excluded.imported_at,
                data=excluded.data""",
            [datetime.now(timezone.utc).isoformat(), json.dumps(data, ensure_ascii=False)])

def load_from_db() -> dict | None:
    try:
        with sqlite3.connect(DATABASE) as c:
            row = c.execute("SELECT data FROM latest WHERE id=1").fetchone()
            return json.loads(row[0]) if row else None
    except Exception:
        return None

init_db()

# ──────────────────────────────────────────────
# RAR READER
# ──────────────────────────────────────────────
_UNRAR_CANDIDATES = [
    r"C:\Program Files\WinRAR\unrar.exe",
    r"C:\Program Files (x86)\WinRAR\unrar.exe",
    "unrar", "bsdtar",
]

def _find_unrar():
    for c in _UNRAR_CANDIDATES:
        try:
            subprocess.run([c], capture_output=True)
            return c
        except FileNotFoundError:
            continue
    return None

_UNRAR_TOOL = _find_unrar()
if _UNRAR_TOOL:
    rarfile.UNRAR_TOOL = _UNRAR_TOOL

def extract_all_from_rar(path: str) -> dict[str, bytes]:
    if _UNRAR_TOOL:
        try:
            files = {}
            with rarfile.RarFile(path) as rf:
                for name in rf.namelist():
                    if name.endswith(".json"):
                        files[name] = rf.read(name)
            return files
        except Exception:
            pass
    with tempfile.TemporaryDirectory() as tmp:
        r = subprocess.run(["tar", "-xf", path, "-C", tmp], capture_output=True)
        if r.returncode != 0:
            raise RuntimeError("Impossible d'extraire le RAR. Installez WinRAR ou 7-Zip.")
        files = {}
        for root, _, fnames in os.walk(tmp):
            for fn in fnames:
                if fn.endswith(".json"):
                    fp = os.path.join(root, fn)
                    rel = os.path.relpath(fp, tmp).replace("\\", "/")
                    with open(fp, "rb") as f:
                        files[rel] = f.read()
        return files

def extract_all_from_zip(path: str) -> dict[str, bytes]:
    files = {}
    with zipfile.ZipFile(path) as z:
        for name in z.namelist():
            if name.endswith(".json"):
                files[name] = z.read(name)
    return files

# ──────────────────────────────────────────────
# PARSEURS GARMIN
# ──────────────────────────────────────────────
def _stress_avg(uds):
    s = uds.get("allDayStress") or {}
    for agg in s.get("aggregatorList", []):
        if agg.get("type") == "TOTAL":
            return agg.get("averageStressLevel")
    return None

def _body_battery(uds):
    # Try dynamic summary list first
    bb = uds.get("bodyBatteryDynamicSummaryList") or []
    if bb:
        vals = [b.get("bodyBatteryLevel") for b in bb if b.get("bodyBatteryLevel") is not None]
        if vals:
            return max(vals)
    # Fallback to scalar fields (varies by export version)
    for key in ("bodyBatteryChargeMax", "maxBodyBattery", "bodyBatteryHighestValue",
                "highBodyBattery", "endBodyBattery"):
        v = uds.get(key)
        if v is not None:
            return int(v)
    return None

def parse_wellness(files: dict) -> list:
    rows = []
    for name, raw in files.items():
        if "DI-Connect-Aggregator/UDSFile_" in name:
            try:
                data = json.loads(raw)
                if isinstance(data, list):
                    rows.extend(data)
            except Exception:
                pass
    rows.sort(key=lambda x: x.get("calendarDate", ""))
    out = []
    for x in rows:
        if not x.get("totalSteps"):
            continue
        out.append({
            "date":                x["calendarDate"],
            "steps":               x.get("totalSteps", 0),
            "calories":            round(x.get("totalKilocalories", 0) or 0),
            "restingHR":           (x.get("restingHeartRate")
                                    or x.get("averageRestingHeartRate")
                                    or x.get("restingHr")
                                    or x.get("minAvgHeartRate")),      # FC repos Garmin (moy. sommeil)
            "minHR":               x.get("minHeartRate"),              # min absolu (gardé pour compat)
            "maxHR":               x.get("maxHeartRate"),
            "stress":              _stress_avg(x),
            "distance_m":          x.get("totalDistanceMeters", 0),
            "activeSeconds":       x.get("activeSeconds", 0),
            "highlyActiveSeconds": x.get("highlyActiveSeconds", 0),
            "bodyBattery":         _body_battery(x),
            "hrv":                 x.get("hrv5MinHigh") or x.get("lastNightHrvScore") or x.get("hrvScore"),
        })
    return out[-365:]  # 1 an

def parse_weight(files: dict) -> list:
    """Parse weight / body composition data from Garmin ZIP export."""
    rows = []
    for name, raw in files.items():
        if any(k in name.lower() for k in ("weight", "body_comp", "bodycomposition")):
            try:
                data = json.loads(raw)
                if isinstance(data, list):
                    rows.extend(data)
            except Exception:
                pass
    rows.sort(key=lambda x: x.get("calendarDate") or x.get("date") or "")
    out, seen = [], set()
    for r in rows:
        date = r.get("calendarDate") or r.get("date", "")
        if not date or date in seen:
            continue
        w = r.get("weight")
        if w is None:
            continue
        # Garmin stores weight in grams (e.g. 80500 = 80.5 kg)
        if w > 100000:      w_kg = round(w / 1e6, 1)   # milligrams
        elif w > 1000:      w_kg = round(w / 1000, 1)  # grams
        else:               w_kg = round(w, 1)          # already kg
        if not (20 < w_kg < 300):
            continue
        seen.add(date)
        bmi = r.get("bmi")
        out.append({"date": date, "weight_kg": w_kg, "bmi": round(bmi, 1) if bmi else None})
    return out[-365:]

def parse_activities(files: dict) -> list:
    acts = []
    for name, raw in files.items():
        if "summarizedActivities" in name:
            try:
                d = json.loads(raw)
                if isinstance(d, list) and d:
                    acts = d[0].get("summarizedActivitiesExport", [])
                    break
            except Exception:
                pass
    acts.sort(key=lambda x: x.get("beginTimestamp", 0), reverse=True)
    out = []
    for act in acts[:300]:
        ts    = act.get("beginTimestamp", 0) / 1000
        dur_s = (act.get("duration") or 0) / 1000
        dist_km = round((act.get("distance") or 0) / 100000, 2)
        out.append({
            "date":         datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d"),
            "type":         act.get("activityType"),
            "name":         act.get("name"),
            "duration_min": round(dur_s / 60),
            "distance_km":  dist_km,
            "calories":     round(act.get("calories") or 0),
            "maxHR":        act.get("maxHr"),
            "avgHR":        act.get("averageHr"),
            "vo2max":       act.get("vO2MaxValue"),
        })
    return out

def parse_sleep(files: dict) -> list:
    rows = []
    for name, raw in files.items():
        if "sleepData" in name:
            try:
                data = json.loads(raw)
                if isinstance(data, list):
                    rows.extend(data)
            except Exception:
                pass
    rows.sort(key=lambda x: x.get("calendarDate", ""))
    out = []
    for s in rows:
        deep  = s.get("deepSleepSeconds",  0) or 0
        light = s.get("lightSleepSeconds", 0) or 0
        rem   = s.get("remSleepSeconds",   0) or 0
        awake = s.get("awakeSleepSeconds", 0) or 0
        if deep + light < 3600:
            continue
        inbed = 0
        # Prioritise local timestamps (user's timezone) over GMT
        start_str = (s.get("sleepStartTimestampLocal") or s.get("sleepStartTimestampGMT") or "")
        end_str   = (s.get("sleepEndTimestampLocal")   or s.get("sleepEndTimestampGMT")   or "")
        if start_str and end_str:
            try:
                s1 = datetime.fromisoformat(start_str.replace(".0", ""))
                e1 = datetime.fromisoformat(end_str.replace(".0", ""))
                inbed = int((e1 - s1).total_seconds() // 60)
            except Exception:
                pass
        # Sleep score (Garmin Connect ≥ 2022)
        score = None
        ss = s.get("sleepScores")
        if isinstance(ss, dict):
            score = (ss.get("overall") or {}).get("value")
        out.append({
            "date":           s["calendarDate"],
            "sleepTotal_min": round((deep + light + rem) / 60),
            "inBed_min":      inbed,
            "deep_min":       round(deep  / 60),
            "light_min":      round(light / 60),
            "rem_min":        round(rem   / 60),
            "awake_min":      round(awake / 60),
            "bedtime":        start_str[11:16] if start_str else "",
            "wakeTime":       end_str[11:16]   if end_str   else "",
            "score":          score,
        })
    return out[-365:]

def parse_customer(files: dict) -> dict:
    for name, raw in files.items():
        if "customer.json" in name:
            try:
                d = json.loads(raw)
                return {
                    "firstName": d.get("firstName", ""),
                    "username":  d.get("username", ""),
                    "dob":       d.get("dateOfBirth", ""),
                }
            except Exception:
                pass
    return {}

def build_garmin_data(files: dict) -> dict:
    return {
        "wellness":   parse_wellness(files),
        "activities": parse_activities(files),
        "sleep":      parse_sleep(files),
        "customer":   parse_customer(files),
        "weight":     parse_weight(files),
    }

# ──────────────────────────────────────────────
# TRAINING PLAN — PARSER & ROUTES
# ──────────────────────────────────────────────
_JOURS  = ['LUNDI','MARDI','MERCREDI','JEUDI','VENDREDI','SAMEDI','DIMANCHE']
_MOIS   = {
    'JANVIER':1,'FÉVRIER':2,'FEVRIER':2,'MARS':3,'AVRIL':4,'MAI':5,'JUIN':6,
    'JUILLET':7,'AOÛT':8,'AOUT':8,'SEPTEMBRE':9,'OCTOBRE':10,'NOVEMBRE':11,
    'DÉCEMBRE':12,'DECEMBRE':12,
}
# Le titre après le tiret est OPTIONNEL : on accepte aussi "VENDREDI 22 MAI" seul
_DAY_RE = re.compile(
    r'(' + '|'.join(_JOURS) + r')\s+(\d{1,2})\s+(' + '|'.join(_MOIS.keys()) + r')(?:\s*[—–\-]\s*(.+))?',
    re.IGNORECASE,
)
_EMOJI_COLORS = {
    # Cercles colorés (format ancien)
    '🟣':'#8B5CF6','🟢':'#22C55E','🔴':'#EF4444','🟡':'#F59E0B',
    '⚪':'#9CA3AF','🟠':'#F97316',
    # Emojis sport (format titre sur ligne suivante)
    '🏃':'#22C55E',   # course → vert
    '💪':'#F97316',   # muscu → orange
    '🏋️':'#EF4444',  # haltères → rouge
    '🔥':'#F97316',   # recovery intense → orange
    '🧘':'#8B5CF6',   # yoga → violet
    '🚴':'#3B82F6',   # vélo → bleu
    '🏊':'#0EA5E9',   # natation → cyan
    '🔄':'#6B7280',   # récupération → gris
}

def parse_training_plan(text: str) -> list:
    lines = text.split('\n')
    day_starts: list[dict] = []
    for i, line in enumerate(lines):
        m = _DAY_RE.search(line.strip())
        if m:
            # Titre inline (après le tiret) — peut être absent
            inline_title = (m.group(4) or '').strip()

            # Si pas de titre inline, chercher sur les lignes suivantes (max 3)
            title = inline_title
            title_line_idx = None   # index de la ligne où on a trouvé le titre
            if not title:
                for j in range(i + 1, min(i + 4, len(lines))):
                    candidate = lines[j].strip()
                    if candidate:
                        title = candidate
                        title_line_idx = j
                        break

            # Couleur : chercher dans la ligne de date ET dans le titre trouvé
            color = '#4A6CF7'
            search_text = line + ' ' + title
            for emoji, c in _EMOJI_COLORS.items():
                if emoji in search_text:
                    color = c
                    break

            day_starts.append({
                'line_idx':       i,
                'title_line_idx': title_line_idx,  # None si titre était inline
                'day_name': m.group(1).upper(),
                'day_num':  int(m.group(2)),
                'month':    _MOIS.get(m.group(3).upper(), 0),
                'title':    title or '(Sans titre)',
                'color':    color,
            })
    sessions = []
    for idx, ds in enumerate(day_starts):
        start = ds['line_idx'] + 1
        end   = day_starts[idx + 1]['line_idx'] if idx + 1 < len(day_starts) else len(lines)
        raw_lines = lines[start:end]
        # Si le titre vient d'une ligne suivante, l'exclure du contenu pour éviter le doublon
        if ds['title_line_idx'] is not None:
            tl = ds['title_line_idx']
            raw_lines = [l for li, l in enumerate(raw_lines, start=start) if li != tl]
        content = '\n'.join(raw_lines).strip()
        # preview = first non-empty line of content
        preview = next((l.strip() for l in raw_lines if l.strip()), '')
        sessions.append({
            'day_name': ds['day_name'],
            'day_num':  ds['day_num'],
            'month':    ds['month'],
            'title':    ds['title'],
            'color':    ds['color'],
            'content':  content,
            'preview':  preview[:80],
        })
    return sessions


@app.route("/api/upload-training", methods=["POST"])
def api_upload_training():
    body = request.get_json(silent=True) or {}
    text = body.get("text", "").strip()
    if not text:
        return jsonify({"error": "Aucun texte fourni"}), 400
    sessions = parse_training_plan(text)
    if not sessions:
        return jsonify({"error": "Aucune séance détectée. Vérifiez le format (ex: LUNDI 19 MAI — FORCE)"}), 400
    week_label = f"Semaine du {sessions[0]['day_num']} au {sessions[-1]['day_num']}"
    with sqlite3.connect(DATABASE) as c:
        c.execute("INSERT INTO training_week(uploaded_at,week_label,sessions) VALUES(?,?,?)",
                  [datetime.now(timezone.utc).isoformat(),
                   week_label,
                   json.dumps(sessions, ensure_ascii=False)])
    return jsonify({"ok": True, "sessions": sessions, "week_label": week_label})


@app.route("/api/training")
def api_get_training():
    with sqlite3.connect(DATABASE) as c:
        row = c.execute(
            "SELECT sessions, week_label, uploaded_at FROM training_week ORDER BY id DESC LIMIT 1"
        ).fetchone()
    if not row:
        return jsonify({"ok": False, "sessions": []})
    sessions = json.loads(row[0])
    return jsonify({"ok": True, "sessions": sessions, "week_label": row[1], "uploaded_at": row[2]})


@app.route("/api/update-training-order", methods=["POST"])
def api_update_training_order():
    """Sauvegarde le plan après un drag & drop côté client."""
    data = request.get_json(force=True) or {}
    sessions = data.get("sessions", [])
    if not sessions:
        return jsonify({"error": "Aucune séance fournie"}), 400
    with sqlite3.connect(DATABASE) as c:
        row = c.execute("SELECT id FROM training_week ORDER BY id DESC LIMIT 1").fetchone()
        if not row:
            return jsonify({"error": "Aucun plan trouvé"}), 404
        c.execute("UPDATE training_week SET sessions=? WHERE id=?",
                  [json.dumps(sessions, ensure_ascii=False), row[0]])
    return jsonify({"ok": True})


# ──────────────────────────────────────────────
# GARMIN CONNECT API — SYNC
# ──────────────────────────────────────────────
def _garmin_client():
    """Retourne un client Garmin Connect authentifié."""
    email    = os.environ.get("GARMIN_EMAIL", "")
    password = os.environ.get("GARMIN_PASSWORD", "")
    if not email or not password:
        raise ValueError("Variables GARMIN_EMAIL et GARMIN_PASSWORD non configurées dans Railway.")
    GARMIN_TOKENS.mkdir(parents=True, exist_ok=True)
    client = _GarminConnect(email=email, password=password)
    # Essayer les tokens sauvegardés (évite une re-auth)
    try:
        client.login(str(GARMIN_TOKENS))
        return client
    except Exception:
        pass
    # Login complet
    client.login()
    try:
        client.garth.dump(str(GARMIN_TOKENS))
    except Exception:
        pass
    return client


def _fetch_garmin_api(client, days=30):
    """Récupère wellness, sleep et activités depuis l'API Garmin Connect."""
    from datetime import timedelta, date as _date
    end_d   = _date.today()
    start_d = end_d - timedelta(days=days - 1)

    wellness_out, sleep_out = [], []

    current = start_d
    while current <= end_d:
        ds = current.strftime("%Y-%m-%d")

        # ── Wellness (pas, calories, FC, stress, body battery)
        try:
            s = client.get_stats(ds) or {}
            steps = s.get("totalSteps") or 0
            if steps:
                bb = (s.get("bodyBatteryMostRecentValue")
                      or s.get("bodyBatteryChargeMax")
                      or s.get("maxBodyBattery"))
                wellness_out.append({
                    "date":                ds,
                    "steps":               steps,
                    "calories":            round(s.get("totalKilocalories") or 0),
                    "restingHR":           s.get("restingHeartRate"),   # FC repos Garmin
                    "minHR":               s.get("minHeartRate"),
                    "maxHR":               s.get("maxHeartRate"),
                    "stress":              s.get("averageStressLevel"),
                    "distance_m":          s.get("totalDistanceMeters") or 0,
                    "activeSeconds":       s.get("activeSeconds") or 0,
                    "highlyActiveSeconds": s.get("highlyActiveSeconds") or 0,
                    "bodyBattery":         int(bb) if bb else None,
                    "hrv":                 s.get("hrv5MinHigh") or s.get("lastNightHrvScore") or s.get("hrvScore"),
                })
        except Exception:
            pass

        # ── Sommeil
        try:
            raw = client.get_sleep_data(ds) or {}
            dto = raw.get("dailySleepDTO") or raw
            deep  = dto.get("deepSleepSeconds")  or 0
            light = dto.get("lightSleepSeconds") or 0
            rem   = dto.get("remSleepSeconds")   or 0
            awake = dto.get("awakeSleepSeconds") or 0
            if deep + light >= 3600:
                def _ms_to_hhmm(ts):
                    """Convert Garmin timestamp (ms int or ISO string) to HH:MM in local time."""
                    if not ts: return ""
                    try:
                        if isinstance(ts, (int, float)) and ts > 1e10:
                            # Use system local timezone so times match the user's clock
                            return datetime.fromtimestamp(ts / 1000).strftime("%H:%M")
                        return str(ts)[11:16]
                    except Exception:
                        return ""

                # Prioritise local timestamps (user's timezone) over GMT
                st = dto.get("sleepStartTimestampLocal") or dto.get("sleepStartTimestampGMT")
                et = dto.get("sleepEndTimestampLocal")   or dto.get("sleepEndTimestampGMT")
                inbed = 0
                if st and et:
                    try:
                        s1 = (st / 1000 if isinstance(st, (int, float)) and st > 1e10 else None)
                        e1 = (et / 1000 if isinstance(et, (int, float)) and et > 1e10 else None)
                        if s1 and e1:
                            inbed = int((e1 - s1) / 60)
                    except Exception:
                        pass
                score = None
                ss = dto.get("sleepScores")
                if isinstance(ss, dict):
                    score = (ss.get("overall") or {}).get("value")
                sleep_out.append({
                    "date":           dto.get("calendarDate", ds),
                    "sleepTotal_min": round((deep + light + rem) / 60),
                    "inBed_min":      inbed,
                    "deep_min":       round(deep  / 60),
                    "light_min":      round(light / 60),
                    "rem_min":        round(rem   / 60),
                    "awake_min":      round(awake / 60),
                    "bedtime":        _ms_to_hhmm(st),
                    "wakeTime":       _ms_to_hhmm(et),
                    "score":          score,
                })
        except Exception:
            pass

        current += timedelta(days=1)

    # ── Activités (fetch groupé)
    activities_out = []
    try:
        acts = client.get_activities_by_date(
            start_d.strftime("%Y-%m-%d"),
            end_d.strftime("%Y-%m-%d")
        ) or []
        for act in acts[:300]:
            try:
                atype = act.get("activityType") or {}
                if isinstance(atype, dict):
                    atype = atype.get("typeKey", "")
                activities_out.append({
                    "date":         (act.get("startTimeLocal") or "")[:10],
                    "type":         atype,
                    "name":         act.get("activityName", ""),
                    "duration_min": round((act.get("duration") or 0) / 60),
                    "distance_km":  round((act.get("distance") or 0) / 1000, 2),
                    "calories":     round(act.get("calories") or 0),
                    "maxHR":        act.get("maxHR"),
                    "avgHR":        act.get("averageHR"),
                    "vo2max":       act.get("vO2MaxValue"),
                })
            except Exception:
                continue
    except Exception:
        pass

    return wellness_out, sleep_out, activities_out


# ──────────────────────────────────────────────
# AUTO-SYNC BACKGROUND THREAD
# ──────────────────────────────────────────────
def _auto_sync_loop():
    import time
    time.sleep(60)  # attendre démarrage app
    while True:
        try:
            if _GARMIN_AVAILABLE and GARMIN_TOKENS.exists():
                gc = _GarminConnect("")
                gc.garth.loads(GARMIN_TOKENS.read_text())
                w, s, a = _fetch_garmin_api(gc, days=30)
                data = load_from_db() or {}
                if w:  data["wellness"]   = w
                if s:  data["sleep"]      = s
                if a:  data["activities"] = a
                data.setdefault("customer", {})
                data.setdefault("weight", [])
                save_to_db(data)
        except Exception:
            pass
        time.sleep(6 * 3600)  # re-sync toutes les 6h

_sync_thread = threading.Thread(target=_auto_sync_loop, daemon=True)
_sync_thread.start()


# ──────────────────────────────────────────────
# ROUTES
# ──────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/reset")
def reset_cache():
    """Page de reset forcé : désinstalle le SW et vide tous les caches navigateur."""
    html = """<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Mise à jour Mon Coach…</title>
<style>
  body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;
       min-height:100vh;margin:0;background:#f1f5f9;flex-direction:column;gap:16px;text-align:center}
  h2{font-size:20px;font-weight:700;margin:0}
  p{color:#64748B;font-size:14px;margin:0}
  .spinner{width:40px;height:40px;border:3px solid #E2E8F0;border-top-color:#4A6CF7;
           border-radius:50%;animation:spin .8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
</style>
</head><body>
<div class="spinner"></div>
<h2>Mise à jour en cours…</h2>
<p>Suppression du cache et rechargement</p>
<script>
(async function(){
  // 1. Désinstaller tous les service workers
  if('serviceWorker' in navigator){
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r => r.unregister()));
  }
  // 2. Vider tous les caches
  if('caches' in window){
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
  }
  // 3. Rediriger vers l'accueil en forçant le rechargement
  window.location.replace('/?t=' + Date.now());
})();
</script>
</body></html>"""
    resp = app.make_response(html)
    resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate'
    return resp

@app.route("/sw.js")
def service_worker():
    resp = send_from_directory("static", "sw.js")
    resp.headers["Service-Worker-Allowed"] = "/"
    resp.headers["Cache-Control"] = "no-cache"
    return resp

@app.route("/api/data")
def api_data():
    data = load_from_db()
    if data is None:
        return jsonify({"ok": False})
    return jsonify({"ok": True, "data": data})


@app.route("/api/debug-hr")
def api_debug_hr():
    """Diagnostic FC repos : affiche restingHR vs minHR sur les 10 derniers jours."""
    data = load_from_db()
    if not data:
        return jsonify({"ok": False, "error": "Pas de données"})
    rows = data.get("wellness", [])[-10:]
    result = [{"date": r["date"],
               "restingHR": r.get("restingHR"),
               "minHR":     r.get("minHR"),
               "used":      r.get("restingHR") or r.get("minHR")} for r in rows]
    return jsonify({"ok": True, "hr_debug": result})

@app.route("/api/import", methods=["POST"])
def api_import():
    if "file" not in request.files:
        return jsonify({"error": "Aucun fichier reçu"}), 400
    f = request.files["file"]
    fname = f.filename.lower()
    suffix = ".rar" if fname.endswith(".rar") else ".zip"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    f.save(tmp.name)
    tmp.close()
    try:
        files = extract_all_from_rar(tmp.name) if suffix == ".rar" else extract_all_from_zip(tmp.name)
        data = build_garmin_data(files)
        save_to_db(data)
        return jsonify({"ok": True, "data": data,
                        "summary": {
                            "wellness":   len(data["wellness"]),
                            "activities": len(data["activities"]),
                            "sleep":      len(data["sleep"]),
                        }})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        os.unlink(tmp.name)

# ──────────────────────────────────────────────
# NUTRITION — HELPERS DB
# ──────────────────────────────────────────────
def save_meal(data: dict, image_file: str) -> int:
    today = datetime.now(timezone.utc)
    with sqlite3.connect(DATABASE) as c:
        cur = c.execute("""
            INSERT INTO meals(analyzed_at,meal_date,description,calories,
                proteines,glucides,lipides,fibres,confiance,aliments,image_file)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)""", [
            today.isoformat(),
            today.strftime("%Y-%m-%d"),
            data.get("description",""),
            int(data.get("calories") or 0),
            int(data.get("proteines") or 0),
            int(data.get("glucides") or 0),
            int(data.get("lipides") or 0),
            int(data.get("fibres") or 0),
            data.get("confiance",""),
            json.dumps(data.get("aliments",[]), ensure_ascii=False),
            image_file,
        ])
        return cur.lastrowid

def get_meals(date: str | None = None) -> list:
    with sqlite3.connect(DATABASE) as c:
        c.row_factory = sqlite3.Row
        if date:
            rows = c.execute("SELECT * FROM meals WHERE meal_date=? ORDER BY analyzed_at DESC", [date]).fetchall()
        else:
            rows = c.execute("SELECT * FROM meals ORDER BY analyzed_at DESC LIMIT 60").fetchall()
    out = []
    for r in rows:
        d = dict(r)
        try: d["aliments"] = json.loads(d["aliments"] or "[]")
        except: d["aliments"] = []
        out.append(d)
    return out

# ──────────────────────────────────────────────
# NUTRITION — ROUTES
# ──────────────────────────────────────────────
@app.route("/api/analyze-meal", methods=["POST"])
def api_analyze_meal():
    if not _OPENAI_AVAILABLE:
        return jsonify({"error": "Package 'openai' manquant."}), 500

    api_key = os.environ.get("OPENAI_API_KEY","")
    if not api_key:
        return jsonify({"error": "Variable OPENAI_API_KEY non définie. Ajoutez-la dans Railway → Variables."}), 500

    if "file" not in request.files:
        return jsonify({"error": "Aucune image reçue"}), 400

    f = request.files["file"]
    img_bytes = f.read()
    fname = (f.filename or "").lower()

    if fname.endswith(".png"):   media_type = "image/png"
    elif fname.endswith(".webp"): media_type = "image/webp"
    elif fname.endswith(".gif"):  media_type = "image/gif"
    else:                         media_type = "image/jpeg"

    # Sauvegarder l'image originale
    ext = media_type.split("/")[1]
    img_filename = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}.{ext}"
    img_path = MEALS_DIR / img_filename
    img_path.write_bytes(img_bytes)

    # Compression si > 4 MB (limite OpenAI API)
    MAX_BYTES = 4 * 1024 * 1024
    if len(img_bytes) > MAX_BYTES:
        try:
            from PIL import Image
            import io as _io
            pil_img = Image.open(_io.BytesIO(img_bytes)).convert("RGB")
            # Réduire dimensions si trop grandes
            max_dim = 1600
            w, h = pil_img.size
            if w > max_dim or h > max_dim:
                pil_img.thumbnail((max_dim, max_dim), Image.LANCZOS)
            # Réduire qualité jusqu'à passer sous MAX_BYTES
            quality = 85
            buf = _io.BytesIO()
            while quality >= 30:
                buf.seek(0); buf.truncate()
                pil_img.save(buf, format="JPEG", quality=quality, optimize=True)
                if buf.tell() <= MAX_BYTES:
                    break
                quality -= 10
            img_bytes = buf.getvalue()
            media_type = "image/jpeg"
        except Exception:
            pass  # fallback : envoyer l'original, Claude renverra l'erreur

    img_b64 = base64.b64encode(img_bytes).decode("utf-8")

    system_prompt = (
        "Tu es un nutritionniste expert et diététicien clinique avec 20 ans d'expérience. "
        "Tu maîtrises parfaitement les tables nutritionnelles Ciqual (France) et USDA. "
        "Tu estimes les portions avec précision en analysant la taille des récipients, des ustensiles visibles et les proportions relatives des aliments. "
        "Tes analyses sont rigoureuses, détaillées et cohérentes avec les standards professionnels. "
        "Tu raisonnes toujours étape par étape avant de donner un résultat."
    )

    prompt = (
        "Analyse cette photo de repas. Raisonne à voix haute étape par étape, PUIS fournis le JSON.\n\n"
        "ÉTAPE 1 — IDENTIFICATION\n"
        "Décris chaque aliment visible avec précision (nom, préparation, couleur, texture).\n\n"
        "ÉTAPE 2 — ESTIMATION DES PORTIONS (en grammes)\n"
        "Pour chaque aliment, raisonne ainsi :\n"
        "  - Quelle est la taille du récipient ? (assiette standard 26cm ≈ surface utile ~450cm², bol 400ml, etc.)\n"
        "  - Quelle fraction de l'assiette/bol occupe cet aliment ?\n"
        "  - Quelle est la hauteur/épaisseur visible ?\n"
        "  - Conclusion : X grammes (justifie)\n\n"
        "ÉTAPE 3 — CALCUL LIGNE PAR LIGNE\n"
        "Pour chaque aliment, écris :\n"
        "  Aliment (Xg) : valeurs pour 100g selon Ciqual = kcal/P/G/L → pour Xg = kcal/P/G/L\n"
        "  Inclure huile/beurre si cuisson à la poêle (estimer 5-15g de matière grasse absorbée).\n\n"
        "ÉTAPE 4 — TOTAUX\n"
        "Additionne chaque colonne et vérifie la cohérence (calories = P×4 + G×4 + L×9).\n\n"
        "ÉTAPE 5 — JSON FINAL\n"
        "Termine ta réponse avec ce bloc JSON (et RIEN après) :\n"
        "```json\n"
        '{"description":"Nom précis du repas","calories":520,"proteines":32,"glucides":58,'
        '"lipides":16,"fibres":5,"confiance":"haute|moyenne|basse",'
        '"aliments":["Poulet grillé sans peau 160g — 176 kcal, P:33g G:0g L:4g","Riz blanc cuit 200g — 260 kcal, P:5g G:57g L:0g","Haricots verts vapeur 100g — 27 kcal, P:2g G:5g L:0g"]}\n'
        "```"
    )

    try:
        client = _OpenAI(api_key=api_key)
        msg = client.chat.completions.create(
            model="gpt-4o",
            max_tokens=2500,
            temperature=0,
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {
                            "url": f"data:{media_type};base64,{img_b64}",
                            "detail": "high"
                        }},
                        {"type": "text", "text": prompt}
                    ]
                }
            ]
        )
        raw = msg.choices[0].message.content.strip()
        # Extraire le JSON depuis la réponse chain-of-thought
        # Chercher le dernier bloc ```json ... ``` ou le dernier { ... }
        json_match = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", raw)
        if json_match:
            raw = json_match.group(1)
        else:
            # Fallback : extraire le dernier objet JSON de la réponse
            json_match = re.search(r"(\{[^{}]*\"calories\"[^{}]*\})", raw, re.DOTALL)
            if json_match:
                raw = json_match.group(1)
            else:
                raw = re.sub(r"^```(?:json)?\s*", "", raw)
                raw = re.sub(r"\s*```$", "", raw)
        nutrition = json.loads(raw)
    except json.JSONDecodeError as e:
        img_path.unlink(missing_ok=True)
        return jsonify({"error": f"Réponse IA non parseable : {e}"}), 500
    except Exception as e:
        img_path.unlink(missing_ok=True)
        return jsonify({"error": str(e)}), 500

    meal_id = save_meal(nutrition, img_filename)
    nutrition["id"] = meal_id
    nutrition["image_url"] = f"/static/meals/{img_filename}"
    nutrition["analyzed_at"] = datetime.now(timezone.utc).isoformat()
    return jsonify({"ok": True, "nutrition": nutrition})


@app.route("/api/analyze-meal-text", methods=["POST"])
def api_analyze_meal_text():
    """Analyse nutritionnelle à partir d'une description textuelle."""
    if not _OPENAI_AVAILABLE:
        return jsonify({"error": "Package 'openai' manquant."}), 500
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        return jsonify({"error": "Variable OPENAI_API_KEY non définie."}), 500

    data = request.get_json(force=True) or {}
    description = (data.get("description") or "").strip()
    if not description:
        return jsonify({"error": "Aucune description fournie"}), 400

    system_prompt = (
        "Tu es un nutritionniste expert et diététicien clinique. "
        "Tu maîtrises parfaitement les tables nutritionnelles Ciqual (France) et USDA. "
        "Tu estimes les portions avec précision selon les quantités indiquées ou les standards habituels. "
        "Tu raisonnes toujours étape par étape avant de donner un résultat."
    )

    prompt = (
        f"Analyse ce repas décrit textuellement. Raisonne étape par étape, PUIS fournis le JSON.\n\n"
        f"REPAS DÉCRIT : {description}\n\n"
        "ÉTAPE 1 — IDENTIFICATION\n"
        "Identifie chaque aliment avec sa préparation probable (grillé, bouilli, cru, sauté…).\n\n"
        "ÉTAPE 2 — ESTIMATION DES PORTIONS (en grammes)\n"
        "Pour chaque aliment, estime le poids en grammes selon les quantités indiquées\n"
        "ou les portions standards habituelles (ex: 1 œuf ≈ 60g, 1 verre de lait ≈ 200ml).\n\n"
        "ÉTAPE 3 — CALCUL LIGNE PAR LIGNE\n"
        "Pour chaque aliment : valeurs Ciqual/USDA pour 100g → calculer pour la portion.\n"
        "Inclure les matières grasses de cuisson si applicable.\n\n"
        "ÉTAPE 4 — TOTAUX\n"
        "Additionne et vérifie : calories ≈ P×4 + G×4 + L×9.\n\n"
        "ÉTAPE 5 — JSON FINAL\n"
        "Termine avec ce bloc JSON (rien après) :\n"
        "```json\n"
        '{"description":"Nom du repas","calories":520,"proteines":32,"glucides":58,'
        '"lipides":16,"fibres":5,"confiance":"haute|moyenne|basse",'
        '"aliments":["Œuf brouillé 120g — 160 kcal, P:12g G:1g L:11g"]}\n'
        "```"
    )

    try:
        client = _OpenAI(api_key=api_key)
        msg = client.chat.completions.create(
            model="gpt-4o",
            max_tokens=2000,
            temperature=0,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user",   "content": prompt},
            ]
        )
        raw = msg.choices[0].message.content.strip()
        json_match = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", raw)
        if json_match:
            raw = json_match.group(1)
        else:
            json_match = re.search(r"(\{[^{}]*\"calories\"[^{}]*\})", raw, re.DOTALL)
            if json_match:
                raw = json_match.group(1)
        nutrition = json.loads(raw)
    except json.JSONDecodeError as e:
        return jsonify({"error": f"Réponse IA non parseable : {e}"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    meal_id = save_meal(nutrition, None)
    nutrition["id"]           = meal_id
    nutrition["image_url"]    = None
    nutrition["analyzed_at"]  = datetime.now(timezone.utc).isoformat()
    return jsonify({"ok": True, "nutrition": nutrition})


@app.route("/api/meals")
def api_meals():
    date = request.args.get("date")
    return jsonify({"ok": True, "meals": get_meals(date)})


@app.route("/api/weight", methods=["POST"])
def api_add_weight():
    """Reçoit une mesure de poids depuis le script BLE local."""
    # Vérification clé API simple (optionnelle)
    api_key  = request.headers.get("X-Api-Key", "")
    expected = os.environ.get("WEIGHT_API_KEY", "")
    if expected and api_key != expected:
        return jsonify({"error": "Unauthorized"}), 401

    body = request.get_json(silent=True) or {}
    weight_kg = body.get("weight_kg")
    if not weight_kg or not (20 < float(weight_kg) < 300):
        return jsonify({"error": "Poids invalide"}), 400

    weight_kg = round(float(weight_kg), 2)
    date = body.get("date", datetime.now().strftime("%Y-%m-%d"))

    data = load_from_db()
    if not data:
        data = {"wellness": [], "activities": [], "sleep": [], "customer": {}, "weight": []}

    weight_list = [w for w in data.get("weight", []) if w.get("date") != date]
    weight_list.append({"date": date, "weight_kg": weight_kg, "bmi": body.get("bmi")})
    weight_list.sort(key=lambda x: x["date"])
    data["weight"] = weight_list[-365:]
    save_to_db(data)

    return jsonify({"ok": True, "weight_kg": weight_kg, "date": date})


@app.route("/api/meals-history")
def api_meals_history():
    """Aggregated macro totals per day for the past N days."""
    days = min(int(request.args.get("days", 7)), 90)
    from datetime import timedelta, date as _date
    start = (_date.today() - timedelta(days=days - 1)).isoformat()
    with sqlite3.connect(DATABASE) as c:
        c.row_factory = sqlite3.Row
        rows = c.execute(
            "SELECT meal_date, SUM(calories) cal, SUM(proteines) prot, "
            "SUM(glucides) gluc, SUM(lipides) lip "
            "FROM meals WHERE meal_date >= ? GROUP BY meal_date ORDER BY meal_date",
            [start]
        ).fetchall()
    return jsonify({"ok": True, "history": [dict(r) for r in rows]})


@app.route("/api/meals/<int:meal_id>", methods=["DELETE"])
def api_delete_meal(meal_id):
    with sqlite3.connect(DATABASE) as c:
        row = c.execute("SELECT image_file FROM meals WHERE id=?", [meal_id]).fetchone()
        if row and row[0]:
            p = MEALS_DIR / row[0]
            if p.exists(): p.unlink()
        c.execute("DELETE FROM meals WHERE id=?", [meal_id])
    return jsonify({"ok": True})


# ──────────────────────────────────────────────
# GARMIN CONNECT — ROUTES
# ──────────────────────────────────────────────
@app.route("/api/garmin-status")
def api_garmin_status():
    configured = bool(os.environ.get("GARMIN_EMAIL") and os.environ.get("GARMIN_PASSWORD"))
    return jsonify({"configured": configured, "available": _GARMIN_AVAILABLE})


# État du sync en arrière-plan
_sync_state = {"status": "idle", "progress": "", "result": None}

def _run_sync_background(days):
    global _sync_state
    _sync_state = {"status": "running", "progress": "Connexion à Garmin Connect…", "result": None}
    try:
        client = _garmin_client()
        _sync_state["progress"] = f"Récupération des données ({days} jours)…"
        new_wellness, new_sleep, new_activities = _fetch_garmin_api(client, days)

        existing = load_from_db() or {"wellness": [], "activities": [], "sleep": [], "customer": {}}
        def _merge(old, new):
            by_date = {item["date"]: item for item in old if "date" in item}
            for item in new:
                if "date" in item:
                    by_date[item["date"]] = item
            return sorted(by_date.values(), key=lambda x: x["date"])

        merged = {
            "wellness":   _merge(existing.get("wellness",   []), new_wellness)[-365:],
            "sleep":      _merge(existing.get("sleep",      []), new_sleep)[-365:],
            "activities": _merge(existing.get("activities", []), new_activities)[:300],
            "customer":   existing.get("customer", {}),
            "weight":     existing.get("weight", []),
        }
        save_to_db(merged)
        _sync_state = {
            "status": "done",
            "progress": "Synchronisation terminée",
            "result": {
                "ok": True,
                "data": merged,
                "synced": {"wellness": len(new_wellness), "sleep": len(new_sleep), "activities": len(new_activities)}
            }
        }
    except Exception as e:
        msg = str(e)
        if any(k in msg.lower() for k in ["mfa", "2fa", "factor", "multifactor"]):
            msg = "2FA requise : désactivez-la sur connect.garmin.com"
        _sync_state = {"status": "error", "progress": msg, "result": None}


@app.route("/api/sync-garmin", methods=["POST"])
def api_sync_garmin():
    if not _GARMIN_AVAILABLE:
        return jsonify({"error": "Package 'garminconnect' non installé."}), 500

    body = request.get_json(silent=True) or {}
    days = max(1, min(int(body.get("days", 30)), 90))

    # Si un sync tourne déjà, ne pas en lancer un deuxième
    if _sync_state.get("status") == "running":
        return jsonify({"ok": True, "status": "running", "progress": _sync_state.get("progress", "")})

    t = threading.Thread(target=_run_sync_background, args=(days,), daemon=True)
    t.start()
    return jsonify({"ok": True, "status": "started", "progress": "Démarrage…"})


@app.route("/api/sync-garmin/status")
def api_sync_garmin_status():
    return jsonify(_sync_state)


# ──────────────────────────────────────────────
# FLASHCARDS — SM-2 + ROUTES
# ──────────────────────────────────────────────
from datetime import date as _date, timedelta as _timedelta

def _sm2(interval: int, ease: float, reps: int, quality: int):
    """Algorithme SM-2 : retourne (interval, ease, reps, due_date)."""
    if quality >= 3:
        if reps == 0:   interval = 1
        elif reps == 1: interval = 6
        else:           interval = round(interval * ease)
        reps += 1
    else:
        interval = 1
        reps = 0
    ease = max(1.3, ease + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    due = (_date.today() + _timedelta(days=interval)).isoformat()
    return interval, round(ease, 4), reps, due

def _deck_stats(c, deck_id: int) -> dict:
    total = c.execute("SELECT COUNT(*) FROM fc_cards WHERE deck_id=?", [deck_id]).fetchone()[0]
    due   = c.execute(
        "SELECT COUNT(*) FROM fc_cards WHERE deck_id=? AND due_date<=?",
        [deck_id, _date.today().isoformat()]
    ).fetchone()[0]
    new   = c.execute(
        "SELECT COUNT(*) FROM fc_cards WHERE deck_id=? AND total_reviews=0",
        [deck_id]
    ).fetchone()[0]
    return {"total": total, "due": due, "new": new}


@app.route("/api/flashcards/decks")
def fc_get_decks():
    with sqlite3.connect(DATABASE) as c:
        c.row_factory = sqlite3.Row
        decks = c.execute("SELECT * FROM fc_decks ORDER BY name").fetchall()
        out = []
        for d in decks:
            s = _deck_stats(c, d["id"])
            out.append({**dict(d), **s})
    return jsonify({"ok": True, "decks": out})


@app.route("/api/flashcards/decks", methods=["POST"])
def fc_create_deck():
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Nom requis"}), 400
    with sqlite3.connect(DATABASE) as c:
        try:
            cur = c.execute(
                "INSERT INTO fc_decks(name, created_at, anki_name) VALUES(?,?,?)",
                [name, datetime.now(timezone.utc).isoformat(), data.get("anki_name")]
            )
            deck_id = cur.lastrowid
        except sqlite3.IntegrityError:
            return jsonify({"error": f"Le deck «{name}» existe déjà"}), 409
    return jsonify({"ok": True, "id": deck_id, "name": name})


@app.route("/api/flashcards/decks/<int:deck_id>", methods=["DELETE"])
def fc_delete_deck(deck_id):
    with sqlite3.connect(DATABASE) as c:
        c.execute("DELETE FROM fc_cards WHERE deck_id=?", [deck_id])
        c.execute("DELETE FROM fc_decks WHERE id=?", [deck_id])
    return jsonify({"ok": True})


@app.route("/api/flashcards/decks/<int:deck_id>/cards")
def fc_get_cards(deck_id):
    due_only = request.args.get("due") == "1"
    today    = _date.today().isoformat()
    with sqlite3.connect(DATABASE) as c:
        c.row_factory = sqlite3.Row
        if due_only:
            cards = c.execute(
                "SELECT * FROM fc_cards WHERE deck_id=? AND due_date<=? ORDER BY due_date",
                [deck_id, today]
            ).fetchall()
        else:
            cards = c.execute(
                "SELECT * FROM fc_cards WHERE deck_id=? ORDER BY id", [deck_id]
            ).fetchall()
    return jsonify({"ok": True, "cards": [dict(r) for r in cards]})


@app.route("/api/flashcards/decks/<int:deck_id>/cards", methods=["POST"])
def fc_add_cards(deck_id):
    data  = request.get_json(force=True) or {}
    cards = data.get("cards", [])
    if not cards:
        return jsonify({"error": "Aucune carte"}), 400
    today = _date.today().isoformat()
    with sqlite3.connect(DATABASE) as c:
        # Vérifier que le deck existe
        if not c.execute("SELECT id FROM fc_decks WHERE id=?", [deck_id]).fetchone():
            return jsonify({"error": "Deck introuvable"}), 404
        count = 0
        for card in cards:
            front = (card.get("front") or "").strip()
            back  = (card.get("back")  or "").strip()
            if not front or not back:
                continue
            anki_id = card.get("anki_note_id")
            # Éviter les doublons si import Anki
            if anki_id:
                existing = c.execute(
                    "SELECT id FROM fc_cards WHERE deck_id=? AND anki_note_id=?",
                    [deck_id, anki_id]
                ).fetchone()
                if existing:
                    # Mettre à jour le contenu si modifié dans Anki
                    c.execute(
                        "UPDATE fc_cards SET front=?, back=? WHERE id=?",
                        [front, back, existing[0]]
                    )
                    continue
            c.execute(
                """INSERT INTO fc_cards(deck_id,front,back,anki_note_id,due_date)
                   VALUES(?,?,?,?,?)""",
                [deck_id, front, back, anki_id, today]
            )
            count += 1
    return jsonify({"ok": True, "added": count})


@app.route("/api/flashcards/cards/<int:card_id>/answer", methods=["POST"])
def fc_answer_card(card_id):
    """Enregistre la réponse et applique SM-2."""
    data    = request.get_json(force=True) or {}
    quality = int(data.get("quality", 3))   # 0-5
    quality = max(0, min(5, quality))
    with sqlite3.connect(DATABASE) as c:
        c.row_factory = sqlite3.Row
        card = c.execute("SELECT * FROM fc_cards WHERE id=?", [card_id]).fetchone()
        if not card:
            return jsonify({"error": "Carte introuvable"}), 404
        card = dict(card)
        new_int, new_ease, new_reps, new_due = _sm2(
            card["interval"], card["ease_factor"], card["repetitions"], quality
        )
        correct = 1 if quality >= 3 else 0
        c.execute("""UPDATE fc_cards SET
            interval=?, ease_factor=?, repetitions=?, due_date=?,
            last_reviewed=?, total_reviews=total_reviews+1,
            correct_reviews=correct_reviews+?
            WHERE id=?""",
            [new_int, new_ease, new_reps, new_due,
             datetime.now(timezone.utc).isoformat(), correct, card_id]
        )
    return jsonify({"ok": True, "next_due": new_due, "interval": new_int})


@app.route("/api/flashcards/cards/<int:card_id>", methods=["DELETE"])
def fc_delete_card(card_id):
    with sqlite3.connect(DATABASE) as c:
        c.execute("DELETE FROM fc_cards WHERE id=?", [card_id])
    return jsonify({"ok": True})


@app.route("/api/flashcards/stats")
def fc_stats():
    """Stats globales : cartes dues, streak de révision."""
    today = _date.today().isoformat()
    with sqlite3.connect(DATABASE) as c:
        total_due = c.execute(
            "SELECT COUNT(*) FROM fc_cards WHERE due_date<=?", [today]
        ).fetchone()[0]
        total_cards = c.execute("SELECT COUNT(*) FROM fc_cards").fetchone()[0]
        total_decks = c.execute("SELECT COUNT(*) FROM fc_decks").fetchone()[0]
        reviewed_today = c.execute(
            "SELECT COUNT(*) FROM fc_cards WHERE last_reviewed LIKE ?",
            [today + "%"]
        ).fetchone()[0]
    return jsonify({
        "ok": True,
        "total_due": total_due,
        "total_cards": total_cards,
        "total_decks": total_decks,
        "reviewed_today": reviewed_today,
    })


if __name__ == "__main__":
    is_prod = os.environ.get("RAILWAY_ENVIRONMENT") or os.environ.get("PORT")
    port = int(os.environ.get("PORT", 5000))
    print("=" * 50)
    print(f"  Garmin Dashboard  ->  http://localhost:{port}")
    print("=" * 50)
    app.run(debug=not is_prod, host="0.0.0.0", port=port)
