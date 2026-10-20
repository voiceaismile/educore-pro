/**
 * =========================================================================
 * 📚 EDUCORE PRO — Library Book Tracking
 * =========================================================================
 * Book catalogue (title / author / ISBN / category / copies) plus issue &
 * return workflow: issue a copy to a student with a due date, track overdue
 * books, and return copies back into stock.
 *
 * DATA MODEL (IndexedDB):
 *   This module reads/writes two object stores (keyPath "id"):
 *     "books"      — catalogue records
 *     "bookIssues" — issue/return transactions
 *   Both must be registered in js/db.js STORES (BOOKS, BOOK_ISSUES) and
 *   created in onupgradeneeded; bump DB_VERSION when adding them.
 *
 * Book record:
 *   { id, title, author, isbn, category, totalCopies, availableCopies,
 *     createdAt, updatedAt }
 * Issue record:
 *   { id, bookId, bookTitle, studentId, studentName, issueDate, dueDate,
 *     returnDate, status: "issued" | "returned", createdAt }
 *
 * Pure data helpers + view renderers. DOM binding happens in
 * bindLibraryEvents(app). No printing needed for v1 of this module.
 * =========================================================================
 */

import { db } from "./db.js";

/** IndexedDB store names (register in db.js STORES). */
export const STORE_BOOKS = "books";
export const STORE_BOOK_ISSUES = "bookIssues";

