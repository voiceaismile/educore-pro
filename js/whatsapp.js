/**
 * =========================================================================
 * 📲 EDUCORE PRO v2.0 — WhatsApp Integration Module
 * Fee reminders, defaulter nudges & result-card sharing via wa.me links.
 * Works fully offline — opens WhatsApp with a pre-filled message.
 * =========================================================================
 */

/**
 * Normalize a Pakistani mobile number to international format (no +).
 * 0300-1234567 / 03001234567 -> 923001234567
 */
export function normalizePakPhone(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, "");
  if (d.startsWith("92") && d.length === 12) return d;
  if (d.startsWith("0") && d.length === 11) return "92" + d.slice(1);
  if (d.length === 10) return "92" + d; // missing leading 0
  return d.length >= 10 ? d : null;
}

/** Build a wa.me deep link with pre-filled text. */
export function waLink(phone, message) {
  const to = normalizePakPhone(phone);
  if (!to) return null;
  return `https://wa.me/${to}?text=${encodeURIComponent(message)}`;
}

/** Days overdue for a due-date string (YYYY-MM-DD). */
export function daysOverdue(dueDate) {
  if (!dueDate) return 0;
  const diff = Date.now() - new Date(dueDate + "T00:00:00").getTime();
  return Math.max(0, Math.floor(diff / 86400000));
}

function schoolNameOf(config) {
  return (config && (config.schoolName || config.instituteName)) || "School";
}

/**
 * Fee reminder message (Roman Urdu + English mix, polite parent tone).
 */
export function feeReminderMessage(studentName, fee, config, reminderNo = 1) {
  const school = schoolNameOf(config);
  const cur = (config && config.currency) || "Rs";
  const amount = Number(fee.amount || 0).toLocaleString();
  const due = fee.dueDate || "";
  const name = studentName || fee.studentName || "Student";

  const greetings = {
    1: "Assalam-o-Alaikum!",
    2: "Assalam-o-Alaikum! (Reminder 2)",
    3: "Assalam-o-Alaikum! (Aakhri Reminder)",
  };
  const g = greetings[Math.min(reminderNo, 3)];

  return (
    `${g}\n\n` +
    `${school} ki taraf se ittila: ${name} ki *${fee.type || "fee"}* ` +
    `(${cur} ${amount}) ki aakhri tareekh *${due}* thi/guzaar chuki hai.\n\n` +
    `Barah-e-karam jald ada kar dein taake bachay ki parhai mutasir na ho. ` +
    `Raseed hasil karne ke liye school office tashreef layein.\n\n` +
    `Shukriya!\n${school}`
  );
}

/**
 * Result-card share message for a grade record.
 */
export function resultShareMessage(studentName, grade, config) {
  const school = schoolNameOf(config);
  const name = studentName || grade.studentName || "Student";
  const obt = grade.marksObtained ?? grade.obtainedMarks;
  const tot = grade.maxMarks ?? grade.totalMarks;
  const score = (obt != null && tot != null) ? `${obt}/${tot} marks` : "";
  const pct = grade.percentage != null ? ` (${grade.percentage}%)` : "";
  return (
    `Assalam-o-Alaikum!\n\n` +
    `*${school}* — ${name} ka *${grade.examName || "exam"}* result:\n` +
    `📊 ${score}${pct}\n` +
    `🏅 Grade: *${grade.grade || "-"}*\n\n` +
    `Tafseeli report card ke liye school office se rabta karein.\nShukriya!\n${school}`
  );
}

/**
 * Bulk defaulter summary for the "copy all" action.
 */
export function defaulterSummaryText(defaulters, config) {
  const school = schoolNameOf(config);
  const cur = (config && config.currency) || "Rs";
  const total = defaulters.reduce((s, f) => s + Number(f.amount || 0), 0);
  const lines = defaulters.map(
    (f, i) =>
      `${i + 1}. ${f.studentName} — ${cur} ${Number(f.amount).toLocaleString()} (due ${f.dueDate})`
  );
  return (
    `*${school}* — Fee Defaulters Report\n` +
    `Total pending: ${cur} ${total.toLocaleString()} (${defaulters.length} invoices)\n\n` +
    lines.join("\n")
  );
}
