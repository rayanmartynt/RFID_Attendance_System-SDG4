from flask import Flask, jsonify, request
from flask_cors import CORS
import pandas as pd
from datetime import datetime
import os
import sys

app = Flask(__name__)
CORS(app)

# Path to Excel file
EXCEL_FILE = os.path.join(os.path.dirname(__file__), "..", "Python", "Attendance.xlsx")
CURRENT_WEEK = 1
CURRENT_SESSION = 1

SESSIONS = {
    1: ("08:30", "11:30"),
    2: ("11:30", "14:30"),
    3: ("14:30", "17:30"),
    4: ("17:30", "20:30"),
}
def log_msg(msg):
    """Log message with timestamp for debugging."""
    print(f"[Flask] {datetime.now().isoformat()} {msg}", file=sys.stderr, flush=True)


def parse_session_clock(time_str):
    """Parse HH:MM into today's datetime."""
    hour, minute = map(int, time_str.split(":"))
    now = datetime.now()
    return now.replace(hour=hour, minute=minute, second=0, microsecond=0)


def get_session_window(session):
    """Return (start, end) datetime for a session today."""
    start_str, end_str = SESSIONS[session]
    start = parse_session_clock(start_str)
    end = parse_session_clock(end_str)
    return start, end


def detect_current_session(now=None):
    """Return the session number active at `now`, or None if outside all windows."""
    now = now or datetime.now()
    for session, (start_str, end_str) in SESSIONS.items():
        start = parse_session_clock(start_str)
        end = parse_session_clock(end_str)
        # Inclusive start; exclusive end except last session (inclusive end)
        if session == max(SESSIONS):
            if start <= now <= end:
                return session
        elif start <= now < end:
            return session
    return None


def session_status_payload(session):
    start_str, end_str = SESSIONS[session]
    return {
        "session": session,
        "start": start_str,
        "end": end_str,
        "label": f"Session {session} ({start_str} – {end_str})",
    }

# Load the students data from the Excel
def load_students():
    """Load students from Excel."""
    try:
        log_msg("Loading students from Excel...")
        df = pd.read_excel(EXCEL_FILE, engine='openpyxl')
        log_msg(f"Loaded {len(df)} students")
        # Ensure all week columns exist and convert to string type
        for week in range(1, 13):
            arrival_col = f"Week{week}_Arrival"
            departure_col = f"Week{week}_Departure"
            status_col = f"Week{week}_Status"
            
            if arrival_col not in df.columns:
                df[arrival_col] = ""
            else:
                # Pandas 3 keeps NA after astype(str); normalize to real empty strings
                df[arrival_col] = df[arrival_col].map(_cell_to_text)

            if departure_col not in df.columns:
                df[departure_col] = ""
            else:
                df[departure_col] = df[departure_col].map(_cell_to_text)

            if status_col not in df.columns:
                df[status_col] = 0
            else:
                df[status_col] = pd.to_numeric(df[status_col], errors="coerce").fillna(0).astype(int)

        return df
    except Exception as e:
        log_msg(f"ERROR loading Excel: {e}")
        import traceback
        traceback.print_exc(file=sys.stderr)
        return None


def _cell_to_text(value):
    """Normalize Excel/pandas cells to a clean string (empty if missing)."""
    if pd.isna(value):
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    text = str(value).strip()
    if text.endswith(".0"):
        text = text[:-2]
    if text.lower() in ("nan", "none", "<na>", "nat"):
        return ""
    return text

# Save the student's attendance data
def save_students(df):
    """Save students to Excel with retry logic and total calculations."""
    max_retries = 3
    retry_delay = 0.1  # seconds
    
    # Recalculate totals
    status_cols = [f"Week{w}_Status" for w in range(1, 13)]
    for col in status_cols:
        if col not in df.columns:
            df[col] = 0
        else:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0).astype(int)
    df["Total_Present"] = df[status_cols].sum(axis=1)
    df["Attendance_%"] = (df["Total_Present"] / 12.0 * 100).round(2)

    # Must use .xlsx extension so openpyxl is selected correctly
    temp_file = EXCEL_FILE + ".tmp.xlsx"
    for attempt in range(max_retries):
        try:
            log_msg(f"Saving students (attempt {attempt + 1}/{max_retries})...")
            df.to_excel(temp_file, index=False, engine="openpyxl")
            os.replace(temp_file, EXCEL_FILE)
            log_msg("Saved successfully")
            return True
        except Exception as e:
            log_msg(f"Save failed: {e}")
            if os.path.exists(temp_file):
                try:
                    os.remove(temp_file)
                except Exception:
                    pass
            if attempt < max_retries - 1:
                import time
                time.sleep(retry_delay)
            else:
                log_msg(f"Failed to save after {max_retries} attempts")
                raise

@app.route("/", methods=["GET"])
def home():
    return jsonify({"status": "RFID API running", "week": CURRENT_WEEK, "session": CURRENT_SESSION})

