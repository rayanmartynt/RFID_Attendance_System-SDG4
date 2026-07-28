import express from "express";
import http from "http";
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import { Server } from "socket.io";
import { exec } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import multer from "multer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

let currentWeek = 1;
let currentSession = 1;
let arduinoConnected = false;
let arduinoMessage = "Waiting for Arduino...";
let currentPortName = SERIAL_PORT;

// Debounce map for physical card taps (prevents duplicate triggers within 3s)
const lastScanTimes = new Map();
const DEBOUNCE_MS = 3000;

// --- Multer: store uploaded Excel files in the uploads folder ---
const excelUploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(excelUploadDir)) fs.mkdirSync(excelUploadDir, { recursive: true });

// Tracks the path of the currently active workbook (set on upload)
let currentExcelPath = null;

// Initialize currentExcelPath to existing Attendance.xlsx if available
const attendanceFilePath = path.join(excelUploadDir, "Attendance.xlsx");
if (fs.existsSync(attendanceFilePath)) {
  currentExcelPath = attendanceFilePath;
  console.log(`Initialized with existing workbook: ${attendanceFilePath}`);
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, excelUploadDir),
  // Preserve the lecturer's original filename
  filename: (_req, file, cb) => cb(null, file.originalname),
});
const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.mimetype === "application/vnd.ms-excel" ||
      file.originalname.endsWith(".xlsx") ||
      file.originalname.endsWith(".xls");
    cb(null, ok);
  },
});

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
  if (session < 1 || session > 4) {
    return res.status(400).json({ error: "Session must be 1-4" });
  }
  currentSession = session;
  io.emit("session-changed", { session: currentSession });
  res.json({ session: currentSession });
});

// --- Workbook Library routes ---

// List all workbooks in the uploads folder
app.get("/workbooks", (req, res) => {
  try {
    const files = fs.readdirSync(excelUploadDir).filter((f) =>
      f.endsWith(".xlsx") || f.endsWith(".xls")
    );
    const activeFilename = currentExcelPath ? path.basename(currentExcelPath) : null;
    res.json({
      files: files.map((f) => ({ filename: f, active: f === activeFilename })),
      activeFilename,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to list workbooks", details: err.message });
  }
});

// Upload a new workbook into the library (does NOT auto-activate it)
app.post("/workbooks/upload", upload.single("workbook"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No Excel file received. Please upload a .xlsx or .xls file." });
  }
  console.log(`Workbook added to library: ${req.file.path}`);
  res.json({ success: true, filename: req.file.originalname });
});

// Set a workbook as the active one
app.post("/workbooks/select", async (req, res) => {
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ error: "filename is required" });
  const targetPath = path.join(excelUploadDir, filename);
  if (!fs.existsSync(targetPath)) {
    return res.status(404).json({ error: `File "${filename}" not found in workbook library.` });
  }
  currentExcelPath = targetPath;
  console.log(`Active workbook set to: ${currentExcelPath}`);

  // Notify Flask API of the new workbook
  try {
    const flaskResponse = await fetch(`${FLASK_API}/set-workbook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename }),
    });
    if (flaskResponse.ok) {
      console.log(`Flask API notified of workbook change: ${filename}`);
    } else {
      console.warn(`Flask API failed to set workbook: ${flaskResponse.status}`);
    }
  } catch (err) {
    console.warn("Failed to notify Flask API of workbook change:", err.message);
  }

  res.json({ success: true, activeFilename: filename });
});

// Delete a workbook from the library
app.delete("/workbooks/:filename", (req, res) => {
  const filename = decodeURIComponent(req.params.filename);
  const targetPath = path.join(excelUploadDir, filename);
  if (!fs.existsSync(targetPath)) {
    return res.status(404).json({ error: `File "${filename}" not found.` });
  }
  fs.rmSync(targetPath);
  // Clear active path if the deleted file was active
  if (currentExcelPath === targetPath) currentExcelPath = null;
  console.log(`Workbook deleted: ${filename}`);
  res.json({ success: true, deleted: filename });
});

app.get("/attendance", async (req, res) => {
  try {
    console.log(`Attempting to fetch from Flask API: ${FLASK_API}/attendance`);
    const response = await fetch(`${FLASK_API}/attendance`);
    console.log(`Flask response status: ${response.status}`);
    if (response.ok) {
      const data = await response.json();
      console.log(`Successfully received data from Flask with ${data.students?.length || 0} students`);
      return res.json(data);
    } else {
      console.warn(`Flask API returned status ${response.status}, falling back to direct Excel read`);
    }
  } catch (err) {
    console.warn("Flask API unreachable for /attendance, falling back to direct Excel read:", err.message);
  }

  // Fallback: read the lecturer's uploaded workbook directly with Python
  if (!currentExcelPath) {
    return res.status(503).json({
      error: "No workbook loaded",
      details: "Please upload your Excel attendance file using the upload button.",
    });
  }

  const safePath = currentExcelPath.replace(/\\/g, "/");
  const pyCmd = `python -c "import pandas as pd, json; df=pd.read_excel(r'${safePath}'); print(json.dumps(df.fillna('').to_dict(orient='records')))"`;
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
    console.log(`Attempting to fetch students from Flask API: ${FLASK_API}/students`);
    const response = await fetch(`${FLASK_API}/students`);
    console.log(`Flask students response status: ${response.status}`);
    if (response.ok) {
      const data = await response.json();
      console.log(`Successfully received students from Flask`);
      return res.json(data);
    } else {
      console.warn(`Flask API returned status ${response.status} for /students, falling back to direct Excel read`);
    }
  } catch (err) {
    console.warn("Flask API unreachable for /students, falling back to direct Excel read:", err.message);
  }

  if (!currentExcelPath) {
    return res.status(503).json({
      error: "No workbook loaded",
      details: "Please upload your Excel attendance file first.",
    });
  }

  const safePath = currentExcelPath.replace(/\\/g, "/");
  const pyCmd = `python -c "import pandas as pd, json; df=pd.read_excel(r'${safePath}'); print(json.dumps(df[['Student_ID','Name','RFID_UID']].fillna('').to_dict(orient='records')))"`;
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
  socket.emit("session-changed", { session: currentSession });
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
});

function sendToArduino(message) {
  if (port && port.isOpen) {
    console.log("Writing to Arduino Serial:", message);
    port.write(message + "\n", (err) => {
      if (err) console.error("Error writing to Arduino serial:", err.message);
    });
  }
}

// Auto-select session based on current time
function autoSelectSession() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const currentTime = hours * 60 + minutes; // Convert to minutes since midnight

  // Define session time ranges (in minutes since midnight)
  const sessions = [
    { session: 1, start: 8 * 60 + 30, end: 11 * 60 + 30 }, // 08:30 - 11:30
    { session: 2, start: 11 * 60 + 30, end: 14 * 60 + 30 }, // 11:30 - 14:30
    { session: 3, start: 14 * 60 + 30, end: 17 * 60 + 30 }, // 14:30 - 17:30
    { session: 4, start: 17 * 60 + 30, end: 20 * 60 + 30 }, // 17:30 - 20:30
  ];

  for (const s of sessions) {
    if (currentTime >= s.start && currentTime < s.end) {
      if (currentSession !== s.session) {
        currentSession = s.session;
        console.log(`Auto-selected session ${currentSession}`);
        io.emit("session-changed", { session: currentSession });
      }
      return;
    }
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



console.log(`Using Flask API at ${FLASK_API}`);
server.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
