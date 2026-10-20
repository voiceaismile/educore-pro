/**
 * =========================================================================
 * 📅 EDUCORE PRO — Class Timetable Builder
 * =========================================================================
 * Weekly class timetables: visual days × periods grid editor, printable
 * black-on-white weekly grid for notice boards.
 *
 * DATA MODEL (IndexedDB):
 *   This module reads/writes the "timetables" object store (keyPath "id").
 *   The store must be registered in js/db.js STORES (TIMETABLES) and created
 *   in onupgradeneeded; bump DB_VERSION when adding it.
 *
 * Timetable record:
 *   { id, classId, className, slots: [{ day, periodNo, subject, teacher }],
 *     createdAt, updatedAt }
 *
 * Pure data helpers + view renderers. DOM binding happens in
 * bindTimetableEvents(app). Printing goes through app.printDocument().
 * =========================================================================
 */

import { db } from "./db.js";

/** IndexedDB store name for timetables (register in db.js STORES). */
export const STORE_TIMETABLES = "timetables";

/** Working days for the weekly grid. */
export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Default number of periods per day. */
export const DEFAULT_PERIODS = 8;

/** Common subjects offered as quick picks when a class has no subject list. */
export const COMMON_SUBJECTS = [
  "English", "Urdu", "Mathematics", "Science", "Islamiat", "Nazra Quran",
  "Social Studies", "Computer Science", "Physics", "Chemistry", "Biology",
  "Pak Studies", "Tarjuma-tul-Quran", "Break", "Sports", "Art"
];

/** Short day labels for the grid header. */
const DAY_SHORT = { Monday: "Mon", Tuesday: "Tue", Wednesday: "Wed", Thursday: "Thu", Friday: "Fri", Saturday: "Sat" };

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

/**
 * Build a new timetable record from editor input.
 * @param {Object} input
 * @param {string} input.classId
 * @param {string} input.className
 * @param {Array<{day:string, periodNo:number, subject:string, teacher:string}>} input.periods
 * @returns {Object} timetable record ready for db.add()
 */
export function buildTimetable({ classId, className, periods }) {
  const now = new Date().toISOString();
  const slots = (periods || [])
    .filter(p => p && (p.subject || "").trim())
    .map(p => ({
      day: p.day,
      periodNo: Number(p.periodNo),
      subject: (p.subject || "").trim(),
      teacher: (p.teacher || "").trim()
    }));
  return {
    id: newId("tt"),
    classId: classId || null,
    className: className || "",
    slots,
    createdAt: now,
    updatedAt: now
  };
}

/**
 * Find the saved timetable for a class (latest wins).
 * @param {string} classId
 * @returns {Promise<Object|null>}
 */
export async function getTimetableForClass(classId) {
  if (!classId) return null;
  const all = await db.getAll(STORE_TIMETABLES);
  const mine = all.filter(t => t.classId === classId);
  if (!mine.length) return null;
  mine.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  return mine[0];
}

/**
 * Look up a single slot.
 * @param {Object} timetable
 * @param {string} day
 * @param {number} periodNo
 * @returns {{subject:string, teacher:string}}
 */
export function slotAt(timetable, day, periodNo) {
  const s = (timetable && timetable.slots || []).find(
    x => x.day === day && Number(x.periodNo) === Number(periodNo)
  );
  return s ? { subject: s.subject || "", teacher: s.teacher || "" } : { subject: "", teacher: "" };
}

/**
 * Render the Timetable Builder view.
 * @param {Object} app - SchoolApp instance (config, openModal, showToast, printDocument)
 * @returns {Promise<string>} HTML
 */
