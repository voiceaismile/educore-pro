/**
 * =========================================================================
 * 🚌 EDUCORE PRO v2.2+ — Transport / Route Management
 * =========================================================================
 * Van/bus routes with driver details, stop lists, student assignments and
 * monthly transport-fee collection tracking.
 *
 * STORAGE NOTE: route data lives in localStorage (key below) so this module
 * is fully self-contained. If the host app later adds an IndexedDB store,
 * swap loadRoutes/saveRoutes for db.getAll/add/update on that store —
 * the public function signatures are designed to survive that migration.
 * =========================================================================
 */

import { db, STORES } from "./db.js";
import { waLink } from "./whatsapp.js";

const LS_KEY = "educore_transport_routes";

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

/** Current month as "YYYY-MM". */
export function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

/* ------------------------------------------------------------------ */
/* Persistence (localStorage; see STORAGE NOTE above)                   */
/* ------------------------------------------------------------------ */

/** Load all routes (array). Never throws — returns [] on corrupt data. */
export function loadRoutes() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

/** Persist the full route array. */
export function saveRoutes(routes) {
  localStorage.setItem(LS_KEY, JSON.stringify(routes || []));
}

/* ------------------------------------------------------------------ */
/* Pure data helpers                                                    */
/* ------------------------------------------------------------------ */

/**
 * Build a new route record.
 * @param {object} opts
 * @param {string} opts.routeName
 * @param {string} opts.driverName
 * @param {string} opts.driverPhone
 * @param {string} opts.vehicleNo
 * @param {string[]} [opts.stops]  stop names in order
 * @param {number} [opts.monthlyFee]
 */
export function buildRoute({ routeName, driverName, driverPhone, vehicleNo, stops, monthlyFee }) {
  return {
    id: newId("route"),
    routeName: (routeName || "").trim(),
    driverName: (driverName || "").trim(),
    driverPhone: (driverPhone || "").trim(),
    vehicleNo: (vehicleNo || "").trim(),
    stops: (stops || []).map(s => String(s).trim()).filter(Boolean),
    monthlyFee: Number(monthlyFee || 0),
    students: [],        // student ids assigned to this route
    transportFees: [],   // {studentId, month:"YYYY-MM", status:"paid"|"pending", paidDate}
    createdAt: new Date().toISOString()
  };
}

/** Assign a student to a route (idempotent). Returns updated routes array. */
export function assignStudentToRoute(studentId, routeId) {
  const routes = loadRoutes();
  routes.forEach(r => {
    r.students = (r.students || []).filter(id => id !== studentId); // one route per student
    if (r.id === routeId && !r.students.includes(studentId)) r.students.push(studentId);
  });
  saveRoutes(routes);
  return routes;
}

/** Remove a student from whatever route they are on. */
export function removeStudentFromRoute(studentId) {
  const routes = loadRoutes();
  routes.forEach(r => { r.students = (r.students || []).filter(id => id !== studentId); });
  saveRoutes(routes);
  return routes;
}

/** Find the route a student is assigned to (or null). */
export function routeOfStudent(studentId) {
  return loadRoutes().find(r => (r.students || []).includes(studentId)) || null;
}

/**
 * Mark a student's transport fee for a month as paid (default: current month).
 * Creates the pending record implicitly if missing.
 */
export function markTransportFeePaid(routeId, studentId, month) {
  const m = month || currentMonth();
  const routes = loadRoutes();
  const route = routes.find(r => r.id === routeId);
  if (!route) return routes;
  route.transportFees = route.transportFees || [];
  let rec = route.transportFees.find(f => f.studentId === studentId && f.month === m);
  if (!rec) {
    rec = { studentId, month: m, status: "pending", paidDate: null };
    route.transportFees.push(rec);
  }
  rec.status = "paid";
  rec.paidDate = new Date().toISOString().split("T")[0];
  saveRoutes(routes);
  return routes;
}

/** Fee status for a student+month: "paid" | "pending" (default pending). */
export function transportFeeStatus(route, studentId, month) {
  const m = month || currentMonth();
  const rec = (route.transportFees || []).find(f => f.studentId === studentId && f.month === m);
  return rec ? rec.status : "pending";
}

/** Collection summary for a route+month: {paid, pending, total}. */
export function routeCollectionSummary(route, month) {
  const m = month || currentMonth();
  let paid = 0, pending = 0;
  (route.students || []).forEach(id => {
    if (transportFeeStatus(route, id, m) === "paid") paid++;
    else pending++;
  });
  return { paid, pending, total: paid + pending };
}

