"use client";

import { useState, useEffect, useMemo, useRef } from "react";

/* ── Types ── */
export interface ExtractedRow {
  date: string;
  scheduledIn: string;
  scheduledOut: string;
  actualIn: string;
  actualOut: string;
  dayOff: boolean;
  absent: boolean;
}

export interface EmployeeSummary {
  employee: Employee;
  rows: (ExtractedRow & { lateMinutes: number | null, deduction: number, hoursWorked: number, hourlyRate: number })[];
  totalLateMinutes: number;
  totalDeduction: number;
  grossSalary: number;
  netSalary: number;
  hourlyRate: number;
}

export function parseTimeStr(timeStr: string): number | null {
  if (!timeStr) return null;
  const match = timeStr.toLowerCase().match(/^(\d+):(\d+)\s*(am|pm)$/);
  if (!match) return null;
  const [, hStr, mStr, period] = match;
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  
  if (h === 12) {
    h = period === "am" ? 0 : 12;
  } else if (period === "pm") {
    h += 12;
  }
  return h * 60 + m;
}

export function getShiftHours(scheduledInStr: string, scheduledOutStr: string): number {
  const inMinutes = parseTimeStr(scheduledInStr);
  const outMinutes = parseTimeStr(scheduledOutStr);
  if (inMinutes === null || outMinutes === null) return 8; // fallback
  
  let diff = outMinutes - inMinutes;
  if (diff < 0) {
    diff += 1440; // overnight
  }
  return diff / 60;
}

export function calcLateMinutes(scheduledInStr: string, actualInStr: string): null | number {
  if (!actualInStr) return null; // absent
  const sched = parseTimeStr(scheduledInStr);
  const actual = parseTimeStr(actualInStr);
  if (sched === null || actual === null) return null;
  const late = actual - sched;
  return Math.max(0, late);
}

export function calcDayDeduction(lateMinutes: number, hourlyRate: number): number {
  const ded = (lateMinutes / 60) * hourlyRate;
  return Math.round(ded * 100) / 100;
}

export function calcEmployeeSummary(employee: Employee, extractedRows: ExtractedRow[]) {
  const monthlySalary = employee.monthlySalary || 3000;
  
  const workingRows = extractedRows.filter(r => !r.dayOff && !r.absent);
  const shiftHoursList = workingRows.map(r => getShiftHours(r.scheduledIn, r.scheduledOut));
  const avgShiftHours = shiftHoursList.length > 0 
    ? shiftHoursList.reduce((a, b) => a + b, 0) / shiftHoursList.length 
    : 8;

  const hourlyRate = monthlySalary / 30 / avgShiftHours;

  let totalLateMinutes = 0;
  let totalDeduction = 0;

  const detailedRows = extractedRows.map(row => {
    if (row.dayOff || row.absent) {
      return { ...row, lateMinutes: null, deduction: 0, hoursWorked: 0, hourlyRate };
    }
    
    const lateMinutes = calcLateMinutes(row.scheduledIn, row.actualIn) ?? 0;
    const deduction = calcDayDeduction(lateMinutes, hourlyRate);
    const shiftHours = getShiftHours(row.scheduledIn, row.scheduledOut);
    const actualLength = Math.max(0, shiftHours - (lateMinutes / 60));

    totalLateMinutes += lateMinutes;
    totalDeduction += deduction;

    return { ...row, lateMinutes, deduction, hoursWorked: actualLength, hourlyRate };
  });

  return {
    employee,
    rows: detailedRows,
    totalLateMinutes,
    totalDeduction,
    grossSalary: monthlySalary,
    netSalary: monthlySalary - totalDeduction,
    hourlyRate
  };
}

