/**
 * =========================================================================
 * ⏫ EDUCORE PRO — Fee Reminder Auto-Escalation Tiers
 * =========================================================================
 * Automatic escalation ladder for overdue fee reminders:
 *   Level 1 "Gentle Reminder"  — 1+ day overdue   (polite)
 *   Level 2 "Firm Reminder"    — 7+ days overdue  (firm, late-fee warning)
 *   Level 3 "Final Notice"     — 15+ days overdue (strict, consequences)
 *
 * DESIGN NOTE (no schema migration): reminder history is stored ON the fee
 * record itself (`fee.reminderLog` — array of log entries). This avoids an
 * IndexedDB version bump. Callers persist with `db.update(STORES.FEES, fee)`.
 * Pure helpers + view HTML — no direct DOM access except in bind functions.
 * =========================================================================
 */

import { daysOverdue, waLink } from "./whatsapp.js";
import { db, STORES } from "./db.js";

/**
 * Escalation ladder. `daysAfterDue` = overdue days at which the tier kicks in.
 */
export const ESCALATION_TIERS = [
  {
    level: 1,
    label: "Gentle Reminder",
    daysAfterDue: 1,
    tone: "polite",
    color: "#0ea5e9",
    badge: "badge-info",
    icon: "fa-bell",
    hint: "Pehli yaad-dihani — naram lehjay me."
  },
  {
    level: 2,
    label: "Firm Reminder",
    daysAfterDue: 7,
    tone: "firm",
    color: "#f59e0b",
    badge: "badge-warning",
    icon: "fa-triangle-exclamation",
    hint: "Sakht reminder — late fee ka zikr."
  },
  {
    level: 3,
    label: "Final Notice",
    daysAfterDue: 15,
    tone: "strict",
    color: "#ef4444",
    badge: "badge-danger",
    icon: "fa-circle-exclamation",
    hint: "Aakhri notice — consequences ke sath."
  }
];

