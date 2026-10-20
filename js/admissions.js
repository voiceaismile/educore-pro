/**
 * =========================================================================
 * 📋 EDUCORE PRO v2.2+ — Admission Inquiry Pipeline (Lead Tracking)
 * =========================================================================
 * Kanban-style inquiry funnel for prospective admissions:
 *   new -> contacted -> visited -> admitted | lost
 *
 * STORAGE: reuses the existing IndexedDB STORES.INQUIRIES (created in db.js),
 * so no schema change is required. Records created here carry a `stage`
 * field; records created by the legacy dashboard form are picked up via
 * defensive field mapping (name/phone/className) — see compat helpers.
 *
 * PURE DATA helpers are DOM-free; render/bind functions take the app
 * instance (for app.config, app.showToast, app.refreshCurrentView).
 * =========================================================================
 */

import { db, STORES } from "./db.js";
import { waLink } from "./whatsapp.js";

/** Pipeline stages in funnel order. */
export const INQUIRY_STAGES = ["new", "contacted", "visited", "admitted", "lost"];

/** Human labels for stages. */
export const STAGE_LABELS = {
  new: "New",
  contacted: "Contacted",
  visited: "Visited",
  admitted: "Admitted",
  lost: "Lost"
};

/** Inquiry sources (how the parent heard about the school). */
export const INQUIRY_SOURCES = ["Walk-in", "Phone", "WhatsApp", "Referral", "Banner/Flex", "Facebook", "Other"];

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
/* Compatibility helpers (legacy records use name/phone/className)      */
/* ------------------------------------------------------------------ */

/** Display name regardless of which shape created the record. */
export function inquiryName(inq) {
  return (inq && (inq.studentName || inq.name)) || "—";
}

/** Parent phone regardless of shape. */
export function inquiryPhone(inq) {
  return (inq && (inq.phone || inq.parentPhone)) || "";
}

/** Class applied for, regardless of shape. */
export function inquiryClass(inq) {
  return (inq && (inq.classApplying || inq.className || inq.class)) || "—";
}

/** Current pipeline stage (defaults to "new" for legacy records). */
export function inquiryStage(inq) {
  const s = (inq && inq.stage) || "new";
  return INQUIRY_STAGES.includes(s) ? s : "new";
}

/* ------------------------------------------------------------------ */
/* Pure data helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Build a new inquiry record.
 * @param {object} opts
 * @param {string} opts.studentName
 * @param {string} opts.parentName
 * @param {string} opts.phone
 * @param {string} opts.classApplying
 * @param {string} [opts.source]
 * @param {string} [opts.notes]
 * @param {string} [opts.followUpDate]  YYYY-MM-DD
 * @returns {object} inquiry record ready for db.add(STORES.INQUIRIES, ...)
 */
export function buildInquiry({ studentName, parentName, phone, classApplying, source, notes, followUpDate }) {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  return {
    id: newId("inq"),
    studentName: (studentName || "").trim(),
    name: (studentName || "").trim(), // legacy compat
    parentName: (parentName || "").trim(),
    phone: (phone || "").trim(),
    classApplying: (classApplying || "").trim(),
    className: (classApplying || "").trim(), // legacy compat
    source: source || "Walk-in",
    notes: (notes || "").trim(),
    stage: "new",
    followUpDate: followUpDate || today,
    createdAt: now.toISOString(),
    status: "Active"
  };
}

/** Whole days since the inquiry was created. */
export function daysWaiting(inq) {
  if (!inq || !inq.createdAt) return 0;
  const diff = Date.now() - new Date(inq.createdAt).getTime();
  return Math.max(0, Math.floor(diff / 86400000));
}

/** True when the follow-up date is past and the inquiry is still open. */
export function isFollowUpOverdue(inq, todayStr) {
  const st = inquiryStage(inq);
  if (st === "admitted" || st === "lost") return false;
  const today = todayStr || new Date().toISOString().split("T")[0];
  return (inq.followUpDate || "") < today;
}

/** Open inquiries whose follow-up date has passed. */
export function overdueFollowUps(inquiries) {
  return (inquiries || []).filter(i => isFollowUpOverdue(i));
}

/**
 * Funnel conversion stats.
 * @returns {{total:number, admitted:number, rate:number, byStage:Object}}
 */
