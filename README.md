# 📚 RFID-Based Automated Student Attendance System – Full‑Stack Edition

## 📑 Table of Contents

1. [Introduction](#introduction)  
2. [Core Features](#core-features)  
3. [System Architecture](#system-architecture)  
4. [Technology Stack](#technology-stack)  
   - [Hardware Components](#hardware-components)  
   - [Software Dependencies](#software-dependencies)  
5. [Hardware Schematics & Pin Mapping](#hardware-schematics--pin-mapping)  
6. [Software Installation & Setup](#software-installation--setup)  
   - [Backend (Node.js + Flask)](#backend-nodejs--flask)  
   - [Frontend (React)](#frontend-react)  
   - [Arduino IDE Configuration](#arduino-ide-configuration)  
7. [Database Structure (Excel)](#database-structure-excel)  
8. [User Feedback Matrix](#user-feedback-matrix)  
9. [Usage Guide](#usage-guide)  
10. [Troubleshooting & Common Issues](#troubleshooting--common-issues)  
11. [Future Enhancements](#future-enhancements)  
12. [Author](#author)  

---

## 1. Introduction

The **RFID-Based Automated Student Attendance System** is a fully integrated solution that combines **embedded hardware (Arduino + RFID)** with a **full‑stack software suite** to modernise attendance tracking in educational institutions.

This enhanced version introduces:
- A **React‑based web dashboard** for live monitoring and control.
- A **Node.js WebSocket server** that bridges the Arduino serial port and the frontend.
- A **Flask REST API** to handle Excel read/write operations.
- Real‑time updates via **Socket.IO**, ensuring that every scan is instantly reflected on the dashboard.

Together, they eliminate manual record‑keeping, prevent proxy attendance, and provide educators with an intuitive interface to manage weekly sessions and review attendance analytics.

---

## 2. Core Features

- **RFID Authentication** – Unique UID verification for each student.
- **Weekly Attendance Tracking** – Supports up to **15 academic weeks** (configurable).
- **Real‑Time Dashboard** – Shows total enrolled, arrivals, departures, and live scans.
- **Dual‑Scan Logic** – Records **arrival** (1st scan) and **departure** (2nd scan) per week.
- **Duplicate Prevention** – Prevents multiple scans in the same week.
- **Multi‑Modal Feedback** – LCD, LEDs, and buzzer on the Arduino; browser notifications via the dashboard.
- **Excel Database** – All attendance data is stored in `Attendance.xlsx` using `openpyxl` and `pandas`.
- **Session Awareness** – Auto‑detects the current lecture session based on system time.
- **Search & Filter** – Quickly locate students by name, ID, or RFID UID.
- **Persistent Settings** – Selected week, session, and COM port survive page refreshes.

---

## 3. System Architecture

The system is composed of four main layers:

<img width="335" height="729" alt="RFID SYSTEM-Page-2 drawio" src="https://github.com/user-attachments/assets/d576f4f0-07e8-4dab-9586-a64b1140b45f" />


**Data Flow:**
1. A student taps an RFID card on the reader.
2. Arduino reads the UID and sends it over USB serial.
3. The Node.js backend captures the serial data and forwards it to the Flask API.
4. Flask validates the UID against the Excel file, updates statuses and timestamps, and returns a result.
5. The Node.js server sends the result back to the Arduino (for feedback) and broadcasts it to all connected web clients via Socket.IO.
6. The React dashboard updates instantly, showing the scan result and refreshing the attendance table.

---

## 4. Technology Stack

### Hardware Components

| Component              | Model/Type                | Qty |
|------------------------|---------------------------|-----|
| Microcontroller        | Arduino Uno R3            | 1   |
| RFID Reader            | RC522 (13.56 MHz)         | 1   |
| RFID Tags/Cards        | ISO 14443A Compatible     | N   |
| Display                | 16×2 LCD (I2C or parallel)| 1   |
| Indicator LEDs         | Green, Blue, Red          | 3   |
| Buzzer                 | 5V Active Piezo           | 1   |
| Power Supply           | 5V 2A Adapter             | 1   |
| Interconnects          | Jumper Wires & Breadboard | Set |

### Software Dependencies

| Layer       | Language / Framework            | Key Libraries / Tools                     |
|-------------|----------------------------------|-------------------------------------------|
| **Frontend**| React 18 + Vite                 | Socket.IO client, `fetch`, `localStorage` |
| **Backend** | Node.js (Express)               | `serialport`, `socket.io`, `cors`         |
| **API**     | Python 3.8+ (Flask)             | `pandas`, `openpyxl`, `flask-cors`        |
| **Arduino** | C++ (Arduino IDE)               | `SPI.h`, `MFRC522.h`, `LiquidCrystal.h`   |

---

## 5. Hardware Schematics & Pin Mapping

> ⚠️ **Correction:** The buzzer is moved from D12 (conflicts with SPI MISO) to D5 for functional integrity.

### RC522 RFID Reader

| RC522 Pin | Arduino Pin |
|-----------|-------------|
| SDA       | D10         |
| SCK       | D13         |
| MOSI      | D11         |
| MISO      | D12         |
| RST       | D9          |
| GND       | GND         |
| 3.3V      | 3.3V        |

### Peripheral Components

| Component           | Arduino Pin | Description                         |
|---------------------|-------------|-------------------------------------|
| Green LED (Success) | D2          | Present / Check‑out success         |
| Blue LED (Duplicate)| D3          | Already scanned this week           |
| Red LED (Unknown)   | D4          | Unauthorised access                 |
| Buzzer              | D5          | Audio feedback tones                |
| LCD RS              | D7          | Register Select                     |
| LCD E               | D6          | Enable                              |
| LCD D4 – D7         | D5, D8, A0, A1 | Data buses (4‑bit mode)         |

> **Note:** The LCD is configured in 4‑bit mode. If using an I2C backpack, adjust the pins accordingly.

---

## 6. Software Installation & Setup

### Prerequisites
- **Node.js** (v16 or later) and **npm**
- **Python** (v3.8+) with `pip`
- **Arduino IDE** (v2.x recommended)
- **Git**

### Project Structure
```
RFID_Attendance_System-SDG4/
├── frontend/               # React frontend (Vite)
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── styles.css
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── backend/                # Node.js WebSocket server
│   ├── server.js
│   ├── package.json
├── Python/                 # Flask API and Arduino scripts
│   ├── app.py              # Flask application
│   ├── attendance.py       # (optional) standalone Python script
│   ├── Attendance.xlsx     # Excel database (must exist)
├── Arduino/                # Arduino sketch
│   └── RFID_Attendance.ino
└── README.md
```

---

### Backend (Node.js + Flask)

#### 1. Flask API (Python)
Navigate to the `Python/` folder and install dependencies:
```bash
cd Python
```
Run the Flask server:
```bash
python app.py
```
It will start on `http://localhost:5000` by default.

#### 2. Node.js WebSocket Server
Navigate to the `backend/` folder:
```bash
cd backend
npm install
```
Start the server:
```bash
npm start
```

### Frontend (React)
Navigate to the `frontend/` folder:
```bash
cd frontend
npm install
```
Run the development server:
```bash
npm run dev
```
Preview
<img width="1919" height="912" alt="Screenshot 2026-07-28 230513" src="https://github.com/user-attachments/assets/34a857a6-64f9-4108-85af-4ff28b28d972" />


### Arduino IDE Configuration
1. Install the Arduino IDE.
2. Open the `Arduino/RFID_Attendance.ino` sketch.
3. Install required libraries via Library Manager:
   - **MFRC522** by Miguel Balboa
   - **LiquidCrystal** (built‑in)
4. Verify the pin mappings match your wiring (see section 5).
5. Select the correct board (Arduino Uno) and port.
6. Upload the sketch.

---

## 7. Database Structure (Excel)

The system relies on a single Excel workbook: **`Attendance.xlsx`**, located in the `Python/` folder.  
The sheet must contain the following columns (order is flexible, but names must match exactly):

| Column Name            | Type    | Description |
|------------------------|---------|-------------|
| `Student_ID`           | String  | Institutional enrollment number |
| `Name`                 | String  | Student's full name |
| `RFID_UID`             | String  | Unique 8‑character hex UID |
| `Week1_Status` … `Week15_Status` | Integer | 1 = Present, 0 = Absent |
| `Week1_Arrival` … `Week15_Arrival` | Time | Arrival timestamp (HH:MM:SS) |
| `Week1_Departure` … `Week15_Departure` | Time | Departure timestamp (HH:MM:SS) |

> The Flask API handles all read/write operations. The Node.js backend never touches the Excel file directly; it forwards requests to the API.

---

## 8. User Feedback Matrix

The system provides immediate multimodal feedback for every scan:

| Status                    | Green LED | Blue LED | Red LED | Buzzer            | LCD Message                | Dashboard Banner          |
|---------------------------|-----------|----------|---------|-------------------|----------------------------|---------------------------|
| **Arrival (1st scan)**    | ON        | OFF      | OFF     | Short beep        | `WELCOME [NAME]`<br>`ARRIVAL SAVED` | "1st Scan Recorded" |
| **Departure (2nd scan)**  | ON        | OFF      | OFF     | Short beep        | `GOODBYE [NAME]`<br>`DEPARTURE SAVED` | "2nd Scan Recorded" |
| **Duplicate Scan**        | OFF       | ON       | OFF     | Long beep         | `ALREADY PRESENT`<br>`WEEK RECORDED`  | "3rd Scan Alert" |
| **Unknown Card**          | OFF       | OFF      | ON      | Two short beeps   | `UNKNOWN CARD`<br>`ACCESS DENIED`     | "Access Denied" |
| **Error (API down)**      | OFF       | OFF      | ON      | Continuous alarm  | `SYSTEM ERROR`<br>`CONTACT ADMIN`     | "System Alert" |

---

## 9. Usage Guide

### Starting the System
1. **Power on** the Arduino and ensure it is connected to the PC via USB.
2. **Launch** the Flask API (`python app.py`).
3. **Launch** the Node.js backend (`npm start`).
4. **Launch** the React frontend (`npm run dev`).
5. Open the dashboard in your browser (`http://localhost:3000`).

### Daily Operation
1. **Select the current week** (1–15) using the dropdown.
2. **Select the lecture session** (1–4) – the system may auto‑detect based on time.
3. **Connect to the Arduino** by selecting the COM port and clicking “Connect Arduino”.
4. **Students tap their RFID cards** one by one.
5. The dashboard will show live scan results, update the attendance table, and highlight the scanned student.
6. **Monitor metrics** – total enrolled, arrivals, departures – update in real time.
7. **Search** for a student by name, ID, or UID to view their attendance record.

### Ending a Session
- Simply close the browser tab or stop the servers with `Ctrl+C`.
- All data is already saved to Excel, so no manual saving is needed.

---

## 10. Troubleshooting & Common Issues

| Issue                                           | Likely Cause                                      | Solution |
|-------------------------------------------------|---------------------------------------------------|----------|
| RFID reader not detecting cards                 | Loose wiring or insufficient power                | Check connections; use external 5V supply |
| Serial port not found                           | Incorrect port name or driver issue               | Update drivers; verify port in `.env` |
| Excel file not updating                         | File is open in Excel (write‑lock)                | Close Excel before running Flask |
| Buzzer interferes with RFID                     | Buzzer on D12 (conflicts with SPI MISO)           | Use D5 as per updated schematic |
| Duplicate entries allowed                       | Week selection mismatch between frontend and API  | Ensure Node.js backend and Flask use same week (auto‑synced) |
| Frontend shows “Backend Offline”                | Node.js server not running or wrong `VITE_BACKEND_URL` | Check server status; update `.env` |
| Scan results not appearing on dashboard         | Socket.IO connection lost                         | Refresh page; check console for errors |
| Arduino repeatedly reconnects                   | Serial port flaky or power issues                 | Use a powered USB hub; increase retry delay in `.env` |
| Flask API returns 500 errors                    | Excel file missing or malformed                   | Ensure `Attendance.xlsx` exists with correct column headers |

---

## 11. Future Enhancements

- **GUI Dashboard** – Already implemented with React; possible additions: charts, export to PDF.
- **Database Migration** – Switch from Excel to SQLite/PostgreSQL for multi‑user support.
- **Wi‑Fi/Cloud Sync** – Add an ESP8266 to push attendance data to Google Sheets or Firebase.
- **Biometric Fallback** – Integrate a fingerprint scanner as secondary authentication.
- **Automated Reports** – Generate weekly/monthly reports and email them to faculty.
- **Mobile App** – Develop a React Native companion app for on‑the‑go monitoring.

---

## 12. Author

**Rayan Martin Turay**  
- GitHub: [@rayanmartynt](https://github.com/rayanmartynt)  
- Project Repository: [RFID_Attendance_System-SDG4](https://github.com/rayanmartynt/RFID_Attendance_System-SDG4.git)
