/**
 * =========================================================================
 * 👩‍🏫 EDUCORE PRO — Staff Module (Teacher Attendance + Leave Management)
 * =========================================================================
 * Pure helpers + view renderers for teacher attendance and leave requests.
 *
 * NOTE: this module references two IndexedDB stores that must exist in
 * js/db.js (STORES): "staffAttendance" (keyPath "id") and "leaves"
 * (keyPath "id"). Add them to STORES + onupgradeneeded when integrating.
 *
 * View contract (same as fees/whatsapp views in js/app.js):
 *   renderStaffAttendanceView(app) / renderLeaveView(app) -> HTML string
 *   bindStaffEvents(app)                        -> wire DOM events
 * `app` exposes: app.config, app.showToast(msg, type).
 * =========================================================================
 */

import { db, STORES } from "./db.js";

/** Local store names (add to STORES in js/db.js during integration). */
export const STAFF_STORES = {
  STAFF_ATTENDANCE: "staffAttendance",
  LEAVES: "leaves"
};

/** Allowed attendance statuses. */
export const ATTENDANCE_STATUSES = ["present", "absent", "leave", "half-day"];

/** Allowed leave types. */
export const LEAVE_TYPES = [
  { id: "casual", label: "Casual Leave" },
  { id: "sick", label: "Sick Leave" },
  { id: "annual", label: "Annual Leave" },
  { id: "unpaid", label: "Unpaid Leave" }
];

/** Human label for an attendance status. */
export function attendanceLabel(status) {
  const map = { present: "Present", absent: "Absent", leave: "Leave", "half-day": "Half Day" };
  return map[status] || status;
}

