/**
 * =========================================================================
 * 🧾 EDUCORE PRO v2.3 — Teacher Salary / Payroll Management
 * =========================================================================
 * Monthly teacher salaries: generate pending salary records for all
 * teachers, record allowances / deductions / salary advances, mark paid,
 * and print professional salary slips.
 *
 * INTEGRATION NOTE (parent agent): add to js/db.js
 *   STORES.SALARIES = "salaries";
 *   in onupgradeneeded: db.createObjectStore("salaries", { keyPath: "id" })
 *   with a non-unique "month" index; bump DB_VERSION.
 * Teacher basic salary is read from teacher.salary || teacher.basicSalary
 * (falls back to 0 — editable per record before payment).
 * =========================================================================
 */

import { db } from "./db.js";

/** IndexedDB store name — must exist in STORES (see integration note). */
export const SALARIES_STORE = "salaries";

/** HTML-escape for safe rendering. */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Collision-safe local id. */
function genId(prefix) {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Currency symbol from app config (defaults to "Rs"). */
function cur(app) {
  return (app && app.config && app.config.currency) || "Rs";
}

/** School name from app config. */
function schoolName(app) {
  return (app && app.config && (app.config.schoolName || app.config.instituteName)) || "School";
}

/** Today's date as YYYY-MM-DD. */
function todayStr() {
  return new Date().toISOString().split("T")[0];
}

/** Default month filter: current "YYYY-MM". */
function defaultMonth() {
  return todayStr().slice(0, 7);
}

/** Compute net payable: basic + allowances − deductions − advance recovered. */
export function computeNetPayable({ basicSalary, allowances, deductions, advanceDeducted }) {
  const net = Number(basicSalary || 0) + Number(allowances || 0)
    - Number(deductions || 0) - Number(advanceDeducted || 0);
  return Math.max(0, Math.round(net));
}

/**
 * Build a salary record for one teacher for one month.
 * @param {object} p
 * @param {string} p.teacherId
 * @param {string} p.teacherName
 * @param {string} p.month        "YYYY-MM"
 * @param {number} p.basicSalary
 * @param {number} [p.allowances]
 * @param {number} [p.deductions]
 * @param {number} [p.advanceDeducted]  Salary advance recovered this month
 * @param {string} [p.notes]
 */
export function buildSalaryRecord({ teacherId, teacherName, month, basicSalary, allowances, deductions, advanceDeducted, notes }) {
  const now = new Date().toISOString();
  const netPayable = computeNetPayable({ basicSalary, allowances, deductions, advanceDeducted });
  return {
    id: genId("sal"),
    teacherId: teacherId || null,
    teacherName: teacherName || "",
    month: month || defaultMonth(),
    basicSalary: Number(basicSalary || 0),
    allowances: Number(allowances || 0),
    deductions: Number(deductions || 0),
    advanceDeducted: Number(advanceDeducted || 0),
    netPayable,
    notes: (notes || "").trim(),
    status: "pending",
    paidDate: null,
    createdAt: now
  };
}

/**
 * Printable professional salary slip HTML.
 * @param {object} record  Salary record
 * @param {object} schoolConfig  { schoolName, logoUrl, logoText, contact:{address,phone,email}, currency }
 */
export function salarySlipHTML(record, schoolConfig) {
  const cfg = schoolConfig || {};
  const c = cfg.currency || "Rs";
  const school = cfg.schoolName || cfg.instituteName || "School";
  const r = record || {};
  const gross = Number(r.basicSalary || 0) + Number(r.allowances || 0);
  const totalDed = Number(r.deductions || 0) + Number(r.advanceDeducted || 0);

  const row = (label, val, bold) => `
    <tr>
      <td style="padding:8px 10px; border-bottom:1px solid #e2e8f0; ${bold ? "font-weight:700;" : ""}">${label}</td>
      <td style="padding:8px 10px; border-bottom:1px solid #e2e8f0; text-align:right; ${bold ? "font-weight:700;" : ""}">${c} ${Number(val || 0).toLocaleString()}</td>
    </tr>`;

  return `
    <div class="printable-area">
      <div class="printable-receipt-card" style="max-width:640px; margin:0 auto;">
        <div class="receipt-header">
          <div style="display:flex; align-items:center; gap:16px;">
            ${cfg.logoUrl ? `<img src="${esc(cfg.logoUrl)}" class="doc-school-logo" alt="School Logo">`
              : `<div class="doc-school-monogram">${esc((cfg.logoText || "Edu").slice(0, 4))}</div>`}
            <div>
              <div class="receipt-school-name">${esc(school)}</div>
              <div style="font-size:12px; color:#64748b; margin-top:3px;">${esc((cfg.contact && cfg.contact.address) || "")}</div>
              <div style="font-size:12px; color:#64748b;">Phone: ${esc((cfg.contact && cfg.contact.phone) || "—")}</div>
            </div>
          </div>
          <div style="text-align:right;">
            <span class="receipt-badge">SALARY SLIP</span>
            <div style="font-size:14px; font-weight:700; margin-top:6px;">${esc(r.month || "")}</div>
            <div style="font-size:11px; color:#64748b;">Status: ${(r.status || "pending").toUpperCase()}</div>
          </div>
        </div>

        <div class="receipt-grid">
          <div>
            <span style="font-size:11px; text-transform:uppercase; color:#94a3b8; font-weight:700;">Employee</span>
            <div style="font-weight:700; font-size:15px; margin-top:2px;">${esc(r.teacherName || "—")}</div>
            <div style="color:#64748b;">Paid Date: ${esc(r.paidDate || "—")}</div>
          </div>
          <div style="text-align:right;">
            <span style="font-size:11px; text-transform:uppercase; color:#94a3b8; font-weight:700;">Net Payable</span>
            <div style="font-weight:800; font-size:22px; color:#10b981; margin-top:2px;">${c} ${Number(r.netPayable || 0).toLocaleString()}</div>
          </div>
        </div>

        <table class="receipt-table">
          <thead>
            <tr><th>Earnings</th><th style="text-align:right;">Amount</th></tr>
          </thead>
          <tbody>
            ${row("Basic Salary", r.basicSalary)}
            ${row("Allowances", r.allowances)}
            ${row("Gross Earnings", gross, true)}
          </tbody>
        </table>

        <table class="receipt-table" style="margin-top:12px;">
          <thead>
            <tr><th>Deductions</th><th style="text-align:right;">Amount</th></tr>
          </thead>
          <tbody>
            ${row("Deductions", r.deductions)}
            ${row("Advance Recovered", r.advanceDeducted)}
            ${row("Total Deductions", totalDed, true)}
          </tbody>
        </table>

        <div class="receipt-total-row">
          <span>Net Payable</span>
          <span>${c} ${Number(r.netPayable || 0).toLocaleString()}</span>
        </div>

        ${r.notes ? `<div style="font-size:12px; color:#64748b; margin-top:8px;"><strong>Notes:</strong> ${esc(r.notes)}</div>` : ""}

        <div class="receipt-footer-stamp">
          <div><em>System generated salary slip. Verified electronically.</em></div>
          <div class="stamp-box">Authorized Signatory</div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Full Payroll view HTML. Caller renders into content area,
 * then calls bindPayrollEvents(app).
 * @param {object} app
 */
export async function renderPayrollView(app) {
  const c = cur(app);
  const month = app.payrollMonth || defaultMonth();
  app.payrollMonth = month;

  const salaries = (await db.getAll(SALARIES_STORE)).filter(s => s.month === month);
  const pending = salaries.filter(s => s.status !== "paid");
  const paidTotal = salaries.filter(s => s.status === "paid").reduce((t, s) => t + Number(s.netPayable || 0), 0);
  const pendingTotal = pending.reduce((t, s) => t + Number(s.netPayable || 0), 0);

  return `
    <div class="page-header">
      <div class="page-title-group">
        <h1>Teacher Payroll</h1>
        <p>Monthly salaries: generate, pay, and print salary slips.</p>
      </div>
      <div class="page-actions-group" style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
        <input type="month" class="form-control" id="payrollMonthPicker" value="${esc(month)}" style="width:auto;">
        <button class="btn btn-primary" id="btnGenerateSalaries">
          <i class="fa-solid fa-wand-magic-sparkles"></i> Generate Salaries
        </button>
      </div>
    </div>

    <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:14px; margin-bottom:16px;">
      <div class="card" style="border-left:4px solid #f59e0b;">
        <div style="font-size:12px; text-transform:uppercase; color:#94a3b8; font-weight:700;">Pending Payout (${esc(month)})</div>
        <div style="font-size:26px; font-weight:800; color:#f59e0b;">${esc(c)} ${pendingTotal.toLocaleString()}</div>
        <div style="font-size:12px; color:#64748b;">${pending.length} teacher(s) unpaid</div>
      </div>
      <div class="card" style="border-left:4px solid #10b981;">
        <div style="font-size:12px; text-transform:uppercase; color:#94a3b8; font-weight:700;">Paid This Month</div>
        <div style="font-size:26px; font-weight:800; color:#10b981;">${esc(c)} ${paidTotal.toLocaleString()}</div>
        <div style="font-size:12px; color:#64748b;">${salaries.length - pending.length} teacher(s) paid</div>
      </div>
    </div>

    <div class="card">
      <div class="table-container">
        <table class="custom-table">
          <thead>
            <tr>
              <th>Teacher</th>
              <th style="text-align:right;">Basic</th>
              <th style="text-align:right;">Allowances</th>
              <th style="text-align:right;">Deductions</th>
              <th style="text-align:right;">Net Payable</th>
              <th>Status</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${salaries.length ? salaries.map(s => `
              <tr>
                <td><strong>${esc(s.teacherName)}</strong></td>
                <td style="text-align:right;">${Number(s.basicSalary || 0).toLocaleString()}</td>
                <td style="text-align:right;">${Number(s.allowances || 0).toLocaleString()}</td>
                <td style="text-align:right;">${(Number(s.deductions || 0) + Number(s.advanceDeducted || 0)).toLocaleString()}</td>
                <td style="text-align:right; font-weight:800;">${esc(c)} ${Number(s.netPayable || 0).toLocaleString()}</td>
                <td>
                  <span class="badge ${s.status === "paid" ? "badge-success" : "badge-warning"}">${esc((s.status || "pending").toUpperCase())}</span>
                  ${s.paidDate ? `<br><span style="font-size:11px; color:#64748b;">${esc(s.paidDate)}</span>` : ""}
                </td>
                <td style="text-align:right; white-space:nowrap;">
                  ${s.status !== "paid" ? `
                    <button class="btn btn-secondary btn-sm btn-salary-edit" data-id="${esc(s.id)}" title="Edit"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn btn-success btn-sm btn-salary-pay" data-id="${esc(s.id)}"><i class="fa-solid fa-check"></i> Mark Paid</button>
                  ` : ""}
                  <button class="btn btn-secondary btn-sm btn-salary-slip" data-id="${esc(s.id)}" title="Print slip"><i class="fa-solid fa-print"></i> Slip</button>
                </td>
              </tr>`).join("") : `
              <tr>
                <td colspan="7" style="text-align:center; padding:36px 12px; color:#94a3b8;">
                  <i class="fa-solid fa-money-check-dollar" style="font-size:28px; opacity:.4;"></i>
                  <div style="margin-top:8px; font-weight:600;">No salary records for ${esc(month)}.</div>
                  <div>Click <strong>Generate Salaries</strong> to create pending records for all teachers.</div>
                </td>
              </tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/** Add/Edit salary modal form. */
function salaryFormHTML(s, teacherName) {
  const r = s || { basicSalary: 0, allowances: 0, deductions: 0, advanceDeducted: 0, notes: "" };
  return `
    <form id="salaryForm">
      <div class="form-group">
        <label class="form-label">Teacher</label>
        <input type="text" class="form-control" value="${esc(teacherName || r.teacherName || "")}" disabled>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Basic Salary (Rs)</label>
          <input type="number" class="form-control" id="salBasic" value="${esc(r.basicSalary)}" min="0">
        </div>
        <div class="form-group">
          <label class="form-label">Allowances (Rs)</label>
          <input type="number" class="form-control" id="salAllow" value="${esc(r.allowances)}" min="0">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Deductions (Rs)</label>
          <input type="number" class="form-control" id="salDed" value="${esc(r.deductions)}" min="0">
        </div>
        <div class="form-group">
          <label class="form-label">Advance Recovered (Rs)</label>
          <input type="number" class="form-control" id="salAdv" value="${esc(r.advanceDeducted)}" min="0">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <input type="text" class="form-control" id="salNotes" value="${esc(r.notes)}" placeholder="Optional">
      </div>
      <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:10px 14px; font-weight:700;">
        Net Payable: <span id="salNetPreview" style="color:#059669;">Rs 0</span>
      </div>
    </form>
  `;
}

/**
 * Wire payroll interactions. Call after rendering renderPayrollView(app).
 * @param {object} app
 */
export function bindPayrollEvents(app) {
  document.getElementById("payrollMonthPicker")?.addEventListener("change", (e) => {
    app.payrollMonth = e.target.value || defaultMonth();
    if (typeof app.refreshCurrentView === "function") app.refreshCurrentView();
  });

  // --- Generate pending salary records for all teachers (skip existing) ---
  document.getElementById("btnGenerateSalaries")?.addEventListener("click", async () => {
    const month = app.payrollMonth || defaultMonth();
    const teachers = await db.getAll("teachers");
    if (!teachers.length) {
      app.showToast("No teachers found. Add teachers first.", "error");
      return;
    }
    const existing = await db.getAll(SALARIES_STORE);
    const existingKeys = new Set(existing.filter(s => s.month === month).map(s => s.teacherId));
    let created = 0;
    for (const t of teachers) {
      if (existingKeys.has(t.id)) continue;
      const basic = Number(t.salary || t.basicSalary || 0);
      await db.add(SALARIES_STORE, buildSalaryRecord({
        teacherId: t.id,
        teacherName: t.name || t.fullName || "Teacher",
        month,
        basicSalary: basic
      }));
      created++;
    }
    app.showToast(
      created ? `${created} salary record(s) generated for ${month}.` : `Salaries already generated for ${month}.`,
      created ? "success" : "info"
    );
    if (typeof app.refreshCurrentView === "function") app.refreshCurrentView();
  });

  // --- Edit a pending salary record ---
  const openSalaryModal = async (id) => {
    const rec = await db.getById(SALARIES_STORE, id);
    if (!rec || rec.status === "paid") return;
    app.openModal(
      `Edit Salary — ${rec.teacherName}`,
      salaryFormHTML(rec),
      `<button class="btn btn-secondary" onclick="window.schoolApp.closeModal()">Cancel</button>
       <button class="btn btn-primary" id="btnSaveSalary">Save</button>`
    );
    const preview = () => {
      const net = computeNetPayable({
        basicSalary: document.getElementById("salBasic").value,
        allowances: document.getElementById("salAllow").value,
        deductions: document.getElementById("salDed").value,
        advanceDeducted: document.getElementById("salAdv").value
      });
      document.getElementById("salNetPreview").textContent = `Rs ${net.toLocaleString()}`;
    };
    ["salBasic", "salAllow", "salDed", "salAdv"].forEach(fid =>
      document.getElementById(fid)?.addEventListener("input", preview));
    preview();

    document.getElementById("btnSaveSalary")?.addEventListener("click", async () => {
      rec.basicSalary = Number(document.getElementById("salBasic").value || 0);
      rec.allowances = Number(document.getElementById("salAllow").value || 0);
      rec.deductions = Number(document.getElementById("salDed").value || 0);
      rec.advanceDeducted = Number(document.getElementById("salAdv").value || 0);
      rec.notes = document.getElementById("salNotes").value;
      rec.netPayable = computeNetPayable(rec);
      await db.update(SALARIES_STORE, rec);
      app.showToast("Salary updated.", "success");
      app.closeModal();
      if (typeof app.refreshCurrentView === "function") app.refreshCurrentView();
    });
  };

  document.querySelectorAll(".btn-salary-edit").forEach(btn => {
    btn.addEventListener("click", () => openSalaryModal(btn.getAttribute("data-id")));
  });

  // --- Mark paid ---
  document.querySelectorAll(".btn-salary-pay").forEach(btn => {
    btn.addEventListener("click", async () => {
      const rec = await db.getById(SALARIES_STORE, btn.getAttribute("data-id"));
      if (!rec) return;
      rec.status = "paid";
      rec.paidDate = todayStr();
      await db.update(SALARIES_STORE, rec);
      app.showToast(`${rec.teacherName}'s salary marked paid.`, "success");
      if (typeof app.refreshCurrentView === "function") app.refreshCurrentView();
    });
  });

  // --- Print salary slip ---
  document.querySelectorAll(".btn-salary-slip").forEach(btn => {
    btn.addEventListener("click", async () => {
      const rec = await db.getById(SALARIES_STORE, btn.getAttribute("data-id"));
      if (!rec) return;
      app.openModal(
        `Salary Slip — ${rec.teacherName} (${rec.month})`,
        salarySlipHTML(rec, app.config),
        `<button class="btn btn-secondary no-print" onclick="window.schoolApp.closeModal()">Close</button>
         <button class="btn btn-primary no-print" id="btnPrintSlip"><i class="fa-solid fa-print"></i> Print</button>`
      );
      document.getElementById("btnPrintSlip")?.addEventListener("click", () => {
        if (typeof app.printDocument === "function") app.printDocument(".printable-area", `Salary Slip — ${rec.teacherName}`);
        else window.print();
      });
    });
  });
}
