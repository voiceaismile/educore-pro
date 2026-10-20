/**
 * =========================================================================
 * 🛡️ EDUCORE PRO — User Roles & Permissions
 * =========================================================================
 * Role-based access control for school staff accounts.
 *
 * Permission model: each role maps to a list of permission keys. The special
 * key "*" grants everything (admin). Views / nav items declare the single
 * permission they need; `hasPermission(user, perm)` decides access and
 * `filterNavByRole()` hides nav items the current user may not see.
 *
 * Standard permission keys used across the app:
 *   students, fees, fees_add, expenses, payroll, attendance, homework,
 *   grades_view, view_reports, view_all, approve_leave
 *
 * View contract (same as other views in js/app.js):
 *   renderRolesView(app) -> HTML string (user list + permission matrix)
 * `app` exposes: app.config, app.showToast(msg, type).
 * NOTE: role assignment writes to STORES.USERS (index "role" exists).
 * =========================================================================
 */

import { db, STORES } from "./db.js";

/**
 * Role definitions: label + permission list.
 * "*" = all permissions (admin only).
 */
export const ROLES = {
  admin: {
    label: "Administrator",
    description: "Full access to everything, including user management.",
    permissions: ["*"]
  },
  principal: {
    label: "Principal",
    description: "Oversight of the whole school; approves leaves, views reports.",
    permissions: ["view_all", "approve_leave", "view_reports"]
  },
  accountant: {
    label: "Accountant",
    description: "Fees, expenses and payroll; can view financial reports.",
    permissions: ["fees", "expenses", "payroll", "view_reports"]
  },
  receptionist: {
    label: "Receptionist",
    description: "Front-desk: students, fee collection entries, attendance.",
    permissions: ["students", "fees_add", "attendance"]
  },
  teacher: {
    label: "Teacher",
    description: "Classroom work: attendance, homework, view grades.",
    permissions: ["attendance", "homework", "grades_view"]
  }
};

/** Ordered list of role ids (for dropdowns / matrix columns). */
export const ROLE_IDS = Object.keys(ROLES);

/**
 * All distinct permission keys across roles (excludes "*"), sorted.
 * Useful for building the permission matrix.
 */
export function allPermissions() {
  const set = new Set();
  Object.values(ROLES).forEach(r => (r.permissions || []).forEach(p => {
    if (p !== "*") set.add(p);
  }));
  return [...set].sort();
}

/** Human label for a permission key. */
export function permissionLabel(perm) {
  const map = {
    students: "Students",
    fees: "Fee Management",
    fees_add: "Add Fee Entries",
    expenses: "Expenses",
    payroll: "Payroll",
    attendance: "Attendance",
    homework: "Homework",
    grades_view: "View Grades",
    view_reports: "View Reports",
    view_all: "View Everything",
    approve_leave: "Approve Leaves"
  };
  return map[perm] || perm;
}

/**
 * Does this user have a permission?
 * Admin ("*" in role permissions) has everything. Unknown roles / missing
 * users get nothing. A per-user `permissions` array (if present) is treated
 * as an additive override on top of the role.
 * @param {{role?: string, permissions?: string[]}|null} user
 * @param {string} perm
 * @returns {boolean}
 */
export function hasPermission(user, perm) {
  if (!user || !perm) return false;
  const role = ROLES[user.role];
  const granted = new Set(role ? role.permissions : []);
  (user.permissions || []).forEach(p => granted.add(p));
  return granted.has("*") || granted.has(perm);
}

/**
 * Filter nav items to those the user may see.
 * @param {Array<{id: string, permission?: string}>} navItems - each item may
 *        declare a `permission`; items without one are always visible.
 * @param {{role?: string, permissions?: string[]}|null} user
 * @returns {Array} visible nav items (same order)
 */
export function filterNavByRole(navItems, user) {
  if (!Array.isArray(navItems)) return [];
  return navItems.filter(item => !item.permission || hasPermission(user, item.permission));
}

/**
 * Assign a role to a user record (validates the role id).
 * @param {object} userRecord - mutable user object from STORES.USERS
 * @param {string} roleId - one of ROLE_IDS
 * @returns {boolean} true if assigned
 */