/** Human label for a leave type id. */
export function leaveTypeLabel(id) {
  const t = LEAVE_TYPES.find(x => x.id === id);
  return t ? t.label : id;
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function uid(prefix) {
  return (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

/** Best-effort display name for a teacher record. */
export function teacherDisplayName(t) {
  if (!t) return "—";
  if (t.name) return t.name;
  const full = [t.firstName, t.lastName].filter(Boolean).join(" ").trim();
  return full || t.id || "—";
}

/**
 * Build a staff-attendance record for one date.
 * @param {{date: string, records: Array<{teacherId: string, teacherName: string, status: string}>}} input
 * @returns {{id: string, date: string, records: Array, createdAt: string}}
 */
export function buildStaffAttendance({ date, records }) {
  const clean = (records || [])
    .filter(r => r && r.teacherId)
    .map(r => ({
      teacherId: r.teacherId,
      teacherName: r.teacherName || "",
      status: ATTENDANCE_STATUSES.includes(r.status) ? r.status : "present"
    }));
  return {
    id: `satt_${date || todayStr()}`,
    date: date || todayStr(),
    records: clean,
    createdAt: new Date().toISOString()
  };
}

/**
 * Build a leave request record (starts as "pending").
 * @param {{teacherId: string, teacherName: string, fromDate: string, toDate: string, reason: string, type: string}} input
 * @returns {{id: string, status: "pending", ...}}
 */
export function buildLeaveRecord({ teacherId, teacherName, fromDate, toDate, reason, type }) {
  return {
    id: uid("leave"),
    teacherId: teacherId || null,
    teacherName: teacherName || "",
    type: LEAVE_TYPES.some(t => t.id === type) ? type : "casual",
    fromDate: fromDate || todayStr(),
    toDate: toDate || fromDate || todayStr(),
    reason: (reason || "").trim(),
    status: "pending",
    createdAt: new Date().toISOString(),
    decidedAt: null,
    decidedBy: null
  };
}

/** Number of days (inclusive) covered by a leave record. */
export function leaveDayCount(leave) {
  try {
    const a = new Date(leave.fromDate + "T00:00:00").getTime();
    const b = new Date(leave.toDate + "T00:00:00").getTime();
    return Math.max(1, Math.round((b - a) / 86400000) + 1);
  } catch (e) {
    return 1;
  }
}

/**
 * Monthly per-teacher attendance summary.
 * @param {Array} attendanceDocs - staff-attendance docs (any dates)
 * @param {string} month - "YYYY-MM"
 * @returns {Array<{teacherId, teacherName, present, absent, leave, halfDay, total}>}
 */
export function monthlyStaffSummary(attendanceDocs, month) {
  const map = {};
  (attendanceDocs || [])
    .filter(d => d && d.date && d.date.startsWith(month))
    .forEach(d => {
      (d.records || []).forEach(r => {
        const k = r.teacherId;
        if (!map[k]) {
          map[k] = { teacherId: k, teacherName: r.teacherName || k, present: 0, absent: 0, leave: 0, halfDay: 0, total: 0 };
        }
        if (r.status === "present") map[k].present++;
        else if (r.status === "absent") map[k].absent++;
        else if (r.status === "leave") map[k].leave++;
        else if (r.status === "half-day") map[k].halfDay++;
        map[k].total++;
      });
    });
  return Object.values(map).sort((a, b) => a.teacherName.localeCompare(b.teacherName));
}

/* =========================================================================
   VIEWS
   ========================================================================= */

/**
 * Staff attendance view: date picker, teacher list with status radio pills,
 * Save Attendance, and a monthly summary table.
 */
export async function renderStaffAttendanceView(app) {
  const date = todayStr();
  const month = date.slice(0, 7);
  let teachers = [];
  let docs = [];
  try { teachers = await db.getAll(STORES.TEACHERS); } catch (e) { /* store may not exist yet */ }
  try { docs = await db.getAll(STAFF_STORES.STAFF_ATTENDANCE); } catch (e) { /* store may not exist yet */ }
  const summary = monthlyStaffSummary(docs, month);

  const statusPill = (teacherId, status) => {
    const colors = {
      present: "#10b981", absent: "#ef4444", leave: "#f59e0b", "half-day": "#8b5cf6"
    };
    return `
      <label class="staff-status-pill" style="border-color:${colors[status]};">
        <input type="radio" name="staff_att_${esc(teacherId)}" value="${status}"
          ${status === "present" ? "checked" : ""} style="accent-color:${colors[status]};">
        <span>${attendanceLabel(status)}</span>
      </label>`;
  };

  return `
    <div class="page-header">
      <div class="page-title-group">
        <h1>Staff Attendance</h1>
        <p>Daily teacher attendance with status tracking and monthly summary.</p>
      </div>
      <div class="page-actions-group">
        <input type="date" id="staffAttDate" class="form-control" value="${date}"
          max="${date}" style="width:auto; display:inline-block;">
        <button class="btn btn-primary" id="btnSaveStaffAttendance">
          <i class="fa-solid fa-floppy-disk"></i> Save Attendance
        </button>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <div class="table-container">
        <table class="custom-table">
          <thead>
            <tr><th>Teacher</th><th>Subject</th><th style="text-align:right;">Status</th></tr>
          </thead>
          <tbody>
            ${teachers.length ? teachers.map(t => `
              <tr>
                <td><strong>${esc(teacherDisplayName(t))}</strong><br>
                  <small style="color:#64748b;">${esc(t.phone || "")}</small></td>
                <td>${esc(t.subject || t.department || "—")}</td>
                <td style="text-align:right;">
                  <div class="staff-status-group" data-teacher-id="${esc(t.id)}"
                       data-teacher-name="${esc(teacherDisplayName(t))}">
                    ${ATTENDANCE_STATUSES.map(s => statusPill(t.id, s)).join("")}
                  </div>
                </td>
              </tr>`).join("") : `
              <tr><td colspan="3" style="text-align:center; color:#64748b; padding:24px;">
                No teachers found. Add teachers from the Teachers section first.
              </td></tr>`}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
        <h3 style="margin:0;"><i class="fa-solid fa-chart-simple"></i> Monthly Summary — ${esc(month)}</h3>
        <input type="month" id="staffSummaryMonth" class="form-control" value="${month}" style="width:auto;">
      </div>
      <div class="table-container">
        <table class="custom-table">
          <thead>
            <tr><th>Teacher</th><th>Present</th><th>Absent</th><th>Leave</th><th>Half Day</th><th>Marked Days</th></tr>
          </thead>
          <tbody id="staffSummaryBody">
            ${summary.length ? summary.map(s => `
              <tr>
                <td><strong>${esc(s.teacherName)}</strong></td>
                <td><span class="badge badge-success">${s.present}</span></td>
                <td><span class="badge badge-danger">${s.absent}</span></td>
                <td><span class="badge badge-warning">${s.leave}</span></td>
                <td><span class="badge badge-info">${s.halfDay}</span></td>
                <td>${s.total}</td>
              </tr>`).join("") : `
              <tr><td colspan="6" style="text-align:center; color:#64748b; padding:20px;">
                No attendance marked for ${esc(month)} yet.
              </td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;
}

/**
 * Leave management view: request form + pending approvals + history.
 */
export async function renderLeaveView(app) {
  let teachers = [];
  let leaves = [];
  try { teachers = await db.getAll(STORES.TEACHERS); } catch (e) { /* store may not exist yet */ }
  try { leaves = await db.getAll(STAFF_STORES.LEAVES); } catch (e) { /* store may not exist yet */ }

  const pending = leaves.filter(l => l.status === "pending")
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const history = leaves.filter(l => l.status !== "pending")
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  const leaveRow = (l, showActions) => `
    <tr>
      <td><strong>${esc(l.teacherName)}</strong></td>
      <td>${esc(leaveTypeLabel(l.type))}</td>
      <td>${esc(l.fromDate)} → ${esc(l.toDate)} <small>(${leaveDayCount(l)}d)</small></td>
      <td style="max-width:220px;">${esc(l.reason || "—")}</td>
      <td><span class="badge ${l.status === "approved" ? "badge-success" : l.status === "rejected" ? "badge-danger" : "badge-warning"}">${esc((l.status || "pending").toUpperCase())}</span></td>
      ${showActions ? `
      <td style="text-align:right; white-space:nowrap;">
        <button class="btn btn-success btn-sm btn-leave-approve" data-id="${esc(l.id)}">
          <i class="fa-solid fa-check"></i> Approve
        </button>
        <button class="btn btn-danger btn-sm btn-leave-reject" data-id="${esc(l.id)}">
          <i class="fa-solid fa-xmark"></i> Reject
        </button>
      </td>` : ""}
    </tr>`;

  return `
    <div class="page-header">
      <div class="page-title-group">
        <h1>Leave Management</h1>
        <p>Teacher leave requests, approvals and history.</p>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <h3 style="margin-top:0;"><i class="fa-solid fa-file-circle-plus"></i> New Leave Request</h3>
      <form id="formLeaveRequest">
        <div class="form-row" style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div>
            <label class="form-label">Teacher</label>
            <select id="leaveTeacher" class="form-control" required>
              <option value="">— Select teacher —</option>
              ${teachers.map(t => `<option value="${esc(t.id)}" data-name="${esc(teacherDisplayName(t))}">${esc(teacherDisplayName(t))}</option>`).join("")}
            </select>
          </div>
          <div>
            <label class="form-label">Leave Type</label>
            <select id="leaveType" class="form-control">
              ${LEAVE_TYPES.map(t => `<option value="${t.id}">${t.label}</option>`).join("")}
            </select>
          </div>
          <div>
            <label class="form-label">From</label>
            <input type="date" id="leaveFrom" class="form-control" value="${todayStr()}" required>
          </div>
          <div>
            <label class="form-label">To</label>
            <input type="date" id="leaveTo" class="form-control" value="${todayStr()}" required>
          </div>
        </div>
        <div style="margin-top:12px;">
          <label class="form-label">Reason</label>
          <textarea id="leaveReason" class="form-control" rows="2" placeholder="e.g. Family function in Lahore"></textarea>
        </div>
        <button type="submit" class="btn btn-primary" style="margin-top:12px;">
          <i class="fa-solid fa-paper-plane"></i> Submit Request
        </button>
      </form>
    </div>

    <div class="card" style="margin-bottom:16px; border-left:4px solid #f59e0b;">
      <h3 style="margin-top:0;"><i class="fa-solid fa-hourglass-half"></i> Pending Approval (${pending.length})</h3>
      <div class="table-container">
        <table class="custom-table">
          <thead><tr><th>Teacher</th><th>Type</th><th>Dates</th><th>Reason</th><th>Status</th><th style="text-align:right;">Actions</th></tr></thead>
          <tbody>
            ${pending.length ? pending.map(l => leaveRow(l, true)).join("") :
              `<tr><td colspan="6" style="text-align:center; color:#64748b; padding:20px;">No pending requests. 🎉</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-top:0;"><i class="fa-solid fa-clock-rotate-left"></i> Leave History</h3>
      <div class="table-container">
        <table class="custom-table">
          <thead><tr><th>Teacher</th><th>Type</th><th>Dates</th><th>Reason</th><th>Status</th></tr></thead>
          <tbody>
            ${history.length ? history.slice(0, 50).map(l => leaveRow(l, false)).join("") :
              `<tr><td colspan="5" style="text-align:center; color:#64748b; padding:20px;">No leave history yet.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;
}

/**
 * Wire all staff-view events. Call after the view HTML is in the DOM.
 * Re-renders the current view after mutations via app.refreshCurrentView()
 * (falls back to location-free re-render when unavailable).
 */
export function bindStaffEvents(app) {
  const refresh = () => {
    if (app && typeof app.refreshCurrentView === "function") app.refreshCurrentView();
  };

  // --- Save staff attendance ---
  document.getElementById("btnSaveStaffAttendance")?.addEventListener("click", async () => {
    const date = document.getElementById("staffAttDate")?.value || todayStr();
    const groups = document.querySelectorAll(".staff-status-group");
    const records = [];
    groups.forEach(g => {
      const checked = g.querySelector('input[type="radio"]:checked');
      records.push({
        teacherId: g.getAttribute("data-teacher-id"),
        teacherName: g.getAttribute("data-teacher-name"),
        status: checked ? checked.value : "present"
      });
    });
    if (!records.length) {
      app?.showToast("No teachers to mark.", "warning");
      return;
    }
    const doc = buildStaffAttendance({ date, records });
    try {
      const existing = await db.getById(STAFF_STORES.STAFF_ATTENDANCE, doc.id).catch(() => null);
      if (existing) {
        doc.createdAt = existing.createdAt;
        await db.update(STAFF_STORES.STAFF_ATTENDANCE, doc);
      } else {
        await db.add(STAFF_STORES.STAFF_ATTENDANCE, doc);
      }
      app?.showToast(`Attendance saved for ${date} (${records.length} teachers).`, "success");
      refresh();
    } catch (e) {
      app?.showToast("Could not save attendance: " + e.message, "danger");
    }
  });

  // --- Monthly summary filter ---
  document.getElementById("staffSummaryMonth")?.addEventListener("change", async (e) => {
    const month = e.target.value;
    let docs = [];
    try { docs = await db.getAll(STAFF_STORES.STAFF_ATTENDANCE); } catch (err) { /* noop */ }
    const summary = monthlyStaffSummary(docs, month);
    const body = document.getElementById("staffSummaryBody");
    if (body) {
      body.innerHTML = summary.length ? summary.map(s => `
        <tr>
          <td><strong>${esc(s.teacherName)}</strong></td>
          <td><span class="badge badge-success">${s.present}</span></td>
          <td><span class="badge badge-danger">${s.absent}</span></td>
          <td><span class="badge badge-warning">${s.leave}</span></td>
          <td><span class="badge badge-info">${s.halfDay}</span></td>
          <td>${s.total}</td>
        </tr>`).join("") :
        `<tr><td colspan="6" style="text-align:center; color:#64748b; padding:20px;">No attendance marked for ${esc(month)} yet.</td></tr>`;
    }
  });

  // --- New leave request ---
  document.getElementById("formLeaveRequest")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const sel = document.getElementById("leaveTeacher");
    const teacherId = sel.value;
    if (!teacherId) {
      app?.showToast("Please select a teacher.", "warning");
      return;
    }
    const teacherName = sel.options[sel.selectedIndex]?.getAttribute("data-name") || "";
    const fromDate = document.getElementById("leaveFrom").value;
    const toDate = document.getElementById("leaveTo").value;
    if (toDate < fromDate) {
      app?.showToast("'To' date cannot be before 'From' date.", "warning");
      return;
    }
    const rec = buildLeaveRecord({
      teacherId,
      teacherName,
      fromDate,
      toDate,
      reason: document.getElementById("leaveReason").value,
      type: document.getElementById("leaveType").value
    });
    try {
      await db.add(STAFF_STORES.LEAVES, rec);
      app?.showToast("Leave request submitted for approval.", "success");
      refresh();
    } catch (err) {
      app?.showToast("Could not submit request: " + err.message, "danger");
    }
  });

  // --- Approve / reject leave ---
  const decide = async (id, decision) => {
    try {
      const rec = await db.getById(STAFF_STORES.LEAVES, id);
      if (!rec) return;
      rec.status = decision;
      rec.decidedAt = new Date().toISOString();
      await db.update(STAFF_STORES.LEAVES, rec);
      app?.showToast(`Leave ${decision}.`, decision === "approved" ? "success" : "info");
      refresh();
    } catch (err) {
      app?.showToast("Could not update request: " + err.message, "danger");
    }
  };
  document.querySelectorAll(".btn-leave-approve").forEach(b =>
    b.addEventListener("click", () => decide(b.getAttribute("data-id"), "approved")));
  document.querySelectorAll(".btn-leave-reject").forEach(b =>
    b.addEventListener("click", () => decide(b.getAttribute("data-id"), "rejected")));
}
