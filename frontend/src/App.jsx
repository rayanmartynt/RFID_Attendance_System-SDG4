import { useEffect, useState } from "react";
import { io } from "socket.io-client";

const SESSIONS = [
  { id: 1, start: "08:30", end: "11:30" },
  { id: 2, start: "11:30", end: "14:30" },
  { id: 3, start: "14:30", end: "17:30" },
  { id: 4, start: "17:30", end: "20:30" },
];

function App() {
  // Load state from localStorage so refreshing the page never resets controls
  const [currentWeek, setCurrentWeek] = useState(() => {
    return Number(localStorage.getItem("rfid_week")) || 1;
  });
  const [currentSession, setCurrentSession] = useState(() => {
    return Number(localStorage.getItem("rfid_session")) || 1;
  });
  const [selectedPort, setSelectedPort] = useState(() => {
    return localStorage.getItem("rfid_port") || "COM3";
  });

  const [availablePorts, setAvailablePorts] = useState(["COM3", "COM4", "COM5"]);
  const [arduinoStatus, setArduinoStatus] = useState({ connected: false, message: "Connecting to server..." });
  const [backendConnected, setBackendConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [lastScan, setLastScan] = useState(null);
  const [attendanceData, setAttendanceData] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString());
  const [socket, setSocket] = useState(null);

  const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";

  // Save changes to localStorage
  useEffect(() => {
    localStorage.setItem("rfid_week", currentWeek);
  }, [currentWeek]);

  useEffect(() => {
    localStorage.setItem("rfid_session", currentSession);
  }, [currentSession]);

  useEffect(() => {
    localStorage.setItem("rfid_port", selectedPort);
  }, [selectedPort]);

  // Live Clock
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch Attendance database from server
  const fetchAttendance = async () => {
    try {
      const res = await fetch(`${backendUrl}/attendance`);
      if (res.ok) {
        const data = await res.json();
        if (data.students) {
          setAttendanceData(data.students);
        }
      }
    } catch (err) {
      console.warn("Error fetching attendance:", err.message);
    }
  };

  // Fetch available COM ports
  const fetchPorts = async () => {
    try {
      const res = await fetch(`${backendUrl}/ports`);
      if (res.ok) {
        const data = await res.json();
        if (data.ports && data.ports.length > 0) {
          setAvailablePorts(data.ports);
        }
      }
    } catch (err) {
      // Fallback
    }
  };

  useEffect(() => {
    fetchAttendance();
    fetchPorts();
    const interval = setInterval(fetchAttendance, 3000);
    return () => clearInterval(interval);
  }, [backendUrl]);

  // Socket.IO real-time event handlers
  useEffect(() => {
    const newSocket = io(backendUrl);

    newSocket.on("connect", () => {
      setBackendConnected(true);
      fetchAttendance();
    });

    newSocket.on("disconnect", () => {
      setBackendConnected(false);
      setArduinoStatus({ connected: false, message: "Backend disconnected" });
    });

    newSocket.on("arduino-status", (status) => {
      setArduinoStatus(status);
      if (status.port) setSelectedPort(status.port);
    });

    newSocket.on("scan-result", (data) => {
      setLastScan(data);
      fetchAttendance();
    });

    newSocket.on("week-changed", (data) => {
      if (data?.week) setCurrentWeek(data.week);
    });

    newSocket.on("session-changed", (data) => {
      if (data?.session) setCurrentSession(data.session);
    });

    setSocket(newSocket);
    return () => newSocket.disconnect();
  }, [backendUrl]);

  const handleWeekChange = (week) => {
    setCurrentWeek(week);
    if (socket) socket.emit("set-week", { week });
  };

  const handleSessionChange = (session) => {
    setCurrentSession(session);
    if (socket) socket.emit("set-session", { session });
  };

  const connectArduino = async () => {
    try {
      setIsConnecting(true);
      const res = await fetch(`${backendUrl}/connect-arduino`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port: selectedPort }),
      });
      const data = await res.json();
      setArduinoStatus({
        connected: data.connected ?? false,
        message: data.message || "Connection updated",
      });
    } catch (err) {
      setArduinoStatus({ connected: false, message: "Failed to connect to backend" });
    } finally {
      setIsConnecting(false);
    }
  };

  // Metrics
  const totalEnrolled = attendanceData.length;
  const weekKey = `week${currentWeek}`;
  const presentToday = attendanceData.filter((s) => s.weeks?.[weekKey]?.status === 1).length;
  const checkedOutToday = attendanceData.filter(
    (s) => s.weeks?.[weekKey]?.status === 1 && s.weeks?.[weekKey]?.departure
  ).length;

  const filteredStudents = attendanceData.filter(
    (s) =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.uid.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="portal-container">
      {/* Executive Header */}
      <header className="portal-header">
        <div className="header-title-group">
          <h1>Student Attendance Portal</h1>
          <p>Microsoft Excel Attendance Database (`Attendance.xlsx`) • Hardware RFID Sync</p>
        </div>

        <div className="header-status-bar">
          <div className="clock-display">{currentTime}</div>

          <div className="status-chip">
            <span className={`status-indicator ${backendConnected ? "active" : "inactive"}`} />
            <span>Server: {backendConnected ? "Online" : "Offline"}</span>
          </div>

          <div className="status-chip">
            <span className={`status-indicator ${arduinoStatus.connected ? "active" : "inactive"}`} />
            <span>Hardware: {arduinoStatus.connected ? `COM Port (${selectedPort})` : "Disconnected"}</span>
          </div>
        </div>
      </header>

      {/* Metrics Section */}
      <section className="metrics-row">
        <div className="metric-card">
          <span className="label">Total Enrolled Students</span>
          <span className="value">{totalEnrolled}</span>
        </div>

        <div className="metric-card">
          <span className="label">Week {currentWeek} Arrival (1st Scan)</span>
          <span className="value" style={{ color: "#10b981" }}>
            {presentToday}
          </span>
        </div>

        <div className="metric-card">
          <span className="label">Week {currentWeek} Departure (2nd Scan)</span>
          <span className="value" style={{ color: "#2563eb" }}>
            {checkedOutToday}
          </span>
        </div>
      </section>

      {/* Hardware & Control Settings */}
      <section className="panel-card">
        <div className="controls-grid">
          <div className="field-group">
            <label>Academic Week Selection</label>
            <select
              className="form-select"
              value={currentWeek}
              onChange={(e) => handleWeekChange(Number(e.target.value))}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((w) => (
                <option key={w} value={w}>
                  Week {w}
                </option>
              ))}
            </select>
          </div>

          <div className="field-group">
            <label>Lecture Session Window</label>
            <select
              className="form-select"
              value={currentSession}
              onChange={(e) => handleSessionChange(Number(e.target.value))}
            >
              {SESSIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  Session {s.id} ({s.start} – {s.end})
                </option>
              ))}
            </select>
          </div>

          <div className="field-group">
            <label>Arduino Serial Port</label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <select
                className="form-select"
                style={{ width: "130px" }}
                value={selectedPort}
                onChange={(e) => setSelectedPort(e.target.value)}
              >
                {availablePorts.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <button
                className="btn-action"
                onClick={connectArduino}
                disabled={isConnecting || arduinoStatus.connected}
                style={{ flex: 1 }}
              >
                {arduinoStatus.connected ? "Hardware Active" : isConnecting ? "Connecting..." : "Connect Arduino"}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Live Scan Result Banner */}
      {lastScan && (
        <section className={`alert-banner ${lastScan.status?.toLowerCase() || ""}`}>
          <div className="alert-content">
            <h4>
              {lastScan.status === "ARRIVAL" && "1st Scan Recorded: Arrival Time Saved to Excel"}
              {lastScan.status === "DEPARTURE" && "2nd Scan Recorded: Departure Time Saved to Excel"}
              {lastScan.status === "DUPLICATE" && "3rd Scan Alert: Already Recorded for This Week"}
              {lastScan.status === "UNKNOWN" && "Access Denied: Unregistered RFID Card"}
              {lastScan.status === "ERROR" && "System Alert"}
            </h4>
            <p>{lastScan.message}</p>
            {lastScan.student && (
              <p style={{ marginTop: "4px", fontSize: "0.82rem", color: "var(--slate-200)" }}>
                Student ID: <strong>{lastScan.student.id}</strong> • Name: <strong>{lastScan.student.name}</strong> • RFID UID: <code className="uid-tag">{lastScan.student.uid}</code>
              </p>
            )}
          </div>
        </section>
      )}

      {/* Excel Attendance Database Register Table */}
      <section className="data-table-wrapper">
        <div className="table-header-bar">
          <h3>Attendance Register Database (`Attendance.xlsx`)</h3>
          <input
            type="text"
            className="form-input search-box"
            placeholder="Search by student name, ID, or UID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="table-scroll">
          <table className="register-table">
            <thead>
              <tr>
                <th>Student ID</th>
                <th>Full Name</th>
                <th>RFID UID</th>
                <th>Week {currentWeek} Status</th>
                <th>1st Scan (Arrival)</th>
                <th>2nd Scan (Departure)</th>
                <th>Total Present</th>
                <th>Attendance Ratio</th>
              </tr>
            </thead>
            <tbody>
              {filteredStudents.length === 0 ? (
                <tr>
                  <td colSpan="8" style={{ textAlign: "center", padding: "2rem", color: "var(--slate-400)" }}>
                    No student records found. Check that `Attendance.xlsx` exists and is formatted correctly.
                  </td>
                </tr>
              ) : (
                filteredStudents.map((st) => {
                  const weekData = st.weeks?.[weekKey] || {};
                  const isPresent = weekData.status === 1;
                  const isHighlighted = lastScan?.student?.id === st.id;

                  return (
                    <tr
                      key={st.id}
                      style={
                        isHighlighted
                          ? { backgroundColor: "rgba(37, 99, 235, 0.15)", transition: "background 0.3s ease" }
                          : {}
                      }
                    >
                      <td style={{ fontWeight: "600" }}>{st.id}</td>
                      <td style={{ fontWeight: "600" }}>{st.name}</td>
                      <td>
                        <span className="uid-tag">{st.uid}</span>
                      </td>
                      <td>
                        <span className={isPresent ? "badge-present" : "badge-absent"}>
                          {isPresent ? "PRESENT" : "ABSENT"}
                        </span>
                      </td>
                      <td style={{ color: weekData.arrival ? "#10b981" : "var(--slate-400)" }}>
                        {weekData.arrival || "—"}
                      </td>
                      <td style={{ color: weekData.departure ? "#2563eb" : "var(--slate-400)" }}>
                        {weekData.departure || "—"}
                      </td>
                      <td style={{ fontWeight: "600", fontFamily: "var(--font-mono)" }}>
                        {st.total_present} / 12
                      </td>
                      <td>
                        <div className="pct-bar-container">
                          <div className="pct-track">
                            <div
                              className="pct-fill"
                              style={{ width: `${Math.min(st.attendance_pct || 0, 100)}%` }}
                            />
                          </div>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
                            {st.attendance_pct}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default App;
