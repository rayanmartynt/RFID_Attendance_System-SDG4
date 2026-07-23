import serial
import pandas as pd
import time
from datetime import datetime

# Arduino setup
PORT = "COM3"      # Change if needed
BAUDRATE = 9600
FILE = "Attendance.xlsx"

# Dictionary that stores session times
SESSIONS = {
    1: ("08:30", "11:30"),
    2: ("11:30", "14:30"),
    3: ("14:30", "17:30"),
    4: ("17:30", "20:30")
}

# Function 1: Connect the arduino
def connect_arduino():
    print("Connecting to Arduino...")
    arduino = serial.Serial(PORT, BAUDRATE, timeout=1)
    time.sleep(2)
    print("Connected.")
    return arduino

# Function 2: Load the attendance database
def load_attendance_database():
    df = pd.read_excel(FILE)
    for week in range(1, 13):
        arrival_col = f"Week{week}_Arrival"
        departure_col = f"Week{week}_Departure"
        status_col = f"Week{week}_Status"

        if arrival_col not in df.columns:
            df[arrival_col] = ""
        else:
            df[arrival_col] = df[arrival_col].astype("object").fillna("")

        if departure_col not in df.columns:
            df[departure_col] = ""
        else:
            df[departure_col] = df[departure_col].astype("object").fillna("")

        if status_col not in df.columns:
            df[status_col] = 0
        else:
            df[status_col] = pd.to_numeric(df[status_col], errors="coerce").fillna(0).astype(int)

    if "Total_Present" not in df.columns:
        df["Total_Present"] = 0
    if "Attendance_%" not in df.columns:
        df["Attendance_%"] = 0.0

    return df

# Function 3: Saves the student attendance in the Excel
def save_attendance_database(df):
    status_cols = [f"Week{w}_Status" for w in range(1, 13)]
    df["Total_Present"] = df[status_cols].sum(axis=1)
    df["Attendance_%"] = (df["Total_Present"] / 12.0 * 100).round(2)
    df.to_excel(FILE, index=False)

# Function 4: Find the student in the database
def find_student(df, uid):
    clean_uid = str(uid).strip().upper()
    student = df[df["RFID_UID"].astype(str).str.strip().str.upper() == clean_uid]
    return student

# Function 5: Sends message to the arduino
def send_message(arduino, message):
    arduino.write((message + "\n").encode())

# Function 6: Gets all the session the lecturer select
def get_session_times(session):
    start_time, end_time = SESSIONS[session]
    # time formats
    start_time = datetime.strptime(start_time, "%H:%M")
    end_time = datetime.strptime(end_time, "%H:%M")
    return start_time, end_time

# Function 7: Process card step by step
def process_card(arduino, uid, current_week, current_session=1):
    df = load_attendance_database()
    student = find_student(df, uid)

    # Unknown Card
    if student.empty:
        print("Unknown Card")
        send_message(arduino, "NOTFOUND")
        return

    row_index = student.index[0]

    student_name = str(df.loc[row_index, "Name"])
    raw_id = df.loc[row_index, "Student_ID"]
    student_ID = str(int(raw_id)) if isinstance(raw_id, float) and raw_id.is_integer() else str(raw_id)

    arrival_col = f"Week{current_week}_Arrival"
    departure_col = f"Week{current_week}_Departure"
    status_col = f"Week{current_week}_Status"

    now = datetime.now()

    arrival = df.loc[row_index, arrival_col]
    departure = df.loc[row_index, departure_col]

    def is_empty(val):
        if pd.isna(val):
            return True
        st = str(val).strip().lower()
        return st in ("", "nan", "none", "<na>")

    # First Scan: Check-in
    if is_empty(arrival):
        arrival_time = now.strftime("%H:%M:%S")
        df.loc[row_index, arrival_col] = arrival_time
        df.loc[row_index, status_col] = 1

        save_attendance_database(df)
        send_message(arduino, f"PRESENT:{student_name}")

        print(f"\nStudent ID: {student_ID}")
        print(f"Name: {student_name}")
        print("Attendance Recorded")
        print("Status: 1 (PRESENT)")
        return

    # Second Scan: Check-out
    if is_empty(departure):
        departure_time = now.strftime("%H:%M:%S")
        df.loc[row_index, departure_col] = departure_time

        save_attendance_database(df)
        send_message(arduino, f"CHECKOUT:{student_name}")

        print(f"\n{student_name} Checked Out")
        print(f"Student ID: {student_ID}")
        print(f"Departure Time: {departure_time}")
        return

    # Third Scan: Duplicate
    send_message(arduino, "DUPLICATE")
    print(f"\nStudent ID: {student_ID}")
    print(f"{student_name} Already Checked-in and Checked-out for Week {current_week}")

# Function 11: The main function of this project
def main():
    print("\n===== RFID ATTENDANCE SYSTEM =====\n")

    current_week = int(input("Enter Week (1-12): "))
    if current_week < 1 or current_week > 12:
        print("Week must be between 1 and 12")
        return

    current_session = int(input("Session (1-4): "))
    if current_session not in [1, 2, 3, 4]:
        print("Invalid Session")
        return

    arduino = connect_arduino()
    print("\nSystem Ready...")

    try:
        while True:
            if arduino.in_waiting:
                uid = arduino.readline().decode().strip()
                if uid:
                    print(f"\nScanned UID: {uid}")
                    process_card(arduino, uid, current_week, current_session)
    except KeyboardInterrupt:
        print("\nSystem Stopped Successfully")
    finally:
        if arduino.is_open:
            arduino.close()
        print("Arduino Connection Closed")

# Start Program
if __name__ == "__main__":
    main()