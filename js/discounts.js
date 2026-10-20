/**
 * =========================================================================
 * 🏷️ EDUCORE PRO v2.3 — Fee Concession / Discount Management
 * =========================================================================
 * Sibling discount, staff-child, Hafiz-e-Quran, merit scholarship, custom —
 * concession rules per student, applied at invoice time, listed in Settings.
 *
 * INTEGRATION NOTE (parent agent): add to js/db.js
 *   STORES.DISCOUNTS = "discounts";
 *   in onupgradeneeded: db.createObjectStore("discounts", { keyPath: "id" })
 *   with a non-unique "studentId" index; bump DB_VERSION.
 * For invoice embedding: inject renderDiscountsSection(app) HTML into the
 * fee-invoice modal, call bindDiscountsSection() after openModal, and read
 * getDiscountSelection() when saving the invoice — store it on the fee as
 * fee.discount = { type, percentOff, fixedOff } and reduce fee.amount.
 * =========================================================================
 */

import { db } from "./db.js";

/** IndexedDB store name — must exist in STORES (see integration note). */
export const DISCOUNTS_STORE = "discounts";

/** Available concession types. */
export const DISCOUNT_TYPES = [
  { id: "sibling", label: "Sibling Discount" },
  { id: "staff", label: "Staff Child" },
  { id: "hafiz", label: "Hafiz-e-Quran" },
  { id: "merit", label: "Merit Scholarship" },
  { id: "custom", label: "Custom" }
];

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

/** Human label for a discount type id. */
export function discountTypeLabel(id) {
  const t = DISCOUNT_TYPES.find(x => x.id === id);
  return t ? t.label : id;
}

/**
 * Build a concession rule for a student.
 * @param {object} p
 * @param {string} p.studentId
 * @param {string} p.studentName
 * @param {string} p.type        One of DISCOUNT_TYPES ids
 * @param {number} [p.percentOff] 0–100
 * @param {number} [p.fixedOff]    Flat amount off
 * @param {string} [p.reason]
 * @param {string} [p.validUntil] YYYY-MM-DD (optional expiry)
 */
export function buildDiscountRule({ studentId, studentName, type, percentOff, fixedOff, reason, validUntil }) {
  const now = new Date().toISOString();
  return {
    id: genId("dsc"),
    studentId: studentId || null,
    studentName: studentName || "",
    type: DISCOUNT_TYPES.some(t => t.id === type) ? type : "custom",
    percentOff: Math.min(100, Math.max(0, Number(percentOff || 0))),
    fixedOff: Math.max(0, Number(fixedOff || 0)),
    reason: (reason || "").trim(),
    validUntil: validUntil || null,
    active: true,
    createdAt: now
  };
}

/** True when the rule is active and not expired. */
export function isRuleValid(rule, asOf = null) {
  if (!rule || rule.active === false) return false;
  if (!rule.validUntil) return true;
  const today = (asOf || new Date().toISOString().split("T")[0]);
  return String(rule.validUntil) >= today;
}

/**
 * Apply a concession rule to an amount.
 * Percent is applied first, then the flat amount; never below zero.
 * @param {number} amount
 * @param {object|null} rule  { percentOff, fixedOff } (or null → unchanged)
 * @returns {number} Discounted amount (rounded)
 */
export function applyDiscount(amount, rule) {
  let v = Number(amount || 0);
  if (!rule) return Math.round(v);
  const pct = Math.min(100, Math.max(0, Number(rule.percentOff || 0)));
  v = v * (1 - pct / 100);
  v = v - Math.max(0, Number(rule.fixedOff || 0));
  return Math.max(0, Math.round(v));
}

/** Describe a rule compactly, e.g. "Sibling Discount — 10% + Rs 500 off". */
export function describeRule(rule, currency = "Rs") {
  if (!rule) return "No concession";
  const parts = [];
  if (Number(rule.percentOff) > 0) parts.push(`${rule.percentOff}%`);
  if (Number(rule.fixedOff) > 0) parts.push(`${currency} ${Number(rule.fixedOff).toLocaleString()} off`);
  const val = parts.length ? parts.join(" + ") : "—";
  return `${discountTypeLabel(rule.type)} — ${val}`;
}

/**
 * HTML snippet for embedding inside the fee-invoice modal.
 * Shows discount type select + percent/flat inputs + live final amount.
 * After openModal, call bindDiscountsSection(); read getDiscountSelection()
 * when saving the invoice.
 * @param {object} app
 * @param {number} baseAmount  Invoice amount before discount
 */