export async function renderTimetableView(app) {
  const classes = await db.getAll("classes");
  const teachers = await db.getAll("teachers");

  if (!classes.length) {
    return `
      <div class="page-header">
        <div class="page-title-group">
          <h1><i class="fa-solid fa-calendar-days"></i> Class Timetable</h1>
          <p>Build printable weekly timetables for every class.</p>
        </div>
      </div>
      <div class="card">
        <div class="empty-state">
          <i class="fa-solid fa-school" style="font-size:40px; color:#cbd5e1;"></i>
          <h3>No classes yet</h3>
          <p>Create a class in <strong>Classes &amp; Batches</strong> first, then come back to build its timetable.</p>
        </div>
      </div>`;
  }

  const classOptions = classes
    .map(c => `<option value="${esc(c.id)}">${esc(c.name)}${c.section ? " — " + esc(c.section) : ""}</option>`)
    .join("");

  return `
    <div class="page-header">
      <div class="page-title-group">
        <h1><i class="fa-solid fa-calendar-days"></i> Class Timetable</h1>
        <p>Pick a class, fill the weekly grid, save and print for the notice board.</p>
      </div>
      <div class="page-actions-group">
        <button class="btn btn-secondary" id="btnPrintTimetable">
          <i class="fa-solid fa-print"></i> Print Timetable
        </button>
        <button class="btn btn-primary" id="btnSaveTimetable">
          <i class="fa-solid fa-floppy-disk"></i> Save Timetable
        </button>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <label class="form-label" for="ttClassSelect"><strong>Class</strong></label>
      <select id="ttClassSelect" class="form-control" style="max-width:320px;">
        ${classOptions}
      </select>
      <div id="ttSavedNote" style="font-size:12px; color:#64748b; margin-top:6px;"></div>
    </div>

    <div class="card">
      <div class="table-container">
        <table class="custom-table" id="ttGridTable" style="min-width:900px;">
          <thead>
            <tr>
              <th style="width:90px;">Day</th>
              ${Array.from({ length: DEFAULT_PERIODS }, (_, i) => `<th>Period ${i + 1}</th>`).join("")}
            </tr>
          </thead>
          <tbody id="ttGridBody"></tbody>
        </table>
      </div>
      <p style="font-size:12px; color:#64748b; margin-top:10px;">
        <i class="fa-solid fa-circle-info"></i> Leave a cell empty for free periods. Teachers are picked from your Teachers &amp; Staff list.
      </p>
    </div>

    <div id="ttPrintHost" style="display:none;"></div>`;
}

/**
 * Build the subject <option> list for a class.
 * @param {Object|null} classRec
 * @returns {string} option HTML
 */
function subjectOptions(classRec) {
  const list = (classRec && classRec.subjects && classRec.subjects.length)
    ? classRec.subjects
    : COMMON_SUBJECTS;
  return `<option value="">—</option>` +
    list.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
}

/**
 * Build the teacher <option> list.
 * @param {Array} teachers
 * @returns {string} option HTML
 */
function teacherOptions(teachers) {
  return `<option value="">—</option>` +
    (teachers || []).map(t => `<option value="${esc(t.name)}">${esc(t.name)}</option>`).join("");
}

/**
 * Render the editable grid for the selected class into #ttGridBody.
 * @param {Object} app
 */
async function renderGrid(app) {
  const classId = document.getElementById("ttClassSelect")?.value;
  const body = document.getElementById("ttGridBody");
  const note = document.getElementById("ttSavedNote");
  if (!body) return;

  const classes = await db.getAll("classes");
  const teachers = await db.getAll("teachers");
  const classRec = classes.find(c => String(c.id) === String(classId)) || null;
  const saved = await getTimetableForClass(classId);

  if (note) {
    note.innerHTML = saved
      ? `<i class="fa-solid fa-check-circle" style="color:#10b981;"></i> Saved timetable loaded (last updated ${esc((saved.updatedAt || "").split("T")[0])}). Edit and re-save to update.`
      : `<i class="fa-solid fa-circle-info"></i> No saved timetable for this class yet — fill the grid and press Save.`;
  }

  const subjOpts = subjectOptions(classRec);
  const teachOpts = teacherOptions(teachers);

  body.innerHTML = DAYS.map(day => `
    <tr>
      <td><strong>${DAY_SHORT[day] || day}</strong></td>
      ${Array.from({ length: DEFAULT_PERIODS }, (_, i) => {
        const p = i + 1;
        const cur = slotAt(saved, day, p);
        return `
          <td style="min-width:130px;">
            <select class="form-control form-control-sm tt-subject" data-day="${esc(day)}" data-period="${p}"
                    style="margin-bottom:4px; font-size:12px; padding:4px 6px;">
              ${subjOpts.replace(`value="${esc(cur.subject)}"`, `value="${esc(cur.subject)}" selected`)}
            </select>
            <select class="form-control form-control-sm tt-teacher" data-day="${esc(day)}" data-period="${p}"
                    style="font-size:12px; padding:4px 6px;">
              ${teachOpts.replace(`value="${esc(cur.teacher)}"`, `value="${esc(cur.teacher)}" selected`)}
            </select>
          </td>`;
      }).join("")}
    </tr>`).join("");
}

/**
 * Collect grid cells into a periods array.
 * @returns {Array<{day:string, periodNo:number, subject:string, teacher:string}>}
 */
