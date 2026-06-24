# RFID-Based Automated Student Attendance System

[![Platform](https://img.shields.io/badge/platform-Arduino%20%26%20Python-blue)](https://www.arduino.cc/)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Status](https://img.shields.io/badge/status-Production%20Ready-brightgreen)]()

---

## 📑 Table of Contents

- [1. Introduction](#1-introduction)
- [2. Core Features](#2-core-features)
- [3. System Workflow](#3-system-workflow)
- [4. Technology Stack](#4-technology-stack)
  - [Hardware Components](#hardware-components)
  - [Software Dependencies](#software-dependencies)
- [5. Hardware Schematics, Pin Mapping, Diagram & Simulation](#5-hardware-schematics--pin-mapping--diagram--simulation)
- [6. Software Installation & Setup](#6-software-installation--setup)
  - [Arduino IDE Configuration](#arduino-ide-configuration)
  - [Python Environment Setup](#python-environment-setup)
- [7. Database Structure (Excel)](#7-database-structure-excel)
- [8. User Feedback Matrix](#9-user-feedback-matrix)
- [9. Usage Guide](#10-usage-guide)
- [10. Troubleshooting & Common Issues](#11-troubleshooting--common-issues)
- [11. Future Enhancements](#12-future-enhancements)
- [12. Author](#13-author)
- [13. License](#14-license)

---

## 1. Introduction

The **RFID-Based Automated Student Attendance System** is a smart, embedded solution engineered to modernize attendance tracking in universities and schools. By integrating **RFID technology**, **Arduino Uno**, **Python**, and **Microsoft Excel**, the system provides a seamless, error-free alternative to traditional paper registers.

Each student is assigned a unique RFID card. Upon scanning, the system authenticates the user, records attendance for the selected academic week, updates the central Excel database in real-time, and delivers instantaneous visual and auditory feedback via LEDs, an LCD display, and a buzzer.

This solution eliminates manual record-keeping, mitigates proxy attendance, and provides educators with robust digital data for analytics and reporting.

---

## 2. Core Features

- **RFID-Based Authentication** – Unique UID verification for each student.
- **Weekly Attendance Tracking** – Supports up to 12 academic weeks per semester.
- **Real-Time Database Sync** – Direct updates to `.xlsx` files using Python libraries.
- **Duplicate Entry Prevention** – Ensures a student is marked present only once per week.
- **Multi-Modal Feedback** – 16×2 LCD, dual-color LEDs (Green/Red), and a buzzer for immediate status updates.
- **Automated Calculations** – Computes total attendance percentages dynamically.
- **Secure & Non-Volatile** – Data persists in Excel without requiring cloud connectivity.

---

## 3. System Workflow

The system operates on a sequential logic loop:

| Step | Action |
| :---: | :--- |
| **1** | The instructor powers on the system and selects the current week (Week 1 – Week 12). |
| **2** | A student taps their RFID card on the RC522 reader. |
| **3** | The reader captures the card's unique UID and transmits it to the Arduino via SPI. |
| **4** | Arduino forwards the UID to the host PC via Serial Communication (USB). |
| **5** | A Python script parses the serial data and queries the Excel database. |
| **6** | **Conditional Logic**: <br> • *If UID exists and Week value is 0* → Mark as `1` (Present), update Excel, play success tone. <br> • *If UID exists and Week value is 1* → Reject as duplicate, play error tone. <br> • *If UID does not exist* → Reject as unauthorized, play alarm. |
| **7** | The LCD updates with a relevant message while LEDs indicate the final status. |

---

## 4. Technology Stack

### Hardware Components
| Component | Model/Type | Quantity |
| :--- | :--- | :--- |
| Microcontroller | Arduino Uno R3 | 1 |
| RFID Reader | RC522 (13.56 MHz) | 1 |
| RFID Tags/Cards | ISO 14443A Compatible | N |
| Display | 16×2 Character LCD (with I2C or parallel) | 1 |
| Indicator LEDs | Green (Success), Red (Error 1), Red (Error 2) | 3 |
| Buzzer | 5V Active Piezo | 1 |
| Power Supply | 5V 2A Adapter (external recommended) | 1 |
| Interconnects | Jumper Wires & Breadboard | Set |

### Software Dependencies
- **Programming Languages**: C++ (Arduino), Python 3.8+
- **Arduino Libraries**: `SPI.h`, `MFRC522.h`, `LiquidCrystal.h`
- **Python Libraries**:
  - `pyserial` – Serial communication.
  - `pandas` – Data manipulation.
  - `openpyxl` – Excel read/write operations.

---

## 5. Hardware Schematics, Pin Mapping, Diagram & Simulation

> **⚠️ Correction Notice**: The buzzer has been moved from **D12** (conflicts with MISO) to **D5** for functional integrity.

### RC522 RFID Reader
| RC522 Pin | Arduino Pin |
| :--- | :--- |
| SDA | D10 |
| SCK | D13 |
| MOSI | D11 |
| MISO | D12 |
| RST | D9 |
| GND | GND |
| 3.3V | 3.3V |

### Peripheral Components
| Component | Arduino Pin | Description |
| :--- | :--- | :--- |
| Green LED | D2 | Success indicator |
| Red LED (Unknown Card) | D3 | Unauthorized access |
| Red LED (Duplicate) | D4 | Already scanned this week |
| Buzzer | D5 | *Updated from D12 to avoid SPI conflict* |
| LCD RS | D7 | Register Select |
| LCD E | D6 | Enable |
| LCD D4 – D7 | D5, D8, A0, A1 | Data buses (4-bit mode) |

### Diagram
<img width="3000" height="2306" alt="Design" src="https://github.com/user-attachments/assets/21e58f9f-9426-4a25-ae05-028c0a1dfb23" />

### Simulation
https://github.com/user-attachments/assets/50ee161b-aff6-4718-b13f-4257404325e6

---

## 6. Software Installation & Setup

### Arduino IDE Configuration
1. Install the **Arduino IDE** (v2.x recommended).
2. Open the Library Manager (`Sketch > Include Library > Manage Libraries`).
3. Install **MFRC522** by Miguel Balboa.
4. Install **LiquidCrystal** (built-in, but ensure it's enabled).
5. Flash the provided `.ino` file to your Arduino Uno.

### Python Environment Setup
Execute the following commands in your terminal:

```bash
# Create a virtual environment (optional)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install required packages
pip install pyserial pandas openpyxl
```

## 7. Database Structure (Excel)

The system relies on a single Excel workbook (`Attendance.xlsx`) structured as follows:

| Column Name | Data Type | Description |
| :--- | :--- | :--- |
| RFID_UID | String | Unique 8-character Hex ID (e.g., `63A1B2C4`) |
| Student_ID | String | Institutional enrollment number |
| Name | String | Student's full name |
| Week1_Arrival – Week12_Arrival | String | Student's arrival time |
| Week1_Departure – Week12_Departure | String | Student's departure time |
| Week1_Status – Week12_Status | String | Student attendance status (Present, Late, Left-early, Absent) |



## 9. User Feedback Matrix

The system provides immediate multimodal feedback for every scan:

| Status | Green LED (D2) | Red LED 1 (D3) | Red LED 2 (D4) | Buzzer (D5) | LCD Message |
| :--- | :---: | :---: | :---: | :--- | :--- |
| **Attendance Marked** | ON | OFF | OFF | Short Beep (100ms) | `WELCOME [NAME]` <br> `ATTENDANCE SAVED` |
| **Unknown Card** | OFF | ON | OFF | 2 Short Beeps | `UNKNOWN CARD` <br> `ACCESS DENIED` |
| **Duplicate Scan** | OFF | OFF | ON | Long Beep (500ms) | `ALREADY PRESENT` <br> `WEEK RECORDED` |


## 10. Usage Guide

1. **Initialize**: Launch the Python script (`attendance.py`) to start serial monitoring.
2. **Select Week**: When prompted in the terminal, enter the current academic week (1–12).
3. **Scan Cards**: Instruct students to tap their RFID cards sequentially.
4. **Monitor Feedback**: Observe the LCD and terminal logs for real-time status.
5. **Review Data**: Open `Attendance.xlsx` to view updated attendance logs.
6. **End Session**: Press `Ctrl+C` in the terminal to gracefully shut down the serial connection.


## 11. Troubleshooting & Common Issues

| Issue | Likely Cause | Solution |
| :--- | :--- | :--- |
| **RFID reader not detecting cards** | Loose connections or insufficient power. | Check SPI wiring. Use external 5V supply instead of USB. |
| **Serial port not found** | Incorrect COM port or driver issues. | Update Arduino drivers. Verify port name in Python script. |
| **Excel file not updating** | File is open in Excel (write-lock). | Close the Excel file before running the script. |
| **Buzzer interfering with RFID** | Buzzer uses D12 (conflicts with SPI MISO). | **Fixed** – use D5 as per the updated schematic above. |
| **Duplicate entries recorded** | Logic misalignment in week selection. | Ensure the Python script correctly parses the current week variable. |


## 12. Future Enhancements

- **GUI Dashboard**: Develop a Tkinter/PyQt interface for non-technical users.
- **Database Migration**: Transition from Excel to SQLite/MySQL for robust multi-user access.
- **Wi-Fi/Cloud Sync**: Add an ESP8266 module to push attendance data to Google Sheets or Firebase.
- **Biometric Fallback**: Integrate a fingerprint scanner as a secondary authentication method.
- **Automated Reports**: Generate PDF attendance reports and email them directly to faculty.


## 13. Author

**Rayan Martin Turay**  
[GitHub](https://github.com/rayanmartynt)
