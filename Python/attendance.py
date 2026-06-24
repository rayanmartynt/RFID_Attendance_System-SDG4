import serial
import pandas as pd
import time
from datetime import datetime, timedelta

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
    return pd.read_excel(FILE, engine="openpyxl")

# Function 3: Saves the student attendance in the Excel
def save_attendance_database(df):
    df.to_excel(FILE, index=False)

# Function 4: Find the student in the database
def find_student(df, uid):
    student = df[df["RFID_UID"].astype(str) == uid]
    return student

# Function 5: Sends message to the arduino
def send_message(arduino, message):
    arduino.write((message + "\n").encode())

# Function 6: Gets all the session the lecturer select
def get_session_times(session):
    start_time, end_time = SESSIONS[session]
    # time formats
    start_time = datetime.strptime(start_time,"%H:%M")
    end_time = datetime.strptime(end_time,"%H:%M")
    return start_time, end_time

# Function 11: The main function of this project
def main():
    print("\n===== RFID ATTENDANCE SYSTEM =====\n")

    # Collect input from the lecturer
    current_week = int(input("Enter Week (1-12): "))

    if current_week < 1 or current_week > 12:
        print("Week must be between 1 and 12")
        return

    current_session = int(input("Session (1-4): "))
    if current_session not in [1,2,3,4]:
        print("Invalid Session")
        return
    arduino = connect_arduino()

    while True:
        if arduino.in_waiting:
            uid = (arduino.readline().decode().strip())
            if uid:
                print(f"\nScanned UID: {uid}")
                # Call the process card function
                process_card(arduino, uid, current_week, current_session)

# Calling the main function
if __name__ == "__main__":
    main()