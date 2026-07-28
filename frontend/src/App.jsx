import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { translations, languages } from "./translations";


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
  const [language, setLanguage] = useState(() => {
    return localStorage.getItem("rfid_language") || "en";
  });
  const [menuOpen, setMenuOpen] = useState(false);

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
  const [toast, setToast] = useState(null); // { id, message, type: 'confirm'|'success'|'error', onConfirm, onCancel }

  const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";

  const t = translations[language] || translations.en;

  const formatText = (key, params = {}) => {
    let text = key;
    if (typeof key === 'string' && key.includes('.')) {
      const keys = key.split('.');
      let value = t;
      for (const k of keys) {
        value = value?.[k];
        if (value === undefined) return key;
      }
      text = value;
    } else {
      text = t[key] || key;
    }
    
    // Replace parameters like {week}, {filename}, etc.
    Object.keys(params).forEach(param => {
      text = text.replace(`{${param}}`, params[param]);
    });
    return text;
  };

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

  useEffect(() => {
    localStorage.setItem("rfid_language", language);
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  }, [language]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuOpen && !event.target.closest('.settings-menu-container')) {
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

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
    setUploadStatus({ type: "loading", message: formatText('library.uploading', { filename: file.name }) });
    const formData = new FormData();
    formData.append("workbook", file);
    try {
      const res = await fetch(`${backendUrl}/workbooks/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        setUploadStatus({ type: "success", message: formatText('library.uploadSuccess', { filename: file.name }) });
        fetchWorkbooks();
        setTimeout(() => setUploadStatus(null), 5000);
      } else {
        setUploadStatus({ type: "error", message: data.error || formatText('library.uploadError') });
      }
    } catch (err) {
      setUploadStatus({ type: "error", message: formatText('library.uploadFailed') });
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
    setToast({
      id: Date.now(),
      message: formatText('library.deleteConfirm', { filename }),
      type: 'confirm',
      onConfirm: async () => {
        setToast(null);
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
            setToast({
              id: Date.now(),
              message: `"${filename}" deleted successfully`,
              type: 'success',
            });
            setTimeout(() => setToast(null), 3000);
          }
        } catch (err) {
          console.warn("Error deleting workbook:", err.message);
          setToast({
            id: Date.now(),
            message: "Failed to delete workbook",
            type: 'error',
          });
          setTimeout(() => setToast(null), 3000);
        }
      },
      onCancel: () => setToast(null),
    });
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
          <h1>{formatText('header.title')}</h1>
          <p>{formatText('header.subtitle')}{activeFilename ? ` • ${activeFilename}` : ""}</p>
        </div>

        <div className="header-status-bar">
          <div className="settings-menu-container">
            <button
              className="settings-menu-button"
              type="button"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Settings"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
            </button>
            
            {menuOpen && (
              <div className="settings-dropdown">
                <div className="dropdown-section">
                  <span className="dropdown-label">{formatText('menu.theme')}</span>
                  <div className="dropdown-options">
                    {['dark', 'light', 'corporate'].map((themeOption) => (
                      <button
                        key={themeOption}
                        className={`dropdown-option ${theme === themeOption ? 'dropdown-option--active' : ''}`}
                        onClick={() => setTheme(themeOption)}
                      >
                        {formatText(`menu.${themeOption}`)}
                      </button>
                    ))}
                  </div>
                </div>
                
                <div className="dropdown-section">
                  <span className="dropdown-label">{formatText('menu.language')}</span>
                  <div className="dropdown-options">
                    {languages.map((lang) => (
                      <button
                        key={lang.code}
                        className={`dropdown-option ${language === lang.code ? 'dropdown-option--active' : ''}`}
                        onClick={() => setLanguage(lang.code)}
                      >
                        {lang.nativeName}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="clock-display">{currentTime}</div>

          <div className="status-chip">
            <span className={`status-indicator ${backendConnected ? "active" : "inactive"}`} />
            <span>Server: {backendConnected ? formatText('status.serverOnline') : formatText('status.serverOffline')}</span>
          </div>

          <div className="status-chip">
            <span className={`status-indicator ${arduinoStatus.connected ? "active" : "inactive"}`} />
            <span>Hardware: {arduinoStatus.connected ? `${formatText('status.hardwareConnected')} (${selectedPort})` : formatText('status.hardwareDisconnected')}</span>
          </div>
        </div>
      </header>

      {/* Metrics Section */}
      <section className="metrics-row">
        <div className="metric-card">
          <span className="label">{formatText('metrics.totalEnrolled')}</span>
          <span className="value">{totalEnrolled}</span>
        </div>

        <div className="metric-card">
          <span className="label">{formatText('metrics.weekArrival', { week: currentWeek })}</span>
          <span className="value" style={{ color: "#10b981" }}>
            {presentToday}
          </span>
        </div>

        <div className="metric-card">
          <span className="label">{formatText('metrics.weekDeparture', { week: currentWeek })}</span>
          <span className="value" style={{ color: "#2563eb" }}>
            {checkedOutToday}
          </span>
        </div>
      </section>

      {/* Hardware & Control Settings */}
      <section className="panel-card">
        <div className="controls-grid">
          <div className="field-group">
            <label>{formatText('controls.weekSelection')}</label>
            <select
              className="form-select"
              value={currentWeek}
              onChange={(e) => handleWeekChange(Number(e.target.value))}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((w) => (
                <option key={w} value={w}>
                  {formatText('week', { week: w })}
                </option>
              ))}
            </select>
          </div>

          <div className="field-group">
            <label>{formatText('controls.arduinoPort')}</label>
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
                {arduinoStatus.connected ? formatText('controls.hardwareActive') : isConnecting ? formatText('controls.connecting') : formatText('controls.connectArduino')}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Workbook Library */}
      <section className="panel-card">
        <div className="library-header">
          <div>
            <h3 className="library-title">{formatText('library.title')}</h3>
            <p className="library-subtitle">
              {activeFilename
                ? formatText('library.active', { filename: activeFilename })
                : formatText('library.noWorkbookSelected')}
            </p>
          </div>
          <label className="btn-upload-lib">
            <input
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={handleWorkbookUpload}
              style={{ display: "none" }}
            />
            {formatText('library.addWorkbook')}
          </label>
        </div>

        {uploadStatus && (
          <div className={`upload-status upload-status--${uploadStatus.type}`} style={{ marginBottom: "0.75rem" }}>
            {uploadStatus.type === "loading" && <span className="upload-spinner" />}
            {uploadStatus.message}
          </div>
        )}

        {workbooks.length === 0 ? (
          <div className="library-empty" dangerouslySetInnerHTML={{ __html: formatText('library.empty') }} />
        ) : (
          <ul className="workbook-list">
            {workbooks.map((wb) => (
              <li key={wb.filename} className={`workbook-item${wb.active ? " workbook-item--active" : ""}`}>
                <span className="workbook-icon">{wb.active ? "●" : "○"}</span>
                <span className="workbook-name">{wb.filename}</span>
                {wb.active && <span className="badge-active">ACTIVE</span>}
                <div className="workbook-actions">
                  {!wb.active && (
                    <button
                      className="btn-lib btn-lib--load"
                      onClick={() => handleSelectWorkbook(wb.filename)}
                    >
                      {formatText('library.load')}
                    </button>
                  )}
                  <button
                    className="btn-lib btn-lib--delete"
                    onClick={() => handleDeleteWorkbook(wb.filename)}
                  >
                    {formatText('library.delete')}
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
              {lastScan.status === "ARRIVAL" && formatText('alerts.arrival')}
              {lastScan.status === "DEPARTURE" && formatText('alerts.departure')}
              {lastScan.status === "DUPLICATE" && formatText('alerts.duplicate')}
              {lastScan.status === "UNKNOWN" && formatText('alerts.unknown')}
              {lastScan.status === "ERROR" && (
                lastScan.message.includes("No workbook loaded") 
                  ? formatText('alerts.noWorkbook')
                  : lastScan.message.includes("Backend not connected")
                    ? formatText('alerts.backendNotConnected')
                    : formatText('alerts.error')
              )}
            </h4>
            <p>
              {lastScan.status === "ERROR" && (
                lastScan.message.includes("No workbook loaded") 
                  ? formatText('alerts.noWorkbook')
                  : lastScan.message.includes("Backend not connected")
                    ? formatText('alerts.backendNotConnected')
                    : lastScan.message
              )}
              {lastScan.status !== "ERROR" && lastScan.message}
            </p>
            {lastScan.student && (
              <p style={{ marginTop: "4px", fontSize: "0.82rem", color: "var(--slate-200)" }}>
                {formatText('alerts.studentInfo', { id: lastScan.student.id, name: lastScan.student.name, uid: lastScan.student.uid })}
              </p>
            )}
          </div>
        </section>
      )}

      {/* Excel Attendance Database Register Table */}
      {activeFilename && (
        <section className="data-table-wrapper">
          <div className="table-header-bar">
            <h3>{formatText('table.title')} — {activeFilename}</h3>
            <input
              type="text"
              className="form-input search-box"
              placeholder={formatText('table.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="table-scroll">
            <table className="register-table">
              <thead>
                <tr>
                  <th>{formatText('table.studentId')}</th>
                  <th>{formatText('table.fullName')}</th>
                  <th>{formatText('table.rfidUid')}</th>
                  <th>{formatText('table.weekStatus', { week: currentWeek })}</th>
                  <th>{formatText('table.firstScan')}</th>
                  <th>{formatText('table.secondScan')}</th>
                  <th>{formatText('table.totalPresent')}</th>
                  <th>{formatText('table.attendanceRatio')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.length === 0 ? (
                  <tr>
                    <td colSpan="8" style={{ textAlign: "center", padding: "2rem", color: "var(--slate-400)" }}>
                      {formatText('table.noRecords', { filename: activeFilename })}
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
                            {isPresent ? formatText('table.present') : formatText('table.absent')}
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
      )}
      
      {/* Toast Notification */}
      {toast && (
        <>
          <div className="toast-backdrop" onClick={toast.onCancel} />
          <div className={`toast toast--${toast.type}`}>
            <div className="toast-content">
              <p>{toast.message}</p>
              {toast.type === 'confirm' && (
                <div className="toast-actions">
                  <button 
                    className="toast-btn toast-btn--cancel"
                    onClick={toast.onCancel}
                  >
                    Cancel
                  </button>
                  <button 
                    className="toast-btn toast-btn--confirm"
                    onClick={toast.onConfirm}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default App;
