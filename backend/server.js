import express from "express";
import http from "http";
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import { Server } from "socket.io";
import { exec } from "child_process";
import path from "path";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const PORT = process.env.PORT || 4000;
const SERIAL_PORT = process.env.SERIAL_PORT || "COM3";
const BAUDRATE = parseInt(process.env.BAUDRATE || "9600", 10);
const FLASK_API = process.env.FLASK_API || "http://127.0.0.1:5000";

const SESSIONS = {
  1: { start: "08:30", end: "11:30" },
  2: { start: "11:30", end: "14:30" },
  3: { start: "14:30", end: "17:30" },
  4: { start: "17:30", end: "20:30" },
};

let currentWeek = 1;
let currentSession = 1;
let arduinoConnected = false;
let arduinoMessage = "Waiting for Arduino...";
let currentPortName = SERIAL_PORT;

// Debounce map for physical card taps (prevents duplicate triggers within 3s)
const lastScanTimes = new Map();
const DEBOUNCE_MS = 3000;

function parseTodayTime(hhmm) {
  const [hour, minute] = hhmm.split(":").map(Number);
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
}

function detectCurrentSession(now = new Date()) {
  const ids = Object.keys(SESSIONS).map(Number);
  for (const session of ids) {
    const { start, end } = SESSIONS[session];
    const startTime = parseTodayTime(start);
    const endTime = parseTodayTime(end);
    const isLast = session === Math.max(...ids);
    if (isLast) {
      if (now >= startTime && now <= endTime) return session;
    } else if (now >= startTime && now < endTime) {
      return session;
    }
  }
  return null;
}

function sessionPayload(session) {
  const { start, end } = SESSIONS[session];
  return {
    session,
    start,
    end,
    label: `Session ${session} (${start} – ${end})`,
  };
}

function setCurrentSession(session, { broadcast = true } = {}) {
  if (!SESSIONS[session]) return false;
  currentSession = session;
  if (broadcast) {
    io.emit("session-changed", sessionPayload(currentSession));
  }
  return true;
}

function autoSelectSession() {
  const active = detectCurrentSession();
  if (active && active !== currentSession) {
    console.log(`Auto-selecting session ${active}`);
    setCurrentSession(active);
  }
}

currentSession = detectCurrentSession() || 1;

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});
app.use(express.json());
app.options("*", (req, res) => {
  res.sendStatus(200);
});

app.get("/", (req, res) => res.send("RFID backend running"));

app.post("/set-week", (req, res) => {
  const { week } = req.body;
  if (week >= 1 && week <= 12) {
    currentWeek = week;
    io.emit("week-changed", { week: currentWeek });
    res.json({ week: currentWeek });
  } else {
    res.status(400).json({ error: "Week must be 1-12" });
  }
});

app.post("/set-session", (req, res) => {
  const session = Number(req.body?.session);
  if (!setCurrentSession(session)) {
    return res.status(400).json({ error: "Session must be 1-4" });
  }
  res.json(sessionPayload(currentSession));
});

app.get("/attendance", async (req, res) => {
  try {
    const response = await fetch(`${FLASK_API}/attendance`);
    if (response.ok) {
      const data = await response.json();
      return res.json(data);
    }
  } catch (err) {
    console.warn("Flask API unreachable for /attendance, falling back to direct Excel read");
  }

  // Fallback to direct Python read of Attendance.xlsx if Flask server is not running
  const pyCmd = `python -c "import pandas as pd, json, os; file=os.path.join('..','Python','Attendance.xlsx'); df=pd.read_excel(file); print(json.dumps(df.fillna('').to_dict(orient='records')))"`;
  exec(pyCmd, { cwd: process.cwd() }, (error, stdout) => {
    if (error) {
      return res.status(500).json({ error: "Failed to read Excel file", details: error.message });
    }
    try {
      const records = JSON.parse(stdout.trim());
      const status_cols = Array.from({ length: 12 }, (_, i) => `Week${i + 1}_Status`);
      const formatted = records.map((r) => {
        const total_present = status_cols.reduce((acc, col) => acc + (Number(r[col]) || 0), 0);
        const weeks = {};
        for (let w = 1; w <= 12; w++) {
          weeks[`week${w}`] = {
            arrival: String(r[`Week${w}_Arrival`] || ""),
            departure: String(r[`Week${w}_Departure`] || ""),
            status: Number(r[`Week${w}_Status`]) || 0,
          };
        }
        return {
          id: String(r.Student_ID || ""),
          name: String(r.Name || ""),
          uid: String(r.RFID_UID || "").toUpperCase(),
          total_present,
          attendance_pct: Math.round((total_present / 12) * 100 * 100) / 100,
          weeks,
        };
      });
      res.json({ current_week: currentWeek, current_session: currentSession, students: formatted });
    } catch (e) {
      res.status(500).json({ error: "Failed to parse Excel JSON output", details: e.message });
    }
  });
});