/** Default loan period in days when the librarian leaves due-date empty. */
export const DEFAULT_LOAN_DAYS = 14;

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function newId(prefix) {
  return (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function addDays(dateStr, days) {
  const d = new Date((dateStr || todayStr()) + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

/**
 * Build a new book catalogue record.
 * @param {Object} input
 * @param {string} input.title
 * @param {string} input.author
 * @param {string} input.isbn
 * @param {string} input.category
 * @param {number} input.totalCopies
 * @returns {Object} book record ready for db.add()
 */
export function buildBookRecord({ title, author, isbn, category, totalCopies }) {
  const now = new Date().toISOString();
  const total = Math.max(1, Number(totalCopies || 1));
  return {
    id: newId("book"),
    title: (title || "").trim(),
    author: (author || "").trim(),
    isbn: (isbn || "").trim(),
    category: (category || "General").trim(),
    totalCopies: total,
    availableCopies: total,
    createdAt: now,
    updatedAt: now
  };
}

/**
 * Build a new issue transaction (status "issued").
 * @param {Object} input
 * @param {string} input.bookId
 * @param {string} input.bookTitle
 * @param {string} input.studentId
 * @param {string} input.studentName
 * @param {string} input.issueDate - YYYY-MM-DD (defaults today)
 * @param {string} input.dueDate - YYYY-MM-DD (defaults issueDate + 14 days)
 * @returns {Object} issue record ready for db.add()
 */
export function buildIssueRecord({ bookId, bookTitle, studentId, studentName, issueDate, dueDate }) {
  const issued = issueDate || todayStr();
  return {
    id: newId("issue"),
    bookId: bookId || null,
    bookTitle: bookTitle || "",
    studentId: studentId || null,
    studentName: studentName || "",
    issueDate: issued,
    dueDate: dueDate || addDays(issued, DEFAULT_LOAN_DAYS),
    returnDate: null,
    status: "issued",
    createdAt: new Date().toISOString()
  };
}

/**
 * True when an issued record is past its due date.
 * @param {Object} issue
 * @param {string} [refDate] - YYYY-MM-DD reference (defaults today)
 * @returns {boolean}
 */
export function isOverdue(issue, refDate) {
  if (!issue || issue.status !== "issued" || !issue.dueDate) return false;
  const ref = refDate || todayStr();
  return issue.dueDate < ref;
}

/**
 * Whole days overdue (0 when not overdue).
 * @param {Object} issue
 * @param {string} [refDate]
 * @returns {number}
 */
export function daysOverdue(issue, refDate) {
  if (!isOverdue(issue, refDate)) return 0;
  const ref = new Date((refDate || todayStr()) + "T00:00:00");
  const due = new Date(issue.dueDate + "T00:00:00");
  return Math.max(0, Math.round((ref - due) / 86400000));
}

/**
 * Render the Library view (Books tab + Issued tab).
 * @param {Object} app - SchoolApp instance
 * @returns {Promise<string>} HTML
 */
export async function renderLibraryView(app) {
  const books = await db.getAll(STORE_BOOKS);
  const issues = await db.getAll(STORE_BOOK_ISSUES);
  const students = await db.getAll("students");

  const sortedBooks = (books || []).slice().sort((a, b) => String(a.title).localeCompare(String(b.title)));
  const activeIssues = (issues || [])
    .filter(i => i.status === "issued")
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  const history = (issues || [])
    .filter(i => i.status === "returned")
    .sort((a, b) => String(b.returnDate || "").localeCompare(String(a.returnDate || "")))
    .slice(0, 20);

  const totalCopies = sortedBooks.reduce((s, b) => s + Number(b.totalCopies || 0), 0);
  const available = sortedBooks.reduce((s, b) => s + Number(b.availableCopies || 0), 0);
  const overdueCount = activeIssues.filter(i => isOverdue(i)).length;

  const bookRows = sortedBooks.map(b => {
    const stockBadge = Number(b.availableCopies) === 0
      ? `<span class="badge badge-danger">Out of stock</span>`
      : Number(b.availableCopies) < Number(b.totalCopies)
        ? `<span class="badge badge-warning">${esc(b.availableCopies)} / ${esc(b.totalCopies)} available</span>`
        : `<span class="badge badge-success">${esc(b.availableCopies)} / ${esc(b.totalCopies)} available</span>`;
    return `
      <tr>
        <td><strong>${esc(b.title)}</strong><br><span style="font-size:11px; color:#64748b;">${esc(b.author || "—")}</span></td>
        <td style="font-size:12px;">${esc(b.isbn || "—")}</td>
        <td><span class="badge badge-info">${esc(b.category || "General")}</span></td>
        <td>${stockBadge}</td>
        <td style="text-align:right; white-space:nowrap;">
          <button class="btn btn-primary btn-sm lib-issue" data-id="${esc(b.id)}" ${Number(b.availableCopies) === 0 ? "disabled" : ""}>
            <i class="fa-solid fa-hand-holding"></i> Issue
          </button>
          <button class="btn btn-danger btn-sm lib-del-book" data-id="${esc(b.id)}"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>`;
  }).join("");

  const issueRows = activeIssues.map(i => {
    const od = isOverdue(i);
    const dd = daysOverdue(i);
    return `
      <tr ${od ? `style="background:#fef2f2;"` : ""}>
        <td><strong>${esc(i.bookTitle)}</strong></td>
        <td>${esc(i.studentName)}</td>
        <td style="font-size:12px;">${esc(i.issueDate)}</td>
        <td style="font-size:12px; ${od ? "color:#dc2626; font-weight:700;" : ""}">
          ${esc(i.dueDate)}${od ? ` <span class="badge badge-danger">${dd}d overdue</span>` : ""}
        </td>
        <td style="text-align:right;">
          <button class="btn btn-success btn-sm lib-return" data-id="${esc(i.id)}">
            <i class="fa-solid fa-rotate-left"></i> Return
          </button>
        </td>
      </tr>`;
  }).join("");

  const historyRows = history.map(i => `
    <tr>
      <td>${esc(i.bookTitle)}</td>
      <td>${esc(i.studentName)}</td>
      <td style="font-size:12px;">${esc(i.issueDate)} → ${esc(i.returnDate || "—")}</td>
      <td><span class="badge badge-success">Returned</span></td>
    </tr>`).join("");

  const bookOptions = sortedBooks
    .filter(b => Number(b.availableCopies) > 0)
    .map(b => `<option value="${esc(b.id)}">${esc(b.title)} (${b.availableCopies} left)</option>`)
    .join("");
  const studentOptions = (students || [])
    .slice().sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map(s => `<option value="${esc(s.id)}">${esc(s.name)}${s.admissionNo ? " — " + esc(s.admissionNo) : ""}</option>`)
    .join("");

  return `
    <div class="page-header">
      <div class="page-title-group">
        <h1><i class="fa-solid fa-book-open"></i> Library</h1>
        <p>Catalogue, issue and return — know exactly where every book is.</p>
      </div>
      <div class="page-actions-group">
        <button class="btn btn-primary" id="btnAddBook"><i class="fa-solid fa-plus"></i> Add Book</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <div style="display:flex; gap:24px; flex-wrap:wrap; padding:4px 8px;">
        <div><i class="fa-solid fa-book" style="color:#4f46e5;"></i> <strong>${sortedBooks.length}</strong> titles</div>
        <div><i class="fa-solid fa-layer-group" style="color:#0ea5e9;"></i> <strong>${available}</strong> / ${totalCopies} copies available</div>
        <div><i class="fa-solid fa-hand-holding" style="color:#f59e0b;"></i> <strong>${activeIssues.length}</strong> issued</div>
        <div><i class="fa-solid fa-triangle-exclamation" style="color:#dc2626;"></i> <strong>${overdueCount}</strong> overdue</div>
      </div>
    </div>

    <div class="settings-nav-tabs" style="margin-bottom:16px;">
      <button type="button" class="settings-tab-btn active" data-lib-tab="books"><i class="fa-solid fa-book"></i> Books</button>
      <button type="button" class="settings-tab-btn" data-lib-tab="issued"><i class="fa-solid fa-hand-holding"></i> Issued ${activeIssues.length ? `(${activeIssues.length})` : ""}</button>
    </div>

    <div id="libPaneBooks">
      <div class="card">
        ${bookRows ? `
          <div class="table-container">
            <table class="custom-table">
              <thead><tr><th>Title / Author</th><th>ISBN</th><th>Category</th><th>Stock</th><th style="text-align:right;">Actions</th></tr></thead>
              <tbody>${bookRows}</tbody>
            </table>
          </div>` : `
          <div class="empty-state">
            <i class="fa-solid fa-book-open" style="font-size:40px; color:#cbd5e1;"></i>
            <h3>No books in the catalogue</h3>
            <p>Press <strong>Add Book</strong> to register your first title with its copies.</p>
          </div>`}
      </div>
    </div>

    <div id="libPaneIssued" style="display:none;">
      <div class="card" style="margin-bottom:16px;">
        <h3 class="card-title" style="margin-bottom:12px;"><i class="fa-solid fa-hand-holding"></i> Issue a Book</h3>
        ${bookOptions && studentOptions ? `
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <div>
              <label class="form-label">Book *</label>
              <select id="libIssueBook" class="form-control">${bookOptions}</select>
            </div>
            <div>
              <label class="form-label">Student *</label>
              <select id="libIssueStudent" class="form-control">${studentOptions}</select>
            </div>
            <div>
              <label class="form-label">Issue Date</label>
              <input type="date" id="libIssueDate" class="form-control" value="${todayStr()}">
            </div>
            <div>
              <label class="form-label">Due Date</label>
              <input type="date" id="libIssueDue" class="form-control" value="${addDays(todayStr(), DEFAULT_LOAN_DAYS)}">
            </div>
          </div>
          <button class="btn btn-primary btn-sm" id="btnDoIssue" style="margin-top:10px;">
            <i class="fa-solid fa-check"></i> Issue Book
          </button>` : `
          <div class="empty-state" style="padding:20px;">
            <p style="margin:0; color:#64748b;">${!bookOptions ? "No copies available to issue." : ""} ${!studentOptions ? "Add students first (Admissions)." : ""}</p>
          </div>`}
      </div>

      <div class="card" style="margin-bottom:16px;">
        <h3 class="card-title" style="margin-bottom:12px;">Currently Issued ${overdueCount ? `<span class="badge badge-danger">${overdueCount} overdue</span>` : ""}</h3>
        ${issueRows ? `
          <div class="table-container">
            <table class="custom-table">
              <thead><tr><th>Book</th><th>Student</th><th>Issued</th><th>Due</th><th style="text-align:right;">Action</th></tr></thead>
              <tbody>${issueRows}</tbody>
            </table>
          </div>` : `
          <div class="empty-state">
            <i class="fa-solid fa-circle-check" style="font-size:40px; color:#cbd5e1;"></i>
            <h3>Nothing issued</h3>
            <p>All books are on the shelf. Use the form above to issue one.</p>
          </div>`}
      </div>

      ${historyRows ? `
        <div class="card">
          <h3 class="card-title" style="margin-bottom:12px;">Recent Returns</h3>
          <div class="table-container">
            <table class="custom-table">
              <thead><tr><th>Book</th><th>Student</th><th>Period</th><th>Status</th></tr></thead>
              <tbody>${historyRows}</tbody>
            </table>
          </div>
        </div>` : ""}
    </div>`;
}

/**
 * Bind Library view events. Call after renderLibraryView() HTML is in the DOM.
 * @param {Object} app - SchoolApp instance
 */
export function bindLibraryEvents(app) {
  // --- Tabs ---
  document.querySelectorAll("[data-lib-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-lib-tab]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.libTab;
      document.getElementById("libPaneBooks").style.display = tab === "books" ? "" : "none";
      document.getElementById("libPaneIssued").style.display = tab === "issued" ? "" : "none";
    });
  });

  // --- Add book ---
  document.getElementById("btnAddBook")?.addEventListener("click", () => {
    app.openModal(
      "Add Book",
      `<div style="display:grid; gap:12px;">
        <div><label class="form-label">Title *</label><input type="text" id="bkTitle" class="form-control" placeholder="Book title"></div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div><label class="form-label">Author</label><input type="text" id="bkAuthor" class="form-control"></div>
          <div><label class="form-label">ISBN</label><input type="text" id="bkIsbn" class="form-control"></div>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div><label class="form-label">Category</label>
            <select id="bkCategory" class="form-control">
              <option>General</option><option>Textbook</option><option>Novel</option>
              <option>Islamic</option><option>Science</option><option>Reference</option>
            </select>
          </div>
          <div><label class="form-label">Total Copies *</label><input type="number" id="bkCopies" class="form-control" min="1" value="1"></div>
        </div>
      </div>`,
      `<button class="btn btn-secondary" onclick="window.schoolApp.closeModal()">Cancel</button>
       <button class="btn btn-primary" id="btnSaveBook"><i class="fa-solid fa-floppy-disk"></i> Save Book</button>`
    );
    document.getElementById("btnSaveBook")?.addEventListener("click", async () => {
      const title = document.getElementById("bkTitle")?.value || "";
      if (!title.trim()) {
        app.showToast("Book title is required.", "warning");
        return;
      }
      await db.add(STORE_BOOKS, buildBookRecord({
        title,
        author: document.getElementById("bkAuthor")?.value || "",
        isbn: document.getElementById("bkIsbn")?.value || "",
        category: document.getElementById("bkCategory")?.value || "General",
        totalCopies: document.getElementById("bkCopies")?.value || 1
      }));
      app.closeModal();
      app.showToast(`"${title.trim()}" added to the catalogue.`, "success");
      app.refreshCurrentView();
    });
  });

  // --- Issue from catalogue row ---
  document.querySelectorAll(".lib-issue").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelector('[data-lib-tab="issued"]')?.click();
      const sel = document.getElementById("libIssueBook");
      if (sel) sel.value = btn.dataset.id;
      document.getElementById("libPaneIssued")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  // --- Delete book (only when nothing is issued) ---
  document.querySelectorAll(".lib-del-book").forEach(btn => {
    btn.addEventListener("click", async () => {
      const issues = await db.getAll(STORE_BOOK_ISSUES);
      const active = issues.filter(i => i.bookId === btn.dataset.id && i.status === "issued");
      if (active.length) {
        app.showToast("Cannot delete — copies of this book are currently issued.", "warning");
        return;
      }
      if (!confirm("Delete this book from the catalogue?")) return;
      await db.delete(STORE_BOOKS, btn.dataset.id);
      app.showToast("Book deleted.", "info");
      app.refreshCurrentView();
    });
  });

  // --- Issue a book ---
  document.getElementById("btnDoIssue")?.addEventListener("click", async () => {
    const bookId = document.getElementById("libIssueBook")?.value || "";
    const studentId = document.getElementById("libIssueStudent")?.value || "";
    if (!bookId || !studentId) {
      app.showToast("Select a book and a student.", "warning");
      return;
    }
    const book = await db.getById(STORE_BOOKS, bookId);
    const students = await db.getAll("students");
    const student = students.find(s => String(s.id) === String(studentId));
    if (!book || Number(book.availableCopies) <= 0) {
      app.showToast("No copies available.", "warning");
      return;
    }
    await db.add(STORE_BOOK_ISSUES, buildIssueRecord({
      bookId: book.id,
      bookTitle: book.title,
      studentId: student ? student.id : null,
      studentName: student ? student.name : "",
      issueDate: document.getElementById("libIssueDate")?.value || todayStr(),
      dueDate: document.getElementById("libIssueDue")?.value || ""
    }));
    book.availableCopies = Number(book.availableCopies) - 1;
    book.updatedAt = new Date().toISOString();
    await db.update(STORE_BOOKS, book);
    app.showToast(`"${book.title}" issued to ${student ? student.name : "student"}.`, "success");
    app.refreshCurrentView();
  });

  // --- Return a book ---
  document.querySelectorAll(".lib-return").forEach(btn => {
    btn.addEventListener("click", async () => {
      const issue = await db.getById(STORE_BOOK_ISSUES, btn.dataset.id);
      if (!issue || issue.status !== "issued") return;
      issue.status = "returned";
      issue.returnDate = todayStr();
      await db.update(STORE_BOOK_ISSUES, issue);
      const book = await db.getById(STORE_BOOKS, issue.bookId);
      if (book) {
        book.availableCopies = Math.min(Number(book.totalCopies), Number(book.availableCopies) + 1);
        book.updatedAt = new Date().toISOString();
        await db.update(STORE_BOOKS, book);
      }
      const late = daysOverdue({ ...issue, status: "issued" });
      app.showToast(
        late > 0 ? `Book returned — ${late} day(s) overdue.` : "Book returned. Thank you!",
        late > 0 ? "warning" : "success"
      );
      app.refreshCurrentView();
    });
  });
}
