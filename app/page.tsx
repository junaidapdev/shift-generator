"use client";

import { useState, useEffect, useMemo, useRef } from "react";

/* ── Types ── */
interface Employee {
  name: string;
  employeeId: string;
  branch: string;
  department: string;
  dutyTime: string;
  offDay: string;
  email: string;
}

interface ParseResult {
  employees: Employee[];
  skippedRows: number;
  missingColumns: string[];
}

/* ── Required headers (lowercase for matching) ── */
const REQUIRED_HEADERS = [
  "name",
  "employeeid",
  "branch",
  "department",
  "dutytime",
  "offday",
  "email",
] as const;

const HEADER_DISPLAY: Record<string, string> = {
  name: "Name",
  employeeid: "EmployeeID",
  branch: "Branch",
  department: "Department",
  dutytime: "DutyTime",
  offday: "OffDay",
  email: "Email",
};

/* ── CSV parser ── */
function parseCSV(text: string): ParseResult {
  // 1. Strip UTF-8 BOM if present
  const cleanText = text.replace(/^\uFEFF/, "");

  // 2. Split by any valid newline (CRLF, LF, or CR)
  const lines = cleanText
    .split(/\r\n|\n|\r/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { employees: [], skippedRows: 0, missingColumns: Object.values(HEADER_DISPLAY) };
  }

  // 3. Auto-detect delimiter based on the header row
  const firstLine = lines[0];
  const delimiters = [",", ";", "\t"];
  let delimiter = ",";
  let maxCols = 0;

  for (const d of delimiters) {
    const cols = firstLine.split(d).length;
    if (cols > maxCols) {
      maxCols = cols;
      delimiter = d;
    }
  }

  // Parse header row
  const rawHeaders = firstLine.split(delimiter).map((h) => h.trim());
  const lowerHeaders = rawHeaders.map((h) => h.toLowerCase().replace(/[\s_-]/g, ""));

  const missingColumns: string[] = [];
  const headerIndex: Record<string, number> = {};

  for (const req of REQUIRED_HEADERS) {
    const idx = lowerHeaders.indexOf(req);
    if (idx === -1) {
      missingColumns.push(HEADER_DISPLAY[req]);
    } else {
      headerIndex[req] = idx;
    }
  }

  if (missingColumns.length > 0) {
    return { employees: [], skippedRows: 0, missingColumns };
  }

  const employees: Employee[] = [];
  let skippedRows = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delimiter).map((c) => c.trim());
    const name = cols[headerIndex["name"]] || "";
    const employeeId = cols[headerIndex["employeeid"]] || "";
    const branch = cols[headerIndex["branch"]] || "";
    const department = cols[headerIndex["department"]] || "";
    const dutyTime = cols[headerIndex["dutytime"]] || "";
    const offDay = cols[headerIndex["offday"]] || "";
    const email = cols[headerIndex["email"]] || "";

    if (!name || !employeeId || !branch || !department || !dutyTime || !offDay || !email) {
      skippedRows++;
      continue;
    }
    employees.push({ name, employeeId, branch, department, dutyTime, offDay, email });
  }

  return { employees, skippedRows, missingColumns: [] };
}

