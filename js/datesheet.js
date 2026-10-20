/**
 * =========================================================================
 * 🗓️ EDUCORE PRO — Exam Date Sheet + Seating Plan Generator
 * =========================================================================
 * Exam date sheets (date / day / subject / time / room) with printable
 * black-on-white output, plus a round-robin seating-plan generator that
 * distributes students across rooms and prints room-wise lists.
 *
 * DATA MODEL (IndexedDB):
 *   This module reads/writes the "datesheets" object store (keyPath "id").
 *   The store must be registered in js/db.js STORES (DATESHEETS) and created
 *   in onupgradeneeded; bump DB_VERSION when adding it.
 *
 * DateSheet record:
 *   { id, examName, classId, className, entries: [{ date, day, subject, time, room }],
 *     createdAt, updatedAt }
 *
 * Pure data helpers + view renderers. DOM binding happens in
 * bindDateSheetEvents(app). Printing goes through app.printDocument().
 * =========================================================================
 */

import { db } from "./db.js";

/** IndexedDB store name for date sheets (register in db.js STORES). */
export const STORE_DATESHEETS = "datesheets";

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

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Day name for a YYYY-MM-DD date string.
 * @param {string} dateStr
 * @returns {string} e.g. "Monday" ("" when unparsable)
 */
export function dayNameOf(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return isNaN(d) ? "" : WEEKDAYS[d.getDay()];
}

/**
 * Build a new date-sheet record from form input.
 * @param {Object} input
 * @param {string} input.examName
 * @param {string} input.classId
 * @param {string} input.className
 * @param {Array<{date:string, subject:string, time:string, room:string}>} input.entries
 * @returns {Object} date-sheet record ready for db.add()
 */
export function buildDateSheet({ examName, classId, className, entries }) {
  const now = new Date().toISOString();
  const clean = (entries || [])
    .filter(e => e && ((e.date || "").trim() || (e.subject || "").trim()))
    .map(e => ({
      date: (e.date || "").trim(),
      day: dayNameOf((e.date || "").trim()),
      subject: (e.subject || "").trim(),
      time: (e.time || "").trim(),
      room: (e.room || "").trim()
    }));
  clean.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return {
    id: newId("ds"),
    examName: (examName || "").trim(),
    classId: classId || null,
    className: className || "",
    entries: clean,
    createdAt: now,
    updatedAt: now
  };
}

/**
 * Distribute students across rooms round-robin (fair, deterministic).
 * @param {Array<{id?:string, name:string, rollNo?:string, admissionNo?:string}>} students
 * @param {string[]} rooms - room names/numbers; defaults to ["Room 1"]
 * @returns {Array<{room:string, students:Array}>} room-wise lists
 */
export function generateSeatingPlan(students, rooms) {
  const list = (students || []).slice().sort((a, b) =>
    String(a.rollNo || a.admissionNo || a.name).localeCompare(String(b.rollNo || b.admissionNo || b.name), undefined, { numeric: true })
  );
  const roomNames = (rooms || []).map(r => String(r).trim()).filter(Boolean);
  const names = roomNames.length ? roomNames : ["Room 1"];
  const plan = names.map(room => ({ room, students: [] }));
  list.forEach((s, i) => plan[i % plan.length].students.push(s));
  return plan;
}

/**
 * Printable black-on-white date sheet.
 * @param {Object} datesheet
 * @param {Object} config - app config (schoolName, contact)
 * @returns {string} HTML
 */