app.get("/students", async (req, res) => {
  try {
    const response = await fetch(`${FLASK_API}/students`);
    if (response.ok) {
      const data = await response.json();
      return res.json(data);
    }
  } catch (err) {
    console.warn("Flask API unreachable for /students, falling back to direct Excel read");
  }

  const pyCmd = `python -c "import pandas as pd, json, os; file=os.path.join('..','Python','Attendance.xlsx'); df=pd.read_excel(file); print(json.dumps(df[['Student_ID','Name','RFID_UID']].fillna('').to_dict(orient='records')))"`;
  exec(pyCmd, { cwd: process.cwd() }, (error, stdout) => {
    if (error) return res.status(500).json({ error: "Failed to load students" });
    try {
      const list = JSON.parse(stdout.trim()).map((s) => ({
        id: String(s.Student_ID || ""),
        name: String(s.Name || ""),
        uid: String(s.RFID_UID || "").toUpperCase(),
      }));
      res.json({ students: list });
    } catch (e) {
      res.status(500).json({ error: "Parse error" });
    }
  });
});

app.get("/ports", async (req, res) => {
  try {
    const list = await SerialPort.list();
    res.json({ ports: list.map((p) => p.path) });
  } catch (err) {
    res.status(500).json({ error: "Failed to list serial ports", details: err.message });
  }
});

app.post("/connect-arduino", (req, res) => {
  const requestedPort = req.body?.port || currentPortName;
  currentPortName = requestedPort;

  if (serialRetryTimer) {
    clearTimeout(serialRetryTimer);
    serialRetryTimer = null;
  }

  updateArduinoStatus(false, `Connecting to Arduino on ${currentPortName}...`);
  setupSerialPort(currentPortName);

  setTimeout(() => {
    res.json({
      connected: arduinoConnected,
      port: currentPortName,
      message: arduinoMessage,
    });
  }, 800);
});

// Socket.IO Connection Handler
io.on("connection", (socket) => {
  console.log("Web client connected:", socket.id);
  // Send current state to newly connected/refreshed page immediately
  socket.emit("week-changed", { week: currentWeek });
  socket.emit("session-changed", sessionPayload(currentSession));
  socket.emit("arduino-status", {
    connected: arduinoConnected,
    message: arduinoMessage,
    port: currentPortName,
  });

  socket.on("set-week", (data) => {
    const week = Number(data?.week);
    if (week >= 1 && week <= 12) {
      currentWeek = week;
      io.emit("week-changed", { week: currentWeek });
    }
  });

  socket.on("set-session", (data) => {
    const session = Number(data?.session);
    setCurrentSession(session);
  });
});

function sendToArduino(message) {
  if (port && port.isOpen) {
    console.log("Writing to Arduino Serial:", message);
    port.write(message + "\n", (err) => {
      if (err) console.error("Error writing to Arduino serial:", err.message);
    });
  }
}

