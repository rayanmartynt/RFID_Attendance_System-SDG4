import serial
import pandas as pd
import time

# Arduino setup
PORT = "COM3"
BAUD = 9600
# FILE = "Attendance.xlsx"

# Arduino Connection
try:
    arduino = serial.Serial(PORT, BAUD, timeout = 1)
    time.sleep(2)
    print("Connected to Arduino")
except:
    print("Could not connect to Arduino")
    exit()

print("RFID Attendance System Started")
while True:
    try:
        current_week = int(input("Enter Current week (1-12):"))
        if 1 <= current_week <= 12:
            break
        else:
            print("Week number must be between 1 and 12")
    except ValueError:
        print("Please enter a valid integer.")
CURRENT_WEEK = f"Week {current_week}"
print(f"Recording attendance for {CURRENT_WEEK}")

while True:
    try:
        uid = arduino.readline().decode().strip().upper()

        if uid == "":
            continue
        print(f"Card Scanned:{uid}")

        df = pd.read_excel("Attendance.xlsx")
        df["RFID_UID"].astype(str).str.upper()

        # Card not registered
        if uid not in df["RFID_UID"].values:
            print("Unknow RFID Card")
            arduino.write(b"NOTFOUND\n")
            continue

        # Get student record
        student = df[df["RFID_UID"] == uid]

        name = student["Name"].values[0]
        attendance = student[CURRENT_WEEK].values[0]

        # Already present
        if attendance == 1:
            print(f"{name} already present")
            arduino.write(f"DUPLICATE:{name}\n".encode())
        else:
            df.loc[
                df["RFID_UID"] == uid,
                CURRENT_WEEK
            ] = 1

            df.to_excel("Attendance.xlsx", index = False)
            print(f"{name} attendance marked")
            arduino.write(f"SUCCESS:{name}\n".encode())
    except Exception as e:
        print("Error:", e)