export function assignRole(userRecord, roleId) {
  if (!userRecord || !ROLES[roleId]) return false;
  userRecord.role = roleId;
  return true;
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* =========================================================================
   VIEW
   ========================================================================= */

/**
 * Roles view: user list with role-assignment dropdowns + a permission
 * matrix (features × roles) so the principal can see who can do what.
 */
export async function renderRolesView(app) {
  let users = [];
  try { users = await db.getAll(STORES.USERS); } catch (e) { /* noop */ }

  const perms = allPermissions();
  const roleOf = (u) => ROLES[u.role] ? u.role : "receptionist";

  const userRow = (u) => `
    <tr>
      <td>
        <strong>${esc(u.name || u.email || u.id)}</strong><br>
        <small style="color:#64748b;">${esc(u.email || "")}</small>
      </td>
      <td>
        <select class="form-control role-assign-select" data-user-id="${esc(u.id)}" style="max-width:200px;">
          ${ROLE_IDS.map(rid => `
            <option value="${rid}" ${roleOf(u) === rid ? "selected" : ""}>${esc(ROLES[rid].label)}</option>`).join("")}
        </select>
      </td>
      <td><small style="color:#64748b;">${esc(ROLES[roleOf(u)].description)}</small></td>
    </tr>`;

  const matrixCell = (roleId, perm) => {
    const has = ROLES[roleId].permissions.includes("*") || ROLES[roleId].permissions.includes(perm);
    return `<td style="text-align:center;">${has
      ? `<i class="fa-solid fa-circle-check" style="color:#10b981; font-size:16px;" title="Allowed"></i>`
      : `<i class="fa-solid fa-circle-minus" style="color:#cbd5e1; font-size:16px;" title="Not allowed"></i>`}</td>`;
  };

  return `
    <div class="page-header">
      <div class="page-title-group">
        <h1>User Roles & Permissions</h1>
        <p>Control what each staff account can see and do. Changes apply on next sign-in.</p>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <h3 style="margin-top:0;"><i class="fa-solid fa-users-gear"></i> Staff Accounts (${users.length})</h3>
      <div class="table-container">
        <table class="custom-table">
          <thead><tr><th>User</th><th>Role</th><th>Access Summary</th></tr></thead>
          <tbody>
            ${users.length ? users.map(userRow).join("") :
              `<tr><td colspan="3" style="text-align:center; color:#64748b; padding:24px;">
                No user accounts found yet.
              </td></tr>`}
          </tbody>
        </table>
      </div>
      <div style="margin-top:8px; font-size:12.5px; color:#64748b;">
        <i class="fa-solid fa-circle-info"></i>
        Tip: keep at least one <strong>Administrator</strong> account. The admin role can never lock itself out.
      </div>
    </div>

    <div class="card">
      <h3 style="margin-top:0;"><i class="fa-solid fa-table-cells"></i> Permission Matrix</h3>
      <p style="color:#64748b; font-size:13px; margin-top:-6px;">Which role can access which feature.</p>
      <div class="table-container">
        <table class="custom-table">
          <thead>
            <tr>
              <th>Feature</th>
              ${ROLE_IDS.map(rid => `<th style="text-align:center;">${esc(ROLES[rid].label)}</th>`).join("")}
            </tr>
          </thead>
          <tbody>
            ${perms.map(p => `
              <tr>
                <td><strong>${esc(permissionLabel(p))}</strong><br>
                  <small style="color:#94a3b8;"><code>${esc(p)}</code></small></td>
                ${ROLE_IDS.map(rid => matrixCell(rid, p)).join("")}
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
}

/**
 * Wire role-assignment dropdowns. Call after the view HTML is in the DOM.
 * Prevents demoting the last remaining admin.
 */
export function bindRolesEvents(app) {
  document.querySelectorAll(".role-assign-select").forEach(sel => {
    sel.addEventListener("change", async () => {
      const userId = sel.getAttribute("data-user-id");
      const newRole = sel.value;
      try {
        const user = await db.getById(STORES.USERS, userId);
        if (!user) { app?.showToast("User not found.", "warning"); return; }

        // Safety: never leave the school without an admin
        if (user.role === "admin" && newRole !== "admin") {
          const all = await db.getAll(STORES.USERS);
          const otherAdmins = all.filter(u => u.id !== userId && u.role === "admin");
          if (!otherAdmins.length) {
            app?.showToast("Cannot demote the last Administrator.", "danger");
            sel.value = "admin";
            return;
          }
        }

        if (!assignRole(user, newRole)) {
          app?.showToast("Invalid role.", "danger");
          return;
        }
        await db.update(STORES.USERS, user);
        app?.showToast(`Role updated to ${ROLES[newRole].label}. Applies on next sign-in.`, "success");
      } catch (err) {
        app?.showToast("Could not update role: " + err.message, "danger");
      }
    });
  });
}
