/**
 * =========================================================================
 * 📥 EDUCORE PRO v2.2+ — Bulk Student Import (CSV)
 * =========================================================================
 * Import students in bulk from a CSV file (schools export Excel -> CSV via
 * "Save As"). Fully offline — no CDN/SheetJS dependency.
 *
 * FLOW: choose .csv file -> parse -> auto-map columns to student fields ->
 * preview first 5 rows -> duplicate check (same name + class skipped) ->
 * import -> result summary.
 *
 * The parser implements the CSV essentials (RFC 4180 subset): quoted
 * fields, embedded commas/newlines, doubled quotes (""), CRLF/LF.
 * =========================================================================
 */

import { db, STORES } from "./db.js";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function newId(prefix) {
  return (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ------------------------------------------------------------------ */
/* Minimal CSV parser (offline, no dependencies)                         */
/* ------------------------------------------------------------------ */

/**
 * Parse CSV text into an array of rows (each row = array of cell strings).
 * Handles: "quoted, fields", ""escaped quotes"", embedded newlines, CRLF/LF.
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const src = String(text || "").replace(/^\uFEFF/, ""); // strip BOM

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } // "" -> "
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\r") {
      // ignore; \n handles the break
    } else if (c === "\n") {
      row.push(field); field = "";
      // skip completely empty trailing rows
      if (!(row.length === 1 && row[0] === "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  // last line without trailing newline
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* Column mapping                                                        */
/* ------------------------------------------------------------------ */

/** Student fields the importer can fill. */
export const STUDENT_FIELDS = [
  { id: "name", label: "Student Name", required: true },
  { id: "className", label: "Class", required: true },
  { id: "rollNo", label: "Roll No" },
  { id: "gender", label: "Gender" },
  { id: "phone", label: "Student Phone" },
  { id: "parentName", label: "Parent Name" },
  { id: "parentPhone", label: "Parent Phone" },
  { id: "address", label: "Address" },
  { id: "admissionNo", label: "Admission No" },
  { id: "dob", label: "Date of Birth" },
  { id: "ignore", label: "— Ignore column —" }
];

const HEADER_HINTS = [
  [/^(student\s*)?name$/i, "name"],
  [/^class/i, "className"],
  [/^roll/i, "rollNo"],
  [/^gender|^sex$/i, "gender"],
  [/^student.*(phone|mobile)|^phone$/i, "phone"],
  [/^parent.*name|^father.*name|^guardian/i, "parentName"],
  [/^parent.*(phone|mobile)|^father.*(phone|mobile)|^contact/i, "parentPhone"],
  [/^address/i, "address"],
  [/^admission/i, "admissionNo"],
  [/^(dob|date.*birth|birth.*date)$/i, "dob"]
];

/**
 * Suggest a student-field mapping for each CSV header.
 * @param {string[]} headers
 * @returns {string[]} field id per column ("ignore" when no hint matches)
 */
export function mapColumns(headers) {
  const used = new Set();
  return (headers || []).map(h => {
    const clean = String(h || "").trim();
    for (const [re, field] of HEADER_HINTS) {
      if (re.test(clean) && !used.has(field)) { used.add(field); return field; }
    }
    return "ignore";
  });
}

/* ------------------------------------------------------------------ */
/* Row -> student record                                                 */
/* ------------------------------------------------------------------ */

/**
 * Build a student record from a mapped CSV row.
 * @param {string[]} rowCells
 * @param {string[]} mapping  field id per column index
 * @returns {object|null} student record or null when required fields missing
 */
export function buildStudentFromRow(rowCells, mapping) {
  const obj = {};
  (mapping || []).forEach((field, i) => {
    if (field && field !== "ignore") obj[field] = String(rowCells[i] ?? "").trim();
  });
  if (!obj.name || !obj.className) return null;
  const year = new Date().getFullYear();
  return {
    id: newId("stu"),
    admissionNo: obj.admissionNo || `ADM-${year}-${Math.floor(100 + Math.random() * 900)}`,
    name: obj.name,
    className: obj.className,
    classId: "cls_imported",
    rollNo: obj.rollNo || "",
    gender: obj.gender || "",
    phone: obj.phone || "",
    parentName: obj.parentName || "",
    parentPhone: obj.parentPhone || "",
    address: obj.address || "",
    dob: obj.dob || "",
    status: "Active",
    joinedDate: new Date().toISOString().split("T")[0],
    photoUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(obj.name)}`
  };
}

/** Duplicate = same name + same class (case-insensitive) already exists. */
export function isDuplicate(student, existing) {
  const n = String(student.name || "").trim().toLowerCase();
  const c = String(student.className || "").trim().toLowerCase();
  return (existing || []).some(s =>
    String(s.name || "").trim().toLowerCase() === n &&
    String(s.className || "").trim().toLowerCase() === c);
}

/* ------------------------------------------------------------------ */
/* View                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Render the bulk-import view (file picker + mapping + preview + import).
 * @param {object} app app instance
 * @returns {string} HTML (static — parsing happens in bindImportEvents)
 */
export function renderImportView(app) {
  return `
    <div class="page-header">
      <div class="page-title-group">
        <h1>Bulk Student Import</h1>
        <p>Excel se <strong>Save As → CSV</strong> karke file yahan upload karein. Pehli row me column headings honi chahiye.</p>
      </div>
    </div>

    <div class="card">
      <div class="form-group">
        <label class="form-label">CSV File</label>
        <input type="file" class="form-control" id="csvFileInput" accept=".csv,text/csv">
      </div>
      <div id="csvStatus" style="font-size:13px; color:var(--text-dim);"></div>
    </div>

    <div id="csvMappingWrap" style="display:none;">
      <div class="card">
        <h3 style="margin-top:0;"><i class="fa-solid fa-columns"></i> Column Mapping</h3>
        <p style="font-size:13px; color:var(--text-dim);">Har CSV column ko student field se milayein. Zaroori: <strong>Student Name</strong> aur <strong>Class</strong>.</p>
        <div id="csvMappingGrid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:10px;"></div>
      </div>

      <div class="card">
        <h3 style="margin-top:0;"><i class="fa-solid fa-eye"></i> Preview (first 5 rows)</h3>
        <div class="table-container"><table class="custom-table" id="csvPreviewTable"></table></div>
      </div>

      <div class="card" style="border-left:4px solid #10b981;">
        <div style="display:flex; gap:16px; align-items:center; flex-wrap:wrap;">
          <div><strong id="csvCountNew">0</strong> new · <strong id="csvCountDup">0</strong> duplicates (skipped)</div>
          <button class="btn btn-success" id="btnDoImport"><i class="fa-solid fa-file-import"></i> Import Students</button>
        </div>
        <div id="csvResult" style="margin-top:10px; font-size:13.5px;"></div>
      </div>
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* Events                                                               */
/* ------------------------------------------------------------------ */

/**
 * Bind events for the import view. Call after injecting renderImportView HTML.
 * @param {object} app app instance (showToast)
 */
export function bindImportEvents(app) {
  let parsedRows = [];
  let headers = [];
  let mapping = [];

  const statusEl = () => document.getElementById("csvStatus");
  const wrapEl = () => document.getElementById("csvMappingWrap");

  function refreshPreview() {
    const grid = document.getElementById("csvMappingGrid");
    const table = document.getElementById("csvPreviewTable");
    if (!grid || !table) return;

    grid.innerHTML = headers.map((h, i) => `
      <div class="form-group" style="margin:0;">
        <label class="form-label" style="font-size:12px;">Column ${i + 1}: <strong>${esc(h || "(blank)")}</strong></label>
        <select class="form-control csv-map-select" data-col="${i}">
          ${STUDENT_FIELDS.map(f => `<option value="${f.id}" ${mapping[i] === f.id ? "selected" : ""}>${f.label}${f.required ? " *" : ""}</option>`).join("")}
        </select>
      </div>`).join("");

    grid.querySelectorAll(".csv-map-select").forEach(sel => {
      sel.addEventListener("change", () => {
        mapping[Number(sel.getAttribute("data-col"))] = sel.value;
        refreshCounts();
      });
    });

    const preview = parsedRows.slice(0, 5);
    table.innerHTML = `
      <thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead>
      <tbody>${preview.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>`;

    refreshCounts();
  }

  async function refreshCounts() {
    let n = 0, d = 0;
    const existing = await db.getAll(STORES.STUDENTS).catch(() => []);
    parsedRows.forEach(r => {
      const s = buildStudentFromRow(r, mapping);
      if (!s) return;
      if (isDuplicate(s, existing)) d++; else n++;
    });
    const cn = document.getElementById("csvCountNew");
    const cd = document.getElementById("csvCountDup");
    if (cn) cn.textContent = n;
    if (cd) cd.textContent = d;
  }

  document.getElementById("csvFileInput")?.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (rows.length < 2) {
        statusEl().textContent = "File me data rows nahi milin. Pehli row headings honi chahiye.";
        return;
      }
      headers = rows[0];
      parsedRows = rows.slice(1);
      mapping = mapColumns(headers);
      statusEl().innerHTML = `<strong>${esc(file.name)}</strong> — ${parsedRows.length} rows, ${headers.length} columns.`;
      wrapEl().style.display = "block";
      refreshPreview();
    } catch (err) {
      statusEl().textContent = "File parhne me masla hua: " + err.message;
    }
  });

  document.getElementById("btnDoImport")?.addEventListener("click", async () => {
    if (!mapping.includes("name") || !mapping.includes("className")) {
      app.showToast("Student Name aur Class columns map karna zaroori hai.", "error");
      return;
    }
    const existing = await db.getAll(STORES.STUDENTS).catch(() => []);
    let added = 0, skipped = 0;
    for (const r of parsedRows) {
      const s = buildStudentFromRow(r, mapping);
      if (!s) { skipped++; continue; }
      if (isDuplicate(s, existing)) { skipped++; continue; }
      await db.add(STORES.STUDENTS, s);
      existing.push(s);
      added++;
    }
    const res = document.getElementById("csvResult");
    if (res) res.innerHTML = `<span style="color:#10b981; font-weight:700;">✓ ${added} students imported.</span>
      <span style="color:var(--text-dim);"> ${skipped} skipped (missing fields / duplicates).</span>`;
    app.showToast(`${added} students imported.`, "success");
  });
}