/* ------------------------------------------------------------------ */
/* View                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Render the transport management view.
 * @param {object} app app instance (uses app.config)
 * @returns {Promise<string>} HTML
 */
export async function renderTransportView(app) {
  const routes = loadRoutes();
  const students = await db.getAll(STORES.STUDENTS);
  const studentMap = {};
  students.forEach(s => { studentMap[s.id] = s; });
  const cur = (app.config && app.config.currency) || "Rs";
  const month = currentMonth();

  const cards = routes.map(route => {
    const sum = routeCollectionSummary(route, month);
    const driverWa = route.driverPhone ? waLink(route.driverPhone,
      `Assalam-o-Alaikum ${route.driverName}! Route "${route.routeName}" ke hawalay se school se rabta kar rahe hain.`) : null;
    const rows = (route.students || []).map(sid => {
      const s = studentMap[sid];
      const st = transportFeeStatus(route, sid, month);
      return `
        <tr>
          <td><strong>${esc(s ? (s.name || "—") : sid)}</strong>
            <div style="font-size:11px; color:var(--text-dim);">${esc(s ? (s.className || "") : "")}</div></td>
          <td><span class="badge ${st === "paid" ? "badge-success" : "badge-warning"}">${st.toUpperCase()}</span></td>
          <td style="text-align:right; white-space:nowrap;">
            ${st !== "paid" ? `<button class="btn btn-success btn-sm tfee-paid" data-route="${esc(route.id)}" data-student="${esc(sid)}">Paid</button>` : ""}
            <button class="btn btn-secondary btn-sm tfee-remove" data-student="${esc(sid)}" title="Remove from route"><i class="fa-solid fa-xmark"></i></button>
          </td>
        </tr>`;
    }).join("");

    return `
      <div class="card" style="border-top:3px solid #f59e0b;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:8px;">
          <div>
            <h3 style="margin:0;"><i class="fa-solid fa-bus"></i> ${esc(route.routeName)}</h3>
            <div style="font-size:12.5px; color:var(--text-dim); margin-top:4px;">
              <i class="fa-solid fa-user"></i> ${esc(route.driverName || "—")}
              ${route.driverPhone ? ` · <i class="fa-solid fa-phone"></i> ${esc(route.driverPhone)}` : ""}
              ${route.vehicleNo ? ` · <i class="fa-solid fa-car"></i> ${esc(route.vehicleNo)}` : ""}
            </div>
            <div style="font-size:12px; color:var(--text-dim); margin-top:4px;">
              <i class="fa-solid fa-location-dot"></i> ${(route.stops || []).map(esc).join(" → ") || "No stops added"}
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-weight:800;">${cur} ${Number(route.monthlyFee || 0).toLocaleString()}<span style="font-weight:400; font-size:12px;">/mo</span></div>
            <div style="font-size:12px; color:var(--text-dim);">${sum.paid}/${sum.total} paid (${month})</div>
            <div style="margin-top:6px; display:flex; gap:6px; justify-content:flex-end;">
              ${driverWa ? `<a class="btn btn-success btn-sm" href="${driverWa}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i></a>` : ""}
              <button class="btn btn-secondary btn-sm route-delete" data-id="${esc(route.id)}"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>
        </div>
        <div class="table-container" style="margin-top:10px;">
          <table class="custom-table">
            <thead><tr><th>Student</th><th>Fee (${month})</th><th style="text-align:right;">Actions</th></tr></thead>
            <tbody>
              ${rows || `<tr><td colspan="3" style="text-align:center; color:var(--text-dim); font-size:12.5px;">No students assigned yet.</td></tr>`}
            </tbody>
          </table>
        </div>
        <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
          <select class="form-control tfee-student" data-route="${esc(route.id)}" style="max-width:240px;">
            <option value="">— Assign student —</option>
            ${students.filter(s => !routeOfStudent(s.id)).map(s =>
              `<option value="${esc(s.id)}">${esc(s.name || "")} (${esc(s.className || "")})</option>`).join("")}
          </select>
          <button class="btn btn-primary btn-sm tfee-assign" data-route="${esc(route.id)}"><i class="fa-solid fa-plus"></i> Assign</button>
        </div>
      </div>`;
  }).join("");

  return `
    <div class="page-header">
      <div class="page-title-group">
        <h1>Transport Management</h1>
        <p>Van/bus routes, drivers, stop lists and monthly transport-fee collection.</p>
      </div>
      <div class="page-actions-group">
        <button class="btn btn-primary" id="btnAddRoute"><i class="fa-solid fa-plus"></i> Add Route</button>
      </div>
    </div>

    <div id="routeFormWrap" style="display:none; margin-bottom:16px;">
      <div class="card">
        <h3 style="margin-top:0;"><i class="fa-solid fa-bus"></i> New Route</h3>
        <form id="formAddRoute">
          <div class="form-row">
            <div class="form-group"><label class="form-label">Route Name *</label>
              <input class="form-control" id="routeName" required placeholder="Gulberg Route"></div>
            <div class="form-group"><label class="form-label">Monthly Fee (${esc(cur)})</label>
              <input type="number" class="form-control" id="routeFee" min="0" value="0"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Driver Name</label>
              <input class="form-control" id="routeDriver"></div>
            <div class="form-group"><label class="form-label">Driver Phone</label>
              <input class="form-control" id="routeDriverPhone" placeholder="0300-1234567"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Vehicle No.</label>
              <input class="form-control" id="routeVehicle" placeholder="FSD-1234"></div>
            <div class="form-group"><label class="form-label">Stops (comma separated)</label>
              <input class="form-control" id="routeStops" placeholder="Stop A, Stop B, Stop C"></div>
          </div>
          <div style="display:flex; gap:10px; margin-top:10px;">
            <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> Save Route</button>
            <button type="button" class="btn btn-secondary" id="btnCancelRoute">Cancel</button>
          </div>
        </form>
      </div>
    </div>

    <div style="display:grid; gap:12px;">
      ${cards || `<div class="card" style="text-align:center; color:var(--text-dim);">No routes yet. Add your first van/bus route above.</div>`}
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* Events                                                               */
/* ------------------------------------------------------------------ */

/**
 * Bind events for the transport view. Call after injecting renderTransportView HTML.
 * @param {object} app app instance (showToast, refreshCurrentView)
 */
export function bindTransportEvents(app) {
  const wrap = document.getElementById("routeFormWrap");
  document.getElementById("btnAddRoute")?.addEventListener("click", () => {
    if (wrap) wrap.style.display = wrap.style.display === "none" ? "block" : "none";
  });
  document.getElementById("btnCancelRoute")?.addEventListener("click", () => {
    if (wrap) wrap.style.display = "none";
  });

  document.getElementById("formAddRoute")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const rec = buildRoute({
      routeName: document.getElementById("routeName").value,
      monthlyFee: document.getElementById("routeFee").value,
      driverName: document.getElementById("routeDriver").value,
      driverPhone: document.getElementById("routeDriverPhone").value,
      vehicleNo: document.getElementById("routeVehicle").value,
      stops: document.getElementById("routeStops").value.split(",")
    });
    if (!rec.routeName) { app.showToast("Route name is required.", "error"); return; }
    const routes = loadRoutes();
    routes.push(rec);
    saveRoutes(routes);
    app.showToast("Route added.", "success");
    app.refreshCurrentView();
  });

  document.querySelectorAll(".tfee-assign").forEach(btn => {
    btn.addEventListener("click", () => {
      const routeId = btn.getAttribute("data-route");
      const sel = document.querySelector(`.tfee-student[data-route="${routeId}"]`);
      if (!sel || !sel.value) { app.showToast("Select a student first.", "warning"); return; }
      assignStudentToRoute(sel.value, routeId);
      app.showToast("Student assigned to route.", "success");
      app.refreshCurrentView();
    });
  });

  document.querySelectorAll(".tfee-paid").forEach(btn => {
    btn.addEventListener("click", () => {
      markTransportFeePaid(btn.getAttribute("data-route"), btn.getAttribute("data-student"));
      app.showToast("Transport fee marked paid.", "success");
      app.refreshCurrentView();
    });
  });

  document.querySelectorAll(".tfee-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      removeStudentFromRoute(btn.getAttribute("data-student"));
      app.showToast("Student removed from route.", "info");
      app.refreshCurrentView();
    });
  });

  document.querySelectorAll(".route-delete").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!confirm("Delete this route?")) return;
      saveRoutes(loadRoutes().filter(r => r.id !== btn.getAttribute("data-id")));
      app.showToast("Route deleted.", "info");
      app.refreshCurrentView();
    });
  });
}
