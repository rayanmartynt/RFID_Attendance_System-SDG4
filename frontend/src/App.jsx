import { useEffect, useState } from "react";
import { io } from "socket.io-client";


function App() {
  // Load state from localStorage so refreshing the page never resets controls
  const [currentWeek, setCurrentWeek] = useState(() => {
    return Number(localStorage.getItem("rfid_week")) || 1;
  });
  const [selectedPort, setSelectedPort] = useState(() => {
    return localStorage.getItem("rfid_port") || "COM3";
  });
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "dark";
    const savedTheme = localStorage.getItem("rfid_theme");
    if (savedTheme) return savedTheme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
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
  const [uploadStatus, setUploadStatus] = useState(null); // { type: 'success'|'error'|'loading', message }
  const [workbooks, setWorkbooks] = useState([]); // [{ filename, active }]
  const [activeFilename, setActiveFilename] = useState(null);

  const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";

  // Save changes to localStorage
  useEffect(() => {
    localStorage.setItem("rfid_week", currentWeek);
  }, [currentWeek]);

  useEffect(() => {
    localStorage.setItem("rfid_port", selectedPort);
  }, [selectedPort]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("rfid_theme", theme);
  }, [theme]);

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

  // Fetch workbook library
  const fetchWorkbooks = async () => {
    try {
      const res = await fetch(`${backendUrl}/workbooks`);
      if (res.ok) {
        const data = await res.json();
        setWorkbooks(data.files || []);
        setActiveFilename(data.activeFilename || null);
      }
    } catch (err) {
      console.warn("Error fetching workbook library:", err.message);
    }
  };

  useEffect(() => {
    fetchAttendance();
    fetchPorts();
    fetchWorkbooks();
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

    setSocket(newSocket);
    return () => newSocket.disconnect();
  }, [backendUrl]);

  const handleWeekChange = (week) => {
    setCurrentWeek(week);
    if (socket) socket.emit("set-week", { week });
  };

  const handleWorkbookUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadStatus({ type: "loading", message: `Uploading "${file.name}"...` });
    const formData = new FormData();
    formData.append("workbook", file);
    try {
      const res = await fetch(`${backendUrl}/workbooks/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        setUploadStatus({ type: "success", message: `"${file.name}" added to library.` });
        fetchWorkbooks();
        setTimeout(() => setUploadStatus(null), 5000);
      } else {
        setUploadStatus({ type: "error", message: data.error || "Upload failed." });
      }
    } catch (err) {
      setUploadStatus({ type: "error", message: "Upload failed: backend unreachable." });
    }
    e.target.value = "";
  };

  const handleSelectWorkbook = async (filename) => {
    try {
      const res = await fetch(`${backendUrl}/workbooks/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename }),
      });
      if (res.ok) {
        setActiveFilename(filename);
        setWorkbooks((prev) =>
          prev.map((w) => ({ ...w, active: w.filename === filename }))
        );
        fetchAttendance();
      }
    } catch (err) {
      console.warn("Error selecting workbook:", err.message);
    }
  };

  const handleDeleteWorkbook = async (filename) => {
    if (!confirm(`Delete "${filename}" from the library? This cannot be undone.`)) return;
    try {
      const res = await fetch(`${backendUrl}/workbooks/${encodeURIComponent(filename)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        fetchWorkbooks();
        if (activeFilename === filename) {
          setActiveFilename(null);
          setAttendanceData([]);
        }
      }
    } catch (err) {
      console.warn("Error deleting workbook:", err.message);
    }
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
          <p>RFID Attendance System • Hardware Sync{activeFilename ? ` • ${activeFilename}` : ""}</p>
        </div>

        <div className="header-status-bar">
          <button
            className={`theme-toggle ${theme === "dark" ? "theme-toggle--dark" : "theme-toggle--light"}`}
            type="button"
            onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            <span className="theme-toggle__thumb" />
            <span className="theme-toggle__label">
              {theme === "dark" ? "Dark" : "Light"}
            </span>
          </button>

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

      {/* Workbook Library */}
      <section className="panel-card">
        <div className="library-header">
          <div>
            <h3 className="library-title">📁 Workbook Library</h3>
            <p className="library-subtitle">
              {activeFilename
                ? `Active: ${activeFilename}`
                : "No workbook selected — click Load on a file below to activate it"}
            </p>
          </div>
          <label className="btn-upload-lib">
            <input
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={handleWorkbookUpload}
              style={{ display: "none" }}
            />
            ＋ Add Workbook
          </label>
        </div>

        {uploadStatus && (
          <div className={`upload-status upload-status--${uploadStatus.type}`} style={{ marginBottom: "0.75rem" }}>
            {uploadStatus.type === "loading" && <span className="upload-spinner" />}
            {uploadStatus.message}
          </div>
        )}

        {workbooks.length === 0 ? (
          <div className="library-empty">
            No workbooks in library yet. Click <strong>＋ Add Workbook</strong> to upload your first Excel file.
          </div>
        ) : (
          <ul className="workbook-list">
            {workbooks.map((wb) => (
              <li key={wb.filename} className={`workbook-item${wb.active ? " workbook-item--active" : ""}`}>
                <span className="workbook-icon">{wb.active ? "🟢" : "📄"}</span>
                <span className="workbook-name">{wb.filename}</span>
                {wb.active && <span className="badge-active">ACTIVE</span>}
                <div className="workbook-actions">
                  {!wb.active && (
                    <button
                      className="btn-lib btn-lib--load"
                      onClick={() => handleSelectWorkbook(wb.filename)}
                    >
                      Load
                    </button>
                  )}
                  <button
                    className="btn-lib btn-lib--delete"
                    onClick={() => handleDeleteWorkbook(wb.filename)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
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
          <h3>Attendance Register{activeFilename ? ` — ${activeFilename}` : ""}</h3>
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
                    {activeFilename
                      ? `No student records found. Verify "${activeFilename}" is formatted correctly.`
                      : "No workbook loaded. Select a workbook from the library above to get started."}
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
