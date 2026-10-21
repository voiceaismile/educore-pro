/**
 * =========================================================================
 * 🪪 EDUCORE PRO — Student ID Cards (printable, QR-coded)
 * =========================================================================
 * Credit-card-ratio ID cards (85.6 × 54 mm — ISO/IEC 7810 ID-1) rendered as
 * print-friendly HTML. The QR code is loaded from the free goqr.me image API
 * keyed by the student id; schools can swap `qrImageUrl()` for an offline QR
 * library (e.g. qrcodejs / kjua) later without touching the card layout.
 *
 * View contract (same as other views in js/app.js):
 *   renderIdCardsView(app) -> HTML string (class filter + student grid)
 *   bindIdCardEvents(app)  -> wire Print Card / Print All / filter
 * `app` exposes: app.config, app.showToast(msg, type).
 * =========================================================================
 */

import { db, STORES } from "./db.js";

/** Exact ISO/IEC 7810 ID-1 dimensions. */
export const ID_CARD_WIDTH_MM = 85.6;
export const ID_CARD_HEIGHT_MM = 54;

/**
 * QR image URL for a student id.
 * NOTE: uses the free goqr.me API (needs internet at print time). To go
 * fully offline, replace this with a local QR library that returns a
 * data-URL and keep the same <img src="..."> usage.
 */