function collectGrid() {
  const periods = [];
  document.querySelectorAll(".tt-subject").forEach(sel => {
    const teacherSel = document.querySelector(
      `.tt-teacher[data-day="${sel.dataset.day}"][data-period="${sel.dataset.period}"]`
    );
    periods.push({
      day: sel.dataset.day,
      periodNo: Number(sel.dataset.period),
      subject: sel.value,
      teacher: teacherSel ? teacherSel.value : ""
    });
  });
  return periods;
}

/**
 * Printable black-on-white weekly timetable.
 * @param {Object} timetable
 * @param {Object} config - app config (schoolName, contact)
 * @returns {string} HTML
 */
export function timetablePrintHTML(timetable, config) {
  const school = (config && config.schoolName) || "School";
  const contact = (config && config.contact) || {};
  const addr = [contact.address, contact.phone ? "Phone: " + contact.phone : ""].filter(Boolean).join(" | ");

  const rows = DAYS.map(day => {
    const cells = Array.from({ length: DEFAULT_PERIODS }, (_, i) => {
      const s = slotAt(timetable, day, i + 1);
      return `<td>${s.subject ? `<strong>${esc(s.subject)}</strong>${s.teacher ? `<br><span style="font-size:10px;">${esc(s.teacher)}</span>` : ""}` : "—"}</td>`;
    }).join("");
    return `<tr><td style="font-weight:700; background:#f8fafc;">${esc(day)}</td>${cells}</tr>`;
  }).join("");

  const head = Array.from({ length: DEFAULT_PERIODS }, (_, i) => `<th>Period ${i + 1}</th>`).join("");

  return `
    <div class="printable-area" style="font-family:Arial, Helvetica, sans-serif; color:#000; background:#fff; padding:24px;">
      <div style="text-align:center; border-bottom:3px double #000; padding-bottom:12px; margin-bottom:16px;">
        <div style="font-size:22px; font-weight:800;">${esc(school)}</div>
        ${addr ? `<div style="font-size:11px; color:#333;">${esc(addr)}</div>` : ""}
        <div style="font-size:15px; font-weight:700; margin-top:8px;">WEEKLY CLASS TIMETABLE — ${esc(timetable.className || "")}</div>
        <div style="font-size:11px; color:#333;">Session 2026–27</div>
      </div>
      <table style="width:100%; border-collapse:collapse; font-size:11.5px;">
        <thead>
          <tr><th style="background:#f8fafc;">Day</th>${head}</tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <style>
        .printable-area table th, .printable-area table td { border:1px solid #000; padding:6px; text-align:center; vertical-align:middle; }
      </style>
      <div style="display:flex; justify-content:space-between; margin-top:36px; font-size:12px;">
        <div>___________________<br>Class Incharge</div>
        <div>___________________<br>Principal</div>
      </div>
    </div>`;
}

/**
 * Bind Timetable view events. Call after renderTimetableView() HTML is in the DOM.
 * @param {Object} app - SchoolApp instance
 */
export function bindTimetableEvents(app) {
  const classSelect = document.getElementById("ttClassSelect");
  if (!classSelect) return;

  renderGrid(app);
  classSelect.addEventListener("change", () => renderGrid(app));

  document.getElementById("btnSaveTimetable")?.addEventListener("click", async () => {
    const classId = classSelect.value;
    const classes = await db.getAll("classes");
    const classRec = classes.find(c => String(c.id) === String(classId));
    const periods = collectGrid().filter(p => p.subject);

    const existing = await getTimetableForClass(classId);
    const record = buildTimetable({
      classId,
      className: classRec ? `${classRec.name}${classRec.section ? " — " + classRec.section : ""}` : "",
      periods
    });

    if (existing) {
      record.id = existing.id;
      record.createdAt = existing.createdAt;
      record.updatedAt = new Date().toISOString();
      await db.update(STORE_TIMETABLES, record);
    } else {
      await db.add(STORE_TIMETABLES, record);
    }
    app.showToast(`Timetable saved for ${record.className}.`, "success");
    renderGrid(app);
  });

  document.getElementById("btnPrintTimetable")?.addEventListener("click", async () => {
    const classId = classSelect.value;
    const saved = await getTimetableForClass(classId);
    if (!saved || !saved.slots.length) {
      app.showToast("Save a timetable for this class first.", "warning");
      return;
    }
    const html = timetablePrintHTML(saved, app.config);
    app.openModal(
      `Print — ${esc(saved.className)}`,
      html,
      `<button class="btn btn-secondary no-print" onclick="window.schoolApp.closeModal()">Close</button>
       <button class="btn btn-primary no-print" onclick="window.schoolApp.printDocument('.printable-area', 'Timetable - ${esc(saved.className)}')">
         <i class="fa-solid fa-print"></i> Print
       </button>`
    );
  });
}
