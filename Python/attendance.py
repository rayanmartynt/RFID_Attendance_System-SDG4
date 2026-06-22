import serial
import pandas as pd
import time

# Arduino setup
PORT = "COM3"
BAUD = 9600
FILE = "Attendance.xlsx"

# Function 1: Arduino Connection
def connect_arduino():
    try:
        arduino = serial.Serial(PORT, BAUD, timeout = 1)
        time.sleep(2)
        print("Connected to Arduino")
        return arduino
    except Exception as e:
        print("Could not connect to Arduino")
        return None

# Function 2: Allows lecturer to enter the weeek he/she wants to enter attendace for
def select_week():
    while True:
        try:
            current_week = int(input("Enter Current week (1-12):"))
            if 1 <= current_week <= 12:
                return f"Week {current_week}"
            print("Week number must be between 1 and 12")
        except ValueError:
            print("Please enter a valid integer.")

# Function 3: Load the attendance database
def load_attendance_database():
    df = pd.read_excel(FILE)
    df["RFID_UID"] = (df["RFID_UID"].astype(str).str.upper())
    return df

# Function 4: Checks if student name is on the database
def find_student(df, uid):
    student = df[df["RFID_UID"] == uid]
    if student.empty:
        return None
    return student

# Function 5: Saves the student attendance
def save_attendance(df):
    df.to_excel(
        FILE,
        index = False
    )

# Function 6: Mark and save the student attendance if he/she is present
def mark_attendance(df, uid, current_week):
    df.loc[
        df["RFID_UID"] == uid,
        current_week
    ] = 1
    save_attendance(df)

# Function 7: Sends success message if the attendance is recorded successfully
def send_success_message(arduino, student_name):
    print(f"{student_name} Attendance recorded")
    arduino.write(f"SUCCESS:{student_name}\n".encode())

# Function 8: Sends message if a student has already swapped their card
def send_duplicate_message(arduino, student_name):
    print(f"{student_name} Already Present")
    arduino.write(f"DUPLICATE:{student_name}\n".encode())

# Function 9: Sends message if an RFID card is unknown
def send_unknown_message(arduino):
    print("Unknown Card")
    arduino.write(b"NOTFOUND\n")

# Function 10: Process card step by step
def process_card(arduino, uid, current_week):
    df = load_attendance_database()

    student = find_student(df, uid)
    if student is None:
        send_unknown_message(arduino)
        return
    student_name = (student["Name"].values[0])

    attendance_status = (student[current_week].values[0])
    if attendance_status == 1:
        send_duplicate_message(arduino, student_name)
    else:
        mark_attendance(df, uid, current_week)
        send_success_message(arduino, student_name)

# Function 11: The main function of this project
def main():
    arduino = connect_arduino()

    if arduino is None:
        return

    current_week = select_week()
    print(f"Recording attendance for week {current_week}")

    while True:
        uid = (arduino.readline().decode().strip().upper())

        if uid == "":
            continue
        print(f"Scanned UID: {uid}")
        process_card(arduino, uid, current_week)

# Calling the main function
if __name__ == "__main__":
    main()