/* ── Date range types & helpers ── */
interface DateEntry {
  dateObj: Date;
  formatted: string;
  dayName: string;
  isOffDay: boolean;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

function getDateRange(startDateStr: string): DateEntry[] {
  const [y, m, d] = startDateStr.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(y, m, 20);
  const entries: DateEntry[] = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    const dd = String(cursor.getDate()).padStart(2, "0");
    const mm = String(cursor.getMonth() + 1).padStart(2, "0");
    const yyyy = cursor.getFullYear();
    entries.push({
      dateObj: new Date(cursor),
      formatted: `${dd}/${mm}/${yyyy}`,
      dayName: DAY_NAMES[cursor.getDay()],
      isOffDay: false,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return entries;
}

function isOffDay(dayName: string, employeeOffDay: string): boolean {
  return dayName.toLowerCase() === employeeOffDay.toLowerCase();
}

/* ── Nearest upcoming 21st ── */
function getNearest21st(): string {
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth(); // 0-indexed
  // If today is past the 21st, go to next month
  if (now.getDate() > 21) {
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  const mm = String(m + 1).padStart(2, "0");
  return `${y}-${mm}-21`;
}

/* ── Declare globals from CDN ── */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const XLSX: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const JSZip: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const saveAs: any;

/* ── Excel styles ── */
const STYLE_YELLOW_BOLD = {
  fill: { fgColor: { rgb: "FFFF00" } },
  font: { bold: true },
};
const STYLE_YELLOW_BOLD_CENTER = {
  fill: { fgColor: { rgb: "FFFF00" } },
  font: { bold: true, sz: 14 },
  alignment: { horizontal: "center", vertical: "center" },
};
const STYLE_HEADER = {
  fill: { fgColor: { rgb: "2C2C2A" } },
  font: { bold: true, color: { rgb: "FFFFFF" } },
  alignment: { horizontal: "center", vertical: "center" },
};
const STYLE_OFFDAY = {
  fill: { fgColor: { rgb: "FFFF00" } },
  font: { bold: false },
};

function generateExcel(
  employee: Employee,
  dateRange: DateEntry[],
  monthName: string,
  year: number
) {
  const aoa: (string | number)[][] = [];
  aoa.push(["KAYAN SWEETS TIME SCHEDULE", "", "", "", "", ""]);
  aoa.push(["BRANCH", employee.branch, "", "", monthName.toUpperCase(), year]);
  aoa.push(["NAME:", employee.name, "", "", "DEPARTMENT", ""]);
  aoa.push(["ID NUMBER", employee.employeeId, "", "", employee.department, ""]);
  aoa.push(["DATE", "IN", "OUT", "DUTY TIME", "SIGNATURE", "REMARKS"]);

  for (const d of dateRange) {
    const off = isOffDay(d.dayName, employee.offDay);
    if (off) {
      aoa.push([d.formatted, "DAY OFF", "DAY OFF", "DAY OFF", "", ""]);
    } else {
      aoa.push([d.formatted, "", "", employee.dutyTime, "", ""]);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
  ws["!cols"] = [
    { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 15 }, { wch: 15 },
  ];

  const totalRows = aoa.length;
  for (let r = 0; r < totalRows; r++) {
    for (let c = 0; c < 6; c++) {
      const cellRef = XLSX.utils.encode_cell({ r, c });
      if (!ws[cellRef]) ws[cellRef] = { v: "", t: "s" };

      if (r === 0) ws[cellRef].s = STYLE_YELLOW_BOLD_CENTER;
      else if (r <= 3) ws[cellRef].s = STYLE_YELLOW_BOLD;
      else if (r === 4) ws[cellRef].s = STYLE_HEADER;
      else {
        const dateIdx = r - 5;
        if (isOffDay(dateRange[dateIdx].dayName, employee.offDay)) {
          ws[cellRef].s = STYLE_OFFDAY;
        }
      }
    }
  }

  const wb = XLSX.utils.book_new();
  const safeMonth = monthName.charAt(0) + monthName.slice(1).toLowerCase();
  XLSX.utils.book_append_sheet(wb, ws, `${safeMonth} ${year}`);
  return wb;
}

/* ═══════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════ */

// CHANGE THIS PASSWORD
const AUTH_PASSWORD = "kayan2025";

export default function Home() {
  /* ── Auth state ── */
  const [authed, setAuthed] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState(false);
  const [authShake, setAuthShake] = useState(false);

  useEffect(() => {
    setAuthed(localStorage.getItem("shiftgen_auth") === "true");
    setAuthChecked(true);
  }, []);

  function handleLogin() {
    if (password === AUTH_PASSWORD) {
      localStorage.setItem("shiftgen_auth", "true");
      setAuthed(true);
      setAuthError(false);
    } else {
      setAuthError(true);
      setAuthShake(true);
      setTimeout(() => setAuthShake(false), 500);
    }
  }

  function handleLock() {
    localStorage.removeItem("shiftgen_auth");
    window.location.reload();
  }

  /* ── App state ── */
  const [file, setFile] = useState<File | null>(null);
  const [startDate, setStartDate] = useState(getNearest21st());
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [parseError, setParseError] = useState("");
  const [skippedWarning, setSkippedWarning] = useState("");
  const [csvValid, setCsvValid] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState<{
    type: "idle" | "active" | "error" | "success";
    message: string;
  }>({ type: "idle", message: "Ready. Upload a file and pick a start date." });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const isFormValid = csvValid && startDate !== "" && !generating;

  /* ── Summary bar data ── */
  const summaryInfo = useMemo(() => {
    if (employees.length === 0) return null;
    const branches = new Set(employees.map((e) => e.branch));
    let dateRangeStr = "";
    if (startDate) {
      const [, , dayStr] = startDate.split("-");
      if (parseInt(dayStr, 10) === 21) {
        const dr = getDateRange(startDate);
        dateRangeStr = `Schedule: ${dr[0].formatted} → ${dr[dr.length - 1].formatted}`;
      }
    }
    return {
      branches: branches.size,
      employees: employees.length,
      dateRange: dateRangeStr,
    };
  }, [employees, startDate]);

  /* ── Handlers ── */
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    setParseError("");
    setSkippedWarning("");
    setEmployees([]);
    setCsvValid(false);

    if (!selected) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const result = parseCSV(text);

      if (result.missingColumns.length > 0) {
        setParseError(`Missing columns: ${result.missingColumns.join(", ")}`);
        setCsvValid(false);
        setStatus({ type: "error", message: "CSV is missing required columns." });
        return;
      }

      if (result.employees.length === 0) {
        setParseError("No valid employee rows found in the CSV.");
        setCsvValid(false);
        setStatus({ type: "error", message: "No valid data rows found." });
        return;
      }

      if (result.skippedRows > 0) {
        setSkippedWarning(
          `${result.skippedRows} row${result.skippedRows > 1 ? "s" : ""} skipped — missing data`
        );
      }

      setEmployees(result.employees);
      setCsvValid(true);
      setStatus({
        type: "success",
        message: `${result.employees.length} employee${result.employees.length > 1 ? "s" : ""} loaded successfully.`,
      });
    };
    reader.onerror = () => {
      setParseError("Failed to read the file.");
      setStatus({ type: "error", message: "File read error." });
    };
    reader.readAsText(selected);
  }

  function handleReset() {
    setFile(null);
    setEmployees([]);
    setParseError("");
    setSkippedWarning("");
    setCsvValid(false);
    setStatus({ type: "idle", message: "Ready. Upload a file and pick a start date." });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleGenerate() {
    const [, , dayStr] = startDate.split("-");
    if (parseInt(dayStr, 10) !== 21) {
      setStatus({ type: "error", message: "Start date must be the 21st of a month" });
      return;
    }

    const dateRange = getDateRange(startDate);
    const startObj = new Date(startDate);
    const scheduleMonth = MONTH_NAMES[startObj.getMonth()];
    const scheduleYear = startObj.getFullYear();

    setGenerating(true);
    setStatus({ type: "active", message: `Generating… 0 / ${employees.length}` });

    const zip = new JSZip();
    const failedList: string[] = [];
    let successCount = 0;

    for (let i = 0; i < employees.length; i++) {
      const emp = employees[i];
      try {
        const wb = generateExcel(emp, dateRange, scheduleMonth, scheduleYear);
        // FIX: Export strictly as base64 to avoid binary array corruption in JSZip
        const base64Excel = XLSX.write(wb, { bookType: "xlsx", type: "base64" });
        const filename = emp.name.replace(/\s+/g, "_") + "_" + scheduleMonth + scheduleYear + ".xlsx";
        
        // Tell JSZip to decode the base64 string
        zip.file(filename, base64Excel, { base64: true });
        successCount++;
      } catch (err) {
        console.error(`Failed to generate for ${emp.name}:`, err);
        failedList.push(emp.name);
      }

      setStatus({ type: "active", message: `Generating… ${i + 1} / ${employees.length}` });
      await new Promise((r) => setTimeout(r, 0));
    }

    try {
      // FIX: Generate the ZIP as base64 and use a Data URI to force the browser 
      // to download it with the exact .zip filename we specify.
      const zipBase64 = await zip.generateAsync({ type: "base64" });
      const a = document.createElement("a");
      a.href = "data:application/zip;base64," + zipBase64;
      a.download = `KayanSweets_Schedules_${scheduleMonth}${scheduleYear}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error("Failed to create zip:", err);
      setGenerating(false);
      setStatus({ type: "error", message: "Failed to create zip file." });
      return;
    }

    setGenerating(false);

    if (failedList.length > 0) {
      setStatus({
        type: "error",
        message: `${successCount} generated. ${failedList.length} failed: ${failedList.join(", ")}`,
      });
    } else {
      setStatus({
        type: "success",
        message: `Done! ${successCount} schedules generated and downloaded.`,
      });
    }
  }

  function handleDownloadSample() {
    const sampleCSV = [
      "Name,EmployeeID,Branch,Department,DutyTime,OffDay,Email",
      "Ahmed Al Ghamdi,1097990590,SHAWQIA,FRONT OFFICE,4:30pm to 12:30am,Tuesday,ahmed@example.com",
      "Sara Al Zahrani,1097990591,MALAZ,CASHIER,9:00am to 6:00pm,Friday,sara@example.com",
    ].join("\n");

    const blob = new Blob([sampleCSV], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "sample_employees.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  /* ── Render ── */

  // Don't render anything until auth check is done (avoid SSR mismatch)
  if (!authChecked) return null;

  // ── Auth Gate ──
  if (!authed) {
    return (
      <div className="authOverlay">
        <div className="authCard">
          <div className="authLogo">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
          </div>
          <h1 className="authTitle">ShiftGen</h1>
          <p className="authSubtitle">Kayan Sweets — Internal Access</p>

          <div className={`authInputWrap ${authShake ? "shake" : ""}`}>
            <input
              id="auth-password"
              type="password"
              className={`authInput ${authError ? "authInputError" : ""}`}
              placeholder="Enter password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setAuthError(false); }}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            />
          </div>
          {authError && <p className="authErrorText">Incorrect password</p>}
          <button className="authBtn" onClick={handleLogin}>Login</button>
        </div>
      </div>
    );
  }

  // ── Main App ──
  return (
    <div className="appWrap">
      <main className="page">
        <div className="card">
          {/* ── Header ── */}
          <div className="header">
            <div className="logo">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5m-9-6h.008v.008H12v-.008ZM12 15h.008v.008H12V15Zm0 2.25h.008v.008H12v-.008ZM9.75 15h.008v.008H9.75V15Zm0 2.25h.008v.008H9.75v-.008ZM7.5 15h.008v.008H7.5V15Zm0 2.25h.008v.008H7.5v-.008Zm6.75-4.5h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V15Zm0 2.25h.008v.008h-.008v-.008Zm2.25-4.5h.008v.008H16.5v-.008Zm0 2.25h.008v.008H16.5V15Z" />
              </svg>
            </div>
            <h1 className="title">ShiftGen</h1>
            <p className="subtitle">Kayan Sweets — Shift Schedule Generator</p>
          </div>

          {/* ── File Upload ── */}
          <div className="formGroup">
            <label className="label" htmlFor="csv-upload">Upload Employee List (.csv)</label>
            <div className="fileInputWrapper">
              <input
                ref={fileInputRef}
                id="csv-upload"
                type="file"
                accept=".csv"
                onChange={handleFileChange}
              />
              <div className="fileInputIcon">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                </svg>
              </div>
              <p className="fileInputText">
                {file ? (<><strong>{file.name}</strong> selected</>) : (<><strong>Click to upload</strong>{" "}or drag &amp; drop</>)}
              </p>
              <p className="fileInputHint">.csv files only</p>
            </div>

            <div className="uploadActions">
              <button type="button" className="sampleLink" onClick={handleDownloadSample}>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Download Sample CSV
              </button>
              {csvValid && (
                <button type="button" className="resetLink" onClick={handleReset}>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
                  </svg>
                  Clear &amp; Reset
                </button>
              )}
            </div>
          </div>

          {/* ── Parse Error ── */}
          {parseError && (
            <div className="errorBanner">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
              {parseError}
            </div>
          )}

          {/* ── Skipped rows warning ── */}
          {skippedWarning && (
            <div className="warningBanner">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
              </svg>
              {skippedWarning}
            </div>
          )}

          {/* ── Employee Preview Table ── */}
          {employees.length > 0 && (
            <div className="previewSection">
              <div className="previewHeader">
                <span className="previewTitle">Employee Preview</span>
                <span className="badge">{employees.length} employees loaded</span>
              </div>
              <div className="tableWrapper">
                <table className="previewTable">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Branch</th>
                      <th>Department</th>
                      <th>Duty Time</th>
                      <th>Off Day</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((emp, i) => (
                      <tr key={i}>
                        <td>{emp.name}</td>
                        <td>{emp.branch}</td>
                        <td>{emp.department}</td>
                        <td>{emp.dutyTime}</td>
                        <td>{emp.offDay}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Summary Bar ── */}
          {summaryInfo && (
            <div className="summaryBar">
              <span>{summaryInfo.branches} branch{summaryInfo.branches !== 1 ? "es" : ""}</span>
              <span className="summaryDot">·</span>
              <span>{summaryInfo.employees} employees</span>
              {summaryInfo.dateRange && (
                <>
                  <span className="summaryDot">·</span>
                  <span>{summaryInfo.dateRange}</span>
                </>
              )}
            </div>
          )}

          {/* ── Date Input ── */}
          <div className="formGroup">
            <label className="label" htmlFor="start-date">Schedule Start Date</label>
            <input
              id="start-date"
              type="date"
              className="dateInput"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <span className="note">Must be the 21st of a month</span>
          </div>

          {/* ── Generate Button ── */}
          <button
            id="generate-btn"
            className={`generateBtn ${generating ? "generating" : ""}`}
            disabled={!isFormValid}
            onClick={handleGenerate}
          >
            {generating ? (
              <>
                <span className="spinner" />
                Generating...
              </>
            ) : (
              "Generate Schedules"
            )}
          </button>

          {/* ── Status Area ── */}
          <div className="statusArea">
            <span className={`statusDot ${status.type === "idle" ? "" : status.type}`} />
            <span className="statusText">{status.message}</span>
          </div>
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="footer">
        <span>ShiftGen · Internal HR Tool · Kayan Sweets</span>
        <button className="lockLink" onClick={handleLock} title="Lock &amp; sign out">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
          </svg>
          Lock
        </button>
      </footer>
    </div>
  );
}