export function qrImageUrl(studentId, sizePx = 100) {
  const data = encodeURIComponent(`EDUCORE:${studentId}`);
  return `https://api.qrserver.com/v1/create-qr-code/?size=${sizePx}x${sizePx}&data=${data}`;
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Best-effort display name for a student record. */
export function studentDisplayName(s) {
  if (!s) return "—";
  if (s.name) return s.name;
  const full = [s.firstName, s.lastName].filter(Boolean).join(" ").trim();
  return full || s.id || "—";
}

/** Student class label (supports classId / class / grade fields). */
export function studentClassLabel(s) {
  return s?.className || s?.class || s?.classId || s?.grade || "—";
}

/**
 * Single printable ID card (front side), exact 85.6 × 54 mm.
 * @param {object} student - student record
 * @param {object} config  - app config (schoolName, logoUrl, ...)
 * @returns {string} HTML fragment
 */
export function idCardHTML(student, config) {
  const school = (config && (config.schoolName || config.instituteName)) || "School";
  const logo = (config && config.logoUrl) || "";
  const name = studentDisplayName(student);
  const initials = (name || "").split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  const photo = student.photo || student.photoUrl || "";

  const row = (label, value) => `
    <div style="display:flex; gap:4px; font-size:7.2pt; line-height:1.35; color:#1e293b;">
      <span style="width:44px; flex-shrink:0; color:#64748b; font-weight:600;">${label}</span>
      <span style="font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(value || "—")}</span>
    </div>`;

  return `
  <div class="id-card" style="
      width:${ID_CARD_WIDTH_MM}mm; height:${ID_CARD_HEIGHT_MM}mm;
      border-radius:3mm; overflow:hidden; position:relative;
      font-family:'Segoe UI', Arial, sans-serif;
      background:linear-gradient(135deg, #1e3a8a 0%, #3730a3 55%, #6d28d9 100%);
      color:#fff; display:flex; flex-direction:column;
      box-shadow:0 1mm 3mm rgba(0,0,0,.25);
      -webkit-print-color-adjust:exact; print-color-adjust:exact;">
    <div style="display:flex; align-items:center; gap:2.5mm; padding:2.8mm 3mm 2mm;">
      <div style="width:9mm; height:9mm; border-radius:50%; background:#fff; display:flex; align-items:center; justify-content:center; overflow:hidden; flex-shrink:0;">
        ${logo ? `<img src="${esc(logo)}" alt="" style="width:100%; height:100%; object-fit:contain;">`
               : `<span style="font-size:11pt;">🎓</span>`}
      </div>
      <div style="min-width:0;">
        <div style="font-size:8.5pt; font-weight:800; letter-spacing:.2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(school)}</div>
        <div style="font-size:6.5pt; opacity:.85;">Student Identity Card</div>
      </div>
    </div>
    <div style="flex:1; background:#fff; margin:0 2.5mm; border-radius:2mm; padding:2mm 2.5mm; display:flex; gap:2.5mm; align-items:center;">
      <div style="width:15mm; height:18mm; border-radius:1.5mm; overflow:hidden; background:#e2e8f0; flex-shrink:0; display:flex; align-items:center; justify-content:center;">
        ${photo ? `<img src="${esc(photo)}" alt="" style="width:100%; height:100%; object-fit:cover;">`
                : `<span style="font-size:12pt; font-weight:800; color:#475569;">${esc(initials)}</span>`}
      </div>
      <div style="flex:1; min-width:0;">
        <div style="font-size:9pt; font-weight:800; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(name)}</div>
        ${row("Class", studentClassLabel(student))}
        ${row("Roll No", student.rollNo || student.rollNumber || "")}
        ${row("DOB", student.dob || student.dateOfBirth || "")}
        ${row("Parent", student.parentPhone || student.phone || "")}
      </div>
      <div style="text-align:center; flex-shrink:0;">
        <img src="${qrImageUrl(student.id || name)}" alt="QR" style="width:15mm; height:15mm; display:block;">
        <div style="font-size:5.5pt; color:#64748b; margin-top:1mm;">${esc(String(student.id || "").slice(0, 10))}</div>
      </div>
    </div>
    <div style="padding:1.8mm 3mm; font-size:6pt; opacity:.9; display:flex; justify-content:space-between;">
      <span>Session 2026-27</span><span>If found, please return to school office.</span>
    </div>
  </div>`;
}

/**
 * Full print document for one or more cards (3 per row on A4).
 * @param {Array<object>} students
 * @param {object} config
 * @returns {string} complete HTML document
 */
export function idCardsPrintDocument(students, config) {
  const cards = students.map(s => idCardHTML(s, config)).join("\n");
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Student ID Cards</title>
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Segoe UI', Arial, sans-serif; }
  .sheet { display: grid; grid-template-columns: repeat(2, ${ID_CARD_WIDTH_MM}mm);
           gap: 6mm; justify-content: center; }
  .id-card { break-inside: avoid; }
  @media print {
    .no-print { display: none !important; }
  }
</style></head>
<body>
  <div class="no-print" style="padding:12px; text-align:center; background:#f1f5f9; position:sticky; top:0;">
    <button onclick="window.print()" style="padding:10px 24px; font-size:15px; background:#4f46e5; color:#fff; border:none; border-radius:8px; cursor:pointer;">🖨️ Print ${students.length} Card(s)</button>
    <span style="margin-left:12px; color:#64748b; font-size:13px;">Use A4, 100% scale, background graphics ON.</span>
  </div>
  <div class="sheet">${cards}</div>
</body></html>`;
}

/** Open a print window with the given students' cards. */
export function printIdCards(students, config) {
  if (!students || !students.length) return false;
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) return false;
  win.document.write(idCardsPrintDocument(students, config));
  win.document.close();
  return true;
}

/* =========================================================================
   VIEW
   ========================================================================= */

/**
 * ID cards view: class filter, student grid with per-student Print Card
 * and a Print All button for the filtered class.
 */
export async function renderIdCardsView(app) {
  let students = [];
  try { students = await db.getAll(STORES.STUDENTS); } catch (e) { /* noop */ }

  const classes = [...new Set(students.map(studentClassLabel).filter(c => c && c !== "—"))].sort();

  return `
    <div class="page-header">
      <div class="page-title-group">
        <h1>Student ID Cards</h1>
        <p>Printable QR-coded identity cards (85.6 × 54 mm — credit-card size).</p>
      </div>
      <div class="page-actions-group">
        <select id="idCardClassFilter" class="form-control" style="width:auto; display:inline-block;">
          <option value="">All Classes</option>
          ${classes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}
        </select>
        <button class="btn btn-primary" id="btnPrintAllIdCards">
          <i class="fa-solid fa-print"></i> Print All
        </button>
      </div>
    </div>

    <div class="card">
      <div id="idCardGrid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(300px, 1fr)); gap:20px; justify-items:center; padding:8px;">
        ${students.length ? students.map(s => `
          <div class="id-card-item" data-class="${esc(studentClassLabel(s))}" data-student-id="${esc(s.id)}"
               style="display:flex; flex-direction:column; align-items:center; gap:10px;">
            <div style="transform:scale(.92); transform-origin:top center;">${idCardHTML(s, app?.config || {})}</div>
            <div style="text-align:center;">
              <div style="font-weight:700;">${esc(studentDisplayName(s))}</div>
              <div style="font-size:12px; color:#64748b;">${esc(studentClassLabel(s))} · Roll ${esc(s.rollNo || s.rollNumber || "—")}</div>
              <button class="btn btn-secondary btn-sm btn-print-id-card" data-student-id="${esc(s.id)}" style="margin-top:6px;">
                <i class="fa-solid fa-print"></i> Print Card
              </button>
            </div>
          </div>`).join("") : `
          <div style="grid-column:1/-1; text-align:center; color:#64748b; padding:32px;">
            No students found. Add students from the Students section first.
          </div>`}
      </div>
    </div>`;
}

/**
 * Wire ID-card view events. Call after the view HTML is in the DOM.
 */
export function bindIdCardEvents(app) {
  const cfg = (app && app.config) || {};

  const visibleStudents = async () => {
    const filter = document.getElementById("idCardClassFilter")?.value || "";
    let students = [];
    try { students = await db.getAll(STORES.STUDENTS); } catch (e) { /* noop */ }
    return filter ? students.filter(s => studentClassLabel(s) === filter) : students;
  };

  // Class filter
  document.getElementById("idCardClassFilter")?.addEventListener("change", (e) => {
    const filter = e.target.value;
    document.querySelectorAll(".id-card-item").forEach(el => {
      el.style.display = (!filter || el.getAttribute("data-class") === filter) ? "" : "none";
    });
  });

  // Print single card
  document.querySelectorAll(".btn-print-id-card").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-student-id");
      try {
        const s = await db.getById(STORES.STUDENTS, id);
        if (!s) { app?.showToast("Student not found.", "warning"); return; }
        if (!printIdCards([s], cfg)) app?.showToast("Popup blocked — please allow popups to print.", "warning");
      } catch (err) {
        app?.showToast("Print failed: " + err.message, "danger");
      }
    });
  });

  // Print all (filtered) cards
  document.getElementById("btnPrintAllIdCards")?.addEventListener("click", async () => {
    const students = await visibleStudents();
    if (!students.length) { app?.showToast("No students to print.", "warning"); return; }
    if (!printIdCards(students, cfg)) app?.showToast("Popup blocked — please allow popups to print.", "warning");
    else app?.showToast(`Preparing ${students.length} ID card(s) for printing.`, "success");
  });
}
