# EDUCORE PRO v2.0 (v3.6.0) — WhatsApp Upgrade — 2026-10-20

## New features
1. **WhatsApp Fee Reminders** — har pending invoice par WhatsApp button;
   parent ke number par pre-filled polite reminder (Roman Urdu) khulta hai.
2. **Defaulter Dashboard** — Fee Management me pending/overdue summary card +
   "Remind All Defaulters" button: ek modal me sab defaulters, har ek ke liye
   alag WhatsApp Remind button + copy-able summary report.
3. **WhatsApp Result Sharing** — Exams & Grades me har result par WhatsApp
   button; parent ko result summary message bhejein.

## Technical
- New module `js/whatsapp.js` (ES module): Pakistani number normalization
  (03xx -> 92xx), wa.me link builder, message templates.
- Offline-first: koi API key ya paid service nahi — wa.me deep links.
- `db.getById` se student ka parent phone uthaya jata hai.

## Files changed
- js/whatsapp.js (new)
- js/app.js (import + fees view + grades view + event bindings)
- package.json (3.5.0 -> 3.6.0)
