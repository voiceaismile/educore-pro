/**
 * =========================================================================
 * 👨‍👩‍👧 EDUCORE PRO v2.2+ — Parent Portal (Read-Only)
 * =========================================================================
 * View-only access for parents: fee status, attendance %, latest grades,
 * class homework and school notices. Parents log in with their registered
 * phone number + a short PIN set by the school admin.
 *
 * ⚠️  SECURITY NOTE (read before production use):
 * This is DEMO-GRADE authentication. Accounts are stored in localStorage
 * with the PIN in plain text, and the "session" is a sessionStorage flag.
 * It is suitable for a family demo kiosk on a trusted device. For any
 * real deployment:
 *   - store only salted+hashed PINs (never plain text),
 *   - move accounts to the server / Firebase with proper Auth,
 *   - enforce rate limiting on login attempts,
 *   - serve over HTTPS and set HttpOnly session cookies.
 *
 * STORAGE: localStorage key below (see SECURITY NOTE).
 * =========================================================================
 */

import { db, STORES } from "./db.js";

const LS_KEY = "educore_parent_accounts";
const SESSION_KEY = "educore_parent_session";

function newId(prefix) {
  return (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ------------------------------------------------------------------ */
/* Account management (admin side)                                      */
/* ------------------------------------------------------------------ */

/** Load all parent accounts. */
export function loadParentAccounts() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

/** Persist parent accounts. */
export function saveParentAccounts(accounts) {
  localStorage.setItem(LS_KEY, JSON.stringify(accounts || []));
}

/**
 * Build a parent account record.
 * @param {object} opts
 * @param {string} opts.studentId
 * @param {string} opts.parentPhone  registered phone (login id)
 * @param {string} opts.pin          4–6 digit PIN (demo-grade plain text — see SECURITY NOTE)
 */
export function buildParentAccount({ studentId, parentPhone, pin }) {
  return {
    id: newId("pacc"),
    studentId: studentId || null,
    parentPhone: String(parentPhone || "").replace(/\D/g, ""),
    pin: String(pin || "").trim(),
    createdAt: new Date().toISOString()
  };
}

/** Create (or replace) the account for a student. Returns the record. */
export function createParentAccount({ studentId, parentPhone, pin }) {
  const rec = buildParentAccount({ studentId, parentPhone, pin });
  const accounts = loadParentAccounts().filter(a => a.studentId !== studentId);
  accounts.push(rec);
  saveParentAccounts(accounts);
  return rec;
}

/** Verify phone + PIN. Returns the account or null. */
export function verifyParentLogin(phone, pin) {
  const digits = String(phone || "").replace(/\D/g, "");
  const p = String(pin || "").trim();
  if (!digits || !p) return null;
  const acc = loadParentAccounts().find(a => a.parentPhone === digits && a.pin === p);
  return acc || null;
}

/* ------------------------------------------------------------------ */
/* Session (sessionStorage — cleared when the tab closes)               */
/* ------------------------------------------------------------------ */

/** Start a parent session after successful login. */
export function startParentSession(accountId) {
  sessionStorage.setItem(SESSION_KEY, accountId);
}

/** Current session account (or null). */
export function getParentSession() {
  try {
    const id = sessionStorage.getItem(SESSION_KEY);
    if (!id) return null;
    return loadParentAccounts().find(a => a.id === id) || null;
  } catch (e) {
    return null;
  }
}

/** End the parent session. */
export function parentLogout() {
  sessionStorage.removeItem(SESSION_KEY);
}

/* ------------------------------------------------------------------ */
/* Login form                                                           */
/* ------------------------------------------------------------------ */

/** HTML for the parent login form (phone + PIN). */
export function parentLoginHtml() {
  return `
    <div class="card" style="max-width:420px; margin:40px auto;">
      <h2 style="text-align:center; margin-top:0;"><i class="fa-solid fa-user-shield"></i> Parent Portal</h2>
      <p style="text-align:center; color:var(--text-dim); font-size:13px;">
        Apne bachay ki fee, hazri aur result dekhne ke liye login karein.
      </p>
      <form id="formParentLogin">
        <div class="form-group">
          <label class="form-label">Registered Mobile Number</label>
          <input class="form-control" id="ppPhone" inputmode="numeric" placeholder="0300-1234567" required>
        </div>
        <div class="form-group">
          <label class="form-label">PIN</label>
          <input type="password" class="form-control" id="ppPin" inputmode="numeric" maxlength="6" placeholder="••••" required>
        </div>
        <button type="submit" class="btn btn-primary" style="width:100%;">
          <i class="fa-solid fa-right-to-bracket"></i> Login
        </button>
      </form>
      <p style="text-align:center; font-size:12px; color:var(--text-dim); margin-bottom:0;">
        PIN school office se hasil karein.
      </p>
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* Parent dashboard (read-only)                                         */
/* ------------------------------------------------------------------ */

/**
 * Attendance % for a student in a given month (YYYY-MM).
 * Records shape: {date:"YYYY-MM-DD", records:{studentId:"present"|"late"|"absent"}}.
 */
export function studentAttendancePct(attendanceDocs, studentId, month) {
  const m = month || new Date().toISOString().slice(0, 7);
  let present = 0, total = 0;
  (attendanceDocs || []).forEach(doc => {
    if ((doc.date || "").slice(0, 7) !== m) return;
    const st = (doc.records || {})[studentId];
    if (!st) return;
    total++;
    if (st === "present" || st === "late") present++;
  });
  return total ? Math.round((present / total) * 100) : null;
}

/**
 * Render the read-only parent dashboard for one student.
 * @param {object} app app instance (uses app.config)
 * @param {string} studentId
 * @returns {Promise<string>} HTML
 */
export async function renderParentDashboard(app, studentId) {
  const student = await db.getById(STORES.STUDENTS, studentId);
  if (!student) return `<div class="card">Student record not found.</div>`;

  const cur = (app.config && app.config.currency) || "Rs";
  const school = (app.config && app.config.schoolName) || "School";
  const month = new Date().toISOString().slice(0, 7);

  const [fees, attendanceDocs, grades, notices] = await Promise.all([
    db.getAll(STORES.FEES).catch(() => []),
    db.getAll(STORES.ATTENDANCE).catch(() => []),
    db.getAll(STORES.GRADES).catch(() => []),
    db.getAll(STORES.NOTICES).catch(() => [])
  ]);

  const myFees = fees.filter(f => f.studentId === studentId || f.studentName === student.name);
  const pending = myFees.filter(f => f.status === "pending");
  const pendingTotal = pending.reduce((s, f) => s + Number(f.amount || 0), 0);
  const attPct = studentAttendancePct(attendanceDocs, studentId, month);
  const myGrades = grades
    .filter(g => g.studentId === studentId || g.studentName === student.name)
    .slice(-5)
    .reverse();

  // Homework: notices tagged as homework for this class (defensive shapes)
  const homework = notices.filter(n => {
    const text = `${n.title || n.heading || ""} ${n.message || n.body || ""}`.toLowerCase();
    const cls = (n.className || n.class || "").toLowerCase();
    const isHw = /home\s*work|diary/.test(text) || (n.type || "").toLowerCase() === "homework";
    return isHw && (!cls || cls === String(student.className || "").toLowerCase());
  }).slice(0, 5);

  const general = notices.filter(n => {
    const text = `${n.title || n.heading || ""}`.toLowerCase();
    return !/home\s*work|diary/.test(text);
  }).slice(0, 5);

  return `
    <div class="page-header">
      <div class="page-title-group">
        <h1><i class="fa-solid fa-user-shield"></i> Parent Portal</h1>
        <p>${esc(school)} — view only. Koi tabdeeli yahan se nahi ho sakti.</p>
      </div>
      <div class="page-actions-group">
        <button class="btn btn-secondary" id="btnParentLogout"><i class="fa-solid fa-right-from-bracket"></i> Logout</button>
      </div>
    </div>

    <div class="card" style="border-left:4px solid #4f46e5;">
      <div style="display:flex; gap:16px; align-items:center; flex-wrap:wrap;">
        <div style="width:56px; height:56px; border-radius:50%; background:#4f46e522; display:flex; align-items:center; justify-content:center; font-size:24px;">
          <i class="fa-solid fa-graduation-cap" style="color:#4f46e5;"></i>
        </div>
        <div>
          <h3 style="margin:0;">${esc(student.name || "Student")}</h3>
          <div style="font-size:13px; color:var(--text-dim);">
            ${esc(student.className || "")} · Roll ${esc(student.rollNo || "—")} · Adm ${esc(student.admissionNo || "—")}
          </div>
        </div>
      </div>
    </div>

    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:12px; margin-bottom:16px;">
      <div class="card" style="margin:0; border-top:3px solid ${pending.length ? "#ef4444" : "#10b981"};">
        <div style="font-size:12px; color:var(--text-dim);">Fee Status</div>
        <div style="font-size:22px; font-weight:800; ${pending.length ? "color:#ef4444;" : "color:#10b981;"}">
          ${pending.length ? `${cur} ${pendingTotal.toLocaleString()} due` : "All Clear ✓"}
        </div>
        <div style="font-size:12px; color:var(--text-dim);">${pending.length} pending invoice${pending.length === 1 ? "" : "s"}</div>
      </div>
      <div class="card" style="margin:0; border-top:3px solid #38bdf8;">
        <div style="font-size:12px; color:var(--text-dim);">Attendance (${month})</div>
        <div style="font-size:22px; font-weight:800; color:#38bdf8;">${attPct === null ? "—" : attPct + "%"}</div>
        <div style="font-size:12px; color:var(--text-dim);">this month</div>
      </div>
      <div class="card" style="margin:0; border-top:3px solid #a78bfa;">
        <div style="font-size:12px; color:var(--text-dim);">Latest Result</div>
        <div style="font-size:22px; font-weight:800; color:#a78bfa;">
          ${myGrades.length ? esc(String(myGrades[0].percentage != null ? myGrades[0].percentage + "%" : (myGrades[0].grade || "—"))) : "—"}
        </div>
        <div style="font-size:12px; color:var(--text-dim);">${myGrades.length ? esc(myGrades[0].examName || "") : "no exams yet"}</div>
      </div>
    </div>

    ${pending.length ? `
    <div class="card">
      <h3 style="margin-top:0;"><i class="fa-solid fa-file-invoice-dollar"></i> Pending Fees</h3>
      <div class="table-container"><table class="custom-table">
        <thead><tr><th>Particulars</th><th>Amount</th><th>Due Date</th></tr></thead>
        <tbody>
          ${pending.map(f => `<tr><td>${esc(f.type || "Fee")}</td>
            <td><strong>${cur} ${Number(f.amount || 0).toLocaleString()}</strong></td>
            <td>${esc(f.dueDate || "—")}</td></tr>`).join("")}
        </tbody>
      </table></div>
      <p style="font-size:12.5px; color:var(--text-dim); margin-bottom:0;">
        💡 Fee school office me ya JazzCash/EasyPaisa par ada karke TID WhatsApp par bhejein.
      </p>
    </div>` : ""}

    <div class="card">
      <h3 style="margin-top:0;"><i class="fa-solid fa-book-open"></i> Homework / Diary</h3>
      ${homework.length ? homework.map(n => `
        <div style="padding:10px 0; border-bottom:1px solid var(--border);">
          <strong>${esc(n.title || n.heading || "Homework")}</strong>
          <div style="font-size:13px; color:var(--text-dim);">${esc(n.message || n.body || "")}</div>
          <div style="font-size:11px; color:var(--text-dim);">${esc(n.date || n.createdAt || "")}</div>
        </div>`).join("")
        : `<p style="color:var(--text-dim); font-size:13px; margin:0;">Koi homework post nahi hua.</p>`}
    </div>

    <div class="card">
      <h3 style="margin-top:0;"><i class="fa-solid fa-bullhorn"></i> School Notices</h3>
      ${general.length ? general.map(n => `
        <div style="padding:10px 0; border-bottom:1px solid var(--border);">
          <strong>${esc(n.title || n.heading || "Notice")}</strong>
          <div style="font-size:13px; color:var(--text-dim);">${esc(n.message || n.body || "")}</div>
          <div style="font-size:11px; color:var(--text-dim);">${esc(n.date || n.createdAt || "")}</div>
        </div>`).join("")
        : `<p style="color:var(--text-dim); font-size:13px; margin:0;">Koi notice nahi hai.</p>`}
    </div>

    ${myGrades.length ? `
    <div class="card">
      <h3 style="margin-top:0;"><i class="fa-solid fa-chart-line"></i> Recent Results</h3>
      <div class="table-container"><table class="custom-table">
        <thead><tr><th>Exam</th><th>Score</th><th>Grade</th></tr></thead>
        <tbody>
          ${myGrades.map(g => `<tr><td>${esc(g.examName || "—")}</td>
            <td><strong>${g.marksObtained ?? "—"} / ${g.maxMarks ?? "—"}</strong>${g.percentage != null ? ` (${g.percentage}%)` : ""}</td>
            <td>${esc(g.grade || "—")}</td></tr>`).join("")}
        </tbody>
      </table></div>
    </div>` : ""}
  `;
}

/* ------------------------------------------------------------------ */
/* Events                                                               */
/* ------------------------------------------------------------------ */

/**
 * Bind the parent login form. On success starts a session and calls onLogin.
 * @param {object} app app instance (showToast)
 * @param {function} onLogin called with the account record after login
 */
export function bindParentPortalEvents(app, onLogin) {
  document.getElementById("formParentLogin")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const phone = document.getElementById("ppPhone").value;
    const pin = document.getElementById("ppPin").value;
    const acc = verifyParentLogin(phone, pin);
    if (!acc) {
      app.showToast("Ghalat number ya PIN. Dobara koshish karein.", "error");
      return;
    }
    startParentSession(acc.id);
    app.showToast("Welcome to Parent Portal.", "success");
    if (typeof onLogin === "function") onLogin(acc);
  });

  document.getElementById("btnParentLogout")?.addEventListener("click", () => {
    parentLogout();
    app.showToast("Logged out.", "info");
    if (typeof onLogin === "function") onLogin(null);
  });
}
