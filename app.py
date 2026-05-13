"""
Garmin Dashboard – Backend Flask
Lancer : python app.py  →  http://localhost:5000
"""
import os, json, zipfile, tempfile, subprocess, sqlite3, re, base64, uuid
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

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 500 * 1024 * 1024
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", os.urandom(24).hex())

# DATA_DIR : répertoire persistant (volume Railway) ou local par défaut
DATA_DIR  = Path(os.environ.get("DATA_DIR", Path(__file__).parent))
DATABASE  = DATA_DIR / "garmin_data.db"
MEALS_DIR = DATA_DIR / "meals"
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
            "minHR":               x.get("minHeartRate"),
            "maxHR":               x.get("maxHeartRate"),
            "stress":              _stress_avg(x),
            "distance_m":          x.get("totalDistanceMeters", 0),
            "activeSeconds":       x.get("activeSeconds", 0),
            "highlyActiveSeconds": x.get("highlyActiveSeconds", 0),
            "bodyBattery":         _body_battery(x),
        })
    return out[-365:]  # 1 an

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
        start_str = s.get("sleepStartTimestampGMT", "")
        end_str   = s.get("sleepEndTimestampGMT",   "")
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
    }

# ──────────────────────────────────────────────
# ROUTES
# ──────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")

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
    if not _ANTHROPIC_AVAILABLE:
        return jsonify({"error": "Package 'anthropic' manquant. Lancez : pip install anthropic"}), 500

    api_key = os.environ.get("ANTHROPIC_API_KEY","")
    if not api_key:
        return jsonify({"error": "Variable ANTHROPIC_API_KEY non définie. Ajoutez-la dans votre environnement."}), 500

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

    # Compression si > 4 MB (limite Claude API = 5 MB)
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

    prompt = (
        "Tu es un nutritionniste expert. Analyse ce repas et estime ses valeurs nutritionnelles.\n"
        "Réponds UNIQUEMENT avec un objet JSON valide (pas de texte avant ou après, pas de balises markdown) :\n"
        '{"description":"Nom court du repas","calories":500,"proteines":30,"glucides":60,'
        '"lipides":15,"fibres":8,"confiance":"haute|moyenne|basse",'
        '"aliments":["Poulet grillé 150g — 165 kcal","Riz 100g — 130 kcal"]}'
    )

    try:
        client = _anthropic.Anthropic(api_key=api_key)
        msg = client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=800,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image", "source": {
                        "type": "base64", "media_type": media_type, "data": img_b64
                    }},
                    {"type": "text", "text": prompt}
                ]
            }]
        )
        raw = msg.content[0].text.strip()
        # Nettoyer si Claude ajoute des balises ```json
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


@app.route("/api/meals")
def api_meals():
    date = request.args.get("date")
    return jsonify({"ok": True, "meals": get_meals(date)})


@app.route("/api/meals/<int:meal_id>", methods=["DELETE"])
def api_delete_meal(meal_id):
    with sqlite3.connect(DATABASE) as c:
        row = c.execute("SELECT image_file FROM meals WHERE id=?", [meal_id]).fetchone()
        if row and row[0]:
            p = MEALS_DIR / row[0]
            if p.exists(): p.unlink()
        c.execute("DELETE FROM meals WHERE id=?", [meal_id])
    return jsonify({"ok": True})


if __name__ == "__main__":
    is_prod = os.environ.get("RAILWAY_ENVIRONMENT") or os.environ.get("PORT")
    port = int(os.environ.get("PORT", 5000))
    print("=" * 50)
    print(f"  Garmin Dashboard  ->  http://localhost:{port}")
    print("=" * 50)
    app.run(debug=not is_prod, host="0.0.0.0", port=port)