interface Employee {
  name: string;
  employeeId: string;
  branch: string;
  department: string;
  dutyTime: string;
  offDay: string;
  email: string;
  monthlySalary?: number;
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

/**
 * An employee's OffDay field may list one or two days, separated by
 * "&", "and", or ",". Examples:
 *   "Tuesday"
 *   "Tuesday & Friday"
 *   "Tuesday and Friday"
 *   "Tuesday, Friday"
 */
function parseOffDays(employeeOffDay: string): string[] {
  return employeeOffDay
    .split(/\s*(?:&|,|\band\b)\s*/i)
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

function isOffDay(dayName: string, employeeOffDay: string): boolean {
  const target = dayName.trim().toLowerCase();
  return parseOffDays(employeeOffDay).includes(target);
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const jspdf: any;

/* ── Brand config ── */
type BrandId = "kayan" | "frybee";

interface Brand {
  id: BrandId;
  displayName: string;
  subtitle: string;
  letterheadPath: string;
  zipPrefix: string;
  salaryPrefix: string;
  footerLabel: string;
  // Vertical offsets (mm) inside the PDF, tuned per letterhead so the
  // subtitle + metadata block clear the top branding band.
  pdfSubtitleY: number;
  pdfMetaStartY: number;
}

const BRANDS: Record<BrandId, Brand> = {
  kayan: {
    id: "kayan",
    displayName: "Kayan Sweets",
    subtitle: "Kayan Sweets — Shift Schedule Generator",
    letterheadPath: "/kayan-letterhead.jpg",
    zipPrefix: "KayanSweets_Schedules",
    salaryPrefix: "KayanAlNazer_Salary",
    footerLabel: "ShiftGen · Internal HR Tool · Kayan Sweets",
    pdfSubtitleY: 40,
    pdfMetaStartY: 52,
  },
  frybee: {
    id: "frybee",
    displayName: "Frybee",
    subtitle: "Frybee — Shift Schedule Generator",
    letterheadPath: "/frybee-letterhead.jpg",
    zipPrefix: "Frybee_Schedules",
    salaryPrefix: "Frybee_Salary",
    footerLabel: "ShiftGen · Internal HR Tool · Frybee",
    pdfSubtitleY: 52,
    pdfMetaStartY: 64,
  },
};

/* ── Letterhead loader (cached once per generate run) ──
   JPEG (not PNG) is critical: jsPDF embeds JPEGs directly via DCTDecode,
   keeping PDFs small. PNG would be decoded to raw RGBA and re-encoded,
   making every PDF ~30 MB. */
async function loadLetterheadAsBase64(letterheadPath: string): Promise<string> {
  const res = await fetch(letterheadPath);
  if (!res.ok) throw new Error(`Letterhead fetch failed: ${res.status}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/* ── PDF generator (one PDF per employee) ──
   Layout: A4 portrait. Letterhead painted full-bleed as page background.
   Content lives in the white middle region — y ≈ 38mm to ≈ 268mm — which
   easily holds the metadata block + 31-row table on one page. */
function generatePDF(
  employee: Employee,
  dateRange: DateEntry[],
  monthName: string,
  year: number,
  letterheadBase64: string,
  brand: Brand
): string {
  const { jsPDF } = jspdf;
  // compress: true gives a small additional savings (~10%) on PDF text streams
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });

  // Full-bleed letterhead background. JPEG so jsPDF embeds the source bytes
  // directly without re-encoding — keeps PDF size near the JPEG file size.
  doc.addImage(letterheadBase64, "JPEG", 0, 0, 210, 297);

  // Subtitle (centered, just below the yellow top band)
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 30, 30);
  doc.text(
    `Employee Time Schedule — ${monthName} ${year}`,
    105,
    brand.pdfSubtitleY,
    { align: "center" }
  );

  // Two-column metadata block
  const metaLeftLabelX = 15;
  const metaLeftValueX = 42;
  const metaRightLabelX = 115;
  const metaRightValueX = 152;
  let metaY = brand.pdfMetaStartY;

  const drawMetaRow = (
    label1: string, value1: string,
    label2: string, value2: string
  ) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.text(label1, metaLeftLabelX, metaY);
    doc.text(label2, metaRightLabelX, metaY);
    doc.setFont("helvetica", "normal");
    doc.text(value1, metaLeftValueX, metaY);
    doc.text(value2, metaRightValueX, metaY);
    metaY += 6.5;
  };

  drawMetaRow("BRANCH:", employee.branch, "DEPARTMENT:", employee.department);
  drawMetaRow("NAME:", employee.name, "OFF DAY:", employee.offDay);
  drawMetaRow("ID NUMBER:", employee.employeeId, "DUTY TIME:", employee.dutyTime);

  // Schedule table
  const tableBody = dateRange.map((d) => {
    const off = isOffDay(d.dayName, employee.offDay);
    return off
      ? [d.formatted, "DAY OFF", "DAY OFF", "DAY OFF", "", ""]
      : [d.formatted, "", "", employee.dutyTime, "", ""];
  });

  doc.autoTable({
    startY: metaY + 4,
    head: [["DATE", "IN", "OUT", "DUTY TIME", "SIGNATURE", "REMARKS"]],
    body: tableBody,
    theme: "grid",
    headStyles: {
      fillColor: [44, 44, 42],
      textColor: 255,
      fontStyle: "bold",
      halign: "center",
      fontSize: 9,
      cellPadding: 1.6,
    },
    bodyStyles: {
      fontSize: 8,
      cellPadding: 1.2,
      halign: "center",
      valign: "middle",
      textColor: [30, 30, 30],
      lineColor: [180, 180, 180],
      lineWidth: 0.1,
    },
    columnStyles: {
      0: { cellWidth: 26 },
      1: { cellWidth: 22 },
      2: { cellWidth: 22 },
      3: { cellWidth: 36 },
      4: { cellWidth: 40 },
      5: { cellWidth: 34 },
    },
    margin: { left: 15, right: 15, bottom: 30 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didParseCell: (data: any) => {
      if (data.section !== "body") return;
      const rowIdx = data.row.index;
      if (rowIdx < dateRange.length && isOffDay(dateRange[rowIdx].dayName, employee.offDay)) {
        data.cell.styles.fillColor = [255, 255, 0];
        data.cell.styles.lineColor = [0, 0, 0];
        data.cell.styles.lineWidth = 0.18;
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  // Return base64 (no data-uri prefix) — JSZip wants raw base64
  return doc.output("datauristring").split(",")[1];
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

  /* ── Brand state ── */
  const [brandId, setBrandId] = useState<BrandId>("kayan");
  const brand = BRANDS[brandId];

  useEffect(() => {
    setAuthed(localStorage.getItem("shiftgen_auth") === "true");
    const savedBrand = localStorage.getItem("shiftgen_brand");
    if (savedBrand === "kayan" || savedBrand === "frybee") {
      setBrandId(savedBrand);
    }
    setAuthChecked(true);
  }, []);

  function handleBrandChange(next: BrandId) {
    setBrandId(next);
    localStorage.setItem("shiftgen_brand", next);
  }

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
  const [activeTab, setActiveTab] = useState<"generate" | "salary">("generate");
  const [salaryEmployeeId, setSalaryEmployeeId] = useState("");
  const [attendanceImage, setAttendanceImage] = useState<File | null>(null);
  const [attendancePreviewUrl, setAttendancePreviewUrl] = useState("");
  const [extractedRows, setExtractedRows] = useState<ExtractedRow[]>([]);
  const [currentResult, setCurrentResult] = useState<EmployeeSummary | null>(null);
  const [processedResults, setProcessedResults] = useState<EmployeeSummary[]>([]);
  const [readingImage, setReadingImage] = useState(false);
  const [salaryStatus, setSalaryStatus] = useState<{
    type: "idle" | "active" | "error" | "success";
    message: string;
  }>({ type: "idle", message: "Waiting for photo and employee selection..." });

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

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] || null;
    setAttendanceImage(selected);
    if (selected) {
      const url = URL.createObjectURL(selected);
      setAttendancePreviewUrl(url);
    } else {
      setAttendancePreviewUrl("");
    }
  }

  function handleRowEdit(index: number, field: "actualIn" | "actualOut", value: string) {
    const newRows = [...extractedRows];
    newRows[index] = { ...newRows[index], [field]: value.trim() };
    setExtractedRows(newRows);
    
    const selectedEmp = employees.find(e => e.employeeId === salaryEmployeeId);
    if (selectedEmp) {
      const result = calcEmployeeSummary(selectedEmp, newRows);
      setCurrentResult(result);
      setProcessedResults(prev => {
        const copy = [...prev];
        const existingIdx = copy.findIndex(r => r.employee.employeeId === result.employee.employeeId);
        if (existingIdx !== -1) copy[existingIdx] = result;
        else copy.push(result);
        return copy;
      });
    }
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function handleReadSheet() {
    if (!attendanceImage || !salaryEmployeeId) return;

    setReadingImage(true);
    setSalaryStatus({ type: "active", message: "Reading sheet with AI... This usually takes 10-20 seconds." });

    const selectedEmp = employees.find(e => e.employeeId === salaryEmployeeId);
    const dutyTimeStr = selectedEmp ? selectedEmp.dutyTime : "Unknown";

    try {
      const base64DataURL = await fileToBase64(attendanceImage);
      const OPENAI_API_KEY = process.env.NEXT_PUBLIC_OPENAI_API_KEY;

      const promptText = `This is a filled employee time schedule sheet for a retail company.
The sheet covers dates from the 21st of one month to the 20th of the next.
The shift is an evening/night shift. Times in the IN column are afternoon/evening 
(e.g. "5:30" means 5:30pm, "4:30" means 4:30pm). Times in the OUT column 
are late night or early morning (e.g. "1:30" means 1:30am, "12:30" means 12:30am).

IMPORTANT: The duty time row may change partway through the sheet 
(e.g. first half shows "5:00pm to 1:00am", second half shows "4:30pm to 12:30am").
Read the DUTY TIME column for each row to know the scheduled times for that day.
(Employee's default duty time is: ${dutyTimeStr})

Extract every date row. Return ONLY a valid JSON array, no explanation, 
no markdown backticks, nothing else.

Format for each row:
{
  "date": "21-08-25",
  "scheduledIn": "5:00pm",
  "scheduledOut": "1:00am",
  "actualIn": "5:30pm",
  "actualOut": "1:30am",
  "dayOff": false,
  "absent": false
}

Rules:
- Yellow highlighted rows = day off. Set dayOff: true, leave actualIn/actualOut as ""
- Rows with a dash "—" or completely blank IN/OUT = absent. Set absent: true, 
  leave actualIn/actualOut as ""
- For IN times: if the number is between 1 and 8, it is pm (afternoon start).
  If OUT time is between 12 and 2, it is am (past midnight).
- Read the scheduledIn/scheduledOut from the DUTY TIME column of that specific row
- Preserve exact times as written — do not round or correct them
- Include every date row you can see, in chronological order`;

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4o",
          max_tokens: 4096,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: {
                    url: base64DataURL,
                    detail: "high"
                  }
                },
                {
                  type: "text",
                  text: promptText
                }
              ]
            }
          ]
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error?.message || "OpenAI API Error");
      }

      const text = data.choices[0].message.content.trim();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        let cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
        const start = cleaned.indexOf('[');
        const end = cleaned.lastIndexOf(']');
        if (start !== -1 && end !== -1 && end > start) {
           cleaned = cleaned.substring(start, end + 1);
        }
        parsed = JSON.parse(cleaned);
      }

      const rows: ExtractedRow[] = parsed;
      
      const workingDays = rows.filter(r => !r.dayOff && !r.absent).length;
      const dayOffs = rows.filter(r => r.dayOff).length;
      const absents = rows.filter(r => r.absent).length;

      setExtractedRows(rows);
      
      const result = selectedEmp ? calcEmployeeSummary(selectedEmp, rows) : null;
      setCurrentResult(result);

      if (result) {
        setProcessedResults(prev => {
          const copy = [...prev];
          const existingIdx = copy.findIndex(r => r.employee.employeeId === result.employee.employeeId);
          if (existingIdx !== -1) copy[existingIdx] = result;
          else copy.push(result);
          return copy;
        });
      }

      setSalaryStatus({ 
        type: "success", 
        message: `Read ${rows.length} rows — ${workingDays} working days, ${dayOffs} day-offs, ${absents} absent` 
      });

    } catch (err) {
      console.error("AI Read Error:", err);
      setSalaryStatus({ 
        type: "error", 
        message: "Could not read the sheet clearly. Try a better-lit photo taken straight-on." 
      });
    } finally {
      setReadingImage(false);
    }
  }

  async function handleExportSalaryReport() {
    if (processedResults.length === 0) return;
    setSalaryStatus({ type: "active", message: "Building salary report Excel file..." });

    try {
      const wb = XLSX.utils.book_new();

      // Sheet 1: Summary
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const summaryAoA: any[][] = [];
      summaryAoA.push(["Summary Report", "", "", "", "", "", ""]);
      summaryAoA.push(["NAME", "BRANCH", "DEPARTMENT", "GROSS (SAR)", "DEDUCTIONS (SAR)", "NET SALARY (SAR)", "TOTAL LATE (min)"]);
      
      let grandDeductions = 0;
      for (const pr of processedResults) {
        summaryAoA.push([
          pr.employee.name,
          pr.employee.branch,
          pr.employee.department,
          pr.grossSalary,
          pr.totalDeduction,
          pr.netSalary,
          pr.totalLateMinutes
        ]);
        grandDeductions += pr.totalDeduction;
      }
      
      const totalRowIdx = summaryAoA.length;
      summaryAoA.push(["TOTALS", "", "", "", grandDeductions, "", ""]);

      const wsSummary = XLSX.utils.aoa_to_sheet(summaryAoA);
      wsSummary["!cols"] = [
        { wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }
      ];

      const STYLE_HEADER_DARK = {
        fill: { fgColor: { rgb: "2C2C2A" } },
        font: { bold: true, color: { rgb: "FFFFFF" } },
        alignment: { horizontal: "center", vertical: "center" },
      };

      for (let c = 0; c < 7; c++) {
        wsSummary[XLSX.utils.encode_cell({ r: 1, c })] = wsSummary[XLSX.utils.encode_cell({ r: 1, c })] || {t: 's', v: ''};
        wsSummary[XLSX.utils.encode_cell({ r: 1, c })].s = STYLE_HEADER_DARK;
      }
      
      wsSummary[XLSX.utils.encode_cell({ r: totalRowIdx, c: 0 })] = wsSummary[XLSX.utils.encode_cell({ r: totalRowIdx, c: 0 })] || {t:'s',v:''};
      wsSummary[XLSX.utils.encode_cell({ r: totalRowIdx, c: 0 })].s = { font: { bold: true } };
      wsSummary[XLSX.utils.encode_cell({ r: totalRowIdx, c: 4 })] = wsSummary[XLSX.utils.encode_cell({ r: totalRowIdx, c: 4 })] || {t:'n',v:''};
      wsSummary[XLSX.utils.encode_cell({ r: totalRowIdx, c: 4 })].s = { font: { bold: true } };

      XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

      // Sheet 2+: Individuals
      for (const pr of processedResults) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const empAoA: any[][] = [];
        empAoA.push(["Date", "Sched. IN", "Actual IN", "Actual OUT", "Late (min)", "Deduction (SAR)", "Status"]);
        
        for (const row of pr.rows) {
           let statusText = "On Time";
           if (row.dayOff) statusText = "Day Off";
           else if (row.absent) statusText = "Absent";
           else if (row.lateMinutes! > 0) statusText = `Late ${row.lateMinutes} min`;

           empAoA.push([
             row.date, row.scheduledIn, row.actualIn, row.actualOut, 
             row.lateMinutes ?? 0, row.deduction, statusText
           ]);
        }
        
        const wsEmp = XLSX.utils.aoa_to_sheet(empAoA);
        wsEmp["!cols"] = [
          { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 15 }
        ];

        for (let c = 0; c < 7; c++) {
           wsEmp[XLSX.utils.encode_cell({ r: 0, c })] = wsEmp[XLSX.utils.encode_cell({ r: 0, c })] || {t:'s',v:''};
           wsEmp[XLSX.utils.encode_cell({ r: 0, c })].s = { font: { bold: true } };
        }

        const STYLE_YELLOW = { fill: { fgColor: { rgb: "FFFF00" } } };
        const STYLE_RED = { fill: { fgColor: { rgb: "FFE4E4" } } };
        const STYLE_AMBER = { fill: { fgColor: { rgb: "FFF3CD" } } };

        for (let r = 1; r <= pr.rows.length; r++) {
           const rowObj = pr.rows[r - 1];
           let sObj = null;
           if (rowObj.dayOff) sObj = STYLE_YELLOW;
           else if (rowObj.absent) sObj = STYLE_RED;
           else if (rowObj.lateMinutes! > 0) sObj = STYLE_AMBER;

           if (sObj) {
              for (let c = 0; c < 7; c++) {
                 const cellRef = XLSX.utils.encode_cell({ r, c });
                 if (!wsEmp[cellRef]) wsEmp[cellRef] = {v:'', t:'s'};
                 wsEmp[cellRef].s = sObj;
              }
           }
        }
        
        const firstName = pr.employee.name.split(" ")[0].substring(0, 30);
        XLSX.utils.book_append_sheet(wb, wsEmp, firstName);
      }

      let monthYearStr = "Report";
      if (processedResults[0].rows.length > 0) {
        const dtPart = processedResults[0].rows[0].date.split("-"); 
        if (dtPart.length === 3) {
          const mNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
          const midx = parseInt(dtPart[1], 10) - 1;
          const yFull = dtPart[2].length === 2 ? "20" + dtPart[2] : dtPart[2];
          monthYearStr = `${mNames[midx]}${yFull}`;
        }
      }

      const fileName = `${brand.salaryPrefix}_${monthYearStr}.xlsx`;
      
      const zipBase64 = XLSX.write(wb, { bookType: "xlsx", type: "base64" });
      const a = document.createElement("a");
      a.href = "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + zipBase64;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setSalaryStatus({ type: "success", message: `Salary report downloaded — ${processedResults.length} employees included.` });

    } catch (error) {
      console.error(error);
      setSalaryStatus({ type: "error", message: "Failed to generate export file." });
    }
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
    setStatus({ type: "active", message: "Loading letterhead..." });

    // Load the brand letterhead once — reused as the background for every PDF
    let letterheadBase64: string;
    try {
      letterheadBase64 = await loadLetterheadAsBase64(brand.letterheadPath);
    } catch (err) {
      console.error("Failed to load letterhead:", err);
      setGenerating(false);
      setStatus({
        type: "error",
        message: `Could not load letterhead image. Make sure public${brand.letterheadPath} exists.`,
      });
      return;
    }

    setStatus({ type: "active", message: `Generating… 0 / ${employees.length}` });

    const zip = new JSZip();
    const failedList: string[] = [];
    let successCount = 0;

    for (let i = 0; i < employees.length; i++) {
      const emp = employees[i];
      try {
        const base64PDF = generatePDF(emp, dateRange, scheduleMonth, scheduleYear, letterheadBase64, brand);
        const filename = emp.name.replace(/\s+/g, "_") + "_" + scheduleMonth + scheduleYear + ".pdf";

        // Tell JSZip to decode the base64 string
        zip.file(filename, base64PDF, { base64: true });
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
      a.download = `${brand.zipPrefix}_${scheduleMonth}${scheduleYear}.zip`;
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
      "Khalid Al Otaibi,1097990592,SHAWQIA,MANAGER,9:00am to 6:00pm,Friday & Saturday,khalid@example.com",
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
            <p className="subtitle">{brand.subtitle}</p>
          </div>

          {/* ── Brand Switcher ── */}
          <div className="brandSwitcher" role="tablist" aria-label="Brand">
            {(Object.values(BRANDS)).map((b) => (
              <button
                key={b.id}
                type="button"
                role="tab"
                aria-selected={brandId === b.id}
                className={`brandPill ${brandId === b.id ? "active" : ""}`}
                onClick={() => handleBrandChange(b.id)}
              >
                {b.displayName}
              </button>
            ))}
          </div>

          {/* ── Tabs ── */}
          <div className="tabsContainer">
            <button
              className={`tabButton ${activeTab === "generate" ? "active" : ""}`}
              onClick={() => setActiveTab("generate")}
            >
              Generate Schedules
            </button>
            <button
              className={`tabButton ${activeTab === "salary" ? "active" : ""}`}
              onClick={() => setActiveTab("salary")}
            >
              Salary Calculator
            </button>
          </div>

          {/* ── Tab Content: Generate Schedules ── */}
          {activeTab === "generate" && (
            <div className="tabContent">
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
          )}

          {/* ── Tab Content: Salary Calculator ── */}
          {activeTab === "salary" && (
            <div className="tabContent">
              <div className="sectionHeader">
                <h2 className="sectionTitle">Salary Calculator</h2>
                <p className="sectionSubtitle">
                  Upload a filled attendance sheet photo to extract times and calculate salary
                </p>
              </div>

              {/* ── Processed Employees Map ── */}
              {processedResults.length > 0 && (
                <div className="processedListWrapper">
                  <h3 className="sectionSubtitle" style={{ marginBottom: "0.5rem", color: "#f5f5f5" }}>Processed Employees</h3>
                  {processedResults.map((pr, i) => (
                    <div 
                      key={i} 
                      className={`processedListItem ${currentResult?.employee.employeeId === pr.employee.employeeId ? "active" : ""}`}
                      onClick={() => {
                        setSalaryEmployeeId(pr.employee.employeeId);
                        setExtractedRows(pr.rows);
                        setCurrentResult(pr);
                        setAttendanceImage(null);
                        setAttendancePreviewUrl("");
                        setSalaryStatus({ type: "idle", message: "Viewing cached results." });
                      }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="checkIcon">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                      <span className="processedName">{pr.employee.name}</span>
                      <span className="processedNet">— Net: SAR {pr.netSalary.toFixed(2)}</span>
                    </div>
                  ))}
                  
                  <button 
                     className="processAnotherBtn mt-2" 
                     onClick={() => {
                        setSalaryEmployeeId("");
                        setExtractedRows([]);
                        setCurrentResult(null);
                        setAttendanceImage(null);
                        setAttendancePreviewUrl("");
                        setSalaryStatus({ type: "idle", message: "Ready for next employee." });
                     }}
                  >
                    Process Another Employee
                  </button>
                </div>
              )}

              {/* ── Employee Selector ── */}
              <div className="formGroup">
                <label className="label" htmlFor="employee-select">Select Employee</label>
                {employees.length === 0 ? (
                  <div className="noticeBanner">
                    Load your employee CSV in the Generate tab first
                  </div>
                ) : (
                  <select
                    id="employee-select"
                    className="selectInput"
                    value={salaryEmployeeId}
                    onChange={(e) => setSalaryEmployeeId(e.target.value)}
                  >
                    <option value="">-- Select Employee --</option>
                    {employees.map((emp, i) => (
                      <option key={i} value={emp.employeeId}>
                        {emp.name} ({emp.branch})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* ── Image Upload ── */}
              <div className="formGroup">
                <label className="label" htmlFor="photo-upload">Upload Filled Attendance Sheet Photo</label>
                <div className="fileInputWrapper">
                  <input
                    id="photo-upload"
                    type="file"
                    accept="image/jpeg, image/png, image/webp"
                    onChange={handleImageChange}
                  />
                  <div className="fileInputIcon">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                    </svg>
                  </div>
                  <p className="fileInputText">
                    {attendanceImage ? (
                      <><strong>{attendanceImage.name}</strong> selected</>
                    ) : (
                      <><strong>Click to upload</strong> or drag &amp; drop</>
                    )}
                  </p>
                  <p className="fileInputHint">.jpg, .png, .webp only</p>
                </div>
                {attendancePreviewUrl && (
                  <div className="imagePreview">
                    <img src={attendancePreviewUrl} alt="Preview" />
                  </div>
                )}
              </div>

              {/* ── Results Container ── */}
              {currentResult && (
                <>
                  <div className="tableWrapper mt-4" style={{ marginTop: '1.5rem', marginBottom: '1.5rem' }}>
                    <table className="previewTable extractedTable">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Sched. IN</th>
                          <th>Actual IN</th>
                          <th>Actual OUT</th>
                          <th>Late (min)</th>
                          <th>Deduction (SAR)</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentResult.rows.map((row: any, idx: number) => {
                          let rowClass = "row-ontime";
                          let statusText = "On Time";
                          
                          if (row.dayOff) {
                            rowClass = "row-dayoff";
                            statusText = "Day Off";
                          } else if (row.absent) {
                            rowClass = "row-absent";
                            statusText = "Absent";
                          } else if (row.lateMinutes > 0) {
                            rowClass = "row-late";
                            statusText = `Late ${row.lateMinutes} min`;
                          }
                          
                          return (
                            <tr key={idx} className={rowClass}>
                              <td>{row.date}</td>
                              <td>{row.scheduledIn}</td>
                              <td>
                                <div
                                  contentEditable={!row.dayOff && !row.absent}
                                  suppressContentEditableWarning={true}
                                  onBlur={(e) => handleRowEdit(idx, "actualIn", e.currentTarget.textContent || "")}
                                  className={!row.dayOff && !row.absent ? "editableCell" : ""}
                                >
                                  {row.actualIn}
                                </div>
                              </td>
                              <td>
                                <div
                                  contentEditable={!row.dayOff && !row.absent}
                                  suppressContentEditableWarning={true}
                                  onBlur={(e) => handleRowEdit(idx, "actualOut", e.currentTarget.textContent || "")}
                                  className={!row.dayOff && !row.absent ? "editableCell" : ""}
                                >
                                  {row.actualOut}
                                </div>
                              </td>
                              <td>{row.lateMinutes ?? 0}</td>
                              <td>{row.deduction.toFixed(2)}</td>
                              <td className="status-cell">{statusText}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="salarySummaryBox">
                    <div className="summaryItem">
                      <span className="summaryLabel">Gross</span>
                      <span className="summaryValue">SAR {currentResult.grossSalary.toFixed(2)}</span>
                    </div>
                    <div className="summaryDivider" />
                    <div className="summaryItem">
                      <span className="summaryLabel">Deductions</span>
                      <span className="summaryValue deduction">SAR {currentResult.totalDeduction.toFixed(2)}</span>
                    </div>
                    <div className="summaryDivider" />
                    <div className="summaryItem">
                      <span className="summaryLabel">Net</span>
                      <span className="summaryValue net">SAR {currentResult.netSalary.toFixed(2)}</span>
                    </div>
                  </div>
                  
                  {(() => {
                     const avgShiftHours = currentResult.grossSalary / 30 / currentResult.hourlyRate;
                     return (
                        <p className="hourlyRateNote">
                          Hourly rate used: SAR {currentResult.hourlyRate.toFixed(2)} 
                          (Salary ÷ 30 days ÷ {Math.round(avgShiftHours * 10) / 10} shift hours)
                        </p>
                     );
                  })()}
                </>
              )}

              {/* ── Actions ── */}
              <button
                className={`generateBtn ${readingImage ? "generating" : ""}`}
                disabled={!salaryEmployeeId || !attendanceImage || readingImage}
                onClick={handleReadSheet}
              >
                {readingImage ? (
                  <>
                    <span className="spinner" />
                    Reading...
                  </>
                ) : (
                  "Read Sheet with AI"
                )}
              </button>
              <button
                className="generateBtn"
                disabled={processedResults.length === 0}
                onClick={handleExportSalaryReport}
                style={{ marginTop: "0.5rem" }}
              >
                Export Salary Report
              </button>
              
              <div className="statusArea" style={{ marginTop: "1rem" }}>
                <span className={`statusDot ${salaryStatus.type === "idle" ? "" : salaryStatus.type}`} />
                <span className="statusText">{salaryStatus.message}</span>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="footer">
        <span>{brand.footerLabel}</span>
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