export function renderDiscountsSection(app, baseAmount = 0) {
  const c = cur(app);
  return `
    <div style="background:#faf5ff; border:1px solid #ddd6fe; border-radius:10px; padding:12px 14px; margin-top:12px;">
      <div style="font-weight:700; font-size:13px; color:#6d28d9; margin-bottom:8px;">
        <i class="fa-solid fa-tags"></i> Fee Concession (optional)
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Concession Type</label>
          <select class="form-control" id="dscType">
            <option value="">— None —</option>
            ${DISCOUNT_TYPES.map(t => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Percent Off (%)</label>
          <input type="number" class="form-control" id="dscPercent" value="0" min="0" max="100">
        </div>
        <div class="form-group">
          <label class="form-label">Flat Off (${esc(c)})</label>
          <input type="number" class="form-control" id="dscFixed" value="0" min="0">
        </div>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; font-size:14px;">
        <span style="color:#64748b;">Original: <strong>${esc(c)} ${Number(baseAmount).toLocaleString()}</strong></span>
        <span>Final: <strong id="dscFinalAmount" style="color:#6d28d9; font-size:17px;">${esc(c)} ${Number(baseAmount).toLocaleString()}</strong></span>
      </div>
    </div>
  `;
}

/** Read the current discount selection from an embedded section. */
export function getDiscountSelection() {
  const type = document.getElementById("dscType")?.value || "";
  if (!type) return null;
  return {
    type,
    percentOff: Number(document.getElementById("dscPercent")?.value || 0),
    fixedOff: Number(document.getElementById("dscFixed")?.value || 0)
  };
}

/**
 * Wire live final-amount computation for an embedded discount section.
 * @param {number} baseAmount  Invoice amount before discount
 */
export function bindDiscountsSection(baseAmount = 0) {
  const recompute = () => {
    const sel = getDiscountSelection();
    const final = applyDiscount(baseAmount, sel);
    const el = document.getElementById("dscFinalAmount");
    if (el) el.textContent = `Rs ${final.toLocaleString()}`;
  };
  ["dscType", "dscPercent", "dscFixed"].forEach(fid =>
    document.getElementById(fid)?.addEventListener("input", recompute));
  const amtInput = document.getElementById("feeAmount");
  if (amtInput) amtInput.addEventListener("input", () => {
    const v = Number(amtInput.value || 0);
    const sel = getDiscountSelection();
    const el = document.getElementById("dscFinalAmount");
    if (el) el.textContent = `Rs ${applyDiscount(v, sel).toLocaleString()}`;
  });
}

/**
 * Full concession-rules management view HTML (Settings-level).
 * Caller renders into content area, then calls bindDiscountRulesEvents(app).
 * @param {object} app
 */