@app.route("/students", methods=["GET"])
def get_students():
    """Get all students from Excel."""
    df = load_students()
    if df is None:
        return jsonify({"error": "Could not load Excel file"}), 500
    
    students = []
    for _, row in df.iterrows():
        students.append({
            "id": _cell_to_text(row.get("Student_ID", "")),
            "name": str(row.get("Name", "")),
            "uid": str(row.get("RFID_UID", "")).strip().upper(),
        })
    
    return jsonify({"students": students})

@app.route("/attendance", methods=["GET"])
def get_attendance():
    """Get complete attendance records with weekly breakdown and summary totals."""
    df = load_students()
    if df is None:
        return jsonify({"error": "Could not load Excel file"}), 500
    
    students_records = []
    status_cols = [f"Week{w}_Status" for w in range(1, 13)]
    
    for _, row in df.iterrows():
        total_present = int(sum(pd.to_numeric(row.get(col, 0), errors="coerce") or 0 for col in status_cols))
        pct = round((total_present / 12.0) * 100, 2)
        
        weeks_data = {}
        for w in range(1, 13):
            weeks_data[f"week{w}"] = {
                "arrival": _cell_to_text(row.get(f"Week{w}_Arrival", "")),
                "departure": _cell_to_text(row.get(f"Week{w}_Departure", "")),
                "status": int(pd.to_numeric(row.get(f"Week{w}_Status", 0), errors="coerce") or 0),
            }

        students_records.append({
            "id": _cell_to_text(row.get("Student_ID", "")),
            "name": str(row.get("Name", "")),
            "uid": str(row.get("RFID_UID", "")).strip().upper(),
            "total_present": total_present,
            "attendance_pct": pct,
            "weeks": weeks_data,
        })

    return jsonify({
        "current_week": CURRENT_WEEK,
        "current_session": CURRENT_SESSION,
        "students": students_records,
    }), 200

@app.route("/scan", methods=["POST"])
def process_scan():
    """Process a scanned UID."""
    try:
        return _process_scan()
    except Exception as exc:
        log_msg(f"Unhandled /scan error: {exc}")
        import traceback
        traceback.print_exc(file=sys.stderr)
        return jsonify({
            "status": "ERROR",
            "message": "Internal server error while processing scan.",
            "details": str(exc),
        }), 500