/** Tier definition for a level (1–3), or null. */
export function tierForLevel(level) {
  return ESCALATION_TIERS.find(t => t.level === Number(level)) || null;
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function schoolNameOf(config) {
  return (config && (config.schoolName || config.instituteName)) || "School";
}

function curOf(config) {
  return (config && config.currency) || "Rs";
}

/**
 * Inline copy of the online-payment footer (duplicated from whatsapp.js on
 * purpose to avoid a circular import between modules).
 */
function paymentInfoLine(config) {
  try {
    const pay = (config && config.payments) || {};
    const jc = (pay.jazzcashNumber || "").trim();
    const ep = (pay.easypaisaNumber || "").trim();
    if (!jc && !ep) return "";
    const parts = [];
    if (jc) parts.push(`JazzCash ${jc}`);
    if (ep) parts.push(`EasyPaisa ${ep}`);
    return `\n\n💳 Online payment: ${parts.join(" / ")}\nPayment ke baad TID WhatsApp par bhejein.`;
  } catch (e) {
    return "";
  }
}

/**
 * Current escalation level for a fee invoice.
 *
 * @param {object} fee - fee record ({ dueDate, status, reminderLog? })
 * @param {Array} [reminderLog] - overrides fee.reminderLog when provided
 * @returns {{ level:number, days:number, lastLevel:number, lastSentAt:string|null, dueForSend:boolean, tier:object|null }}
 *   level 0 = not overdue / already paid (no reminder needed).
 *   dueForSend = true when the fee has reached a HIGHER tier than ever sent.
 */
export function getEscalationLevel(fee, reminderLog) {
  const log = Array.isArray(reminderLog) ? reminderLog : (Array.isArray(fee.reminderLog) ? fee.reminderLog : []);
  const days = daysOverdue(fee.dueDate);

  if ((fee.status || "").toLowerCase() === "paid" || days <= 0) {
    return { level: 0, days, lastLevel: 0, lastSentAt: null, dueForSend: false, tier: null };
  }

  let level = 1;
  for (const t of ESCALATION_TIERS) {
    if (days >= t.daysAfterDue) level = t.level;
  }

  const sentLevels = log.map(e => Number(e.level || 0));
  const lastLevel = sentLevels.length ? Math.max(...sentLevels) : 0;
  const lastEntry = [...log].reverse().find(e => Number(e.level) === lastLevel) || null;

  return {
    level,
    days,
    lastLevel,
    lastSentAt: lastEntry ? (lastEntry.sentAt || lastEntry.date || null) : null,
    dueForSend: level > lastLevel,
    tier: tierForLevel(level)
  };
}

/**
 * Tier-appropriate reminder message (Roman Urdu + English, WhatsApp markdown).
 * Level 1 reuses the polite whatsapp.js template; 2 and 3 escalate the tone.
 *
 * @param {string} studentName
 * @param {object} fee - { type, amount, dueDate, studentName }
 * @param {object} config - app config
 * @param {number} level - 1, 2 or 3
 */
export function escalatedMessage(studentName, fee, config, level) {
  const school = schoolNameOf(config);
  const cur = curOf(config);
  const amount = Number(fee.amount || 0).toLocaleString();
  const due = fee.dueDate || "";
  const name = studentName || fee.studentName || "Student";
  const feeType = fee.type || "fee";
  const payLine = paymentInfoLine(config);

  if (Number(level) <= 1) {
    return (
      `Assalam-o-Alaikum!\n\n` +
      `*${school}* — Gentle Reminder:\n` +
      `${name} ki *${feeType}* (${cur} ${amount}) ki aakhri tareekh *${due}* thi. ` +
      `Barah-e-karam jald ada kar dein taake bachay ki parhai mutasir na ho.\n\n` +
      `Shukriya!\n${school}${payLine}`
    );
  }

  if (Number(level) === 2) {
    return (
      `Assalam-o-Alaikum!\n\n` +
      `*${school}* — *Firm Reminder (2nd Notice):*\n` +
      `${name} ki *${feeType}* (${cur} ${amount}, due *${due}*) abhi tak ada nahi hui. ` +
      `School policy ke mutabiq *late fee* lag sakti hai.\n\n` +
      `Barah-e-karam *3 din ke andar* fee jama karwa dein. ` +
      `Koi masla ho to school office se rabta karein.\n\n` +
      `${school}${payLine}`
    );
  }

  // Level 3 — Final Notice
  return (
    `Assalam-o-Alaikum!\n\n` +
    `*${school}* — ⛔ *FINAL NOTICE*\n` +
    `${name} ki *${feeType}* (${cur} ${amount}, due *${due}*) musalsal ada nahi hui. ` +
    `Yeh *aakhri notice* hai.\n\n` +
    `*48 ghanton* me fee ada na hui to bachay ka *dakhla muattal (suspend)* kiya ja sakta hai ` +
    `aur late fee bhi charge hogi.\n\n` +
    `Foran school office tashreef layein.\n${school}${payLine}`
  );
}

/**
 * Build a reminder-log entry. Persist by appending to `fee.reminderLog`
 * and saving the fee (see `appendReminderLog`).
 *
 * @param {{feeId:string, studentId?:string, level:number, channel:'whatsapp'|'sms'}} opts
 */
export function buildReminderLog({ feeId, studentId, level, channel }) {
  const id = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `rlog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date();
  return {
    id,
    feeId: feeId || null,
    studentId: studentId || null,
    level: Number(level) || 1,
    channel: channel === "sms" ? "sms" : "whatsapp",
    date: now.toISOString().split("T")[0],
    sentAt: now.toISOString()
  };
}

/**
 * Append a log entry to a fee's `reminderLog` array (in-memory).
 * Caller must persist: `await db.update(STORES.FEES, fee)`.
 *
 * @param {object} fee - fee record (mutated)
 * @param {object} entry - from buildReminderLog()
 * @returns {object} the same fee (chainable)
 */
export function appendReminderLog(fee, entry) {
  if (!Array.isArray(fee.reminderLog)) fee.reminderLog = [];
  fee.reminderLog.push(entry);
  return fee;
}

/**
 * Aggregate overdue fees by escalation tier.
 *
 * @param {Array} fees - fee records
 * @returns {{ perTier: {1:{count,amount},2:{...},3:{...}}, total:number, totalAmount:number }}
 */
export function summarizeEscalation(fees) {
  const perTier = {
    1: { count: 0, amount: 0 },
    2: { count: 0, amount: 0 },
    3: { count: 0, amount: 0 }
  };
  let total = 0;
  let totalAmount = 0;
  for (const f of fees || []) {
    const { level } = getEscalationLevel(f);
    if (level > 0) {
      perTier[level].count += 1;
      perTier[level].amount += Number(f.amount || 0);
      total += 1;
      totalAmount += Number(f.amount || 0);
    }
  }
  return { perTier, total, totalAmount };
}

/**
 * Escalation dashboard HTML: per-tier summary cards + actionable fee list.
 * Each row carries a "Send" button that opens the level-appropriate
 * WhatsApp message; the click handler (bindEscalationEvents) logs the send.
 *
 * @param {object} app - EduCoreApp instance (uses app.config)
 * @returns {Promise<string>} HTML
 */
export async function renderEscalationDashboard(app) {
  const config = app.config || {};
  const cur = curOf(config);
  const fees = await db.getAll(STORES.FEES);
  const students = await db.getAll(STORES.STUDENTS);
  const studentMap = {};
  students.forEach(s => { studentMap[s.id] = s; });

  const summary = summarizeEscalation(fees);

  const rows = [];
  for (const f of fees) {
    const esc2 = getEscalationLevel(f);
    if (esc2.level === 0) continue;
    const tier = esc2.tier;
    const student = studentMap[f.studentId];
    const phone = student ? (student.phone || student.parentPhone) : (f.parentPhone || null);
    const msg = escalatedMessage(f.studentName, f, config, esc2.level);
    const link = phone ? waLink(phone, msg) : null;
    rows.push({ f, esc: esc2, tier, phone, link });
  }
  // Highest tier first, then most overdue
  rows.sort((a, b) => (b.esc.level - a.esc.level) || (b.esc.days - a.esc.days));

  const cards = ESCALATION_TIERS.map(t => {
    const s = summary.perTier[t.level];
    return `
      <div class="card" style="border-left:4px solid ${t.color}; flex:1; min-width:200px;">
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
          <span style="background:${t.color}22; color:${t.color}; width:36px; height:36px; border-radius:10px; display:inline-flex; align-items:center; justify-content:center;">
            <i class="fa-solid ${t.icon}"></i>
          </span>
          <div>
            <div style="font-weight:800;">${t.label}</div>
            <div style="font-size:12px; color:var(--text-dim, #64748b);">${t.hint}</div>
          </div>
        </div>
        <div style="font-size:22px; font-weight:800;">${s.count}</div>
        <div style="font-size:13px; color:var(--text-dim, #64748b);">${cur} ${s.amount.toLocaleString()} outstanding</div>
      </div>`;
  }).join("");

  const body = rows.length ? rows.map(({ f, esc, tier, phone, link }) => `
    <tr>
      <td><strong>${esc(f.studentName)}</strong>
        <div style="font-size:11px; color:var(--text-dim, #64748b);">${esc(f.receiptNo || "")}</div></td>
      <td>${esc(f.type || "fee")}</td>
      <td><strong>${cur} ${Number(f.amount || 0).toLocaleString()}</strong></td>
      <td>${esc(f.dueDate || "—")}<div style="font-size:11px; color:#ef4444;">${esc.days} din overdue</div></td>
      <td><span class="badge ${tier.badge}"><i class="fa-solid ${tier.icon}"></i> Level ${tier.level}</span>
        ${esc.dueForSend
          ? `<div style="font-size:11px; color:#f59e0b; margin-top:2px;">Naya tier — bhejna baqi</div>`
          : `<div style="font-size:11px; color:var(--text-dim, #64748b); margin-top:2px;">Level ${esc.lastLevel} bheja ja chuka</div>`}
      </td>
      <td style="text-align:right; white-space:nowrap;">
        ${link
          ? `<a class="btn btn-success btn-sm btn-log-escalation" target="_blank" rel="noopener" href="${link}"
               data-fee-id="${esc(f.id)}" data-level="${esc.level}" data-student-id="${esc(f.studentId || "")}">
               <i class="fa-brands fa-whatsapp"></i> Send L${esc.level}</a>`
          : `<span class="badge badge-warning" title="Parent ka number mojood nahi">No number</span>`}
      </td>
    </tr>`).join("")
    : `<tr><td colspan="6" style="text-align:center; padding:24px; color:var(--text-dim, #64748b);">
         <i class="fa-solid fa-circle-check" style="font-size:24px; color:#10b981;"></i><br>
         Koi overdue fee nahi — sab clear hai! 🎉</td></tr>`;

  return `
    <div class="page-header">
      <div class="page-title-group">
        <h1><i class="fa-solid fa-arrow-trend-up" style="color:#f59e0b;"></i> Reminder Escalation</h1>
        <p>Overdue fees khud-ba-khud tier me bat jati hain — har tier ka apna lehja. Total <strong>${summary.total}</strong> overdue (${cur} ${summary.totalAmount.toLocaleString()}).</p>
      </div>
    </div>

    <div style="display:flex; gap:14px; flex-wrap:wrap; margin-bottom:16px;">
      ${cards}
    </div>

    <div class="card">
      <div class="table-container">
        <table class="custom-table">
          <thead>
            <tr>
              <th>Student</th><th>Fee</th><th>Amount</th><th>Due / Overdue</th><th>Escalation Tier</th>
              <th style="text-align:right;">Action</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <div style="font-size:12px; color:var(--text-dim, #64748b); margin-top:10px;">
        <i class="fa-solid fa-circle-info"></i> "Send" dabane par WhatsApp khulega aur bhejna log me save ho jayega (fee record par),
        taake agli baar sahi tier ka reminder jaye.
      </div>
    </div>`;
}

/**
 * Wire up the dashboard: log every sent reminder onto the fee record.
 * Should be called after injecting renderEscalationDashboard() HTML.
 *
 * @param {object} app - EduCoreApp instance (uses app.showToast)
 */
export function bindEscalationEvents(app) {
  document.querySelectorAll(".btn-log-escalation").forEach(btn => {
    btn.addEventListener("click", async () => {
      const feeId = btn.getAttribute("data-fee-id");
      const level = Number(btn.getAttribute("data-level") || 1);
      const studentId = btn.getAttribute("data-student-id") || null;
      try {
        const fee = await db.getById(STORES.FEES, feeId);
        if (fee) {
          appendReminderLog(fee, buildReminderLog({ feeId, studentId, level, channel: "whatsapp" }));
          await db.update(STORES.FEES, fee);
          app.showToast(`Level ${level} reminder log ho gaya.`, "success");
        }
      } catch (e) {
        console.warn("Escalation log failed:", e);
      }
    });
  });
}