export async function renderDiscountRulesView(app) {
  const c = cur(app);
  const rules = (await db.getAll(DISCOUNTS_STORE))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const active = rules.filter(r => isRuleValid(r));

  return `
    <div class="page-header">
      <div class="page-title-group">
        <h1>Fee Concessions</h1>
        <p>Sibling, staff-child, Hafiz-e-Quran, merit & custom discount rules — auto-applied at invoice time.</p>
      </div>
      <div class="page-actions-group">
        <button class="btn btn-primary" id="btnAddDiscountRule">
          <i class="fa-solid fa-plus"></i> Add Concession Rule
        </button>
      </div>
    </div>

    <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:14px; margin-bottom:16px;">
      <div class="card" style="border-left:4px solid #8b5cf6;">
        <div style="font-size:12px; text-transform:uppercase; color:#94a3b8; font-weight:700;">Active Rules</div>
        <div style="font-size:26px; font-weight:800; color:#8b5cf6;">${active.length}</div>
      </div>
      <div class="card" style="border-left:4px solid #64748b;">
        <div style="font-size:12px; text-transform:uppercase; color:#94a3b8; font-weight:700;">Total Rules</div>
        <div style="font-size:26px; font-weight:800;">${rules.length}</div>
      </div>
    </div>

    <div class="card">
      <div class="table-container">
        <table class="custom-table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Concession</th>
              <th>Valid Until</th>
              <th>Status</th>
              <th style="text-align:right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rules.length ? rules.map(r => `
              <tr>
                <td><strong>${esc(r.studentName || "—")}</strong>
                  ${r.reason ? `<br><span style="font-size:11px; color:#64748b;">${esc(r.reason)}</span>` : ""}</td>
                <td><span class="badge badge-info">${esc(describeRule(r, c))}</span></td>
                <td>${esc(r.validUntil || "—")}</td>
                <td><span class="badge ${isRuleValid(r) ? "badge-success" : "badge-warning"}">${isRuleValid(r) ? "ACTIVE" : "INACTIVE"}</span></td>
                <td style="text-align:right; white-space:nowrap;">
                  <button class="btn btn-secondary btn-sm btn-dsc-toggle" data-id="${esc(r.id)}">
                    ${isRuleValid(r) ? "Deactivate" : "Activate"}
                  </button>
                  <button class="btn btn-secondary btn-sm btn-dsc-del" data-id="${esc(r.id)}" style="color:#ef4444;"><i class="fa-solid fa-trash"></i></button>
                </td>
              </tr>`).join("") : `
              <tr>
                <td colspan="5" style="text-align:center; padding:36px 12px; color:#94a3b8;">
                  <i class="fa-solid fa-tags" style="font-size:28px; opacity:.4;"></i>
                  <div style="margin-top:8px; font-weight:600;">No concession rules yet.</div>
                  <div>Click <strong>Add Concession Rule</strong> to create sibling, staff-child, Hafiz-e-Quran or merit discounts.</div>
                </td>
              </tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/**
 * Wire concession-rules view interactions.
 * @param {object} app
 */
export function bindDiscountRulesEvents(app) {
  document.getElementById("btnAddDiscountRule")?.addEventListener("click", async () => {
    const students = await db.getAll("students");

    const body = `
      <form id="discountRuleForm">
        <div class="form-group">
          <label class="form-label">Student</label>
          <select class="form-control" id="dscStudent" required>
            ${students.map(s => `<option value="${esc(s.id)}" data-name="${esc(s.name)}">${esc(s.name)} (${esc(s.admissionNo || "")})</option>`).join("")}
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Concession Type</label>
            <select class="form-control" id="dscRuleType">
              ${DISCOUNT_TYPES.map(t => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join("")}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Valid Until (optional)</label>
            <input type="date" class="form-control" id="dscValidUntil">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Percent Off (%)</label>
            <input type="number" class="form-control" id="dscRulePercent" value="0" min="0" max="100">
          </div>
          <div class="form-group">
            <label class="form-label">Flat Off (Rs)</label>
            <input type="number" class="form-control" id="dscRuleFixed" value="0" min="0">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Reason</label>
          <input type="text" class="form-control" id="dscReason" placeholder="e.g. Second sibling admitted in Class 3">
        </div>
      </form>
    `;

    app.openModal(
      "Add Concession Rule",
      body,
      `<button class="btn btn-secondary" onclick="window.schoolApp.closeModal()">Cancel</button>
       <button class="btn btn-primary" id="btnSaveDiscountRule">Save Rule</button>`
    );

    document.getElementById("btnSaveDiscountRule")?.addEventListener("click", async () => {
      const sel = document.getElementById("dscStudent");
      const opt = sel.options[sel.selectedIndex];
      const rule = buildDiscountRule({
        studentId: sel.value,
        studentName: opt.getAttribute("data-name"),
        type: document.getElementById("dscRuleType").value,
        percentOff: document.getElementById("dscRulePercent").value,
        fixedOff: document.getElementById("dscRuleFixed").value,
        reason: document.getElementById("dscReason").value,
        validUntil: document.getElementById("dscValidUntil").value || null
      });
      if (!(rule.percentOff > 0 || rule.fixedOff > 0)) {
        app.showToast("Enter a percent or flat discount value.", "error");
        return;
      }
      await db.add(DISCOUNTS_STORE, rule);
      app.showToast("Concession rule added.", "success");
      app.closeModal();
      if (typeof app.refreshCurrentView === "function") app.refreshCurrentView();
    });
  });

  document.querySelectorAll(".btn-dsc-toggle").forEach(btn => {
    btn.addEventListener("click", async () => {
      const r = await db.getById(DISCOUNTS_STORE, btn.getAttribute("data-id"));
      if (!r) return;
      r.active = !isRuleValid(r);
      await db.update(DISCOUNTS_STORE, r);
      app.showToast(`Rule ${r.active ? "activated" : "deactivated"}.`, "info");
      if (typeof app.refreshCurrentView === "function") app.refreshCurrentView();
    });
  });

  document.querySelectorAll(".btn-dsc-del").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!window.confirm("Delete this concession rule?")) return;
      await db.delete(DISCOUNTS_STORE, btn.getAttribute("data-id"));
      app.showToast("Rule deleted.", "info");
      if (typeof app.refreshCurrentView === "function") app.refreshCurrentView();
    });
  });
}