def _process_scan():
    log_msg("POST /scan received")
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid JSON payload"}), 400

    uid = str(data.get("uid", "")).strip().upper()
    try:
        week = int(data.get("week", CURRENT_WEEK))
    except (TypeError, ValueError):
        week = CURRENT_WEEK

    try:
        session = int(data.get("session", CURRENT_SESSION))
    except (TypeError, ValueError):
        session = CURRENT_SESSION

    strict_schedule = bool(data.get("strict", False))

    if not uid:
        return jsonify({"error": "No UID provided"}), 400

    if session not in SESSIONS:
        return jsonify({"error": "Session must be 1-4"}), 400

    now_dt = datetime.now()
    session_start, session_end = get_session_window(session)
    start_str, end_str = SESSIONS[session]

    if strict_schedule:
        # Reject scans before the selected session starts if strict mode active
        if now_dt < session_start:
            log_msg(f"Scan rejected: too early for session {session} (starts {start_str})")
            return jsonify({
                "status": "TOO_EARLY",
                "message": (
                    f"Attendance not recorded. Session {session} starts at {start_str}. "
                    f"Current time is {now_dt.strftime('%H:%M:%S')}."
                ),
                "session": session_status_payload(session),
                "student": None,
            }), 200

        # Reject scans after the selected session ends if strict mode active
        if now_dt > session_end:
            log_msg(f"Scan rejected: session {session} already ended at {end_str}")
            return jsonify({
                "status": "TOO_LATE",
                "message": (
                    f"Attendance not recorded. Session {session} ended at {end_str}. "
                    f"Current time is {now_dt.strftime('%H:%M:%S')}."
                ),
                "session": session_status_payload(session),
                "student": None,
            }), 200

    log_msg(f"Processing UID: {uid}, week: {week}, session: {session}")
    df = load_students()
    if df is None:
        log_msg("ERROR: Could not load Excel file")
        return jsonify({"error": "Could not load Excel file"}), 500

    # Find student by RFID_UID (case-insensitive)
    log_msg(f"Searching for UID: {uid}")
    student_row = None
    student_index = None
    for idx, row in df.iterrows():
        row_uid = row.get("RFID_UID", "")
        # Handle NaN values: pandas NaN != NaN, so check with pd.isna()
        if pd.isna(row_uid):
            continue
        if str(row_uid).strip().upper() == uid:
            student_row = row
            student_index = idx
            log_msg(f"Found student at index {idx}: {row.get('Name', 'Unknown')}")
            break

    if student_row is None:
        log_msg(f"UID not found: {uid} - returning UNKNOWN")
        return jsonify({
            "status": "UNKNOWN",
            "message": f"Unknown card UID: {uid}",
            "session": session_status_payload(session),
            "student": None
        }), 200

    student_id = str(student_row.get("Student_ID", ""))
    student_name = str(student_row.get("Name", ""))
    arrival_col = f"Week{week}_Arrival"
    departure_col = f"Week{week}_Departure"
    status_col = f"Week{week}_Status"

    log_msg(f"Getting attendance data: columns {arrival_col}, {departure_col}, {status_col}")
    arrival = df.loc[student_index, arrival_col]
    departure = df.loc[student_index, departure_col]

    def is_empty(value):
        return _cell_to_text(value) == ""

    now = now_dt.strftime("%H:%M:%S")
    log_msg(f"arrival={repr(arrival)}, departure={repr(departure)}, now={now}")

    # First scan: arrival
    if is_empty(arrival):
        log_msg(f"Recording ARRIVAL for {student_name}")
        df.loc[student_index, arrival_col] = now
        df.loc[student_index, status_col] = 1
        log_msg("About to save (ARRIVAL)...")
        try:
            save_students(df)
            log_msg("ARRIVAL recorded successfully")
        except Exception as save_err:
            log_msg(f"Failed to save arrival: {save_err}")
            return jsonify({
                "status": "ERROR",
                "message": "Failed to save attendance. Close Excel if it is open and try again.",
                "details": str(save_err)
            }), 500

        return jsonify({
            "status": "ARRIVAL",
            "message": f"Arrival recorded for {student_name} (Session {session})",
            "session": session_status_payload(session),
            "student": {
                "id": student_id,
                "name": student_name,
                "uid": uid,
                "arrival_time": now,
                "departure_time": None
            }
        }), 200

    # Second scan: departure
    if is_empty(departure):
        log_msg(f"Recording DEPARTURE for {student_name}")
        df.loc[student_index, departure_col] = now
        log_msg("About to save (DEPARTURE)...")
        try:
            save_students(df)
            log_msg("DEPARTURE recorded successfully")
        except Exception as save_err:
            log_msg(f"Failed to save departure: {save_err}")
            return jsonify({
                "status": "ERROR",
                "message": "Failed to save attendance. Close Excel if it is open and try again.",
                "details": str(save_err)
            }), 500

        return jsonify({
            "status": "DEPARTURE",
            "message": f"Departure recorded for {student_name} (Session {session})",
            "session": session_status_payload(session),
            "student": {
                "id": student_id,
                "name": student_name,
                "uid": uid,
                "arrival_time": _cell_to_text(arrival),
                "departure_time": now
            }
        }), 200

    # Third+ scan: duplicate
    log_msg(f"Duplicate scan for {student_name}")
    return jsonify({
        "status": "DUPLICATE",
        "message": f"{student_name} already scanned for week {week}",
        "session": session_status_payload(session),
        "student": {
            "id": student_id,
            "name": student_name,
            "uid": uid,
            "arrival_time": _cell_to_text(arrival),
            "departure_time": _cell_to_text(departure)
        }
    }), 200

@app.route("/sessions", methods=["GET"])
def get_sessions():
    """List sessions and the one currently active by clock time."""
    active = detect_current_session()
    return jsonify({
        "sessions": [session_status_payload(s) for s in SESSIONS],
        "active_session": active,
        "current_session": CURRENT_SESSION,
    }), 200

@app.route("/set-week", methods=["POST"])
def set_week():
    """Set the current week."""
    global CURRENT_WEEK
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid JSON payload"}), 400

    try:
        week = int(data.get("week", 1))
    except (TypeError, ValueError):
        return jsonify({"error": "Week must be 1-12"}), 400

    if 1 <= week <= 12:
        CURRENT_WEEK = week
        return jsonify({"week": CURRENT_WEEK}), 200
    return jsonify({"error": "Week must be 1-12"}), 400

@app.route("/set-session", methods=["POST"])
def set_session():
    """Set the current session (1-4)."""
    global CURRENT_SESSION
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid JSON payload"}), 400

    try:
        session = int(data.get("session", 1))
    except (TypeError, ValueError):
        return jsonify({"error": "Session must be 1-4"}), 400

    if session in SESSIONS:
        CURRENT_SESSION = session
        return jsonify(session_status_payload(CURRENT_SESSION)), 200
    return jsonify({"error": "Session must be 1-4"}), 400

@app.errorhandler(Exception)
def unhandled_exception(error):
    """Always return JSON so the Node backend can parse failures."""
    from werkzeug.exceptions import HTTPException

    if isinstance(error, HTTPException):
        payload = {"error": error.name, "details": error.description}
        return jsonify(payload), error.code

    log_msg(f"Unhandled internal error: {error}")
    import traceback
    traceback.print_exc(file=sys.stderr)
    return jsonify({"error": "Internal server error", "details": str(error)}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Endpoint not found"}), 404

@app.errorhandler(400)
def bad_request(error):
    return jsonify({"error": "Bad request", "details": str(error)}), 400

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
