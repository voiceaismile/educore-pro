/**
 * =========================================================================
 * 📚 EDUCORE PRO — Daily Homework Broadcast
 * =========================================================================
 * Roz ka homework ek dafa likho, poori class ke parents ko WhatsApp par
 * bhejo. HONEST MODEL: wa.me links sirf INDIVIDUAL numbers par khulte hain
 * (group broadcast supported nahi), is liye module teen raste deta hai:
 *   1. "Copy text" — message copy karke class WhatsApp group me paste karein
 *   2. Class group link — school apne class group ka invite link save kare
 *   3. Per-parent buttons — har bachay ke parent ko alag WhatsApp message
 *
 * Homework history localStorage me save hoti hai (koi DB migration nahi):
 * key "educore_homework_log" — array of records, newest first.
 * Pure helpers + view HTML — no direct DOM except in bind functions.
 * =========================================================================
 */

import { waLink, normalizePakPhone } from "./whatsapp.js";
import { db, STORES } from "./db.js";

const HW_LOG_KEY = "educore_homework_log";
const HW_GROUP_KEY = "educore_homework_groups"; // { [classId]: groupInviteLink }

/** School name helper (matches whatsapp.js style). */
function schoolNameOf(config) {
  return (config && (config.schoolName || config.instituteName)) || "School";
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

/**
 * Build a homework record.
 *
 * @param {{classId:string, className:string, date?:string, subjects:Array<{subject:string, task:string}>, notes?:string}} opts
 * @returns {{id:string, classId:string, className:string, date:string, subjects:Array, notes:string, createdAt:string}}
 */
export function buildHomeworkRecord({ classId, className, date, subjects, notes }) {
  const id = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `hw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const cleanSubjects = (subjects || [])
    .map(s => ({ subject: String(s.subject || "").trim(), task: String(s.task || "").trim() }))
    .filter(s => s.subject || s.task);
  return {
    id,
    classId: classId || "",
    className: className || "",
    date: date || todayStr(),
    subjects: cleanSubjects,
    notes: String(notes || "").trim(),
    createdAt: new Date().toISOString()
  };
}

/**
 * WhatsApp-formatted homework broadcast message (Roman Urdu + English mix).
 *
 * @param {object} homework - from buildHomeworkRecord()
 * @param {object} config
 * @returns {string}
 */
export function homeworkBroadcastMessage(homework, config) {
  const school = schoolNameOf(config);
  const lines = [];
  lines.push(`Assalam-o-Alaikum!`);
  lines.push(``);
  lines.push(`*${school}* — 📚 *Homework*`);
  lines.push(`Class: *${homework.className || "-"}* | Date: *${homework.date || "-"}*`);
  lines.push(``);
  for (const s of homework.subjects || []) {
    const subj = s.subject || "General";
    lines.push(`📖 *${subj}:* ${s.task || "-"}`);
  }
  if ((homework.notes || "").trim()) {
    lines.push(``);
    lines.push(`📝 *Note:* ${homework.notes.trim()}`);
  }
  lines.push(``);
  lines.push(`Bachay se homework mukammal karwa kar school bhejein. Shukriya!`);
  return lines.join("\n");
}

/** Read homework history (newest first). */
export function getHomeworkHistory() {
  try {
    const raw = localStorage.getItem(HW_LOG_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

/** Save (prepend) a homework record to history. Keeps last 200. */
export function saveHomeworkRecord(record) {
  const hist = getHomeworkHistory().filter(h => h.id !== record.id);
  hist.unshift(record);
  try {
    localStorage.setItem(HW_LOG_KEY, JSON.stringify(hist.slice(0, 200)));
  } catch (e) {}
  return hist;
}

/** Remember a class WhatsApp group invite link. */
export function saveClassGroupLink(classId, link) {
  try {
    const all = JSON.parse(localStorage.getItem(HW_GROUP_KEY) || "{}");
    if (link && link.trim()) all[classId] = link.trim();
    else delete all[classId];
    localStorage.setItem(HW_GROUP_KEY, JSON.stringify(all));
  } catch (e) {}
}

/** Get saved group invite link for a class (or ""). */
export function getClassGroupLink(classId) {
  try {
    const all = JSON.parse(localStorage.getItem(HW_GROUP_KEY) || "{}");
    return all[classId] || "";
  } catch (e) {
    return "";
  }
}

/**
 * Homework composer + history view HTML.
 *
 * @param {object} app - EduCoreApp instance (uses app.config)
 * @returns {Promise<string>} HTML
 */
export async function renderHomeworkView(app) {
  const classes = await db.getAll(STORES.CLASSES);
  const history = getHomeworkHistory();

  const classOpts = classes.length
    ? classes.map(c => `<option value="${esc(c.id)}">${esc(c.name)}${c.section ? " - " + esc(c.section) : ""}</option>`).join("")
    : `<option value="">(Koi class nahi mili — pehle Classes me add karein)</option>`;

  const histRows = history.length ? history.map(h => `
    <tr>
      <td>${esc(h.date || "—")}</td>
      <td><strong>${esc(h.className || "—")}</strong></td>
      <td>${(h.subjects || []).map(s => `<span class="badge badge-info" style="margin:1px 2px;">${esc(s.subject || "General")}</span>`).join("")}</td>
      <td style="text-align:right; white-space:nowrap;">
        <button class="btn btn-secondary btn-sm btn-hw-reuse" data-hw-id="${esc(h.id)}">
          <i class="fa-solid fa-rotate-left"></i> Dobara
        </button>
        <button class="btn btn-success btn-sm btn-hw-resend" data-hw-id="${esc(h.id)}">
          <i class="fa-brands fa-whatsapp"></i> Bhejein
        </button>
      </td>
    </tr>`).join("")
    : `<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-dim, #64748b);">Abhi koi homework save nahi hua.</td></tr>`;

  return `
    <div class="page-header">
      <div class="page-title-group">
        <h1><i class="fa-solid fa-book-open" style="color:#8b5cf6;"></i> Daily Homework</h1>
        <p>Roz ka homework ek dafa likhein — poori class ke parents ko WhatsApp par broadcast karein.</p>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <h3 class="card-title"><i class="fa-solid fa-pen-to-square"></i> Aaj ka Homework Likhein</h3>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Class</label>
          <select class="form-control" id="hwClass">${classOpts}</select>
        </div>
        <div class="form-group">
          <label class="form-label">Date</label>
          <input type="date" class="form-control" id="hwDate" value="${todayStr()}">
        </div>
      </div>

      <label class="form-label">Subjects & Tasks</label>
      <div id="hwSubjectRows" style="display:grid; gap:8px; margin-bottom:8px;">
        <div class="hw-subject-row" style="display:flex; gap:8px;">
          <input type="text" class="form-control hw-subject" placeholder="Subject (e.g. Mathematics)" style="max-width:180px;">
          <input type="text" class="form-control hw-task" placeholder="Task (e.g. Page 45, Q1–5)">
          <button type="button" class="btn btn-danger btn-sm hw-remove-row" title="Remove">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" id="hwAddRow" style="margin-bottom:12px;">
        <i class="fa-solid fa-plus"></i> Subject add karein
      </button>

      <div class="form-group">
        <label class="form-label">Note (optional)</label>
        <textarea class="form-control" id="hwNotes" rows="2" placeholder="e.g. Kal test hai — tayari kar ke aayein"></textarea>
      </div>

      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
        <button type="button" class="btn btn-primary" id="hwSave">
          <i class="fa-solid fa-floppy-disk"></i> Save
        </button>
        <button type="button" class="btn btn-success" id="hwPreviewBroadcast">
          <i class="fa-brands fa-whatsapp"></i> Preview & Broadcast
        </button>
      </div>
    </div>

    <div class="card" id="hwBroadcastPanel" style="display:none; margin-bottom:16px; border-left:4px solid #10b981;">
      <h3 class="card-title"><i class="fa-brands fa-whatsapp" style="color:#10b981;"></i> Broadcast</h3>
      <pre id="hwPreviewText" style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px;
           padding:12px 14px; font-size:13px; white-space:pre-wrap; font-family:inherit;"></pre>
      <div class="form-row" style="margin-top:10px;">
        <div class="form-group">
          <label class="form-label">Class WhatsApp group link (optional)</label>
          <input type="text" class="form-control" id="hwGroupLink" placeholder="https://chat.whatsapp.com/...">
          <small class="form-hint">Ek dafa save karein — agli baar yaad rahega</small>
        </div>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button type="button" class="btn btn-secondary btn-sm" id="hwCopyText">
          <i class="fa-solid fa-copy"></i> Copy text
        </button>
        <button type="button" class="btn btn-success btn-sm" id="hwOpenGroup">
          <i class="fa-solid fa-users"></i> Group kholein
        </button>
      </div>
      <div style="margin-top:12px;">
        <label class="form-label">Ya har parent ko alag bhejein:</label>
        <div id="hwParentButtons" style="display:flex; gap:6px; flex-wrap:wrap;"></div>
      </div>
    </div>

    <div class="card">
      <h3 class="card-title"><i class="fa-solid fa-clock-rotate-left"></i> History</h3>
      <div class="table-container">
        <table class="custom-table">
          <thead><tr><th>Date</th><th>Class</th><th>Subjects</th><th style="text-align:right;">Action</th></tr></thead>
          <tbody>${histRows}</tbody>
        </table>
      </div>
    </div>`;
}

/** Blank subject/task row HTML (used by bindHomeworkEvents). */
export function homeworkRowHTML() {
  return `
    <div class="hw-subject-row" style="display:flex; gap:8px;">
      <input type="text" class="form-control hw-subject" placeholder="Subject (e.g. Mathematics)" style="max-width:180px;">
      <input type="text" class="form-control hw-task" placeholder="Task (e.g. Page 45, Q1–5)">
      <button type="button" class="btn btn-danger btn-sm hw-remove-row" title="Remove">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>`;
}

/**
 * Collect the composer form into a homework record (not yet saved).
 * @returns {object|null} record, or null if class/subjects missing
 */
export function collectHomeworkForm() {
  const classSel = document.getElementById("hwClass");
  const dateEl = document.getElementById("hwDate");
  const notesEl = document.getElementById("hwNotes");
  if (!classSel || !classSel.value) return null;

  const className = classSel.options[classSel.selectedIndex]?.textContent?.trim() || "";
  const subjects = [...document.querySelectorAll("#hwSubjectRows .hw-subject-row")].map(row => ({
    subject: row.querySelector(".hw-subject")?.value || "",
    task: row.querySelector(".hw-task")?.value || ""
  })).filter(s => s.subject.trim() || s.task.trim());

  if (!subjects.length) return null;

  return buildHomeworkRecord({
    classId: classSel.value,
    className,
    date: dateEl?.value || todayStr(),
    subjects,
    notes: notesEl?.value || ""
  });
}

/**
 * Wire up the homework view: rows, save, preview/broadcast, history actions.
 *
 * @param {object} app - EduCoreApp instance (uses app.config, app.showToast)
 */
export function bindHomeworkEvents(app) {
  const rowsBox = document.getElementById("hwSubjectRows");

  document.getElementById("hwAddRow")?.addEventListener("click", () => {
    rowsBox?.insertAdjacentHTML("beforeend", homeworkRowHTML());
  });

  rowsBox?.addEventListener("click", (e) => {
    const btn = e.target.closest(".hw-remove-row");
    if (!btn) return;
    const rows = rowsBox.querySelectorAll(".hw-subject-row");
    if (rows.length <= 1) {
      btn.closest(".hw-subject-row").querySelectorAll("input").forEach(i => { i.value = ""; });
      return;
    }
    btn.closest(".hw-subject-row")?.remove();
  });

  const showPreview = async (record) => {
    const panel = document.getElementById("hwBroadcastPanel");
    const preview = document.getElementById("hwPreviewText");
    if (!panel || !preview || !record) return;

    const msg = homeworkBroadcastMessage(record, app.config);
    preview.textContent = msg;
    panel.style.display = "block";
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });

    // Remember group link per class
    const groupInput = document.getElementById("hwGroupLink");
    if (groupInput) {
      groupInput.value = getClassGroupLink(record.classId);
      groupInput.onchange = () => saveClassGroupLink(record.classId, groupInput.value);
    }

    document.getElementById("hwCopyText").onclick = async () => {
      try {
        await navigator.clipboard.writeText(msg);
        app.showToast("Homework text copy ho gaya — group me paste karein.", "success");
      } catch (e) {
        app.showToast("Copy nahi ho saka — text select karke manually copy karein.", "warning");
      }
    };

    document.getElementById("hwOpenGroup").onclick = () => {
      const link = (groupInput?.value || "").trim();
      if (!link) {
        app.showToast("Pehle class ka WhatsApp group link dalein.", "warning");
        return;
      }
      saveClassGroupLink(record.classId, link);
      window.open(link, "_blank", "noopener");
    };

    // Per-parent WhatsApp buttons
    const btnBox = document.getElementById("hwParentButtons");
    btnBox.innerHTML = `<span style="font-size:12px; color:var(--text-dim,#64748b);">Load ho raha hai...</span>`;
    try {
      const students = (await db.getAll(STORES.STUDENTS))
        .filter(s => String(s.classId) === String(record.classId));
      if (!students.length) {
        btnBox.innerHTML = `<span style="font-size:12px; color:var(--text-dim,#64748b);">Is class me koi student nahi mila.</span>`;
        return;
      }
      btnBox.innerHTML = "";
      for (const s of students) {
        const phone = s.phone || s.parentPhone;
        const to = normalizePakPhone(phone);
        const b = document.createElement(to ? "a" : "span");
        b.className = to ? "btn btn-success btn-sm" : "btn btn-secondary btn-sm";
        b.style.margin = "2px";
        b.innerHTML = `<i class="fa-brands fa-whatsapp"></i> ${esc(s.name || s.studentName || "Student")}`;
        if (to) {
          b.href = waLink(to, msg);
          b.target = "_blank";
          b.rel = "noopener";
          b.title = to;
        } else {
          b.title = "Parent ka number mojood nahi";
          b.style.opacity = "0.55";
        }
        btnBox.appendChild(b);
      }
    } catch (e) {
      btnBox.innerHTML = `<span style="font-size:12px; color:#ef4444;">Students load nahi ho sakay.</span>`;
    }
  };

  document.getElementById("hwSave")?.addEventListener("click", () => {
    const rec = collectHomeworkForm();
    if (!rec) {
      app.showToast("Class aur kam-az-kam ek subject/task zaroor likhein.", "warning");
      return;
    }
    saveHomeworkRecord(rec);
    app.showToast("Homework save ho gaya.", "success");
    // Refresh view to show in history (parent re-renders the view)
    document.dispatchEvent(new CustomEvent("homeworkSaved", { detail: rec }));
  });

  document.getElementById("hwPreviewBroadcast")?.addEventListener("click", async () => {
    const rec = collectHomeworkForm();
    if (!rec) {
      app.showToast("Class aur kam-az-kam ek subject/task zaroor likhein.", "warning");
      return;
    }
    await showPreview(rec);
  });

  // History: reuse (fill form) and resend (preview)
  document.querySelectorAll(".btn-hw-reuse").forEach(btn => {
    btn.addEventListener("click", () => {
      const h = getHomeworkHistory().find(x => x.id === btn.getAttribute("data-hw-id"));
      if (!h) return;
      const classSel = document.getElementById("hwClass");
      if (classSel && h.classId) classSel.value = h.classId;
      const dateEl = document.getElementById("hwDate");
      if (dateEl) dateEl.value = todayStr();
      const notesEl = document.getElementById("hwNotes");
      if (notesEl) notesEl.value = h.notes || "";
      if (rowsBox) {
        rowsBox.innerHTML = "";
        for (const s of (h.subjects?.length ? h.subjects : [{ subject: "", task: "" }])) {
          rowsBox.insertAdjacentHTML("beforeend", homeworkRowHTML());
          const row = rowsBox.lastElementChild;
          row.querySelector(".hw-subject").value = s.subject || "";
          row.querySelector(".hw-task").value = s.task || "";
        }
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
      app.showToast("Purana homework form me bhar diya — date aaj ki kar di hai.", "info");
    });
  });

  document.querySelectorAll(".btn-hw-resend").forEach(btn => {
    btn.addEventListener("click", async () => {
      const h = getHomeworkHistory().find(x => x.id === btn.getAttribute("data-hw-id"));
      if (!h) return;
      await showPreview({ ...h, date: todayStr() });
    });
  });
}
