/**
 * =========================================================================
 * 💸 EDUCORE PRO v2.3 — School Expense Tracking & Profit/Loss
 * =========================================================================
 * School kharcha (salaries, utilities, rent, stationery…) record karo,
 * monthly profit/loss dekho: fee income vs total expenses.
 *
 * INTEGRATION NOTE (parent agent): add to js/db.js
 *   STORES.EXPENSES = "expenses";
 *   in onupgradeneeded: db.createObjectStore("expenses", { keyPath: "id" })
 *   with a non-unique "date" index; bump DB_VERSION.
 * Pure data helpers + view HTML — DB access follows the same pattern as
 * app.js (import { db } from "./db.js").
 * =========================================================================
 */

import { db } from "./db.js";

/** IndexedDB store name — must exist in STORES (see integration note). */
export const EXPENSES_STORE = "expenses";

/** Standard school expense categories. */
export const EXPENSE_CATEGORIES = [
  "Salaries",
  "Utilities",
  "Rent",
  "Stationery",
  "Maintenance",
  "Transport",
  "Events",
  "Miscellaneous"
];

/** HTML-escape for safe rendering. */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Collision-safe local id (crypto.randomUUID when available). */
function genId(prefix) {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Currency symbol from app config (defaults to "Rs"). */
function cur(app) {
  return (app && app.config && app.config.currency) || "Rs";
}

/** "YYYY-MM" key for a date string. */
export function monthKey(dateStr) {
  return String(dateStr || "").slice(0, 7);
}

/** Today's date as YYYY-MM-DD. */
export function todayStr() {
  return new Date().toISOString().split("T")[0];
}

/**
 * Build a new expense record.
 * @param {object} p
 * @param {string} p.title       Short description (e.g. "Electricity bill — March")
 * @param {string} p.category    One of EXPENSE_CATEGORIES
 * @param {number} p.amount
 * @param {string} p.date        YYYY-MM-DD
 * @param {string} [p.paidTo]    Vendor / recipient name
 * @param {string} [p.notes]
 * @param {string} [p.receiptNo] External receipt / bill number
 */
export function buildExpenseRecord({ title, category, amount, date, paidTo, notes, receiptNo }) {
  const now = new Date().toISOString();
  return {
    id: genId("exp"),
    title: (title || "").trim(),
    category: EXPENSE_CATEGORIES.includes(category) ? category : "Miscellaneous",
    amount: Math.max(0, Number(amount || 0)),
    date: date || todayStr(),
    paidTo: (paidTo || "").trim(),
    notes: (notes || "").trim(),
    receiptNo: (receiptNo || "").trim(),
    status: "recorded",
    createdAt: now
  };
}

/**
 * Sum of expenses for a calendar month ("YYYY-MM").
 * @param {Array} expenses
 * @param {string} yearMonth  "YYYY-MM"
 */
export function monthlyExpenseTotal(expenses, yearMonth) {
  return (expenses || [])
    .filter(e => monthKey(e.date) === yearMonth)
    .reduce((s, e) => s + Number(e.amount || 0), 0);
}

/**
 * Per-category totals for a month, sorted high → low.
 * @returns {Array<{category:string,total:number}>}
 */
export function categoryBreakdown(expenses, yearMonth) {
  const map = {};
  (expenses || [])
    .filter(e => monthKey(e.date) === yearMonth)
    .forEach(e => {
      const c = e.category || "Miscellaneous";
      map[c] = (map[c] || 0) + Number(e.amount || 0);
    });
  return Object.entries(map)
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Monthly profit & loss: fee income (PAID fees by paidDate) vs expenses.
 * @param {Array} fees      Fee records (status "paid", paidDate YYYY-MM-DD)
 * @param {Array} expenses
 * @param {string} yearMonth "YYYY-MM"
 * @returns {{income:number, expenses:number, profit:number}}
 */
export function profitLoss(fees, expenses, yearMonth) {
  const income = (fees || [])
    .filter(f => f.status === "paid" && monthKey(f.paidDate) === yearMonth)
    .reduce((s, f) => s + Number(f.amount || 0), 0);
  const exp = monthlyExpenseTotal(expenses, yearMonth);
  return { income, expenses: exp, profit: income - exp };
}

/** Month-picker default: current "YYYY-MM". */
function defaultMonth() {
  return todayStr().slice(0, 7);
}

/**
 * Full Expenses & Profit/Loss view HTML. Caller renders into content area,
 * then calls bindExpensesEvents(app). Data is loaded here (async).
 * @param {object} app  The schoolApp instance (config, showToast, refreshCurrentView, openModal…)
 */
export async function renderExpensesView(app) {
  const c = cur(app);
  const month = app.expenseMonth || defaultMonth();
  app.expenseMonth = month;

  const expenses = await db.getAll(EXPENSES_STORE);
  const fees = await db.getAll("fees");

  const pl = profitLoss(fees, expenses, month);
  const breakdown = categoryBreakdown(expenses, month);
  const monthExpenses = expenses
    .filter(e => monthKey(e.date) === month)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const profitColor = pl.profit >= 0 ? "#10b981" : "#ef4444";

  return `
    <div class="page-header">
      <div class="page-title-group">
        <h1>Expenses & Profit / Loss</h1>
        <p>School kharcha record karein aur monthly profit/loss dekhein.</p>
      </div>
      <div class="page-actions-group" style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
        <input type="month" class="form-control" id="expenseMonthPicker" value="${esc(month)}" style="width:auto;">
        <button class="btn btn-primary" id="btnAddExpense">
          <i class="fa-solid fa-plus"></i> Add Expense
        </button>
      </div>
    </div>

    <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:14px; margin-bottom:16px;">
      <div class="card" style="border-left:4px solid #10b981;">
        <div style="font-size:12px; text-transform:uppercase; color:#94a3b8; font-weight:700;">Fee Income (${esc(month)})</div>
        <div style="font-size:26px; font-weight:800; color:#10b981;">${esc(c)} ${pl.income.toLocaleString()}</div>
      </div>
      <div class="card" style="border-left:4px solid #ef4444;">
        <div style="font-size:12px; text-transform:uppercase; color:#94a3b8; font-weight:700;">Total Expenses (${esc(month)})</div>
        <div style="font-size:26px; font-weight:800; color:#ef4444;">${esc(c)} ${pl.expenses.toLocaleString()}</div>
      </div>
      <div class="card" style="border-left:4px solid ${profitColor};">
        <div style="font-size:12px; text-transform:uppercase; color:#94a3b8; font-weight:700;">Net Profit / Loss</div>
        <div style="font-size:26px; font-weight:800; color:${profitColor};">${esc(c)} ${pl.profit.toLocaleString()}</div>
      </div>
    </div>

    <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:14px;">
      <div class="card">
        <h3 style="margin:0 0 12px 0; font-size:15px;"><i class="fa-solid fa-chart-pie" style="color:#8b5cf6;"></i> Category Breakdown</h3>
        ${breakdown.length ? `
        <div class="table-container">
          <table class="custom-table">
            <thead><tr><th>Category</th><th style="text-align:right;">Amount</th></tr></thead>
            <tbody>
              ${breakdown.map(b => `
                <tr>
                  <td><span class="badge badge-info">${esc(b.category)}</span></td>
                  <td style="text-align:right; font-weight:700;">${esc(c)} ${b.total.toLocaleString()}</td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>` : `
        <div style="text-align:center; padding:28px 12px; color:#94a3b8;">
          <i class="fa-solid fa-chart-pie" style="font-size:28px; opacity:.4;"></i>
          <div style="margin-top:8px;">No expenses recorded for this month.</div>
        </div>`}
      </div>

      <div class="card">
        <h3 style="margin:0 0 12px 0; font-size:15px;"><i class="fa-solid fa-receipt" style="color:#0ea5e9;"></i> Expense Entries (${monthExpenses.length})</h3>
        ${monthExpenses.length ? `
        <div class="table-container">
          <table class="custom-table">
            <thead>
              <tr><th>Date</th><th>Title</th><th>Category</th><th style="text-align:right;">Amount</th><th style="text-align:right;">Actions</th></tr>
            </thead>
            <tbody>
              ${monthExpenses.map(e => `
                <tr>
                  <td style="white-space:nowrap;">${esc(e.date)}</td>
                  <td><strong>${esc(e.title)}</strong>${e.paidTo ? `<br><span style="font-size:11px; color:#64748b;">To: ${esc(e.paidTo)}</span>` : ""}${e.receiptNo ? `<br><span style="font-size:11px; color:#64748b;">Bill: <code>${esc(e.receiptNo)}</code></span>` : ""}</td>
                  <td><span class="badge badge-info">${esc(e.category)}</span></td>
                  <td style="text-align:right; font-weight:700;">${esc(c)} ${Number(e.amount).toLocaleString()}</td>
                  <td style="text-align:right; white-space:nowrap;">
                    <button class="btn btn-secondary btn-sm btn-expense-edit" data-id="${esc(e.id)}"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn btn-secondary btn-sm btn-expense-del" data-id="${esc(e.id)}" style="color:#ef4444;"><i class="fa-solid fa-trash"></i></button>
                  </td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>` : `
        <div style="text-align:center; padding:28px 12px; color:#94a3b8;">
          <i class="fa-solid fa-receipt" style="font-size:28px; opacity:.4;"></i>
          <div style="margin-top:8px;">No expenses recorded yet.<br>Click <strong>Add Expense</strong> to record your first kharcha.</div>
        </div>`}
      </div>
    </div>
  `;
}

/** Modal form for add/edit expense. */
function expenseFormHTML(e) {
  const rec = e || { title: "", category: "Miscellaneous", amount: "", date: todayStr(), paidTo: "", notes: "", receiptNo: "" };
  return `
    <form id="expenseForm">
      <div class="form-group">
        <label class="form-label">Title / Description</label>
        <input type="text" class="form-control" id="expTitle" value="${esc(rec.title)}" placeholder="e.g. Electricity bill — March" required>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Category</label>
          <select class="form-control" id="expCategory">
            ${EXPENSE_CATEGORIES.map(c => `<option value="${esc(c)}" ${rec.category === c ? "selected" : ""}>${esc(c)}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Amount (Rs)</label>
          <input type="number" class="form-control" id="expAmount" value="${esc(rec.amount)}" min="0" required>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Date</label>
          <input type="date" class="form-control" id="expDate" value="${esc(rec.date)}" required>
        </div>
        <div class="form-group">
          <label class="form-label">Paid To (vendor / person)</label>
          <input type="text" class="form-control" id="expPaidTo" value="${esc(rec.paidTo)}" placeholder="e.g. WAPDA, Landlord">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Bill / Receipt No.</label>
          <input type="text" class="form-control" id="expReceiptNo" value="${esc(rec.receiptNo)}" placeholder="Optional">
        </div>
        <div class="form-group">
          <label class="form-label">Notes</label>
          <input type="text" class="form-control" id="expNotes" value="${esc(rec.notes)}" placeholder="Optional">
        </div>
      </div>
    </form>
  `;
}

/**
 * Wire all expense view interactions. Call after rendering renderExpensesView(app).
 * @param {object} app
 */
export function bindExpensesEvents(app) {
  document.getElementById("expenseMonthPicker")?.addEventListener("change", (e) => {
    app.expenseMonth = e.target.value || defaultMonth();
    if (typeof app.refreshCurrentView === "function") app.refreshCurrentView();
  });

  const openExpenseModal = async (existingId = null) => {
    const existing = existingId ? await db.getById(EXPENSES_STORE, existingId) : null;
    app.openModal(
      existing ? "Edit Expense" : "Add Expense",
      expenseFormHTML(existing),
      `<button class="btn btn-secondary" onclick="window.schoolApp.closeModal()">Cancel</button>
       <button class="btn btn-primary" id="btnSaveExpense">${existing ? "Save Changes" : "Add Expense"}</button>`
    );
    document.getElementById("btnSaveExpense")?.addEventListener("click", async () => {
      const rec = buildExpenseRecord({
        title: document.getElementById("expTitle").value,
        category: document.getElementById("expCategory").value,
        amount: document.getElementById("expAmount").value,
        date: document.getElementById("expDate").value,
        paidTo: document.getElementById("expPaidTo").value,
        notes: document.getElementById("expNotes").value,
        receiptNo: document.getElementById("expReceiptNo").value
      });
      if (!rec.title || !(rec.amount > 0)) {
        app.showToast("Please enter a title and a valid amount.", "error");
        return;
      }
      if (existing) {
        rec.id = existing.id;
        rec.createdAt = existing.createdAt;
        await db.update(EXPENSES_STORE, rec);
        app.showToast("Expense updated.", "success");
      } else {
        await db.add(EXPENSES_STORE, rec);
        app.showToast("Expense recorded.", "success");
      }
      app.closeModal();
      if (typeof app.refreshCurrentView === "function") app.refreshCurrentView();
    });
  };

  document.getElementById("btnAddExpense")?.addEventListener("click", () => openExpenseModal());

  document.querySelectorAll(".btn-expense-edit").forEach(btn => {
    btn.addEventListener("click", () => openExpenseModal(btn.getAttribute("data-id")));
  });

  document.querySelectorAll(".btn-expense-del").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      if (!window.confirm("Delete this expense entry?")) return;
      await db.delete(EXPENSES_STORE, id);
      app.showToast("Expense deleted.", "info");
      if (typeof app.refreshCurrentView === "function") app.refreshCurrentView();
    });
  });
}