export function conversionStats(inquiries) {
  const list = inquiries || [];
  const byStage = {};
  INQUIRY_STAGES.forEach(s => (byStage[s] = 0));
  list.forEach(i => { byStage[inquiryStage(i)]++; });
  const total = list.length;
  const admitted = byStage.admitted;
  return { total, admitted, byStage, rate: total ? Math.round((admitted / total) * 100) : 0 };
}

/** Next stage in the funnel (null when already terminal). */
export function nextStage(stage) {
  const i = INQUIRY_STAGES.indexOf(stage);
  if (i < 0 || stage === "admitted" || stage === "lost") return null;
  return INQUIRY_STAGES[i + 1];
}

/* ------------------------------------------------------------------ */
/* View                                                                 */
/* ------------------------------------------------------------------ */

const STAGE_COLORS = {
  new: "#38bdf8",
  contacted: "#a78bfa",
  visited: "#f59e0b",
  admitted: "#10b981",
  lost: "#64748b"
};

/**
 * Render the admissions pipeline view (kanban columns + add form + stats).
 * @param {object} app  app instance (uses app.config)
 * @returns {Promise<string>} HTML
 */
export async function renderAdmissionsView(app) {
  const inquiries = await db.getAll(STORES.INQUIRIES);
  const stats = conversionStats(inquiries);
  const overdue = overdueFollowUps(inquiries);
  const cur = (app.config && app.config.currency) || "Rs";

  const columns = INQUIRY_STAGES.map(stage => {
    const cards = inquiries.filter(i => inquiryStage(i) === stage);
    return `
      <div class="card" style="min-width:0; border-top:3px solid ${STAGE_COLORS[stage]};">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <strong>${STAGE_LABELS[stage]}</strong>
          <span class="badge" style="background:${STAGE_COLORS[stage]}22; color:${STAGE_COLORS[stage]};">${cards.length}</span>
        </div>
        <div style="display:grid; gap:8px;">
          ${cards.length ? cards.map(inq => {
            const dw = daysWaiting(inq);
            const od = isFollowUpOverdue(inq);
            const wa = inquiryPhone(inq) ? waLink(inquiryPhone(inq),
              `Assalam-o-Alaikum! ${esc(inquiryName(inq))} ke admission inquiry ke silsilay me rabta kar rahe hain. Aap kab tashreef la sakte hain?`) : null;
            return `
              <div class="card" style="padding:10px 12px; margin:0; ${od ? "border-left:3px solid #ef4444;" : ""}">
                <div style="font-weight:700;">${esc(inquiryName(inq))}</div>
                <div style="font-size:12px; color:var(--text-dim);">
                  ${esc(inquiryClass(inq))} · ${dw}d waiting
                  ${inq.parentName ? ` · ${esc(inq.parentName)}` : ""}
                </div>
                ${inq.followUpDate ? `<div style="font-size:12px; ${od ? "color:#ef4444; font-weight:700;" : "color:var(--text-dim);"}">
                  <i class="fa-solid fa-bell"></i> Follow-up: ${esc(inq.followUpDate)}${od ? " (overdue)" : ""}</div>` : ""}
                <div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">
                  ${nextStage(stage) ? `<button class="btn btn-primary btn-sm inq-advance" data-id="${esc(inq.id)}">
                    <i class="fa-solid fa-arrow-right"></i> ${STAGE_LABELS[nextStage(stage)]}</button>` : ""}
                  ${stage !== "lost" ? `<button class="btn btn-secondary btn-sm inq-lost" data-id="${esc(inq.id)}">Lost</button>` : ""}
                  ${wa ? `<a class="btn btn-success btn-sm" href="${wa}" target="_blank" rel="noopener" title="WhatsApp parent">
                    <i class="fa-brands fa-whatsapp"></i></a>` : ""}
                </div>
              </div>`;
          }).join("") : `<div style="font-size:12px; color:var(--text-dim); text-align:center; padding:12px;">—</div>`}
        </div>
      </div>`;
  }).join("");

  return `
    <div class="page-header">
      <div class="page-title-group">
        <h1>Admission Inquiries</h1>
        <p>Lead pipeline: track every prospective admission from first contact to enrollment.</p>
      </div>
      <div class="page-actions-group">
        <button class="btn btn-primary" id="btnAddInquiry"><i class="fa-solid fa-plus"></i> Add Inquiry</button>
      </div>
    </div>

    <div class="card" style="border-left:4px solid #4f46e5; margin-bottom:16px;">
      <div style="display:flex; gap:24px; align-items:center; flex-wrap:wrap; padding:4px 8px;">
        <div><strong>${stats.total}</strong> total inquiries</div>
        <div><strong>${stats.admitted}</strong> admitted</div>
        <div><strong>${stats.rate}%</strong> conversion</div>
        <div style="${overdue.length ? "color:#ef4444; font-weight:700;" : "color:var(--text-dim);"}">
          <i class="fa-solid fa-bell"></i> ${overdue.length} overdue follow-up${overdue.length === 1 ? "" : "s"}
        </div>
      </div>
    </div>

    <div id="inquiryFormWrap" style="display:none; margin-bottom:16px;">
      <div class="card">
        <h3 style="margin-top:0;"><i class="fa-solid fa-user-plus"></i> New Inquiry</h3>
        <form id="formAddInquiry">
          <div class="form-row">
            <div class="form-group"><label class="form-label">Student Name *</label>
              <input class="form-control" id="inqStudentName" required></div>
            <div class="form-group"><label class="form-label">Parent Name</label>
              <input class="form-control" id="inqParentName"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Phone *</label>
              <input class="form-control" id="inqPhone" required placeholder="0300-1234567"></div>
            <div class="form-group"><label class="form-label">Class Applying For *</label>
              <input class="form-control" id="inqClass" required placeholder="Class 5"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Source</label>
              <select class="form-control" id="inqSource">${INQUIRY_SOURCES.map(s => `<option>${s}</option>`).join("")}</select></div>
            <div class="form-group"><label class="form-label">Follow-up Date</label>
              <input type="date" class="form-control" id="inqFollowUp" value="${new Date().toISOString().split("T")[0]}"></div>
          </div>
          <div class="form-group"><label class="form-label">Notes</label>
            <textarea class="form-control" id="inqNotes" rows="2" placeholder="Previous school, siblings, fee concerns..."></textarea></div>
          <div style="display:flex; gap:10px; margin-top:10px;">
            <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> Save Inquiry</button>
            <button type="button" class="btn btn-secondary" id="btnCancelInquiry">Cancel</button>
          </div>
        </form>
      </div>
    </div>

    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:12px; align-items:start;">
      ${columns}
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* Events                                                               */
/* ------------------------------------------------------------------ */

/**
 * Bind events for the admissions view. Call after injecting renderAdmissionsView HTML.
 * @param {object} app app instance (showToast, refreshCurrentView)
 */
export function bindAdmissionsEvents(app) {
  const wrap = document.getElementById("inquiryFormWrap");
  document.getElementById("btnAddInquiry")?.addEventListener("click", () => {
    if (wrap) wrap.style.display = wrap.style.display === "none" ? "block" : "none";
  });
  document.getElementById("btnCancelInquiry")?.addEventListener("click", () => {
    if (wrap) wrap.style.display = "none";
  });

  document.getElementById("formAddInquiry")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const rec = buildInquiry({
      studentName: document.getElementById("inqStudentName").value,
      parentName: document.getElementById("inqParentName").value,
      phone: document.getElementById("inqPhone").value,
      classApplying: document.getElementById("inqClass").value,
      source: document.getElementById("inqSource").value,
      notes: document.getElementById("inqNotes").value,
      followUpDate: document.getElementById("inqFollowUp").value
    });
    if (!rec.studentName || !rec.phone || !rec.classApplying) {
      app.showToast("Student name, phone and class are required.", "error");
      return;
    }
    await db.add(STORES.INQUIRIES, rec);
    app.showToast("Inquiry saved to pipeline.", "success");
    app.refreshCurrentView();
  });

  document.querySelectorAll(".inq-advance").forEach(btn => {
    btn.addEventListener("click", async () => {
      const inq = await db.getById(STORES.INQUIRIES, btn.getAttribute("data-id"));
      if (!inq) return;
      const ns = nextStage(inquiryStage(inq));
      if (!ns) return;
      inq.stage = ns;
      inq.followUpDate = new Date(Date.now() + 2 * 86400000).toISOString().split("T")[0];
      await db.update(STORES.INQUIRIES, inq);
      app.showToast(`Moved to "${STAGE_LABELS[ns]}".`, "success");
      app.refreshCurrentView();
    });
  });

  document.querySelectorAll(".inq-lost").forEach(btn => {
    btn.addEventListener("click", async () => {
      const inq = await db.getById(STORES.INQUIRIES, btn.getAttribute("data-id"));
      if (!inq) return;
      inq.stage = "lost";
      await db.update(STORES.INQUIRIES, inq);
      app.showToast("Marked as lost.", "info");
      app.refreshCurrentView();
    });
  });
}