// Process a scan by calling Flask API
async function processScan(rawUid, { strict = false } = {}) {
  const uid = String(rawUid || "").trim().toUpperCase();
  if (!uid) return;

  // Debounce check
  const now = Date.now();
  const lastTime = lastScanTimes.get(uid) || 0;
  if (now - lastTime < DEBOUNCE_MS) {
    console.log(`[Debounce] Ignored rapid duplicate scan for UID: ${uid}`);
    return;
  }
  lastScanTimes.set(uid, now);

  autoSelectSession();
  try {
    const response = await fetch(`${FLASK_API}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, week: currentWeek, session: currentSession, strict }),
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      throw new Error(`Flask API returned invalid JSON (status ${response.status}): ${text.slice(0, 500)}`);
    }

    if (!response.ok) {
      throw new Error(`Flask API error ${response.status}: ${JSON.stringify(data)}`);
    }

    console.log("API scan response:", data);
    
    // Respond to physical Arduino device
    if (data.status === "ARRIVAL") {
      sendToArduino(`PRESENT:${data.student?.name || ""}`);
    } else if (data.status === "DEPARTURE") {
      sendToArduino(`CHECKOUT:${data.student?.name || ""}`);
    } else if (data.status === "DUPLICATE") {
      sendToArduino("DUPLICATE");
    } else {
      sendToArduino("NOTFOUND");
    }

    io.emit("scan-result", data);
    return data;
  } catch (err) {
    console.error("Error processing scan via Flask API:", err.message);
    sendToArduino("NOTFOUND");
    const errorPayload = { status: "ERROR", message: err.message };
    io.emit("scan-result", errorPayload);
    return errorPayload;
  }
}

let port = null;
let parser = null;
let serialRetryTimer = null;
let intentionalClose = false;
const SERIAL_RETRY_DELAY = parseInt(process.env.SERIAL_RETRY_DELAY || "5000", 10);

function updateArduinoStatus(connected, message) {
  arduinoConnected = connected;
  arduinoMessage = message;
  io.emit("arduino-status", { connected, message, port: currentPortName });
}

function scheduleSerialRetry(reason) {
  if (serialRetryTimer) return;
  console.warn(`Scheduling serial retry in ${SERIAL_RETRY_DELAY}ms: ${reason}`);
  updateArduinoStatus(false, `Retrying serial connection in ${SERIAL_RETRY_DELAY / 1000}s...`);
  serialRetryTimer = setTimeout(() => {
    serialRetryTimer = null;
    setupSerialPort(currentPortName);
  }, SERIAL_RETRY_DELAY);
}

function destroySerialPort() {
  if (!port) return;

  intentionalClose = true;
  try {
    port.removeAllListeners();
    if (parser) {
      parser.removeAllListeners();
      parser = null;
    }
    if (port.isOpen) {
      port.close(() => {
        intentionalClose = false;
      });
    } else {
      intentionalClose = false;
    }
  } catch (err) {
    intentionalClose = false;
    console.warn("Failed to destroy existing port:", err.message || err);
  }
  port = null;
}

function setupSerialPort(portPath = currentPortName) {
  if (serialRetryTimer) {
    clearTimeout(serialRetryTimer);
    serialRetryTimer = null;
  }

  destroySerialPort();
  currentPortName = portPath;

  console.log(`Attempting connection to ${currentPortName}...`);
  port = new SerialPort({ path: currentPortName, baudRate: BAUDRATE, autoOpen: false });
  parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

  port.on("open", () => {
    updateArduinoStatus(true, `Arduino connected on ${currentPortName}`);
    console.log(`Serial port ${currentPortName} opened at ${BAUDRATE}`);
  });

  parser.on("data", (line) => {
    const uid = String(line || "").trim();
    if (!uid) return;
    console.log("Scanned UID:", uid);
    processScan(uid);
  });

  port.on("error", (err) => {
    if (intentionalClose) return;
    const message = `Arduino connection error on ${currentPortName}: ${err.message || err}`;
    console.error("Serial port error:", err.message || err);
    updateArduinoStatus(false, message);
    scheduleSerialRetry(message);
  });

  port.on("close", () => {
    if (intentionalClose) return;
    const message = `Arduino disconnected from ${currentPortName}`;
    console.warn("Serial port closed");
    updateArduinoStatus(false, message);
    scheduleSerialRetry(message);
  });

  port.open((err) => {
    if (err) {
      const message = `Failed to open ${currentPortName}: ${err.message || err}`;
      console.error(message);
      updateArduinoStatus(false, message);
      scheduleSerialRetry(message);
    }
  });
}

setupSerialPort();

setInterval(autoSelectSession, 30_000);
autoSelectSession();

console.log(`Using Flask API at ${FLASK_API}`);
server.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