export function dateSheetPrintHTML(datesheet, config) {
  const school = (config && config.schoolName) || "School";
  const contact = (config && config.contact) || {};
  const addr = [contact.address, contact.phone ? "Phone: " + contact.phone : ""].filter(Boolean).join(" | ");

  const rows = (datesheet.entries || []).map((e, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${esc(e.date)}</strong></td>
      <td>${esc(e.day)}</td>
      <td style="text-align:left;"><strong>${esc(e.subject)}</strong></td>
      <td>${esc(e.time || "—")}</td>
      <td>${esc(e.room || "—")}</td>
    </tr>`).join("");

  return `
    <div class="printable-area" style="font-family:Arial, Helvetica, sans-serif; color:#000; background:#fff; padding:24px;">
      <div style="text-align:center; border-bottom:3px double #000; padding-bottom:12px; margin-bottom:16px;">
        <div style="font-size:22px; font-weight:800;">${esc(school)}</div>
        ${addr ? `<div style="font-size:11px; color:#333;">${esc(addr)}</div>` : ""}
        <div style="font-size:15px; font-weight:700; margin-top:8px;">DATE SHEET — ${esc(datesheet.examName || "")}</div>
        <div style="font-size:12px; color:#333;">Class: ${esc(datesheet.className || "")}</div>
      </div>
      <table style="width:100%; border-collapse:collapse; font-size:12.5px;">
        <thead>
          <tr><th>#</th><th>Date</th><th>Day</th><th style="text-align:left;">Subject</th><th>Time</th><th>Room</th></tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="6" style="text-align:center;">No entries</td></tr>`}</tbody>
      </table>
      <style>
        .printable-area table th, .printable-area table td { border:1px solid #000; padding:7px 8px; text-align:center; }
        .printable-area table thead th { background:#f1f1f1; }
      </style>
      <div style="margin-top:14px; font-size:11px; color:#333;">
        <strong>Note:</strong> Students must reach the examination room 15 minutes before the paper starts and bring their roll-number slips.
      </div>
      <div style="display:flex; justify-content:space-between; margin-top:36px; font-size:12px;">
        <div>___________________<br>Controller of Examinations</div>
        <div>___________________<br>Principal</div>
      </div>
    </div>`;
}

/**
 * Printable black-on-white room-wise seating plan.
 * @param {Array<{room:string, students:Array}>} plan
 * @param {string} examName
 * @param {string} className
 * @param {Object} config - app config (schoolName)
 * @returns {string} HTML
 */
export function seatingPlanPrintHTML(plan, examName, className, config) {
  const school = (config && config.schoolName) || "School";

  const blocks = (plan || []).map(r => {
    const rows = r.students.map((s, i) => `
      <tr>
        <td>${i + 1}</td>
        <td style="text-align:left;"><strong>${esc(s.name)}</strong></td>
        <td>${esc(s.rollNo || s.admissionNo || "—")}</td>
        <td style="width:90px;"></td>
      </tr>`).join("");
    return `
      <div style="margin-bottom:22px; page-break-inside:avoid;">
        <div style="font-size:14px; font-weight:800; background:#f1f1f1; border:1px solid #000; padding:6px 10px;">
          ${esc(r.room)} <span style="font-weight:400; font-size:12px;">(${r.students.length} students)</span>
        </div>
        <table style="width:100%; border-collapse:collapse; font-size:12px;">
          <thead><tr><th style="width:40px;">#</th><th style="text-align:left;">Student Name</th><th>Roll No</th><th>Signature</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join("");

  return `
    <div class="printable-area" style="font-family:Arial, Helvetica, sans-serif; color:#000; background:#fff; padding:24px;">
      <div style="text-align:center; border-bottom:3px double #000; padding-bottom:12px; margin-bottom:16px;">
        <div style="font-size:22px; font-weight:800;">${esc(school)}</div>
        <div style="font-size:15px; font-weight:700; margin-top:8px;">SEATING PLAN — ${esc(examName || "")}</div>
        <div style="font-size:12px; color:#333;">Class: ${esc(className || "")}</div>
      </div>
      ${blocks || `<p style="text-align:center;">No students assigned.</p>`}
      <style>
        .printable-area table th, .printable-area table td { border:1px solid #000; padding:6px 8px; text-align:center; }
        .printable-area table thead th { background:#f1f1f1; }
      </style>
    </div>`;
}

/**
 * Render the Date Sheet view.
 * @param {Object} app - SchoolApp instance
 * @returns {Promise<string>} HTML
 */
export async function renderDateSheetView(app) {
  const classes = await db.getAll("classes");
  const saved = await db.getAll(STORE_DATESHEETS);

  const classOptions = (classes || [])
    .map(c => `<option value="${esc(c.id)}">${esc(c.name)}${c.section ? " — " + esc(c.section) : ""}</option>`)
    .join("");

  const savedRows = (saved || [])
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .map(d => `
      <tr>
        <td><strong>${esc(d.examName)}</strong></td>
        <td>${esc(d.className)}</td>
        <td>${(d.entries || []).length} papers</td>
        <td>${esc((d.updatedAt || "").split("T")[0])}</td>
        <td style="text-align:right; white-space:nowrap;">
          <button class="btn btn-secondary btn-sm ds-print" data-id="${esc(d.id)}"><i class="fa-solid fa-print"></i> Print</button>
          <button class="btn btn-danger btn-sm ds-delete" data-id="${esc(d.id)}"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>`).join("");

  return `
    <div class="page-header">
      <div class="page-title-group">
        <h1><i class="fa-solid fa-calendar-check"></i> Exam Date Sheets</h1>
        <p>Create date sheets and generate room-wise seating plans.</p>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <h3 class="card-title" style="margin-bottom:12px;"><i class="fa-solid fa-plus"></i> New Date Sheet</h3>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
        <div>
          <label class="form-label">Exam Name *</label>
          <input type="text" id="dsExamName" class="form-control" placeholder="e.g. First Term Examination 2026">
        </div>
        <div>
          <label class="form-label">Class</label>
          <select id="dsClassSelect" class="form-control">
            <option value="">— Select class —</option>
            ${classOptions}
          </select>
        </div>
      </div>

      <div class="table-container">
        <table class="custom-table" style="min-width:640px;">
          <thead>
            <tr><th>Date *</th><th>Day</th><th>Subject *</th><th>Time</th><th>Room</th><th style="width:48px;"></th></tr>
          </thead>
          <tbody id="dsRowsBody"></tbody>
        </table>
      </div>
      <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
        <button class="btn btn-secondary btn-sm" id="btnDsAddRow"><i class="fa-solid fa-plus"></i> Add Paper</button>
        <button class="btn btn-primary btn-sm" id="btnDsSave"><i class="fa-solid fa-floppy-disk"></i> Save Date Sheet</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <h3 class="card-title" style="margin-bottom:12px;"><i class="fa-solid fa-chair"></i> Seating Plan Generator</h3>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <div>
          <label class="form-label">Class (students source)</label>
          <select id="spClassSelect" class="form-control">
            <option value="">— Select class —</option>
            ${classOptions}
          </select>
        </div>
        <div>
          <label class="form-label">Rooms (comma separated)</label>
          <input type="text" id="spRooms" class="form-control" placeholder="e.g. Room 1, Room 2, Hall A">
        </div>
      </div>
      <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
        <input type="text" id="spExamName" class="form-control" placeholder="Exam name for the print header" style="max-width:320px;">
        <button class="btn btn-success btn-sm" id="btnSpGenerate"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate Seating Plan</button>
      </div>
      <p style="font-size:12px; color:#64748b; margin-top:8px;">
        <i class="fa-solid fa-circle-info"></i> Students are distributed across rooms round-robin by roll number — fair and automatic.
      </p>
    </div>

    <div class="card">
      <h3 class="card-title" style="margin-bottom:12px;">Saved Date Sheets</h3>
      ${savedRows ? `
        <div class="table-container">
          <table class="custom-table">
            <thead><tr><th>Exam</th><th>Class</th><th>Papers</th><th>Updated</th><th style="text-align:right;">Actions</th></tr></thead>
            <tbody>${savedRows}</tbody>
          </table>
        </div>` : `
        <div class="empty-state">
          <i class="fa-solid fa-calendar-xmark" style="font-size:40px; color:#cbd5e1;"></i>
          <h3>No date sheets yet</h3>
          <p>Fill the form above and press <strong>Save Date Sheet</strong> to create your first one.</p>
        </div>`}
    </div>`;
}

/** Add one editable paper row to the date-sheet editor. */
function addDateRow(values = {}) {
  const body = document.getElementById("dsRowsBody");
  if (!body) return;
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="date" class="form-control form-control-sm ds-date" value="${esc(values.date || "")}"></td>
    <td class="ds-day" style="font-size:12px; color:#64748b; white-space:nowrap;">${esc(dayNameOf(values.date || ""))}</td>
    <td><input type="text" class="form-control form-control-sm ds-subject" placeholder="Subject" value="${esc(values.subject || "")}"></td>
    <td><input type="text" class="form-control form-control-sm ds-time" placeholder="9:00 – 12:00" value="${esc(values.time || "")}"></td>
    <td><input type="text" class="form-control form-control-sm ds-room" placeholder="Room" value="${esc(values.room || "")}"></td>
    <td><button class="btn btn-danger btn-sm ds-row-del" title="Remove row"><i class="fa-solid fa-xmark"></i></button></td>`;
  const dateInput = tr.querySelector(".ds-date");
  const dayCell = tr.querySelector(".ds-day");
  dateInput.addEventListener("change", () => { dayCell.textContent = dayNameOf(dateInput.value); });
  tr.querySelector(".ds-row-del").addEventListener("click", () => tr.remove());
  body.appendChild(tr);
}

/** Collect editor rows into entries. */
function collectDateRows() {
  const entries = [];
  document.querySelectorAll("#dsRowsBody tr").forEach(tr => {
    entries.push({
      date: tr.querySelector(".ds-date")?.value || "",
      subject: tr.querySelector(".ds-subject")?.value || "",
      time: tr.querySelector(".ds-time")?.value || "",
      room: tr.querySelector(".ds-room")?.value || ""
    });
  });
  return entries;
}

/**
 * Bind Date Sheet view events. Call after renderDateSheetView() HTML is in the DOM.
 * @param {Object} app - SchoolApp instance
 */
export function bindDateSheetEvents(app) {
  addDateRow();
  addDateRow();
  addDateRow();

  document.getElementById("btnDsAddRow")?.addEventListener("click", () => addDateRow());

  document.getElementById("btnDsSave")?.addEventListener("click", async () => {
    const examName = document.getElementById("dsExamName")?.value || "";
    const classId = document.getElementById("dsClassSelect")?.value || "";
    if (!examName.trim()) {
      app.showToast("Please enter an exam name.", "warning");
      return;
    }
    const entries = collectDateRows().filter(e => e.date || e.subject);
    if (!entries.length) {
      app.showToast("Add at least one paper row.", "warning");
      return;
    }
    const classes = await db.getAll("classes");
    const classRec = classes.find(c => String(c.id) === String(classId));
    const record = buildDateSheet({
      examName,
      classId,
      className: classRec ? `${classRec.name}${classRec.section ? " — " + classRec.section : ""}` : "",
      entries
    });
    await db.add(STORE_DATESHEETS, record);
    app.showToast(`Date sheet saved: ${record.examName}.`, "success");
    app.refreshCurrentView();
  });

  document.querySelectorAll(".ds-print").forEach(btn => {
    btn.addEventListener("click", async () => {
      const d = await db.getById(STORE_DATESHEETS, btn.dataset.id);
      if (!d) return;
      app.openModal(
        `Print — ${esc(d.examName)}`,
        dateSheetPrintHTML(d, app.config),
        `<button class="btn btn-secondary no-print" onclick="window.schoolApp.closeModal()">Close</button>
         <button class="btn btn-primary no-print" onclick="window.schoolApp.printDocument('.printable-area', 'Date Sheet - ${esc(d.examName)}')">
           <i class="fa-solid fa-print"></i> Print
         </button>`
      );
    });
  });

  document.querySelectorAll(".ds-delete").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this date sheet?")) return;
      await db.delete(STORE_DATESHEETS, btn.dataset.id);
      app.showToast("Date sheet deleted.", "info");
      app.refreshCurrentView();
    });
  });

  document.getElementById("btnSpGenerate")?.addEventListener("click", async () => {
    const classId = document.getElementById("spClassSelect")?.value || "";
    const rooms = (document.getElementById("spRooms")?.value || "").split(",").map(s => s.trim()).filter(Boolean);
    const examName = document.getElementById("spExamName")?.value || "Examination";
    if (!classId) {
      app.showToast("Select a class first.", "warning");
      return;
    }
    const students = (await db.getAll("students")).filter(s => String(s.classId) === String(classId));
    if (!students.length) {
      app.showToast("No students found in this class.", "warning");
      return;
    }
    const classes = await db.getAll("classes");
    const classRec = classes.find(c => String(c.id) === String(classId));
    const className = classRec ? `${classRec.name}${classRec.section ? " — " + classRec.section : ""}` : "";
    const plan = generateSeatingPlan(students, rooms);
    app.openModal(
      `Seating Plan — ${esc(examName)}`,
      seatingPlanPrintHTML(plan, examName, className, app.config),
      `<button class="btn btn-secondary no-print" onclick="window.schoolApp.closeModal()">Close</button>
       <button class="btn btn-primary no-print" onclick="window.schoolApp.printDocument('.printable-area', 'Seating Plan - ${esc(examName)}')">
         <i class="fa-solid fa-print"></i> Print
       </button>`
    );
  });
}
