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

---

# EDUCORE PRO v2.1 (v3.7.0) — Online Fee Collection — 2026-10-20

## Honest model
Koi real JazzCash/EasyPaisa API integration nahi (uske liye merchant credentials + backend chahiye).
Asli workflow: parent fee school ke JazzCash/EasyPaisa number par bhejta hai -> TID
(transaction ID) school ko share karta hai -> admin app me verify karta hai -> invoice PAID.

## New features
1. **Payment Settings (Settings > Online Fee Collection)** — school apne JazzCash number,
   EasyPaisa number, bank name / account title / account number aur extra instructions save kare.
2. **Record Online Payment** — har pending invoice par "Online" button: method select
   (JazzCash / EasyPaisa / Bank), TID, sender phone, date -> "Pending Verification" queue me jata hai.
3. **Verification Queue** — Fee Management me "Pending Online Payment Verifications" card:
   Verify -> payment "verified", invoice PAID (method + TID ke saath); Reject -> "rejected".
4. **Challan me payment instructions** — pending invoice ka receipt/challan print karne par
   "Online Payment" box (numbers + "TID WhatsApp par bhejein" note) print hota hai.
5. **WhatsApp reminders me payment info** — fee reminder message me ab JazzCash/EasyPaisa
   numbers auto-append hote hain (jab configured hon).

## Technical
- New module `js/onlinepay.js` (ES module, no DOM): PAYMENT_METHODS, getPaymentSettings,
  hasPaymentSettings, paymentInstructionsHTML, buildPaymentRecord, methodLabel.
- IndexedDB `onlinePayments` store (DB_VERSION 2 -> 3, feeId + status indexes).
- `config.payments` DEFAULT_CONFIG me + getAppConfig merge.
- `feeReminderMessage` me inline payment append (onlinepay.js import nahi — circular import se bachne ke liye).

## Files changed
- js/onlinepay.js (new)
- js/db.js (DB_VERSION 3, ONLINE_PAYMENTS store)
- js/config.js (DEFAULT_CONFIG.payments + getAppConfig merge)
- js/whatsapp.js (feeReminderMessage payment append)
- js/app.js (import + settings tab + payment form + fees view + verification queue + modals + challan print)
- package.json (3.6.0 -> 3.7.0)
