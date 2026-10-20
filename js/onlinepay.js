/**
 * =========================================================================
 * 💳 EDUCORE PRO v2.1 — Online Fee Collection (JazzCash / EasyPaisa / Bank)
 * =========================================================================
 * HONEST MODEL: no merchant API integration (that needs credentials + a
 * backend). Workflow Pakistani schools actually use:
 *   parent sends fee to the school's JazzCash/EasyPaisa number
 *   -> shares the TID (transaction ID) with the school
 *   -> school admin verifies in the app -> invoice marked PAID.
 * Pure data helpers + printable HTML — no DOM.
 * =========================================================================
 */

import { DEFAULT_CONFIG } from "./config.js";

export const PAYMENT_METHODS = [
  { id: "jazzcash", label: "JazzCash" },
  { id: "easypaisa", label: "EasyPaisa" },
  { id: "bank", label: "Bank Transfer" }
];

/** School's payment settings (numbers/accounts), merged over defaults. */
export function getPaymentSettings(config) {
  return { ...DEFAULT_CONFIG.payments, ...((config && config.payments) || {}) };
}

/** True when at least one receiving number is configured. */
export function hasPaymentSettings(config) {
  const p = getPaymentSettings(config);
  return Boolean((p.jazzcashNumber || "").trim() || (p.easypaisaNumber || "").trim());
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Printable HTML box for the fee challan: shows JazzCash / EasyPaisa numbers,
 * bank details and the "TID WhatsApp par bhejein" note. "" if not configured.
 */
export function paymentInstructionsHTML(config, amount) {
  const p = getPaymentSettings(config);
  const jc = (p.jazzcashNumber || "").trim();
  const ep = (p.easypaisaNumber || "").trim();
  const bankName = (p.bankName || "").trim();
  const bankTitle = (p.bankAccountTitle || "").trim();
  const bankAcct = (p.bankAccount || "").trim();
  const instr = (p.instructions || "").trim();

  if (!jc && !ep && !bankAcct) return "";

  const cur = (config && config.currency) || "Rs";
  const rows = [];
  if (jc) rows.push(`<div><strong>JazzCash:</strong> <span style="font-size:15px;">${esc(jc)}</span></div>`);
  if (ep) rows.push(`<div><strong>EasyPaisa:</strong> <span style="font-size:15px;">${esc(ep)}</span></div>`);
  if (bankAcct) {
    rows.push(`<div><strong>Bank:</strong> ${esc(bankName || "Bank")} — ${esc(bankTitle || "School Account")}<br>
      <strong>Account:</strong> <span style="font-size:15px;">${esc(bankAcct)}</span></div>`);
  }

  return `
    <div style="border:2px dashed #0ea5e9; border-radius:10px; padding:14px 16px; margin:14px 0; background:#f0f9ff;">
      <div style="font-weight:800; font-size:14px; color:#0369a1; margin-bottom:8px;">
        <i class="fa-solid fa-money-bill-transfer"></i> Online Payment
        ${amount ? `<span style="float:right;">${esc(cur)} ${Number(amount).toLocaleString()}</span>` : ""}
      </div>
      <div style="display:grid; gap:6px; font-size:13px; color:#0c4a6e;">
        ${rows.join("")}
      </div>
      <div style="margin-top:10px; font-size:12.5px; color:#334155; border-top:1px solid #bae6fd; padding-top:8px;">
        💡 Payment ke baad <strong>TID (transaction ID)</strong> school ko WhatsApp par bhejein taake aapki fee foran verify ho jaye.
        ${instr ? `<br>${esc(instr)}` : ""}
      </div>
    </div>
  `;
}

/**
 * Build a new online-payment verification record (status "pending").
 * Saved into STORES.ONLINE_PAYMENTS; verified later from the fees view.
 */
export function buildPaymentRecord({ feeId, studentId, studentName, amount, method, tid, senderPhone, date }) {
  const id = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  return {
    id,
    feeId: feeId || null,
    studentId: studentId || null,
    studentName: studentName || "",
    amount: Number(amount || 0),
    method: method || "jazzcash",
    tid: (tid || "").trim(),
    senderPhone: (senderPhone || "").trim(),
    date: date || now.split("T")[0],
    status: "pending",
    createdAt: now
  };
}

/** Human label for a method id. */
export function methodLabel(id) {
  const m = PAYMENT_METHODS.find(x => x.id === id);
  return m ? m.label : id;
}
