from flask import Flask, jsonify, request
from flask_cors import CORS
import pandas as pd
from datetime import datetime
import os
import sys

app = Flask(__name__)
CORS(app)

# Path to Excel file (dynamic, can be set via /set-workbook endpoint)
EXCEL_FILE = None
CURRENT_WEEK = 1

def get_excel_file():
    """Get the current Excel file path. Auto-detects available Excel file if not set."""
    global EXCEL_FILE
    if EXCEL_FILE and os.path.exists(EXCEL_FILE):
        return EXCEL_FILE
    
    # Auto-detect any Excel file in uploads directory
    uploads_dir = os.path.join(os.path.dirname(__file__), "..", "backend", "uploads")
    if os.path.exists(uploads_dir):
        for filename in os.listdir(uploads_dir):
            if filename.endswith((".xlsx", ".xls")):
                EXCEL_FILE = os.path.join(uploads_dir, filename)
                log_msg(f"Auto-detected Excel file: {EXCEL_FILE}")
                return EXCEL_FILE
    
    # Fallback to default path
    default_path = os.path.join(os.path.dirname(__file__), "..", "backend", "uploads", "Attendance.xlsx")
    return default_path

def log_msg(msg):
    """Log message with timestamp for debugging."""
    print(f"[Flask] {datetime.now().isoformat()} {msg}", file=sys.stderr, flush=True)


# Load the students data from the Excel
def load_students():
    """Load students from Excel."""
    try:
        excel_path = get_excel_file()
        # Check if file exists first
        if not os.path.exists(excel_path):
            log_msg(f"WARNING: Excel file not found at {excel_path}")
            return None
            
        log_msg(f"Loading students from Excel: {excel_path}")
        df = pd.read_excel(excel_path, engine='openpyxl')
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
    
    excel_path = get_excel_file()
    
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
    temp_file = excel_path + ".tmp.xlsx"
    for attempt in range(max_retries):
        try:
            log_msg(f"Saving students to {excel_path} (attempt {attempt + 1}/{max_retries})...")
            df.to_excel(temp_file, index=False, engine="openpyxl")
            os.replace(temp_file, excel_path)
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
    return jsonify({"status": "RFID API running", "week": CURRENT_WEEK})

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

    if not uid:
        return jsonify({"error": "No UID provided"}), 400

    now_dt = datetime.now()
    log_msg(f"Processing UID: {uid}, week: {week}")
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
            "message": f"Arrival recorded for {student_name}",
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
            "message": f"Departure recorded for {student_name}",
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
        "student": {
            "id": student_id,
            "name": student_name,
            "uid": uid,
            "arrival_time": _cell_to_text(arrival),
            "departure_time": _cell_to_text(departure)
        }
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

@app.route("/set-workbook", methods=["POST"])
def set_workbook():
    """Set the active Excel workbook file."""
    global EXCEL_FILE
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Invalid JSON payload"}), 400

    filename = data.get("filename")
    if not filename:
        return jsonify({"error": "filename is required"}), 400

    # Construct the full path to the uploads directory
    uploads_dir = os.path.join(os.path.dirname(__file__), "..", "backend", "uploads")
    target_path = os.path.join(uploads_dir, filename)

    if not os.path.exists(target_path):
        return jsonify({"error": f"File '{filename}' not found in uploads directory"}), 404

    EXCEL_FILE = target_path
    log_msg(f"Active workbook set to: {EXCEL_FILE}")
    return jsonify({"success": True, "filename": filename}), 200

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
