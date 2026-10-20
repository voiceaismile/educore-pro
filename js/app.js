/**
 * =========================================================================
 * 🎓 EDUCORE PRO - MAIN APPLICATION CONTROLLER
 * Single-Page Architecture, Reactive UI, Offline-First with Firebase Sync
 * =========================================================================
 */

import { getAppConfig, saveAppConfig, DEFAULT_CONFIG } from "./config.js";
import { db, STORES } from "./db.js";
import { auth } from "./auth.js";
import { syncManager } from "./firebase-sync.js";
import { uploadImageToImgbb } from "./imgbb.js";
import { licenseManager } from "./license.js";
import { normalizePakPhone, waLink, daysOverdue, feeReminderMessage, resultShareMessage, defaulterSummaryText } from "./whatsapp.js";
import { PAYMENT_METHODS, getPaymentSettings, hasPaymentSettings, paymentInstructionsHTML, buildPaymentRecord, methodLabel } from "./onlinepay.js";

class SchoolApp {
  constructor() {
    this.config = getAppConfig();
    this.currentView = "dashboard";
    this.currentSettingsTab = "landing_cms";
    this.activeModal = null;
    this.searchQuery = "";
    this.classFilter = "all";
    
    this.init();
  }

  async init() {
    this.applyThemeAndBranding();
    this.bindGlobalEvents();

    // v2.1.1 — Fast boot: render UI FIRST, license check runs in background.
    // The public landing page never waits on the license server.

    // 1. Initialize Database & fetch remote landing page config if online
    await db.init();
    try {
      const fbUrl = this.config.firebase?.databaseURL;
      if (fbUrl) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        const resp = await fetch(`${fbUrl}/school_config.json`, { signal: controller.signal });
        clearTimeout(timeout);
        if (resp.ok) {
          const remoteConfig = await resp.json();
          if (remoteConfig) {
            saveAppConfig(remoteConfig);
            this.config = getAppConfig();
          }
        }
      }
    } catch (e) {
      // offline fallback automatic
    }

    // 2. Check Authentication & Initial View — renders IMMEDIATELY
    const user = auth.getCurrentUser();
    if (!user) {
      this.renderPublicLandingPage();
    } else {
      this.switchToPortal("dashboard");
    }

    // 3. Try initializing Firebase sync if configured
    syncManager.initialize();

    // 4. License verification runs in BACKGROUND (non-blocking).
    // Portal features remain gated: switchToPortal re-checks license.
    this.checkLicenseInBackground();
  }

  /**
   * v2.1.1 — Background license check with timeout.
   * Never blocks the landing page. If unlicensed, the portal login
   * will show the activation prompt when the user tries to sign in.
   */
  async checkLicenseInBackground() {
    try {
      const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve("timeout"), 15000));
      const checkPromise = licenseManager.init(this.config).then(
        (ok) => (ok ? "licensed" : "unlicensed"),
        () => "unlicensed"
      );
      const result = await Promise.race([checkPromise, timeoutPromise]);

      if (result === "licensed" && licenseManager.licenseData?.schoolName &&
          (!this.config.schoolName || this.config.schoolName === "School Management System")) {
        this.config.schoolName = licenseManager.licenseData.schoolName;
        this.config.schoolShortName = licenseManager.licenseData.schoolName;
        saveAppConfig({ schoolName: licenseManager.licenseData.schoolName, schoolShortName: licenseManager.licenseData.schoolName });
        this.applyThemeAndBranding();
      }

      if (result !== "licensed") {
        console.warn("School Management System: license not verified (background check). Portal access will require activation.");
        // Mark for portal gate — do NOT lock the landing page
        this.licenseVerified = false;
      } else {
        this.licenseVerified = true;
      }
    } catch (e) {
      console.warn("Background license check failed:", e);
      this.licenseVerified = false;
    }
  }

  // --- Branding & Dynamic Theme ---
  applyThemeAndBranding() {
    this.config = getAppConfig();
    const root = document.documentElement;
    if (this.config.theme?.primaryColor) {
      root.style.setProperty("--primary", this.config.theme.primaryColor);
      root.style.setProperty("--primary-hover", this.config.theme.primaryHover || this.config.theme.primaryColor);
    }

    // Update School name titles in DOM
    document.querySelectorAll(".brand-name-text").forEach(el => el.textContent = this.config.schoolName);
    document.querySelectorAll(".brand-short-text").forEach(el => el.textContent = this.config.schoolShortName || this.config.schoolName);
    document.querySelectorAll(".brand-logo-text").forEach(el => el.textContent = this.config.logoText || "Edu");
    document.title = `${this.config.schoolName} - School Management Portal`;

    // Render fixed School Logo in sidebar
    document.querySelectorAll(".brand-logo-badge").forEach(el => {
      if (this.config.logoUrl && this.config.logoUrl.trim()) {
        el.innerHTML = `<img src="${this.config.logoUrl}" class="brand-logo-img" alt="${this.config.schoolName}">`;
        el.style.background = "#ffffff";
        el.style.padding = "2px";
      } else {
        el.innerHTML = `<i class="fa-solid fa-graduation-cap"></i>`;
        el.style.background = "";
        el.style.padding = "";
      }
    });
  }

  // --- Global Event Listeners ---
  bindGlobalEvents() {
    // License activated
    window.addEventListener("licenseActivated", async (e) => {
      this.showToast("Software License Activated & Verified!", "success");
      if (e.detail?.data?.schoolName) {
        this.config.schoolName = e.detail.data.schoolName;
        this.config.schoolShortName = e.detail.data.schoolName;
        saveAppConfig({ schoolName: e.detail.data.schoolName, schoolShortName: e.detail.data.schoolName });
        this.applyThemeAndBranding();
      }
      await db.init();
      const user = auth.getCurrentUser();
      if (!user) {
        this.renderPublicLandingPage();
      } else {
        this.switchToPortal("dashboard");
      }
      syncManager.initialize();
    });

    // Auth state changed
    window.addEventListener("authStateChanged", (e) => {
      if (e.detail.user) {
        this.hideAuthModal();
        this.switchToPortal("dashboard");
      } else {
        this.renderPublicLandingPage();
      }
    });

    // DB changed (Live refresh if current view is affected)
    window.addEventListener("dbChanged", () => {
      this.refreshCurrentView();
    });

    // Config updated
    window.addEventListener("configUpdated", () => {
      this.applyThemeAndBranding();
      this.refreshCurrentView();
    });

    // Sync status updates
    window.addEventListener("syncStatusChanged", (e) => {
      this.updateSyncUI(e.detail);
    });

    // Theme toggle
    const themeBtn = document.getElementById("themeToggleBtn");
    if (themeBtn) {
      themeBtn.addEventListener("click", () => {
        document.body.classList.toggle("light-theme");
        const isLight = document.body.classList.contains("light-theme");
        localStorage.setItem("educore_theme", isLight ? "light" : "dark");
        themeBtn.innerHTML = isLight ? '<i class="fa-solid fa-moon"></i>' : '<i class="fa-solid fa-sun"></i>';
      });
      // Restore theme
      if (localStorage.getItem("educore_theme") === "light") {
        document.body.classList.add("light-theme");
        themeBtn.innerHTML = '<i class="fa-solid fa-moon"></i>';
      }
    }

    // Sidebar mobile toggle (v2.2: drawer + backdrop + auto-close)
    const menuToggle = document.getElementById("menuToggleBtn");
    const sidebar = document.getElementById("sidebar");
    let sidebarBackdrop = document.getElementById("sidebarBackdrop");
    if (!sidebarBackdrop) {
      sidebarBackdrop = document.createElement("div");
      sidebarBackdrop.id = "sidebarBackdrop";
      sidebarBackdrop.className = "sidebar-backdrop";
      sidebarBackdrop.setAttribute("aria-hidden", "true");
      document.body.appendChild(sidebarBackdrop);
    }
    const closeSidebarDrawer = () => {
      sidebar?.classList.remove("mobile-open");
      sidebarBackdrop.classList.remove("visible");
    };
    const syncSidebarBackdrop = () => {
      // wait a tick so the class toggle above has applied
      requestAnimationFrame(() => {
        sidebarBackdrop.classList.toggle("visible", !!sidebar?.classList.contains("mobile-open"));
      });
    };
    if (menuToggle && sidebar) {
      menuToggle.addEventListener("click", () => {
        sidebar.classList.toggle("mobile-open");
        syncSidebarBackdrop();
      });
    }
    sidebarBackdrop.addEventListener("click", closeSidebarDrawer);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeSidebarDrawer();
    });
    // Auto-close drawer after tapping a nav item (mobile/tablet only)
    document.getElementById("sidebarNavMenu")?.addEventListener("click", (e) => {
      if (e.target.closest(".nav-item") && window.innerWidth <= 1024) {
        closeSidebarDrawer();
      }
    });
    // If resized to desktop while drawer open, reset state
    window.addEventListener("resize", () => {
      if (window.innerWidth > 1024) closeSidebarDrawer();
    });

    // Manual Quick Sync button
    const quickSyncBtn = document.getElementById("btnQuickSync");
    if (quickSyncBtn) {
      quickSyncBtn.addEventListener("click", async () => {
        this.showToast("Initiating Firebase sync...", "info");
        await syncManager.syncPendingQueue();
      });
    }

    // Global Search Input
    const globalSearch = document.getElementById("globalSearchInput");
    if (globalSearch) {
      globalSearch.addEventListener("input", (e) => {
        this.searchQuery = e.target.value.toLowerCase().trim();
        this.refreshCurrentView();
      });
    }
  }

  updateSyncUI(detail) {
    const dot = document.getElementById("syncStatusDot");
    const text = document.getElementById("syncStatusText");
    const headerPill = document.getElementById("headerSyncPill");

    if (!dot || !text) return;

    dot.className = `status-dot ${detail.state}`;

    if (detail.state === "online" || detail.state === "synced") {
      text.textContent = detail.lastSyncTime ? `Synced (${detail.lastSyncTime})` : "Cloud Connected";
      if (headerPill) headerPill.innerHTML = `<span class="status-dot online"></span> <span>Cloud Synced</span>`;
    } else if (detail.state === "offline") {
      text.textContent = "Offline (Local DB)";
      if (headerPill) headerPill.innerHTML = `<span class="status-dot offline"></span> <span>Offline Mode</span>`;
    } else if (detail.state === "syncing") {
      text.textContent = "Syncing...";
      if (headerPill) headerPill.innerHTML = `<span class="status-dot syncing"></span> <span>Syncing...</span>`;
    } else if (detail.state === "unconfigured") {
      text.textContent = "Local Only (IndexedDB)";
      if (headerPill) headerPill.innerHTML = `<span class="status-dot offline"></span> <span>Local Storage</span>`;
    } else {
      text.textContent = "Sync Notice";
    }
  }

  showToast(message, type = "info") {
    let container = document.getElementById("toastContainer");
    if (!container) {
      container = document.createElement("div");
      container.id = "toastContainer";
      container.style.cssText = "position:fixed; bottom:24px; right:24px; z-index:9999; display:flex; flex-direction:column; gap:10px; pointer-events:none;";
      document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = `toast-pill ${type}`;
    const bg = type === "success" ? "#10b981" : type === "error" ? "#ef4444" : type === "warning" ? "#f59e0b" : "#4f46e5";
    toast.style.cssText = `background: ${bg}; color: #fff; padding: 12px 20px; border-radius: 12px; font-size: 13.5px; font-weight: 600; box-shadow: 0 8px 24px rgba(0,0,0,0.3); pointer-events:auto; display:flex; align-items:center; gap:10px; animation: slideIn 0.3s ease;`;
    
    const icon = type === "success" ? "fa-circle-check" : type === "error" ? "fa-circle-exclamation" : "fa-circle-info";
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(10px)";
      toast.style.transition = "all 0.3s ease";
      setTimeout(() => toast.remove(), 300);
    }, 3800);
  }

  // --- Render Navigation Based on Role ---
  renderAppForUser(user) {
    // Populate user profile in top-right
    const userNameEl = document.getElementById("headerUserName");
    const userRoleEl = document.getElementById("headerUserRole");
    const userAvatarEl = document.getElementById("headerUserAvatar");

    if (userNameEl) userNameEl.textContent = user.name || user.email;
    if (userRoleEl) userRoleEl.textContent = user.role.toUpperCase();
    if (userAvatarEl && user.avatar) userAvatarEl.src = user.avatar;

    // Render Navigation Menu Items
    const navMenu = document.getElementById("sidebarNavMenu");
    if (!navMenu) return;

    let items = [];

    if (user.role === "admin") {
      items = [
        { id: "dashboard", label: "Dashboard", icon: "fa-chart-pie", section: "Main" },
        { id: "public_website", label: "Public Website", icon: "fa-globe" },
        { id: "students", label: "Students", icon: "fa-user-graduate" },
        { id: "teachers", label: "Teachers & Staff", icon: "fa-chalkboard-user" },
        { id: "classes", label: "Classes & Batches", icon: "fa-school" },
        { id: "attendance", label: "Attendance", icon: "fa-clipboard-check", section: "Academic" },
        { id: "fees", label: "Fee Management", icon: "fa-file-invoice-dollar" },
        { id: "grades", label: "Exams & Grades", icon: "fa-award" },
        { id: "notices", label: "Notice Board", icon: "fa-bullhorn" },
        { id: "landing_cms", label: "Landing Page CMS", icon: "fa-window-maximize", section: "System" },
        { id: "settings", label: "Settings & Cloud", icon: "fa-sliders" }
      ];
    } else if (user.role === "teacher") {
      items = [
        { id: "teacher_dashboard", label: "Teacher Dashboard", icon: "fa-chart-pie", section: "Portal" },
        { id: "public_website", label: "Public Website", icon: "fa-globe" },
        { id: "teacher_attendance", label: "Mark Attendance", icon: "fa-clipboard-check" },
        { id: "teacher_grades", label: "Gradebook", icon: "fa-award" },
        { id: "teacher_students", label: "My Students", icon: "fa-user-graduate" },
        { id: "notices", label: "School Notices", icon: "fa-bullhorn" }
      ];
    } else if (user.role === "student") {
      items = [
        { id: "student_dashboard", label: "My Student Portal", icon: "fa-graduation-cap", section: "Portal" },
        { id: "public_website", label: "Public Website", icon: "fa-globe" },
        { id: "student_attendance", label: "My Attendance", icon: "fa-calendar-check" },
        { id: "student_grades", label: "My Report Card", icon: "fa-file-lines" },
        { id: "student_fees", label: "My Fee Invoices", icon: "fa-receipt" },
        { id: "notices", label: "Announcements", icon: "fa-bullhorn" }
      ];
    }

    let menuHtml = "";
    let lastSection = "";

    items.forEach((item) => {
      if (item.section && item.section !== lastSection) {
        menuHtml += `<div class="nav-section-title">${item.section}</div>`;
        lastSection = item.section;
      }
      menuHtml += `
        <button class="nav-item ${this.currentView === item.id ? 'active' : ''}" data-view="${item.id}">
          <i class="fa-solid ${item.icon}"></i>
          <span>${item.label}</span>
        </button>
      `;
    });

    // Add logout item
    menuHtml += `
      <div class="nav-section-title" style="margin-top:auto;">Session</div>
      <button class="nav-item" id="btnLogoutNav" style="color:#f87171;">
        <i class="fa-solid fa-arrow-right-from-bracket"></i>
        <span>Sign Out</span>
      </button>
    `;

    navMenu.innerHTML = menuHtml;

    // Attach click events
    navMenu.querySelectorAll(".nav-item[data-view]").forEach(btn => {
      btn.addEventListener("click", () => {
        const viewId = btn.getAttribute("data-view");
        this.navigateTo(viewId);
      });
    });

    const logoutBtn = document.getElementById("btnLogoutNav");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => {
        auth.logout();
        this.showToast("Signed out successfully", "info");
      });
    }

    // Default view for role if view does not match
    const validViews = items.map(i => i.id);
    if (!validViews.includes(this.currentView)) {
      this.currentView = validViews[0];
    }

    this.refreshCurrentView();
  }

  // --- Switch between Landing Page and Portal ---
  switchToPortal(viewId = "dashboard") {
    // v2.1.1 — Portal stays license-gated even though boot no longer blocks on it
    if (!licenseManager.isValid && this.licenseVerified !== true) {
      licenseManager.showLockScreen("A valid commercial license is required to access the School Management Portal.");
      return;
    }
    const landing = document.getElementById("publicLandingPage");
    const appEl = document.getElementById("app");
    if (landing) landing.style.display = "none";
    if (appEl) appEl.style.display = "flex";
    
    this.currentView = viewId;
    const user = auth.getCurrentUser();
    if (user) {
      this.renderAppForUser(user);
    } else {
      this.showAuthModal("login");
    }
  }

  navigateTo(viewId) {
    if (!licenseManager.isValid) {
      licenseManager.showLockScreen("A valid commercial license is required to access the School Management System.");
      return;
    }
    if (viewId === "public_website") {
      this.renderPublicLandingPage();
      return;
    }
    if (viewId === "landing_cms") {
      this.currentSettingsTab = "landing_cms";
      this.currentView = "settings";
      document.querySelectorAll(".nav-item[data-view]").forEach(b => {
        b.classList.toggle("active", b.getAttribute("data-view") === "landing_cms");
      });
      document.getElementById("sidebar")?.classList.remove("mobile-open");
      this.refreshCurrentView();
      return;
    }
    this.currentView = viewId;
    document.querySelectorAll(".nav-item[data-view]").forEach(b => {
      b.classList.toggle("active", b.getAttribute("data-view") === viewId);
    });
    // Close mobile sidebar if open
    document.getElementById("sidebar")?.classList.remove("mobile-open");
    this.refreshCurrentView();
  }

  async refreshCurrentView() {
    if (!licenseManager.isValid) {
      licenseManager.showLockScreen("A valid commercial license is required to access the School Management System.");
      return;
    }
    const user = auth.getCurrentUser();
    if (!user) return;

    const contentArea = document.getElementById("mainContentArea");
    if (!contentArea) return;

    switch (this.currentView) {
      // Admin Views
      case "dashboard":
        contentArea.innerHTML = await this.renderAdminDashboard();
        this.bindAdminDashboardEvents();
        break;
      case "students":
        contentArea.innerHTML = await this.renderStudentsView();
        this.bindStudentsEvents();
        break;
      case "teachers":
        contentArea.innerHTML = await this.renderTeachersView();
        this.bindTeachersEvents();
        break;
      case "classes":
        contentArea.innerHTML = await this.renderClassesView();
        this.bindClassesEvents();
        break;
      case "attendance":
        contentArea.innerHTML = await this.renderAttendanceView();
        this.bindAttendanceEvents();
        break;
      case "fees":
        contentArea.innerHTML = await this.renderFeesView();
        this.bindFeesEvents();
        break;
      case "grades":
        contentArea.innerHTML = await this.renderGradesView();
        this.bindGradesEvents();
        break;
      case "notices":
        contentArea.innerHTML = await this.renderNoticesView();
        this.bindNoticesEvents();
        break;
      case "settings":
        contentArea.innerHTML = await this.renderSettingsView();
        this.bindSettingsEvents();
        break;

      // Teacher Views
      case "teacher_dashboard":
        contentArea.innerHTML = await this.renderTeacherDashboard();
        break;
      case "teacher_attendance":
        contentArea.innerHTML = await this.renderTeacherAttendanceView();
        this.bindTeacherAttendanceEvents();
        break;
      case "teacher_grades":
        contentArea.innerHTML = await this.renderTeacherGradesView();
        this.bindTeacherGradesEvents();
        break;
      case "teacher_students":
        contentArea.innerHTML = await this.renderTeacherStudentsView();
        break;

      // Student Views
      case "student_dashboard":
        contentArea.innerHTML = await this.renderStudentDashboard();
        break;
      case "student_attendance":
        contentArea.innerHTML = await this.renderStudentAttendanceView();
        break;
      case "student_grades":
        contentArea.innerHTML = await this.renderStudentGradesView();
        this.bindStudentGradesEvents();
        break;
      case "student_fees":
        contentArea.innerHTML = await this.renderStudentFeesView();
        this.bindStudentFeesEvents();
        break;

      default:
        contentArea.innerHTML = `<div class="card"><h2>View not found</h2></div>`;
    }
  }

  // =========================================================================
  // 1. ADMIN DASHBOARD VIEW
  // =========================================================================
  async renderAdminDashboard() {
    const students = await db.getAll(STORES.STUDENTS);
    const teachers = await db.getAll(STORES.TEACHERS);
    const classes = await db.getAll(STORES.CLASSES);
    const fees = await db.getAll(STORES.FEES);
    const notices = await db.getAll(STORES.NOTICES);
    const inquiries = await db.getAll(STORES.INQUIRIES);

    const totalRevenue = fees.filter(f => f.status === "paid").reduce((sum, f) => sum + Number(f.amount || 0), 0);
    const pendingFees = fees.filter(f => f.status === "pending").reduce((sum, f) => sum + Number(f.amount || 0), 0);

    return `
      <div class="page-header">
        <div class="page-title-group">
          <h1>Campus Overview & Analytics</h1>
          <p>Real-time school performance, offline resilience, and Firebase cloud sync.</p>
        </div>
        <div class="page-actions-group">
          <button class="btn btn-secondary" id="btnAdminExportJson">
            <i class="fa-solid fa-file-export"></i> Backup Database
          </button>
          <button class="btn btn-primary" id="btnAdminAddStudentQuick">
            <i class="fa-solid fa-user-plus"></i> Enroll Student
          </button>
        </div>
      </div>

      <!-- Quick KPI Cards -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-details">
            <span class="stat-label">Total Enrolled</span>
            <span class="stat-value">${students.length}</span>
            <div class="stat-trend positive">
              <i class="fa-solid fa-arrow-up"></i> Active Scholars
            </div>
          </div>
          <div class="stat-icon indigo">
            <i class="fa-solid fa-graduation-cap"></i>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-details">
            <span class="stat-label">Faculty Staff</span>
            <span class="stat-value">${teachers.length}</span>
            <div class="stat-trend positive">
              <i class="fa-solid fa-user-tie"></i> Qualified Teachers
            </div>
          </div>
          <div class="stat-icon sky">
            <i class="fa-solid fa-chalkboard-user"></i>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-details">
            <span class="stat-label">Fee Revenue</span>
            <span class="stat-value">${this.config.currency}${totalRevenue.toLocaleString()}</span>
            <div class="stat-trend positive">
              <i class="fa-solid fa-circle-check"></i> Paid Invoices
            </div>
          </div>
          <div class="stat-icon emerald">
            <i class="fa-solid fa-vault"></i>
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-details">
            <span class="stat-label">Pending Dues</span>
            <span class="stat-value">${this.config.currency}${pendingFees.toLocaleString()}</span>
            <div class="stat-trend neutral">
              <i class="fa-solid fa-clock"></i> Awaiting Collection
            </div>
          </div>
          <div class="stat-icon amber">
            <i class="fa-solid fa-receipt"></i>
          </div>
        </div>
      </div>

      <!-- Dashboard Two Column Grid -->
      <div style="display:grid; grid-template-columns: 2fr 1fr; gap:24px;">
        
        <!-- Recent Students Table -->
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Recent Student Admissions</h3>
            <button class="btn btn-secondary btn-sm" id="btnViewAllStudents">View Directory</button>
          </div>
          <div class="table-container">
            <table class="custom-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Admission #</th>
                  <th>Class</th>
                  <th>Guardian</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${students.slice(0, 5).map(s => `
                  <tr>
                    <td>
                      <div class="table-user-cell">
                        <img src="${s.photoUrl || 'https://api.dicebear.com/7.x/bottts/svg?seed=' + s.name}" class="table-avatar" alt="Avatar">
                        <div>
                          <strong>${s.name}</strong>
                          <div style="font-size:11px; color:var(--text-muted);">${s.email}</div>
                        </div>
                      </div>
                    </td>
                    <td><code style="font-size:12px;">${s.admissionNo}</code></td>
                    <td>${s.className}</td>
                    <td>${s.parentName}</td>
                    <td><span class="badge badge-success">Active</span></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Latest Announcements Card -->
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Campus Broadcasts</h3>
            <button class="btn btn-secondary btn-sm" id="btnAdminAddNotice">Post</button>
          </div>
          <div style="display:flex; flex-direction:column; gap:14px;">
            ${notices.slice(0, 3).map(n => `
              <div style="padding:14px; background:rgba(255,255,255,0.03); border:1px solid var(--border-subtle); border-radius:var(--radius-md);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                  <span class="badge ${n.priority === 'urgent' ? 'badge-danger' : 'badge-info'}">${n.priority.toUpperCase()}</span>
                  <span style="font-size:11px; color:var(--text-dim);">${n.date}</span>
                </div>
                <strong style="font-size:13.5px; display:block; margin-bottom:4px;">${n.title}</strong>
                <p style="font-size:12px; color:var(--text-muted); line-height:1.4;">${n.content.slice(0, 110)}...</p>
              </div>
            `).join("")}
          </div>
        </div>

      </div>

      <!-- Online Admissions & Enrollment Inquiries Hub -->
      <div class="card" style="margin-top:24px;">
        <div class="card-header">
          <div>
            <h3 class="card-title"><i class="fa-solid fa-file-signature" style="color:var(--primary); margin-right:6px;"></i> Online Admissions & Enrollment Inquiries</h3>
            <span style="font-size:12px; color:var(--text-muted);">Incoming applications submitted by parents & scholars via Public Website</span>
          </div>
          <span class="badge ${inquiries.filter(i => i.status === 'Pending').length > 0 ? 'badge-warning' : 'badge-success'}">
            ${inquiries.filter(i => i.status === 'Pending').length} Pending Inquiries
          </span>
        </div>
        <div class="table-container">
          <table class="custom-table">
            <thead>
              <tr>
                <th>Applicant Scholar</th>
                <th>Desired Grade</th>
                <th>Guardian</th>
                <th>Contact Phone</th>
                <th>Date Applied</th>
                <th>Status</th>
                <th style="text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${inquiries.length === 0 ? `
                <tr>
                  <td colspan="7" style="text-align:center; padding:32px; color:var(--text-dim);">
                    <i class="fa-solid fa-inbox" style="font-size:28px; display:block; margin-bottom:8px; opacity:0.4;"></i>
                    No online admission inquiries yet. Visitors can submit applications on your Public School Website.
                  </td>
                </tr>
              ` : inquiries.map(inq => `
                <tr>
                  <td>
                    <strong>${inq.name}</strong>
                    <div style="font-size:11px; color:var(--text-muted);"><i class="fa-solid fa-id-card"></i> ${inq.cnic || '—'}</div>
                  </td>
                  <td><span class="badge badge-info">${inq.className || 'General'}</span></td>
                  <td>${inq.parentName || '—'}</td>
                  <td>
                    <strong>${inq.phone || '—'}</strong>
                  </td>
                  <td>${inq.createdAt ? inq.createdAt.split('T')[0] : 'Today'}</td>
                  <td>
                    <span class="badge ${inq.status === 'Enrolled' ? 'badge-success' : 'badge-warning'}">
                      ${inq.status || 'Pending'}
                    </span>
                  </td>
                  <td style="text-align:right;">
                    <div style="display:inline-flex; gap:6px;">
                      ${inq.status !== 'Enrolled' ? `
                        <button class="btn btn-primary btn-sm btn-approve-inquiry" data-id="${inq.id}" title="Enroll as Active Student">
                          <i class="fa-solid fa-user-check"></i> Enroll
                        </button>
                      ` : `
                        <span style="font-size:12px; color:#10b981; font-weight:700;"><i class="fa-solid fa-check"></i> Enrolled</span>
                      `}
                      <a href="https://wa.me/92${(inq.phone || '').replace(/\D/g, '').replace(/^0/, '')}?text=Assalam-o-Alaikum%20regarding%20your%20admission%20application%20at%20${encodeURIComponent(this.config.schoolName)}" target="_blank" class="icon-action-btn" style="color:#22c55e;" title="Chat on WhatsApp">
                        <i class="fa-brands fa-whatsapp"></i>
                      </a>
                      <button class="icon-action-btn btn-delete-inquiry" data-id="${inq.id}" style="color:#f87171;" title="Delete Inquiry">
                        <i class="fa-solid fa-trash-can"></i>
                      </button>
                    </div>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  bindAdminDashboardEvents() {
    document.getElementById("btnAdminAddStudentQuick")?.addEventListener("click", () => this.showStudentModal());
    document.getElementById("btnViewAllStudents")?.addEventListener("click", () => this.navigateTo("students"));
    document.getElementById("btnAdminAddNotice")?.addEventListener("click", () => this.showNoticeModal());
    document.getElementById("btnAdminExportJson")?.addEventListener("click", () => this.exportDatabaseBackup());

    document.querySelectorAll(".btn-approve-inquiry").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const inq = await db.getById(STORES.INQUIRIES, id);
        if (!inq) return;

        const newStudent = {
          id: `std_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
          admissionNo: `ADM-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`,
          name: inq.name.trim(),
          cnic: inq.cnic || "",
          phone: inq.phone || "",
          parentName: inq.parentName || "",
          parentPhone: inq.phone || "",
          parentCnic: "",
          email: `${inq.name.toLowerCase().replace(/\s+/g, '')}@student.portal`,
          classId: inq.classId || "cls_01",
          className: inq.className || "Class 1",
          rollNo: `R-${Math.floor(10 + Math.random() * 90)}`,
          gender: "Male",
          status: "Active",
          joinedDate: new Date().toISOString().split("T")[0],
          photoUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(inq.name)}`
        };

        await db.add(STORES.STUDENTS, newStudent);
        inq.status = "Enrolled";
        await db.update(STORES.INQUIRIES, inq);
        this.showToast(`Scholar ${inq.name} enrolled with Admission # ${newStudent.admissionNo}!`, "success");
        this.refreshCurrentView();
      });
    });

    document.querySelectorAll(".btn-delete-inquiry").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        if (confirm("Delete this online admission inquiry?")) {
          await db.delete(STORES.INQUIRIES, id);
          this.showToast("Inquiry deleted", "info");
          this.refreshCurrentView();
        }
      });
    });
  }

  // =========================================================================
  // 2. STUDENTS VIEW
  // =========================================================================
  async renderStudentsView() {
    const students = await db.getAll(STORES.STUDENTS);
    const classes = await db.getAll(STORES.CLASSES);

    const filtered = students.filter(s => {
      const q = this.searchQuery;
      const matchSearch = !q || 
        s.name.toLowerCase().includes(q) || 
        (s.cnic && s.cnic.toLowerCase().includes(q)) ||
        (s.phone && s.phone.includes(q)) ||
        (s.parentPhone && s.parentPhone.includes(q)) ||
        s.admissionNo.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q);
      const matchClass = this.classFilter === "all" || s.classId === this.classFilter;
      return matchSearch && matchClass;
    });

    return `
      <div class="page-header">
        <div class="page-title-group">
          <h1>Student Directory</h1>
          <p>Manage scholar profiles, B-Form CNIC, class assignments, mobile contacts, and student ID cards.</p>
        </div>
        <div class="page-actions-group">
          <select class="form-control" id="classFilterSelect" style="width:180px;">
            <option value="all">All Classes</option>
            ${classes.map(c => `<option value="${c.id}" ${this.classFilter === c.id ? 'selected' : ''}>${c.name} - ${c.section}</option>`).join("")}
          </select>
          <button class="btn btn-primary" id="btnAddNewStudent">
            <i class="fa-solid fa-plus"></i> New Student
          </button>
        </div>
      </div>

      <div class="card">
        <div class="table-container">
          <table class="custom-table">
            <thead>
              <tr>
                <th>Scholar & B-Form</th>
                <th>Admission No</th>
                <th>Class & Section</th>
                <th>Guardian & Mobile</th>
                <th>Enrollment Date</th>
                <th style="text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.length === 0 ? `<tr><td colspan="6" style="text-align:center; padding:32px; color:var(--text-muted);">No student records found matching filter.</td></tr>` : 
                filtered.map(s => `
                <tr>
                  <td>
                    <div class="table-user-cell">
                      <img src="${s.photoUrl || 'https://api.dicebear.com/7.x/bottts/svg?seed=' + s.name}" class="table-avatar" alt="Avatar">
                      <div>
                        <strong>${s.name}</strong>
                        <div style="font-size:11px; color:var(--text-muted);"><i class="fa-solid fa-id-card"></i> <code>${s.cnic || '—'}</code></div>
                      </div>
                    </div>
                  </td>
                  <td><code>${s.admissionNo}</code></td>
                  <td><span class="badge badge-info">${s.className}</span></td>
                  <td>
                    <div>${s.parentName}</div>
                    <div style="font-size:11px; color:var(--text-dim);"><i class="fa-solid fa-phone"></i> ${s.phone || s.parentPhone || '—'}</div>
                  </td>
                  <td>${s.joinedDate || '2024-09-01'}</td>
                  <td style="text-align:right;">
                    <div style="display:inline-flex; gap:6px;">
                      <button class="icon-action-btn btn-print-id-card" data-id="${s.id}" title="Print Student ID Card">
                        <i class="fa-solid fa-id-card"></i>
                      </button>
                      <button class="icon-action-btn btn-print-admission-card" data-id="${s.id}" title="Print Admission Card / Slip">
                        <i class="fa-solid fa-file-invoice"></i>
                      </button>
                      <button class="icon-action-btn btn-print-student-transcript" data-id="${s.id}" title="Print Academic Transcript / Report Card">
                        <i class="fa-solid fa-graduation-cap"></i>
                      </button>
                      <button class="icon-action-btn btn-print-character-cert" data-id="${s.id}" title="Print Official Character Certificate (1-Click)" style="color:#0284c7;">
                        <i class="fa-solid fa-certificate"></i>
                      </button>
                      <button class="icon-action-btn btn-edit-student" data-id="${s.id}" title="Edit Student">
                        <i class="fa-solid fa-pen-to-square"></i>
                      </button>
                      <button class="icon-action-btn btn-delete-student" data-id="${s.id}" title="Delete" style="color:#f87171;">
                        <i class="fa-solid fa-trash-can"></i>
                      </button>
                    </div>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  bindStudentsEvents() {
    document.getElementById("btnAddNewStudent")?.addEventListener("click", () => this.showStudentModal());

    document.getElementById("classFilterSelect")?.addEventListener("change", (e) => {
      this.classFilter = e.target.value;
      this.refreshCurrentView();
    });

    document.querySelectorAll(".btn-print-id-card").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        this.showStudentIdCardModal(id);
      });
    });

    document.querySelectorAll(".btn-print-admission-card").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        this.showAdmissionCardModal(id);
      });
    });

    document.querySelectorAll(".btn-print-student-transcript").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        this.showReportCardModal(id);
      });
    });

    document.querySelectorAll(".btn-print-character-cert").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        this.showCharacterCertificateModal(id);
      });
    });

    document.querySelectorAll(".btn-edit-student").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        this.showStudentModal(id);
      });
    });

    document.querySelectorAll(".btn-delete-student").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        if (confirm("Are you sure you want to remove this student? All linked records will be updated.")) {
          await db.delete(STORES.STUDENTS, id);
          this.showToast("Student deleted successfully", "success");
        }
      });
    });
  }

  // =========================================================================
  // 3. TEACHERS & STAFF VIEW
  // =========================================================================
  async renderTeachersView() {
    const teachers = await db.getAll(STORES.TEACHERS);

    return `
      <div class="page-header">
        <div class="page-title-group">
          <h1>Faculty & Teaching Staff</h1>
          <p>Qualified instructors, assigned subject departments, and academic credentials.</p>
        </div>
        <div class="page-actions-group">
          <button class="btn btn-primary" id="btnAddNewTeacher">
            <i class="fa-solid fa-plus"></i> Add Faculty Member
          </button>
        </div>
      </div>

      <div class="card">
        <div class="table-container">
          <table class="custom-table">
            <thead>
              <tr>
                <th>Faculty & CNIC</th>
                <th>Employee ID</th>
                <th>Department</th>
                <th>Mobile Phone</th>
                <th>Qualifications</th>
                <th>Classes Assigned</th>
                <th style="text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${teachers.map(t => `
                <tr>
                  <td>
                    <div class="table-user-cell">
                      <img src="${t.avatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + t.name}" class="table-avatar" alt="Avatar">
                      <div>
                        <strong>${t.name}</strong>
                        <div style="font-size:11px; color:var(--text-muted);"><i class="fa-solid fa-id-card"></i> <code>${t.cnic || '—'}</code></div>
                      </div>
                    </div>
                  </td>
                  <td><code>${t.employeeId}</code></td>
                  <td><strong>${t.subject}</strong></td>
                  <td><div><i class="fa-solid fa-phone" style="font-size:11px; color:var(--text-dim);"></i> ${t.phone || '—'}</div></td>
                  <td><span style="font-size:12px; color:var(--text-muted);">${t.qualification}</span></td>
                  <td>
                    ${(t.assignedClasses || []).map(c => `<span class="badge badge-info" style="margin-right:4px;">${c}</span>`).join("")}
                  </td>
                  <td style="text-align:right;">
                    <div style="display:inline-flex; gap:6px;">
                      <button class="icon-action-btn btn-print-experience-cert" data-id="${t.id}" title="Print Faculty Experience Certificate (1-Click)" style="color:#10b981;">
                        <i class="fa-solid fa-award"></i>
                      </button>
                      <button class="icon-action-btn btn-edit-teacher" data-id="${t.id}" title="Edit">
                        <i class="fa-solid fa-pen-to-square"></i>
                      </button>
                      <button class="icon-action-btn btn-delete-teacher" data-id="${t.id}" title="Delete" style="color:#f87171;">
                        <i class="fa-solid fa-trash-can"></i>
                      </button>
                    </div>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  bindTeachersEvents() {
    document.getElementById("btnAddNewTeacher")?.addEventListener("click", () => this.showTeacherModal());

    document.querySelectorAll(".btn-print-experience-cert").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        this.showTeacherExperienceCertificateModal(id);
      });
    });

    document.querySelectorAll(".btn-edit-teacher").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        this.showTeacherModal(id);
      });
    });

    document.querySelectorAll(".btn-delete-teacher").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        if (confirm("Delete this teacher record?")) {
          await db.delete(STORES.TEACHERS, id);
          this.showToast("Teacher record deleted", "success");
        }
      });
    });
  }

  // =========================================================================
  // 4. CLASSES & BATCHES VIEW
  // =========================================================================
  async renderClassesView() {
    const classes = await db.getAll(STORES.CLASSES);
    const students = await db.getAll(STORES.STUDENTS);

    return `
      <div class="page-header">
        <div class="page-title-group">
          <h1>Classes, Grades & Sections</h1>
          <p>Academic rosters, subject curriculums, and batch capacities.</p>
        </div>
        <div class="page-actions-group">
          <button class="btn btn-primary" id="btnAddNewClass">
            <i class="fa-solid fa-plus"></i> Add New Class
          </button>
        </div>
      </div>

      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap:20px;">
        ${classes.map(c => {
          const enrolledCount = students.filter(s => s.classId === c.id).length;
          return `
            <div class="card">
              <div class="card-header">
                <div>
                  <h3 class="card-title">${c.name} - ${c.section}</h3>
                  <span style="font-size:12px; color:var(--text-dim);"><i class="fa-solid fa-door-open"></i> ${c.room || 'Room Unassigned'}</span>
                </div>
                <span class="badge badge-success">${enrolledCount} / ${c.capacity} Enrolled</span>
              </div>
              <div style="margin-bottom:14px;">
                <span style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--text-muted); display:block; margin-bottom:6px;">Curriculum Subjects</span>
                <div style="display:flex; flex-wrap:wrap; gap:6px;">
                  ${(c.subjects || []).map(s => `<span class="badge badge-info">${s}</span>`).join("")}
                </div>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border-subtle); padding-top:12px; margin-top:12px;">
                <span style="font-size:12px; color:var(--text-dim);">Capacity: ${c.capacity} Scholars</span>
                <button class="btn btn-secondary btn-sm btn-delete-class" data-id="${c.id}" style="color:#f87171;">
                  <i class="fa-solid fa-trash"></i>
                </button>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  bindClassesEvents() {
    document.getElementById("btnAddNewClass")?.addEventListener("click", () => this.showClassModal());
    document.querySelectorAll(".btn-delete-class").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        if (confirm("Delete this class?")) {
          await db.delete(STORES.CLASSES, id);
          this.showToast("Class removed", "success");
        }
      });
    });
  }

  // =========================================================================
  // 5. ATTENDANCE VIEW (ADMIN OVERVIEW)
  // =========================================================================
  async renderAttendanceView() {
    const classes = await db.getAll(STORES.CLASSES);
    const attendanceRecords = await db.getAll(STORES.ATTENDANCE);
    const today = new Date().toISOString().split("T")[0];

    return `
      <div class="page-header">
        <div class="page-title-group">
          <h1>Attendance Logs & Records</h1>
          <p>School-wide daily presence metrics and logs.</p>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Class Daily Attendance Logs</h3>
        </div>
        <div class="table-container">
          <table class="custom-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Class</th>
                <th>Recorded By</th>
                <th>Present</th>
                <th>Late</th>
                <th>Absent</th>
                <th>Attendance %</th>
              </tr>
            </thead>
            <tbody>
              ${attendanceRecords.length === 0 ? `<tr><td colspan="7" style="text-align:center; padding:24px;">No attendance records found yet.</td></tr>` :
                attendanceRecords.map(a => {
                  const summary = a.summary || { present: 0, late: 0, absent: 0, total: 1 };
                  const pct = Math.round(((summary.present + summary.late) / (summary.total || 1)) * 100);
                  return `
                    <tr>
                      <td><strong>${a.date}</strong></td>
                      <td>${a.className || a.classId}</td>
                      <td>${a.markedBy || 'Teacher'}</td>
                      <td><span class="badge badge-success">${summary.present} Present</span></td>
                      <td><span class="badge badge-warning">${summary.late} Late</span></td>
                      <td><span class="badge badge-danger">${summary.absent} Absent</span></td>
                      <td><strong>${pct}%</strong></td>
                    </tr>
                  `;
                }).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  bindAttendanceEvents() {}

  // =========================================================================
  // 6. FEE MANAGEMENT VIEW & PRINTABLE RECEIPT
  // =========================================================================
  async renderFeesView() {
    const fees = await db.getAll(STORES.FEES);
    const students = await db.getAll(STORES.STUDENTS);
    const studentMap = {};
    students.forEach(s => { studentMap[s.id] = s; });

    // v2.0 — defaulter stats
    const pending = fees.filter(f => f.status === "pending");
    const overdue = pending.filter(f => daysOverdue(f.dueDate) > 0);
    const pendingTotal = pending.reduce((s, f) => s + Number(f.amount || 0), 0);

    // v2.1 — pending online payment verifications
    let pendingVerifs = [];
    try {
      const allPays = await db.getAll(STORES.ONLINE_PAYMENTS);
      pendingVerifs = allPays.filter(p => p.status === "pending");
    } catch (e) { pendingVerifs = []; }

    return `
      <div class="page-header">
        <div class="page-title-group">
          <h1>Tuition & Fee Management</h1>
          <p>Invoice generation, fee collection tracking, and printable official receipts.</p>
        </div>
        <div class="page-actions-group">
          <button class="btn btn-success" id="btnRemindAllDefaulters" title="Open WhatsApp reminders for all pending fees">
            <i class="fa-brands fa-whatsapp"></i> Remind All Defaulters${pending.length ? ` (${pending.length})` : ""}
          </button>
          <button class="btn btn-primary" id="btnCreateFeeInvoice">
            <i class="fa-solid fa-file-invoice"></i> Issue Invoice
          </button>
        </div>
      </div>

      ${pending.length ? `
      <div class="card" style="border-left:4px solid #f59e0b; margin-bottom:16px;">
        <div style="display:flex; gap:24px; align-items:center; flex-wrap:wrap; padding:4px 8px;">
          <div><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i>
            <strong>${pending.length}</strong> pending invoices</div>
          <div><strong>${this.config.currency}${pendingTotal.toLocaleString()}</strong> total outstanding</div>
          <div><strong>${overdue.length}</strong> overdue</div>
          <span style="color:#64748b; font-size:0.9em;">v2.0 — WhatsApp reminders enabled</span>
        </div>
      </div>` : ""}

      ${pendingVerifs.length ? `
      <div class="card" style="border-left:4px solid #0ea5e9; margin-bottom:16px;">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
          <h3 class="card-title"><i class="fa-solid fa-money-bill-transfer" style="color:#0ea5e9;"></i> Pending Online Payment Verifications (${pendingVerifs.length})</h3>
          <span class="badge badge-info">v2.1</span>
        </div>
        <div class="table-container">
          <table class="custom-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Amount</th>
                <th>Method</th>
                <th>TID / Reference</th>
                <th>Sender Phone</th>
                <th>Date</th>
                <th style="text-align:right;">Verify</th>
              </tr>
            </thead>
            <tbody>
              ${pendingVerifs.map(p => `
                <tr>
                  <td><strong>${p.studentName}</strong></td>
                  <td><strong>${this.config.currency}${Number(p.amount).toLocaleString()}</strong></td>
                  <td><span class="badge badge-info">${methodLabel(p.method)}</span></td>
                  <td><code>${p.tid || "—"}</code></td>
                  <td>${p.senderPhone || "—"}</td>
                  <td>${p.date || "—"}</td>
                  <td style="text-align:right;">
                    <div style="display:inline-flex; gap:6px;">
                      <button class="btn btn-success btn-sm btn-verify-online-pay" data-id="${p.id}">
                        <i class="fa-solid fa-check"></i> Verify
                      </button>
                      <button class="btn btn-danger btn-sm btn-reject-online-pay" data-id="${p.id}">
                        <i class="fa-solid fa-xmark"></i> Reject
                      </button>
                    </div>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>` : ""}

      <div class="card">
        <div class="table-container">
          <table class="custom-table">
            <thead>
              <tr>
                <th>Receipt / Invoice</th>
                <th>Student</th>
                <th>Fee Particulars</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Due / Paid Date</th>
                <th style="text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${fees.map(f => `
                <tr>
                  <td><code>${f.receiptNo}</code></td>
                  <td><strong>${f.studentName}</strong></td>
                  <td>${f.type}</td>
                  <td><strong>${this.config.currency}${Number(f.amount).toLocaleString()}</strong></td>
                  <td>
                    <span class="badge ${f.status === 'paid' ? 'badge-success' : 'badge-warning'}">
                      ${f.status.toUpperCase()}
                    </span>
                  </td>
                  <td>${f.paidDate ? `Paid on ${f.paidDate}` : `Due: ${f.dueDate}`}</td>
                  <td style="text-align:right;">
                    <div style="display:inline-flex; gap:6px;">
                      ${f.status === 'pending' ? `
                        <button class="btn btn-success btn-sm btn-mark-fee-paid" data-id="${f.id}">
                          <i class="fa-solid fa-check"></i> Collect
                        </button>
                        <button class="icon-action-btn btn-wa-remind" data-id="${f.id}" title="Send WhatsApp fee reminder to parent" style="color:#25D366;">
                          <i class="fa-brands fa-whatsapp"></i>
                        </button>
                        <button class="btn btn-info btn-sm btn-record-online-pay" data-id="${f.id}" title="Record online payment (JazzCash / EasyPaisa) with TID">
                          <i class="fa-solid fa-money-bill-transfer"></i> Online
                        </button>
                      ` : ''}
                      <button class="icon-action-btn btn-print-receipt" data-id="${f.id}" title="Print Official Receipt">
                        <i class="fa-solid fa-receipt"></i>
                      </button>
                      <button class="icon-action-btn btn-print-fee-cert" data-id="${f.id}" title="Print Fee Clearance Certificate">
                        <i class="fa-solid fa-certificate"></i>
                      </button>
                    </div>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  bindFeesEvents() {
    document.getElementById("btnCreateFeeInvoice")?.addEventListener("click", () => this.showFeeInvoiceModal());

    document.querySelectorAll(".btn-mark-fee-paid").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const fee = await db.getById(STORES.FEES, id);
        if (fee) {
          fee.status = "paid";
          fee.paidDate = new Date().toISOString().split("T")[0];
          fee.paymentMethod = "Cash / Card Portal";
          await db.update(STORES.FEES, fee);
          this.showToast("Payment recorded! You can now print the receipt.", "success");
        }
      });
    });

    document.querySelectorAll(".btn-print-receipt").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        this.showPrintableReceiptModal(id);
      });
    });

    document.querySelectorAll(".btn-print-fee-cert").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        this.showFeeCertificateModal(id);
      });
    });

    // v2.0 — WhatsApp fee reminders
    document.querySelectorAll(".btn-wa-remind").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const fee = await db.getById(STORES.FEES, id);
        if (!fee) return;
        const student = await db.getById(STORES.STUDENTS, fee.studentId);
        const phone = student ? (student.phone || student.parentPhone) : null;
        const msg = feeReminderMessage(fee.studentName, fee, this.config, 1);
        const link = waLink(phone, msg);
        if (!link) {
          this.showToast("Parent mobile number missing for this student.", "error");
          return;
        }
        window.open(link, "_blank");
      });
    });

    document.getElementById("btnRemindAllDefaulters")?.addEventListener("click", async () => {
      const fees = await db.getAll(STORES.FEES);
      const pending = fees.filter(f => f.status === "pending");
      if (!pending.length) {
        this.showToast("No pending fees — all clear!", "success");
        return;
      }
      // Build a chooser list: one WhatsApp link per defaulter
      const students = await db.getAll(STORES.STUDENTS);
      const studentMap = {};
      students.forEach(s => { studentMap[s.id] = s; });
      const rows = pending.map(f => {
        const st = studentMap[f.studentId];
        const phone = st ? (st.phone || st.parentPhone) : null;
        const link = waLink(phone, feeReminderMessage(f.studentName, f, this.config, 1));
        const od = daysOverdue(f.dueDate);
        return `<div style="display:flex; align-items:center; justify-content:space-between; padding:10px 4px; border-bottom:1px solid #eef2f7;">
          <div>
            <strong>${f.studentName}</strong>
            <span style="color:#64748b;"> — ${this.config.currency}${Number(f.amount).toLocaleString()}${od ? ` · <span style="color:#dc2626;">${od}d overdue</span>` : ""}</span>
          </div>
          ${link
            ? `<a class="btn btn-success btn-sm" href="${link}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i> Remind</a>`
            : `<span class="badge badge-warning">No number</span>`}
        </div>`;
      }).join("");
      const summary = defaulterSummaryText(pending, this.config);
      this.openModal(
        `Fee Defaulters — WhatsApp Reminders (${pending.length})`,
        `<p style="color:#64748b; margin-bottom:12px;">Click <strong>Remind</strong> to open WhatsApp with a pre-filled polite reminder for each parent.</p>
         <div style="max-height:380px; overflow-y:auto;">${rows}</div>`,
        `<button class="btn btn-secondary" id="btnCopyDefaulterSummary">Copy Summary</button>
         <button class="btn btn-secondary" onclick="window.schoolApp.closeModal()">Close</button>`
      );
      document.getElementById("btnCopyDefaulterSummary")?.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(summary);
          this.showToast("Defaulter summary copied!", "success");
        } catch (e) {
          this.showToast("Copy failed — select the text manually.", "error");
        }
      });
    });

    // v2.1 — record an online payment (parent sent fee, shares TID)
    document.querySelectorAll(".btn-record-online-pay").forEach(btn => {
      btn.addEventListener("click", () => {
        this.showOnlinePaymentModal(btn.getAttribute("data-id"));
      });
    });

    // v2.1 — verify a pending online payment → invoice paid
    document.querySelectorAll(".btn-verify-online-pay").forEach(btn => {
      btn.addEventListener("click", async () => {
        const pay = await db.getById(STORES.ONLINE_PAYMENTS, btn.getAttribute("data-id"));
        if (!pay || pay.status !== "pending") return;
        const today = new Date().toISOString().split("T")[0];
        pay.status = "verified";
        pay.verifiedAt = today;
        await db.update(STORES.ONLINE_PAYMENTS, pay);
        const fee = await db.getById(STORES.FEES, pay.feeId);
        if (fee) {
          fee.status = "paid";
          fee.paidDate = today;
          fee.paymentMethod = `${methodLabel(pay.method)} (TID ${pay.tid || "—"})`;
          await db.update(STORES.FEES, fee);
        }
        this.showToast("Payment verified — invoice marked PAID!", "success");
        this.refreshCurrentView();
      });
    });

    // v2.1 — reject a pending online payment
    document.querySelectorAll(".btn-reject-online-pay").forEach(btn => {
      btn.addEventListener("click", async () => {
        const pay = await db.getById(STORES.ONLINE_PAYMENTS, btn.getAttribute("data-id"));
        if (!pay || pay.status !== "pending") return;
        pay.status = "rejected";
        await db.update(STORES.ONLINE_PAYMENTS, pay);
        this.showToast("Payment rejected.", "info");
        this.refreshCurrentView();
      });
    });
  }

  // =========================================================================
  // 7. EXAMS & GRADES VIEW
  // =========================================================================
  async renderGradesView() {
    const grades = await db.getAll(STORES.GRADES);

    return `
      <div class="page-header">
        <div class="page-title-group">
          <h1>Examinations & Academic Grades</h1>
          <p>Standardized term grading, marks entry, and transcript recording.</p>
        </div>
        <div class="page-actions-group">
          <button class="btn btn-primary" id="btnAdminAddGrade">
            <i class="fa-solid fa-plus"></i> Record Grade
          </button>
        </div>
      </div>

      <div class="card">
        <div class="table-container">
          <table class="custom-table">
            <thead>
              <tr>
                <th>Scholar</th>
                <th>Examination</th>
                <th>Subject</th>
                <th>Score</th>
                <th>Grade</th>
                <th>Remarks</th>
                <th style="text-align:right;">Transcript</th>
              </tr>
            </thead>
            <tbody>
              ${grades.map(g => `
                <tr>
                  <td><strong>${g.studentName}</strong></td>
                  <td>${g.examName}</td>
                  <td>${g.subject}</td>
                  <td><strong>${g.marksObtained} / ${g.maxMarks}</strong></td>
                  <td><span class="badge badge-success">${g.grade}</span></td>
                  <td style="font-size:12.5px; color:var(--text-muted);">${g.remarks || '—'}</td>
                  <td style="text-align:right;">
                    <button class="icon-action-btn btn-wa-result" data-id="${g.id}" title="Share result on WhatsApp with parent" style="color:#25D366;">
                      <i class="fa-brands fa-whatsapp"></i>
                    </button>
                    <button class="icon-action-btn btn-print-scholar-report" data-id="${g.studentId}" title="Print Official Academic Transcript">
                      <i class="fa-solid fa-print"></i>
                    </button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  bindGradesEvents() {
    document.getElementById("btnAdminAddGrade")?.addEventListener("click", () => this.showGradeModal());

    document.querySelectorAll(".btn-print-scholar-report").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        this.showReportCardModal(id);
      });
    });

    // v2.0 — WhatsApp result sharing
    document.querySelectorAll(".btn-wa-result").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const grade = await db.getById(STORES.GRADES, id);
        if (!grade) return;
        const student = await db.getById(STORES.STUDENTS, grade.studentId);
        const phone = student ? (student.phone || student.parentPhone) : null;
        const link = waLink(phone, resultShareMessage(grade.studentName, grade, this.config));
        if (!link) {
          this.showToast("Parent mobile number missing for this student.", "error");
          return;
        }
        window.open(link, "_blank");
      });
    });
  }

  // =========================================================================
  // 8. NOTICE BOARD VIEW
  // =========================================================================
  async renderNoticesView() {
    const notices = await db.getAll(STORES.NOTICES);
    const user = auth.getCurrentUser();
    const canPost = user && (user.role === "admin" || user.role === "teacher");

    return `
      <div class="page-header">
        <div class="page-title-group">
          <h1>Official Notices & Announcements</h1>
          <p>School-wide bulletins, academic schedules, and priority notifications.</p>
        </div>
        ${canPost ? `
          <div class="page-actions-group">
            <button class="btn btn-primary" id="btnPostNewNotice">
              <i class="fa-solid fa-bullhorn"></i> Post Bulletin
            </button>
          </div>
        ` : ''}
      </div>

      <div style="display:flex; flex-direction:column; gap:18px;">
        ${notices.map(n => `
          <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
              <div>
                <span class="badge ${n.priority === 'urgent' ? 'badge-danger' : n.priority === 'high' ? 'badge-warning' : 'badge-info'}" style="margin-bottom:6px;">
                  ${n.priority.toUpperCase()} PRIORITY
                </span>
                <h3 style="font-size:18px; font-weight:700; color:var(--text-main);">${n.title}</h3>
              </div>
              <div style="text-align:right;">
                <span style="font-size:12px; color:var(--text-dim); display:block;"><i class="fa-regular fa-calendar"></i> ${n.date}</span>
                <span style="font-size:11px; color:var(--text-muted);">By ${n.author}</span>
              </div>
            </div>
            <p style="font-size:14px; line-height:1.6; color:var(--text-main); margin-bottom:12px;">
              ${n.content}
            </p>
            <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border-subtle); padding-top:10px; font-size:12px; color:var(--text-dim);">
              <span>Audience: <strong>${n.target.toUpperCase()}</strong></span>
              ${canPost ? `<button class="btn btn-secondary btn-sm btn-delete-notice" data-id="${n.id}" style="color:#f87171;"><i class="fa-solid fa-trash"></i> Delete</button>` : ''}
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  bindNoticesEvents() {
    document.getElementById("btnPostNewNotice")?.addEventListener("click", () => this.showNoticeModal());
    document.querySelectorAll(".btn-delete-notice").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        if (confirm("Delete this notice?")) {
          await db.delete(STORES.NOTICES, id);
          this.showToast("Notice deleted", "success");
        }
      });
    });
  }

  // =========================================================================
  // 9. RESELLER, BRANDING & FIREBASE CLOUD SETTINGS
  // =========================================================================
  async renderSettingsView() {
    const config = getAppConfig();
    const fb = config.firebase || {};
    const lp = config.landingPage || DEFAULT_CONFIG.landingPage;
    const about = lp.about || {};
    const programs = lp.programs || {};
    const faculty = lp.faculty || {};
    const admission = lp.admission || {};
    const contact = lp.contact || {};
    const hero = lp.hero || {};
    const activeTab = this.currentSettingsTab || "landing_cms";

    return `
      <div class="page-header">
        <div class="page-title-group">
          <h1>Administrator Settings & Public Website CMS</h1>
          <p>Customize public landing page website sections, manage official school branding, configure Firebase cloud sync, and verify software licenses.</p>
        </div>
      </div>

      <!-- Settings Tab Navigation Bar -->
      <div class="settings-nav-tabs">
        <button type="button" class="settings-tab-btn ${activeTab === 'landing_cms' ? 'active' : ''}" data-settings-tab="landing_cms">
          <i class="fa-solid fa-globe"></i> Landing Page Website CMS
          <span class="badge badge-info" style="font-size:10px; margin-left:6px;">5 Sections</span>
        </button>
        <button type="button" class="settings-tab-btn ${activeTab === 'branding' ? 'active' : ''}" data-settings-tab="branding">
          <i class="fa-solid fa-paintbrush"></i> School Branding & Whitelabel
        </button>
        <button type="button" class="settings-tab-btn ${activeTab === 'cloud' ? 'active' : ''}" data-settings-tab="cloud">
          <i class="fa-solid fa-fire"></i> Cloud Sync & Database Backup
        </button>
        <button type="button" class="settings-tab-btn ${activeTab === 'license' ? 'active' : ''}" data-settings-tab="license">
          <i class="fa-solid fa-shield-halved"></i> Software License
        </button>
        <button type="button" class="settings-tab-btn ${activeTab === 'payments' ? 'active' : ''}" data-settings-tab="payments">
          <i class="fa-solid fa-money-bill-transfer"></i> Online Fee Collection
        </button>
      </div>

      <!-- ====================================================================
           TAB 1: PUBLIC LANDING PAGE WEBSITE CMS
           ==================================================================== -->
      <div class="settings-tab-pane ${activeTab === 'landing_cms' ? 'active' : ''}" id="tabPaneLandingCMS">
        
        <!-- CMS Top Action Bar -->
        <div class="cms-top-action-bar">
          <div>
            <h3 style="font-size:16px; margin:0 0 4px 0; color:#fff;">
              <i class="fa-solid fa-sliders" style="color:var(--primary); margin-right:6px;"></i> Public Website Landing Page Editor
            </h3>
            <p style="font-size:12px; color:var(--text-muted); margin:0;">
              Changes saved here instantly update the public landing page on <strong>https://schoolmangementpanel.web.app/</strong>
            </p>
          </div>
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <button type="button" class="btn btn-secondary btn-sm" id="btnPreviewPublicWebsite">
              <i class="fa-solid fa-arrow-up-right-from-square"></i> Preview Live Website
            </button>
            <button type="button" class="btn btn-secondary btn-sm" id="btnResetLandingDefaults">
              <i class="fa-solid fa-rotate-left"></i> Reset Defaults
            </button>
            <button type="submit" form="formLandingPageCMS" class="btn btn-primary btn-sm">
              <i class="fa-solid fa-floppy-disk"></i> Save & Publish Changes
            </button>
          </div>
        </div>

        <form id="formLandingPageCMS">

          <!-- 1. ABOUT CAMPUS SECTION (#about) -->
          <div class="cms-section-card">
            <div class="cms-section-header">
              <div class="cms-section-title-wrap">
                <div class="cms-section-icon" style="background:rgba(56, 189, 248, 0.15); color:#38bdf8;">
                  <i class="fa-solid fa-building-columns"></i>
                </div>
                <div>
                  <h4 class="cms-section-title">1. About Campus & Facilities</h4>
                  <p class="cms-section-desc">Manage school infrastructure overview, mission, and the 6 campus facilities cards.</p>
                </div>
              </div>
              <span class="cms-section-hash-badge"><i class="fa-solid fa-link"></i> Target: #about</span>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 2fr; gap:16px;">
              <div class="form-group">
                <label class="form-label">Section Pill Badge</label>
                <input type="text" class="form-control" id="lpAboutPill" value="${about.pill || 'World-Class Infrastructure'}" placeholder="e.g. World-Class Infrastructure" required>
              </div>
              <div class="form-group">
                <label class="form-label">Section Main Heading</label>
                <input type="text" class="form-control" id="lpAboutTitle" value="${about.title || 'Designed for Modern Learning'}" placeholder="e.g. Designed for Modern Learning" required>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Section Subtitle / Vision Paragraph</label>
              <textarea class="form-control" id="lpAboutSubtitle" rows="2" placeholder="Describe the campus vision and student development...">${about.subtitle || 'Our campus provides holistic educational facilities to foster curiosity, scientific aptitude, and moral integrity.'}</textarea>
            </div>

            <div style="margin-top:18px;">
              <label class="form-label" style="display:flex; justify-content:space-between;">
                <span><i class="fa-solid fa-microscope" style="color:var(--primary); margin-right:6px;"></i> 6 Campus Facilities (Iconic Highlights)</span>
                <span style="font-size:11px; color:var(--text-muted);">Displays on public facilities grid</span>
              </label>

              <div class="cms-facilities-editor-grid">
                <!-- Facility 1 -->
                <div class="cms-facility-editor-card">
                  <div style="font-size:11px; font-weight:800; color:#38bdf8; margin-bottom:8px;"><i class="fa-solid fa-flask-vial"></i> Facility 1 (Science Labs)</div>
                  <div class="form-group" style="margin-bottom:8px;">
                    <input type="text" class="form-control" id="lpAboutF1Title" value="${about.f1_title || 'Modern Science Laboratories'}" placeholder="Facility Title" style="font-size:13px; font-weight:700;">
                  </div>
                  <textarea class="form-control" id="lpAboutF1Desc" rows="2" placeholder="Facility description..." style="font-size:12px;">${about.f1_desc || 'Fully equipped Physics, Chemistry, and Biology laboratories enabling hands-on experimental learning according to board curriculum.'}</textarea>
                </div>

                <!-- Facility 2 -->
                <div class="cms-facility-editor-card">
                  <div style="font-size:11px; font-weight:800; color:#38bdf8; margin-bottom:8px;"><i class="fa-solid fa-desktop"></i> Facility 2 (Computer Lab)</div>
                  <div class="form-group" style="margin-bottom:8px;">
                    <input type="text" class="form-control" id="lpAboutF2Title" value="${about.f2_title || 'ICT & Computer Laboratories'}" placeholder="Facility Title" style="font-size:13px; font-weight:700;">
                  </div>
                  <textarea class="form-control" id="lpAboutF2Desc" rows="2" placeholder="Facility description..." style="font-size:12px;">${about.f2_desc || 'High-speed networked computing workstations dedicated to computer science, coding, and technological literacy.'}</textarea>
                </div>

                <!-- Facility 3 -->
                <div class="cms-facility-editor-card">
                  <div style="font-size:11px; font-weight:800; color:#38bdf8; margin-bottom:8px;"><i class="fa-solid fa-book-open-reader"></i> Facility 3 (Library)</div>
                  <div class="form-group" style="margin-bottom:8px;">
                    <input type="text" class="form-control" id="lpAboutF3Title" value="${about.f3_title || 'Resourceful Library'}" placeholder="Facility Title" style="font-size:13px; font-weight:700;">
                  </div>
                  <textarea class="form-control" id="lpAboutF3Desc" rows="2" placeholder="Facility description..." style="font-size:12px;">${about.f3_desc || 'Thousands of reference books, educational journals, and digital study resources promoting continuous self-learning.'}</textarea>
                </div>

                <!-- Facility 4 -->
                <div class="cms-facility-editor-card">
                  <div style="font-size:11px; font-weight:800; color:#38bdf8; margin-bottom:8px;"><i class="fa-solid fa-futbol"></i> Facility 4 (Sports)</div>
                  <div class="form-group" style="margin-bottom:8px;">
                    <input type="text" class="form-control" id="lpAboutF4Title" value="${about.f4_title || 'Sports & Physical Development'}" placeholder="Facility Title" style="font-size:13px; font-weight:700;">
                  </div>
                  <textarea class="form-control" id="lpAboutF4Desc" rows="2" placeholder="Facility description..." style="font-size:12px;">${about.f4_desc || 'Expansive athletic grounds and dedicated coaches fostering teamwork, sportsmanship, and physical health.'}</textarea>
                </div>

                <!-- Facility 5 -->
                <div class="cms-facility-editor-card">
                  <div style="font-size:11px; font-weight:800; color:#38bdf8; margin-bottom:8px;"><i class="fa-solid fa-van-shuttle"></i> Facility 5 (Transport)</div>
                  <div class="form-group" style="margin-bottom:8px;">
                    <input type="text" class="form-control" id="lpAboutF5Title" value="${about.f5_title || 'Safe Student Transport'}" placeholder="Facility Title" style="font-size:13px; font-weight:700;">
                  </div>
                  <textarea class="form-control" id="lpAboutF5Desc" rows="2" placeholder="Facility description..." style="font-size:12px;">${about.f5_desc || 'Dedicated institutional transport fleet covering all major residential sectors with GPS tracking and trained drivers.'}</textarea>
                </div>

                <!-- Facility 6 -->
                <div class="cms-facility-editor-card">
                  <div style="font-size:11px; font-weight:800; color:#38bdf8; margin-bottom:8px;"><i class="fa-solid fa-shield-halved"></i> Facility 6 (Security)</div>
                  <div class="form-group" style="margin-bottom:8px;">
                    <input type="text" class="form-control" id="lpAboutF6Title" value="${about.f6_title || 'Secure & Disciplined Campus'}" placeholder="Facility Title" style="font-size:13px; font-weight:700;">
                  </div>
                  <textarea class="form-control" id="lpAboutF6Desc" rows="2" placeholder="Facility description..." style="font-size:12px;">${about.f6_desc || 'Round-the-clock security personnel, automated attendance tracking, and comprehensive CCTV surveillance across campus.'}</textarea>
                </div>
              </div>
            </div>
          </div>

          <!-- 2. ACADEMIC PROGRAMS SECTION (#programs) -->
          <div class="cms-section-card">
            <div class="cms-section-header">
              <div class="cms-section-title-wrap">
                <div class="cms-section-icon" style="background:rgba(99, 102, 241, 0.15); color:var(--primary);">
                  <i class="fa-solid fa-graduation-cap"></i>
                </div>
                <div>
                  <h4 class="cms-section-title">2. Academic Programs & Curriculum</h4>
                  <p class="cms-section-desc">Manage curriculum streams, grade wings, and board exam preparation details.</p>
                </div>
              </div>
              <span class="cms-section-hash-badge"><i class="fa-solid fa-link"></i> Target: #programs</span>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 2fr; gap:16px;">
              <div class="form-group">
                <label class="form-label">Section Pill Badge</label>
                <input type="text" class="form-control" id="lpProgramsPill" value="${programs.pill || 'Curriculum & Grades'}" required>
              </div>
              <div class="form-group">
                <label class="form-label">Section Main Heading</label>
                <input type="text" class="form-control" id="lpProgramsTitle" value="${programs.title || 'Academic Programs Offered'}" required>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Section Subtitle / Narrative</label>
              <textarea class="form-control" id="lpProgramsSubtitle" rows="2">${programs.subtitle || 'Rigorous educational pathways tailored to cultivate analytical thinking, linguistic fluency, and competitive board preparation.'}</textarea>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px;">
              <div class="form-group">
                <label class="form-label"><i class="fa-solid fa-shapes" style="color:var(--primary); margin-right:4px;"></i> Primary & Middle Wing Overview</label>
                <textarea class="form-control" id="lpProgramsPrimary" rows="2" placeholder="Class 1 to 8 description...">${programs.primaryOverview || 'Class 1 to Class 8 comprehensive foundational education in English, Mathematics, General Science, and Social Studies.'}</textarea>
              </div>

              <div class="form-group">
                <label class="form-label"><i class="fa-solid fa-atom" style="color:#06b6d4; margin-right:4px;"></i> Secondary / Matric Streams Overview</label>
                <textarea class="form-control" id="lpProgramsSecondary" rows="2" placeholder="Matric Science / Computer streams...">${programs.secondaryOverview || 'Grade 9 & Grade 10 Science & Computer Science streams with specialized preparation for Board Examinations.'}</textarea>
              </div>
            </div>
            <small style="color:var(--text-muted); font-size:11px; display:block; margin-top:4px;">
              <i class="fa-solid fa-circle-info"></i> Note: When live classes are added in your Classes & Batches module, they will automatically be presented as interactive cards with enrolled subjects.
            </small>
          </div>

          <!-- 3. DISTINGUISHED FACULTY SECTION (#faculty) -->
          <div class="cms-section-card">
            <div class="cms-section-header">
              <div class="cms-section-title-wrap">
                <div class="cms-section-icon" style="background:rgba(16, 185, 129, 0.15); color:#10b981;">
                  <i class="fa-solid fa-chalkboard-user"></i>
                </div>
                <div>
                  <h4 class="cms-section-title">3. Distinguished Faculty & Mentors</h4>
                  <p class="cms-section-desc">Manage teachers presentation, educational rigor, and the Principal's message.</p>
                </div>
              </div>
              <span class="cms-section-hash-badge"><i class="fa-solid fa-link"></i> Target: #faculty</span>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 2fr; gap:16px;">
              <div class="form-group">
                <label class="form-label">Section Pill Badge</label>
                <input type="text" class="form-control" id="lpFacultyPill" value="${faculty.pill || 'Experienced Educators'}" required>
              </div>
              <div class="form-group">
                <label class="form-label">Section Main Heading</label>
                <input type="text" class="form-control" id="lpFacultyTitle" value="${faculty.title || 'Our Distinguished Faculty'}" required>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Section Subtitle</label>
              <textarea class="form-control" id="lpFacultySubtitle" rows="2">${faculty.subtitle || 'Passionate teachers holding higher qualifications committed to academic rigor, concept building, and individual mentorship.'}</textarea>
            </div>

            <div class="form-group">
              <label class="form-label"><i class="fa-solid fa-quote-left" style="color:#38bdf8; margin-right:6px;"></i> Principal's Academic Message / Quote (Featured Banner)</label>
              <textarea class="form-control" id="lpFacultyPrincipalMessage" rows="2" placeholder="e.g. Our teachers are more than instructors — they are mentors who cultivate critical reasoning...">${faculty.principalMessage || 'Our teachers are more than instructors — they are mentors who cultivate critical reasoning, personal discipline, and ethical leadership in every student.'}</textarea>
            </div>
            <small style="color:var(--text-muted); font-size:11px; display:block; margin-top:4px;">
              <i class="fa-solid fa-circle-info"></i> Note: Teachers registered in your Teachers & Staff module will automatically appear on the landing page with their names, degrees, and assigned subjects.
            </small>
          </div>

          <!-- 4. ONLINE ADMISSION SECTION (#admission) -->
          <div class="cms-section-card">
            <div class="cms-section-header">
              <div class="cms-section-title-wrap">
                <div class="cms-section-icon" style="background:rgba(245, 158, 11, 0.15); color:#f59e0b;">
                  <i class="fa-solid fa-file-signature"></i>
                </div>
                <div>
                  <h4 class="cms-section-title">4. Online Admission & Enrollment</h4>
                  <p class="cms-section-desc">Manage online registration guidelines, admission session, document checklist, and helpdesk.</p>
                </div>
              </div>
              <span class="cms-section-hash-badge"><i class="fa-solid fa-link"></i> Target: #admission</span>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 2fr; gap:16px;">
              <div class="form-group">
                <label class="form-label">Section Pill Badge</label>
                <input type="text" class="form-control" id="lpAdmissionPill" value="${admission.pill || 'Apply Online Today'}" required>
              </div>
              <div class="form-group">
                <label class="form-label">Section Main Heading</label>
                <input type="text" class="form-control" id="lpAdmissionTitle" value="${admission.title || 'Online Admission Application'}" required>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Section Subtitle</label>
              <textarea class="form-control" id="lpAdmissionSubtitle" rows="2">${admission.subtitle || 'Take the first step toward quality education. Submit your admission inquiry online and receive an instant application tracking number.'}</textarea>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px;">
              <div class="form-group">
                <label class="form-label"><i class="fa-solid fa-calendar-check" style="color:#10b981; margin-right:4px;"></i> Academic Session</label>
                <input type="text" class="form-control" id="lpAdmissionSession" value="${admission.session || 'Session 2026 - 2027'}" placeholder="e.g. Session 2026 - 2027">
              </div>

              <div class="form-group">
                <label class="form-label"><i class="fa-brands fa-whatsapp" style="color:#10b981; margin-right:4px;"></i> Admission Hotline / WhatsApp</label>
                <input type="text" class="form-control" id="lpAdmissionHotline" value="${admission.hotline || config.contact.phone || '0300-1111111'}" placeholder="e.g. 0300-1111111">
              </div>
            </div>

            <div class="form-group">
              <label class="form-label"><i class="fa-solid fa-list-check" style="color:var(--primary); margin-right:4px;"></i> Required Documents & Instructions Box</label>
              <textarea class="form-control" id="lpAdmissionInstructions" rows="2" placeholder="Instructions shown above the form...">${admission.instructions || 'Admissions are granted based on merit and evaluation. Bring previous school leaving certificates, B-Form copy, and parent CNIC copy upon interview.'}</textarea>
            </div>
          </div>

          <!-- 5. CONTACT & VISITING HOURS SECTION (#contact) -->
          <div class="cms-section-card">
            <div class="cms-section-header">
              <div class="cms-section-title-wrap">
                <div class="cms-section-icon" style="background:rgba(239, 68, 68, 0.15); color:#ef4444;">
                  <i class="fa-solid fa-map-location-dot"></i>
                </div>
                <div>
                  <h4 class="cms-section-title">5. Campus Contact & Office Hours</h4>
                  <p class="cms-section-desc">Manage physical address, direct phone lines, visiting office hours, and map landmarks.</p>
                </div>
              </div>
              <span class="cms-section-hash-badge"><i class="fa-solid fa-link"></i> Target: #contact</span>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 2fr; gap:16px;">
              <div class="form-group">
                <label class="form-label">Section Pill Badge</label>
                <input type="text" class="form-control" id="lpContactPill" value="${contact.pill || 'Visit Our Campus'}" required>
              </div>
              <div class="form-group">
                <label class="form-label">Section Main Heading</label>
                <input type="text" class="form-control" id="lpContactTitle" value="${contact.title || 'Get In Touch With Us'}" required>
              </div>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px;">
              <div class="form-group">
                <label class="form-label"><i class="fa-regular fa-clock" style="color:#f59e0b; margin-right:4px;"></i> Admissions & Office Hours</label>
                <input type="text" class="form-control" id="lpContactHours" value="${contact.hours || 'Monday to Saturday: 8:00 AM - 2:00 PM'}" placeholder="e.g. Mon-Sat: 8:00 AM - 2:00 PM">
              </div>

              <div class="form-group">
                <label class="form-label">Section Subtitle</label>
                <input type="text" class="form-control" id="lpContactSubtitle" value="${contact.subtitle || 'Our admissions office is open Monday to Saturday from 8:00 AM to 2:00 PM.'}">
              </div>
            </div>

            <div class="form-group">
              <label class="form-label"><i class="fa-solid fa-location-dot" style="color:#ef4444; margin-right:4px;"></i> Campus Physical Address</label>
              <input type="text" class="form-control" id="lpContactAddress" value="${contact.address || config.contact.address || 'Campus Address, Pakistan'}" required>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px;">
              <div class="form-group">
                <label class="form-label"><i class="fa-solid fa-phone" style="color:#10b981; margin-right:4px;"></i> Official Phone & WhatsApp</label>
                <input type="text" class="form-control" id="lpContactPhone" value="${contact.phone || config.contact.phone || '0300-1111111'}" required>
              </div>

              <div class="form-group">
                <label class="form-label"><i class="fa-solid fa-envelope" style="color:#818cf8; margin-right:4px;"></i> Official Email Address</label>
                <input type="email" class="form-control" id="lpContactEmail" value="${contact.email || config.contact.email || 'admin@school.com'}" required>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label"><i class="fa-solid fa-signs-post" style="color:#38bdf8; margin-right:4px;"></i> Landmarks & Directions Note</label>
              <input type="text" class="form-control" id="lpContactDirections" value="${contact.mapDirections || 'Main Campus Boulevard, Education City'}" placeholder="e.g. Near City Gate, Tandlianwala">
            </div>
          </div>

          <!-- 6. HERO BANNER HEADLINE -->
          <div class="cms-section-card">
            <div class="cms-section-header">
              <div class="cms-section-title-wrap">
                <div class="cms-section-icon" style="background:rgba(168, 85, 247, 0.15); color:#a855f7;">
                  <i class="fa-solid fa-wand-magic-sparkles"></i>
                </div>
                <div>
                  <h4 class="cms-section-title">Top Hero Banner & Session Tag</h4>
                  <p class="cms-section-desc">The primary banner shown at the very top of your public landing page.</p>
                </div>
              </div>
              <span class="cms-section-hash-badge"><i class="fa-solid fa-eye"></i> Top Banner</span>
            </div>

            <div style="display:grid; grid-template-columns: 1fr 2fr; gap:16px;">
              <div class="form-group">
                <label class="form-label">Hero Pill Slogan</label>
                <input type="text" class="form-control" id="lpHeroBadge" value="${hero.badge || `Admissions Open for Session ${config.academicYear || '2026 - 2027'}`}">
              </div>
              <div class="form-group">
                <label class="form-label">Hero Headline Prefix</label>
                <input type="text" class="form-control" id="lpHeroTitle" value="${hero.title || 'Inspiring Academic Excellence, Shaping Future Leaders at'}">
              </div>
            </div>

            <div class="form-group">
              <label class="form-label">Hero Subtitle Paragraph</label>
              <textarea class="form-control" id="lpHeroSubtitle" rows="2">${hero.subtitle || 'A premier educational institution committed to intellectual brilliance, character development, state-of-the-art computer & science laboratories, and high-caliber faculty mentorship.'}</textarea>
            </div>
          </div>

          <div style="margin-top:24px;">
            <button type="submit" class="btn btn-primary btn-lg" style="width:100%; justify-content:center; font-size:15px; font-weight:800;">
              <i class="fa-solid fa-cloud-arrow-up"></i> Save & Publish All Landing Page Changes
            </button>
          </div>
        </form>

      </div>

      <!-- ====================================================================
           TAB 2: SCHOOL BRANDING & WHITELABEL
           ==================================================================== -->
      <div class="settings-tab-pane ${activeTab === 'branding' ? 'active' : ''}" id="tabPaneBranding">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title"><i class="fa-solid fa-paintbrush" style="color:var(--primary);"></i> School Rebranding</h3>
            <span class="badge badge-info">Instant Resell</span>
          </div>
          <form id="brandingForm">
            <div class="form-group">
              <label class="form-label">School Full Name</label>
              <input type="text" class="form-control" id="cfgSchoolName" value="${config.schoolName}" required>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Short Name</label>
                <input type="text" class="form-control" id="cfgShortName" value="${config.schoolShortName}">
              </div>
              <div class="form-group">
                <label class="form-label">Logo Text / Monogram</label>
                <input type="text" class="form-control" id="cfgLogoText" value="${config.logoText}">
              </div>
            </div>

            <!-- School Logo & Monogram Uploader (ImgBB API v1) -->
            <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:16px; margin-bottom:18px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <label class="form-label" style="margin-bottom:0;"><i class="fa-solid fa-image" style="color:var(--primary); margin-right:6px;"></i> Official School Logo (Fixed 84x84)</label>
                <span class="badge badge-success" style="font-size:10px;"><i class="fa-solid fa-cloud"></i> ImgBB API v1</span>
              </div>

              <div style="display:flex; align-items:center; gap:16px;">
                <!-- Fixed Width & Height Preview Box -->
                <div class="logo-upload-preview-box" id="logoPreviewBox" title="School Logo Preview">
                  ${config.logoUrl ? `<img src="${config.logoUrl}" class="logo-upload-preview-img" id="cfgLogoPreviewImg" alt="School Logo">` : `<div id="cfgLogoPlaceholder" style="text-align:center; color:var(--text-dim); font-size:10px;"><i class="fa-solid fa-cloud-arrow-up" style="font-size:24px; display:block; margin-bottom:4px; color:var(--primary);"></i>Upload</div>`}
                </div>

                <div style="flex:1; display:flex; flex-direction:column; gap:8px;">
                  <input type="file" id="cfgLogoFileInput" accept="image/*" style="display:none;">
                  <div style="display:flex; gap:8px;">
                    <button type="button" class="btn btn-secondary btn-sm" id="btnUploadLogoTrigger" style="flex:1;">
                      <i class="fa-solid fa-cloud-arrow-up"></i> Upload Logo via ImgBB
                    </button>
                    ${config.logoUrl ? `<button type="button" class="btn btn-danger btn-sm" id="btnRemoveLogo" title="Remove Logo"><i class="fa-solid fa-trash"></i></button>` : ''}
                  </div>
                  <input type="text" class="form-control" id="cfgLogoUrl" value="${config.logoUrl || ''}" placeholder="Live ImgBB Image URL (or paste direct URL)" style="font-size:12px;">
                </div>
              </div>
              <small style="font-size:11px; color:var(--text-dim); margin-top:8px; display:block;">
                Automatically hosted on ImgBB. Displays on header, sidebar, Fee Receipts, and Student ID Cards.
              </small>
            </div>
            <div class="form-group">
              <label class="form-label">School Tagline / Slogan</label>
              <input type="text" class="form-control" id="cfgTagline" value="${config.tagline}">
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Currency Symbol</label>
                <input type="text" class="form-control" id="cfgCurrency" value="${config.currency}">
              </div>
              <div class="form-group">
                <label class="form-label">Primary Brand Color</label>
                <input type="color" class="form-control" id="cfgPrimaryColor" value="${config.theme.primaryColor || '#4f46e5'}" style="height:42px; padding:4px;">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Campus Address</label>
              <input type="text" class="form-control" id="cfgAddress" value="${config.contact.address}">
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Official Phone</label>
                <input type="text" class="form-control" id="cfgPhone" value="${config.contact.phone}">
              </div>
              <div class="form-group">
                <label class="form-label">Official Email</label>
                <input type="email" class="form-control" id="cfgEmail" value="${config.contact.email}">
              </div>
            </div>
            <div style="display:flex; gap:10px; margin-top:20px;">
              <button type="submit" class="btn btn-primary" style="flex:1;">
                <i class="fa-solid fa-floppy-disk"></i> Save Branding
              </button>
              <button type="button" class="btn btn-secondary" id="btnExportConfigFile">
                <i class="fa-solid fa-download"></i> Export config.js
              </button>
            </div>
          </form>
        </div>
      </div>

      <!-- ====================================================================
           TAB 3: FIREBASE CLOUD INTEGRATION & BACKUP
           ==================================================================== -->
      <div class="settings-tab-pane ${activeTab === 'cloud' ? 'active' : ''}" id="tabPaneCloud">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title"><i class="fa-solid fa-fire" style="color:#f59e0b;"></i> Firebase Cloud Integration</h3>
            <span class="badge badge-success">Dual Sync: Firestore & RTDB</span>
          </div>
          <p style="font-size:12.5px; color:var(--text-muted); margin-bottom:16px;">
            Paste your free Firebase project keys below. The system automatically works offline in IndexedDB, and backups to Firebase Realtime Database & Firestore when internet is connected!
          </p>
          <form id="firebaseConfigForm">
            <div class="form-group">
              <label class="form-label">API Key</label>
              <input type="text" class="form-control" id="fbApiKey" value="${fb.apiKey || ''}" placeholder="AIzaSy...">
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Project ID</label>
                <input type="text" class="form-control" id="fbProjectId" value="${fb.projectId || ''}" placeholder="my-school-erp">
              </div>
              <div class="form-group">
                <label class="form-label">Auth Domain</label>
                <input type="text" class="form-control" id="fbAuthDomain" value="${fb.authDomain || ''}" placeholder="my-school-erp.firebaseapp.com">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Realtime Database URL (RTDB)</label>
              <input type="text" class="form-control" id="fbDatabaseURL" value="${fb.databaseURL || ''}" placeholder="https://my-school-erp-default-rtdb.firebaseio.com">
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Storage Bucket</label>
                <input type="text" class="form-control" id="fbStorageBucket" value="${fb.storageBucket || ''}" placeholder="my-school-erp.appspot.com">
              </div>
              <div class="form-group">
                <label class="form-label">App ID</label>
                <input type="text" class="form-control" id="fbAppId" value="${fb.appId || ''}" placeholder="1:123456:web:abcd...">
              </div>
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%; margin-top:6px;">
              <i class="fa-solid fa-cloud-arrow-up"></i> Save & Connect Firebase
            </button>
          </form>

          <hr style="border:0; border-top:1px solid var(--border-subtle); margin:20px 0;">

          <!-- Cloud Backup Operations -->
          <div>
            <span style="font-size:12px; font-weight:700; text-transform:uppercase; color:var(--text-muted); display:block; margin-bottom:10px;">Cloud & Local Data Management</span>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
              <button class="btn btn-secondary btn-sm" id="btnCloudBackupNow">
                <i class="fa-solid fa-cloud-arrow-up" style="color:var(--primary);"></i> Sync Cloud Backup
              </button>
              <button class="btn btn-secondary btn-sm" id="btnCloudRestore">
                <i class="fa-solid fa-cloud-arrow-down" style="color:var(--secondary);"></i> Restore Cloud
              </button>
              <button class="btn btn-secondary btn-sm" id="btnLocalJsonBackup">
                <i class="fa-solid fa-file-code"></i> Download JSON
              </button>
              <button class="btn btn-secondary btn-sm" id="btnLocalJsonRestore">
                <i class="fa-solid fa-upload"></i> Restore JSON
              </button>
              <button class="btn btn-danger btn-sm" id="btnResetFreshSlate" style="grid-column: 1 / -1; margin-top:4px;" title="Purge all student, teacher, fee, and exam records for a completely fresh start">
                <i class="fa-solid fa-trash-can"></i> Fresh Start (Purge All Data)
              </button>
            </div>
            <input type="file" id="jsonFileInput" accept=".json" style="display:none;">
          </div>
        </div>
      </div>

      <!-- ====================================================================
           TAB 4: COMMERCIAL SOFTWARE LICENSE
           ==================================================================== -->
      <div class="settings-tab-pane ${activeTab === 'license' ? 'active' : ''}" id="tabPaneLicense">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title"><i class="fa-solid fa-shield-halved" style="color:#10b981;"></i> Commercial Software License Authentication</h3>
            <span class="badge ${licenseManager.isValid ? 'badge-success' : 'badge-danger'}">
              ${licenseManager.isValid ? 'LICENSED & ACTIVE' : 'UNLICENSED / LOCKED'}
            </span>
          </div>

          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:16px; margin-bottom:16px;">
            <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:14px;">
              <span style="font-size:11px; text-transform:uppercase; color:var(--text-muted); font-weight:700;">Active License Key</span>
              <div style="font-family:'JetBrains Mono', monospace; font-size:13px; font-weight:700; color:var(--text-main); margin-top:4px;">
                <code>${licenseManager.licenseKey || 'No Key Configured'}</code>
              </div>
            </div>

            <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:14px;">
              <span style="font-size:11px; text-transform:uppercase; color:var(--text-muted); font-weight:700;">Private Master RTDB</span>
              <div style="font-size:12px; font-weight:600; color:#10b981; margin-top:4px;">
                <i class="fa-solid fa-lock" style="margin-right:4px;"></i> licensekeysc-default-rtdb
              </div>
            </div>

            <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:14px;">
              <span style="font-size:11px; text-transform:uppercase; color:var(--text-muted); font-weight:700;">Registered Licensee</span>
              <div style="font-size:13px; font-weight:600; color:var(--text-main); margin-top:4px;">
                ${licenseManager.licenseData?.client || config.schoolName}
              </div>
            </div>

            <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:14px;">
              <span style="font-size:11px; text-transform:uppercase; color:var(--text-muted); font-weight:700;">Protection Protocol</span>
              <div style="font-size:12px; color:var(--text-dim); margin-top:4px;">
                Panel locked without active RTDB verification
              </div>
            </div>
          </div>

          <div style="display:flex; justify-content:flex-end; gap:10px;">
            <button type="button" class="btn btn-secondary btn-sm" id="btnReverifyLicense">
              <i class="fa-solid fa-arrows-rotate"></i> Re-verify License with Server
            </button>
            <button type="button" class="btn btn-danger btn-sm" id="btnChangeLicenseKey">
              <i class="fa-solid fa-key"></i> Change / Deactivate License
            </button>
          </div>
        </div>
      </div>

      <!-- ====================================================================
           TAB 5: ONLINE FEE COLLECTION (v2.1 — JazzCash / EasyPaisa / Bank)
           ==================================================================== -->
      <div class="settings-tab-pane ${activeTab === 'payments' ? 'active' : ''}" id="tabPanePayments">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title"><i class="fa-solid fa-money-bill-transfer" style="color:#0ea5e9;"></i> Online Fee Collection Settings</h3>
            <span class="badge badge-info">v2.1</span>
          </div>
          <p style="font-size:13px; color:var(--text-muted); margin:0 0 16px 0;">
            School ke apne JazzCash / EasyPaisa numbers aur bank account yahan save karein.
            Parents fee in numbers par bhejenge, phir <strong>TID (transaction ID)</strong> school ko denge —
            admin Fee Management me jaa kar payment verify karega.
          </p>
          <form id="formPaymentSettings">
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:16px;">
              <div class="form-group">
                <label class="form-label"><i class="fa-solid fa-mobile-screen" style="color:#e11d48;"></i> JazzCash Number</label>
                <input type="text" class="form-control" id="payJazzcashNumber" value="${getPaymentSettings(config).jazzcashNumber || ''}" placeholder="0300-1234567">
              </div>
              <div class="form-group">
                <label class="form-label"><i class="fa-solid fa-mobile-screen" style="color:#16a34a;"></i> EasyPaisa Number</label>
                <input type="text" class="form-control" id="payEasypaisaNumber" value="${getPaymentSettings(config).easypaisaNumber || ''}" placeholder="0345-1234567">
              </div>
            </div>
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:16px; margin-top:4px;">
              <div class="form-group">
                <label class="form-label">Bank Name</label>
                <input type="text" class="form-control" id="payBankName" value="${getPaymentSettings(config).bankName || ''}" placeholder="e.g. Meezan Bank">
              </div>
              <div class="form-group">
                <label class="form-label">Account Title</label>
                <input type="text" class="form-control" id="payBankAccountTitle" value="${getPaymentSettings(config).bankAccountTitle || ''}" placeholder="School name on account">
              </div>
              <div class="form-group">
                <label class="form-label">Account Number / IBAN</label>
                <input type="text" class="form-control" id="payBankAccount" value="${getPaymentSettings(config).bankAccount || ''}" placeholder="PK36...">
              </div>
            </div>
            <div class="form-group" style="margin-top:4px;">
              <label class="form-label">Extra Instructions for Parents (optional)</label>
              <textarea class="form-control" id="payInstructions" rows="2" placeholder="e.g. Raat 8 baje ke baad ki payments agli subah verify hongi.">${getPaymentSettings(config).instructions || ''}</textarea>
            </div>
            <div style="display:flex; justify-content:flex-end; margin-top:8px;">
              <button type="submit" class="btn btn-primary">
                <i class="fa-solid fa-floppy-disk"></i> Save Payment Settings
              </button>
            </div>
          </form>
        </div>
      </div>

    `;
  }

  bindSettingsEvents() {
    // 0. Settings Navigation Tabs Switcher
    document.querySelectorAll(".settings-tab-btn[data-settings-tab]").forEach(btn => {
      btn.addEventListener("click", () => {
        const tab = btn.getAttribute("data-settings-tab");
        this.currentSettingsTab = tab;
        document.querySelectorAll(".settings-tab-btn").forEach(b => b.classList.toggle("active", b.getAttribute("data-settings-tab") === tab));
        document.querySelectorAll(".settings-tab-pane").forEach(p => p.classList.remove("active"));
        const targetPane = document.getElementById(
          tab === "landing_cms" ? "tabPaneLandingCMS" :
          tab === "branding" ? "tabPaneBranding" :
          tab === "payments" ? "tabPanePayments" :
          tab === "cloud" ? "tabPaneCloud" : "tabPaneLicense"
        );
        if (targetPane) targetPane.classList.add("active");
      });
    });

    // 1. Preview Public Landing Page from CMS
    document.getElementById("btnPreviewPublicWebsite")?.addEventListener("click", () => {
      this.renderPublicLandingPage();
    });

    // 2. Reset Landing Page Defaults
    document.getElementById("btnResetLandingDefaults")?.addEventListener("click", () => {
      if (confirm("Reset all landing page sections (About, Programs, Faculty, Admission, Contact) to default templates?")) {
        const defLp = DEFAULT_CONFIG.landingPage;
        saveAppConfig({ landingPage: defLp });
        this.config = getAppConfig();
        this.showToast("Landing page template restored to official defaults.", "info");
        this.refreshCurrentView();
      }
    });

    // 3. Landing Page CMS Form Submit (Saves & Pushes to RTDB)
    document.getElementById("formLandingPageCMS")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const updatedLanding = {
        hero: {
          badge: document.getElementById("lpHeroBadge")?.value.trim() || "",
          title: document.getElementById("lpHeroTitle")?.value.trim() || "",
          subtitle: document.getElementById("lpHeroSubtitle")?.value.trim() || ""
        },
        about: {
          pill: document.getElementById("lpAboutPill")?.value.trim() || "World-Class Infrastructure",
          title: document.getElementById("lpAboutTitle")?.value.trim() || "Designed for Modern Learning",
          subtitle: document.getElementById("lpAboutSubtitle")?.value.trim() || "",
          f1_title: document.getElementById("lpAboutF1Title")?.value.trim() || "",
          f1_desc: document.getElementById("lpAboutF1Desc")?.value.trim() || "",
          f2_title: document.getElementById("lpAboutF2Title")?.value.trim() || "",
          f2_desc: document.getElementById("lpAboutF2Desc")?.value.trim() || "",
          f3_title: document.getElementById("lpAboutF3Title")?.value.trim() || "",
          f3_desc: document.getElementById("lpAboutF3Desc")?.value.trim() || "",
          f4_title: document.getElementById("lpAboutF4Title")?.value.trim() || "",
          f4_desc: document.getElementById("lpAboutF4Desc")?.value.trim() || "",
          f5_title: document.getElementById("lpAboutF5Title")?.value.trim() || "",
          f5_desc: document.getElementById("lpAboutF5Desc")?.value.trim() || "",
          f6_title: document.getElementById("lpAboutF6Title")?.value.trim() || "",
          f6_desc: document.getElementById("lpAboutF6Desc")?.value.trim() || ""
        },
        programs: {
          pill: document.getElementById("lpProgramsPill")?.value.trim() || "Curriculum & Grades",
          title: document.getElementById("lpProgramsTitle")?.value.trim() || "Academic Programs Offered",
          subtitle: document.getElementById("lpProgramsSubtitle")?.value.trim() || "",
          primaryOverview: document.getElementById("lpProgramsPrimary")?.value.trim() || "",
          secondaryOverview: document.getElementById("lpProgramsSecondary")?.value.trim() || ""
        },
        faculty: {
          pill: document.getElementById("lpFacultyPill")?.value.trim() || "Experienced Educators",
          title: document.getElementById("lpFacultyTitle")?.value.trim() || "Our Distinguished Faculty",
          subtitle: document.getElementById("lpFacultySubtitle")?.value.trim() || "",
          principalMessage: document.getElementById("lpFacultyPrincipalMessage")?.value.trim() || ""
        },
        admission: {
          pill: document.getElementById("lpAdmissionPill")?.value.trim() || "Apply Online Today",
          title: document.getElementById("lpAdmissionTitle")?.value.trim() || "Online Admission Application",
          subtitle: document.getElementById("lpAdmissionSubtitle")?.value.trim() || "",
          session: document.getElementById("lpAdmissionSession")?.value.trim() || "",
          hotline: document.getElementById("lpAdmissionHotline")?.value.trim() || "",
          instructions: document.getElementById("lpAdmissionInstructions")?.value.trim() || ""
        },
        contact: {
          pill: document.getElementById("lpContactPill")?.value.trim() || "Visit Our Campus",
          title: document.getElementById("lpContactTitle")?.value.trim() || "Get In Touch With Us",
          subtitle: document.getElementById("lpContactSubtitle")?.value.trim() || "",
          hours: document.getElementById("lpContactHours")?.value.trim() || "",
          address: document.getElementById("lpContactAddress")?.value.trim() || "",
          phone: document.getElementById("lpContactPhone")?.value.trim() || "",
          email: document.getElementById("lpContactEmail")?.value.trim() || "",
          mapDirections: document.getElementById("lpContactDirections")?.value.trim() || ""
        }
      };

      saveAppConfig({ landingPage: updatedLanding });
      this.config = getAppConfig();

      // Cloud RTDB sync so all external visitors see changes immediately
      try {
        const fbUrl = this.config.firebase?.databaseURL;
        if (fbUrl) {
          fetch(`${fbUrl}/school_config/landingPage.json`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updatedLanding)
          }).catch(err => console.warn("Cloud landing sync warning:", err));
        }
      } catch (err) {}

      this.showToast("Landing page website information updated & published successfully!", "success");
    });

    // v2.1 — Online Fee Collection settings form
    document.getElementById("formPaymentSettings")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const payments = {
        jazzcashNumber: document.getElementById("payJazzcashNumber")?.value.trim() || "",
        easypaisaNumber: document.getElementById("payEasypaisaNumber")?.value.trim() || "",
        bankName: document.getElementById("payBankName")?.value.trim() || "",
        bankAccountTitle: document.getElementById("payBankAccountTitle")?.value.trim() || "",
        bankAccount: document.getElementById("payBankAccount")?.value.trim() || "",
        instructions: document.getElementById("payInstructions")?.value.trim() || ""
      };
      saveAppConfig({ payments });
      this.config = getAppConfig();
      this.showToast("Online fee collection settings saved successfully!", "success");
      this.refreshCurrentView();
    });
    const logoUrlInput = document.getElementById("cfgLogoUrl");
    const logoPreviewBox = document.getElementById("logoPreviewBox");
    const btnRemoveLogo = document.getElementById("btnRemoveLogo");

    logoUploadBtn?.addEventListener("click", () => logoFileInput?.click());

    logoFileInput?.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (file) {
        this.showToast("Uploading school logo to ImgBB cloud...", "info");
        try {
          const liveUrl = await uploadImageToImgbb(file);
          if (logoUrlInput) logoUrlInput.value = liveUrl;
          if (logoPreviewBox) {
            logoPreviewBox.innerHTML = `<img src="${liveUrl}" class="logo-upload-preview-img" alt="School Logo">`;
          }
          this.config.logoUrl = liveUrl;
          saveAppConfig({ logoUrl: liveUrl });
          this.applyThemeAndBranding();
          this.showToast("School logo uploaded & saved to ImgBB successfully!", "success");
        } catch (err) {
          this.showToast(`Upload failed: ${err.message}`, "error");
        }
      }
    });

    btnRemoveLogo?.addEventListener("click", () => {
      if (confirm("Remove school logo? Default icon will be used.")) {
        if (logoUrlInput) logoUrlInput.value = "";
        if (logoPreviewBox) {
          logoPreviewBox.innerHTML = `<div id="cfgLogoPlaceholder" style="text-align:center; color:var(--text-dim); font-size:10px;"><i class="fa-solid fa-cloud-arrow-up" style="font-size:24px; display:block; margin-bottom:4px; color:var(--primary);"></i>Upload</div>`;
        }
        this.config.logoUrl = "";
        saveAppConfig({ logoUrl: "" });
        this.applyThemeAndBranding();
        this.showToast("Logo removed.", "info");
      }
    });

    // Branding Form
    document.getElementById("brandingForm")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const updated = {
        schoolName: document.getElementById("cfgSchoolName").value,
        schoolShortName: document.getElementById("cfgShortName").value,
        logoText: document.getElementById("cfgLogoText").value,
        logoUrl: document.getElementById("cfgLogoUrl")?.value.trim() || "",
        tagline: document.getElementById("cfgTagline").value,
        currency: document.getElementById("cfgCurrency").value,
        contact: {
          ...this.config.contact,
          address: document.getElementById("cfgAddress").value,
          phone: document.getElementById("cfgPhone").value,
          email: document.getElementById("cfgEmail").value
        },
        theme: {
          ...this.config.theme,
          primaryColor: document.getElementById("cfgPrimaryColor").value
        }
      };

      saveAppConfig(updated);
      this.applyThemeAndBranding();
      this.showToast("School branding updated successfully!", "success");
    });

    // Export config.js file for selling
    document.getElementById("btnExportConfigFile")?.addEventListener("click", () => {
      const cfg = getAppConfig();
      const jsContent = `/**
 * EDUCORE PRO - CLIENT RESELLER CONFIGURATION
 * Generated automatically from Admin Settings Hub
 */
export const DEFAULT_CONFIG = ${JSON.stringify(cfg, null, 2)};

export function getAppConfig() {
  try {
    const saved = localStorage.getItem("educore_app_config");
    if (saved) return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
  } catch (e) {}
  return DEFAULT_CONFIG;
}

export function saveAppConfig(newConfig) {
  try {
    const merged = { ...getAppConfig(), ...newConfig };
    localStorage.setItem("educore_app_config", JSON.stringify(merged));
    window.dispatchEvent(new CustomEvent("configUpdated", { detail: merged }));
    return true;
  } catch (e) {
    return false;
  }
}
`;
      const blob = new Blob([jsContent], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "config.js";
      a.click();
      URL.revokeObjectURL(url);
      this.showToast("Downloaded customized config.js file!", "success");
    });

    // Firebase Credentials Form
    document.getElementById("firebaseConfigForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fb = {
        apiKey: document.getElementById("fbApiKey").value.trim(),
        projectId: document.getElementById("fbProjectId").value.trim(),
        authDomain: document.getElementById("fbAuthDomain").value.trim(),
        databaseURL: document.getElementById("fbDatabaseURL").value.trim(),
        storageBucket: document.getElementById("fbStorageBucket").value.trim(),
        appId: document.getElementById("fbAppId").value.trim()
      };

      saveAppConfig({ firebase: fb });
      this.showToast("Saved Firebase keys. Testing connection...", "info");
      const ok = await syncManager.reinitializeFirebase();
      if (ok) {
        this.showToast("Connected to Firebase Firestore & RTDB successfully!", "success");
      }
    });

    // Backup & Restore Buttons
    document.getElementById("btnCloudBackupNow")?.addEventListener("click", async () => {
      try {
        this.showToast("Pushing database snapshot to Firebase...", "info");
        const res = await syncManager.backupFullDatabaseToCloud();
        this.showToast(`Cloud Backup Complete! (${res.totalRecords} records backed up)`, "success");
      } catch (err) {
        this.showToast(err.message, "error");
      }
    });

    document.getElementById("btnCloudRestore")?.addEventListener("click", async () => {
      if (confirm("Restore all school data from Firebase Cloud backup? This will sync cloud data to local IndexedDB.")) {
        try {
          await syncManager.restoreFromCloud();
          this.showToast("Restored from Cloud successfully!", "success");
        } catch (err) {
          this.showToast(err.message, "error");
        }
      }
    });

    document.getElementById("btnLocalJsonBackup")?.addEventListener("click", () => this.exportDatabaseBackup());

    const jsonInput = document.getElementById("jsonFileInput");
    document.getElementById("btnLocalJsonRestore")?.addEventListener("click", () => jsonInput?.click());
    jsonInput?.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = async (event) => {
          try {
            const data = JSON.parse(event.target.result);
            await db.restoreAll(data);
            this.showToast("Database restored successfully from JSON backup!", "success");
          } catch (err) {
            this.showToast("Invalid JSON backup file", "error");
          }
        };
        reader.readAsText(file);
      }
    });

    // Fresh Start Data Purge
    document.getElementById("btnResetFreshSlate")?.addEventListener("click", async () => {
      const confirmText = prompt("WARNING: This will permanently delete all students, teachers, fees, attendance, grades, and notices for a completely fresh start.\n\nType 'RESET' to confirm:");
      if (confirmText === "RESET") {
        await db.clearAllDataKeepAdmin();
        this.showToast("All demo and existing records purged! Fresh start initialized.", "success");
        this.refreshCurrentView();
      }
    });

    // License Key Actions
    document.getElementById("btnReverifyLicense")?.addEventListener("click", async () => {
      this.showToast("Contacting private license server (licensekeysc)...", "info");
      const ok = await licenseManager.verifyKey(licenseManager.licenseKey);
      if (ok) {
        this.showToast("License key verified & active!", "success");
        this.refreshCurrentView();
      }
    });

    document.getElementById("btnChangeLicenseKey")?.addEventListener("click", () => {
      if (confirm("Deactivate current license key? The system will require a new valid license key to continue.")) {
        licenseManager.deactivateLicense();
      }
    });
  }

  async exportDatabaseBackup() {
    const data = await db.dumpAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `educore_school_backup_${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.showToast("Database backup downloaded!", "success");
  }

  // =========================================================================
  // 10. TEACHER PORTAL VIEWS
  // =========================================================================
  async renderTeacherDashboard() {
    const user = auth.getCurrentUser();
    const teacher = user.teacherProfile || {};
    const classes = await db.getAll(STORES.CLASSES);
    const notices = await db.getAll(STORES.NOTICES);

    return `
      <div class="page-header">
        <div class="page-title-group">
          <h1>Welcome, ${user.name}</h1>
          <p>Faculty Portal &bull; Department: ${teacher.subject || 'Academics'}</p>
        </div>
        <div class="page-actions-group">
          <button class="btn btn-primary" id="btnTeacherGoAttendance">
            <i class="fa-solid fa-clipboard-user"></i> Mark Attendance Today
          </button>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-details">
            <span class="stat-label">Department</span>
            <span class="stat-value" style="font-size:20px;">${teacher.subject || 'General'}</span>
            <div class="stat-trend positive">${teacher.qualification || 'Faculty'}</div>
          </div>
          <div class="stat-icon indigo"><i class="fa-solid fa-book"></i></div>
        </div>

        <div class="stat-card">
          <div class="stat-details">
            <span class="stat-label">Assigned Classes</span>
            <span class="stat-value">${(teacher.assignedClasses || []).length || 2}</span>
            <div class="stat-trend positive">Active Rosters</div>
          </div>
          <div class="stat-icon sky"><i class="fa-solid fa-chalkboard"></i></div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">My Assigned Classes</h3>
        </div>
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:16px;">
          ${(teacher.assignedClasses || ["Grade 10 - Section A", "Grade 9 - Section A"]).map(clsName => `
            <div style="padding:18px; background:rgba(255,255,255,0.03); border:1px solid var(--border-subtle); border-radius:var(--radius-md);">
              <strong style="font-size:16px; display:block; margin-bottom:6px;">${clsName}</strong>
              <div style="font-size:12px; color:var(--text-muted); margin-bottom:12px;">Standard Schedule &bull; Daily Assessment</div>
              <div style="display:flex; gap:8px;">
                <button class="btn btn-primary btn-sm" onclick="window.schoolApp.navigateTo('teacher_attendance')">Attendance</button>
                <button class="btn btn-secondary btn-sm" onclick="window.schoolApp.navigateTo('teacher_grades')">Grades</button>
              </div>
            </div>
          `).join("")}
        </div>
      </div>
    `;
  }

  async renderTeacherAttendanceView() {
    const classes = await db.getAll(STORES.CLASSES);
    const today = new Date().toISOString().split("T")[0];
    const students = await db.getAll(STORES.STUDENTS);

    // Selected class for marking
    const activeClassId = this.teacherActiveAttendanceClass || (classes[0] ? classes[0].id : "cls_10a");
    const classStudents = students.filter(s => s.classId === activeClassId);

    return `
      <div class="page-header">
        <div class="page-title-group">
          <h1>Mark Student Attendance</h1>
          <p>Instant offline attendance logging with cloud synchronization.</p>
        </div>
        <div class="page-actions-group">
          <input type="date" class="form-control" id="attendanceDatePicker" value="${today}" style="width:160px;">
          <select class="form-control" id="attendanceClassSelect" style="width:200px;">
            ${classes.map(c => `<option value="${c.id}" ${c.id === activeClassId ? 'selected' : ''}>${c.name} - ${c.section}</option>`).join("")}
          </select>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Roster Students (${classStudents.length})</h3>
          <div style="display:flex; gap:8px;">
            <button class="btn btn-secondary btn-sm" id="btnMarkAllPresent">Mark All Present</button>
            <button class="btn btn-primary btn-sm" id="btnSaveAttendance">
              <i class="fa-solid fa-floppy-disk"></i> Save Attendance
            </button>
          </div>
        </div>

        <div class="table-container">
          <table class="custom-table">
            <thead>
              <tr>
                <th>Scholar</th>
                <th>Roll No</th>
                <th>Attendance Status</th>
              </tr>
            </thead>
            <tbody id="attendanceRosterBody">
              ${classStudents.map(s => `
                <tr data-student-id="${s.id}">
                  <td>
                    <div class="table-user-cell">
                      <img src="${s.photoUrl || 'https://api.dicebear.com/7.x/bottts/svg?seed=' + s.name}" class="table-avatar" alt="Avatar">
                      <div>
                        <strong>${s.name}</strong>
                        <div style="font-size:11px; color:var(--text-muted);">${s.admissionNo}</div>
                      </div>
                    </div>
                  </td>
                  <td><code>${s.rollNo}</code></td>
                  <td>
                    <div style="display:inline-flex; gap:6px;">
                      <label style="cursor:pointer; display:flex; align-items:center; gap:4px; padding:6px 12px; border-radius:6px; background:rgba(16,185,129,0.15); color:#34d399; font-weight:600; font-size:12px;">
                        <input type="radio" name="att_${s.id}" value="present" checked> Present
                      </label>
                      <label style="cursor:pointer; display:flex; align-items:center; gap:4px; padding:6px 12px; border-radius:6px; background:rgba(245,158,11,0.15); color:#fbbf24; font-weight:600; font-size:12px;">
                        <input type="radio" name="att_${s.id}" value="late"> Late
                      </label>
                      <label style="cursor:pointer; display:flex; align-items:center; gap:4px; padding:6px 12px; border-radius:6px; background:rgba(239,68,68,0.15); color:#f87171; font-weight:600; font-size:12px;">
                        <input type="radio" name="att_${s.id}" value="absent"> Absent
                      </label>
                    </div>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  bindTeacherAttendanceEvents() {
    const classSelect = document.getElementById("attendanceClassSelect");
    if (classSelect) {
      classSelect.addEventListener("change", (e) => {
        this.teacherActiveAttendanceClass = e.target.value;
        this.refreshCurrentView();
      });
    }

    document.getElementById("btnMarkAllPresent")?.addEventListener("click", () => {
      document.querySelectorAll("input[type='radio'][value='present']").forEach(r => r.checked = true);
    });

    document.getElementById("btnSaveAttendance")?.addEventListener("click", async () => {
      const classId = document.getElementById("attendanceClassSelect")?.value;
      const date = document.getElementById("attendanceDatePicker")?.value || new Date().toISOString().split("T")[0];
      const user = auth.getCurrentUser();
      
      const records = {};
      let presentCount = 0, lateCount = 0, absentCount = 0;

      document.querySelectorAll("#attendanceRosterBody tr").forEach(row => {
        const studentId = row.getAttribute("data-student-id");
        const selected = row.querySelector(`input[name="att_${studentId}"]:checked`);
        const status = selected ? selected.value : "present";
        records[studentId] = status;
        if (status === "present") presentCount++;
        else if (status === "late") lateCount++;
        else absentCount++;
      });

      const attendanceDoc = {
        id: `att_${classId}_${date}`,
        date,
        classId,
        markedBy: user.name,
        records,
        summary: {
          present: presentCount,
          late: lateCount,
          absent: absentCount,
          total: presentCount + lateCount + absentCount
        }
      };

      await db.update(STORES.ATTENDANCE, attendanceDoc);
      this.showToast("Attendance saved successfully to Local DB & Cloud Sync queue!", "success");
    });
  }

  async renderTeacherGradesView() {
    const classes = await db.getAll(STORES.CLASSES);
    const students = await db.getAll(STORES.STUDENTS);
    const grades = await db.getAll(STORES.GRADES);

    return `
      <div class="page-header">
        <div class="page-title-group">
          <h1>Faculty Gradebook</h1>
          <p>Record exam marks and continuous assessments.</p>
        </div>
        <div class="page-actions-group">
          <button class="btn btn-primary" id="btnTeacherEnterGrade">
            <i class="fa-solid fa-plus"></i> Enter Marks
          </button>
        </div>
      </div>

      <div class="card">
        <div class="table-container">
          <table class="custom-table">
            <thead>
              <tr>
                <th>Scholar</th>
                <th>Exam</th>
                <th>Subject</th>
                <th>Marks</th>
                <th>Grade</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              ${grades.map(g => `
                <tr>
                  <td><strong>${g.studentName}</strong></td>
                  <td>${g.examName}</td>
                  <td>${g.subject}</td>
                  <td><strong>${g.marksObtained} / ${g.maxMarks}</strong></td>
                  <td><span class="badge badge-success">${g.grade}</span></td>
                  <td>${g.remarks || '—'}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  bindTeacherGradesEvents() {
    document.getElementById("btnTeacherEnterGrade")?.addEventListener("click", () => this.showGradeModal());
  }

  async renderTeacherStudentsView() {
    return this.renderStudentsView();
  }

  // =========================================================================
  // 11. STUDENT PORTAL VIEWS & PRINTABLE REPORT CARD
  // =========================================================================
  async renderStudentDashboard() {
    const user = auth.getCurrentUser();
    const student = user.studentProfile || {};
    const attendanceRecords = await db.getAll(STORES.ATTENDANCE);
    const grades = await db.getAll(STORES.GRADES);
    const fees = await db.getAll(STORES.FEES);

    const myGrades = grades.filter(g => g.studentId === (student.id || user.studentId));
    const myFees = fees.filter(f => f.studentId === (student.id || user.studentId));
    
    // Calculate attendance percentage for this student
    let totalClasses = 0;
    let attendedClasses = 0;
    attendanceRecords.forEach(att => {
      const rec = att.records ? att.records[student.id || user.studentId] : null;
      if (rec) {
        totalClasses++;
        if (rec === "present" || rec === "late") attendedClasses++;
      }
    });

    const attendancePct = totalClasses > 0 ? Math.round((attendedClasses / totalClasses) * 100) : 95;

    return `
      <div class="page-header">
        <div class="page-title-group">
          <h1>Welcome, ${user.name}</h1>
          <p>Student Portal &bull; ${student.className || 'Academic Enrollee'} &bull; Roll: ${student.rollNo || '01'}</p>
        </div>
        <div class="page-actions-group">
          <button class="btn btn-primary" onclick="window.schoolApp.showStudentIdCardModal('${student.id || user.studentId}')">
            <i class="fa-solid fa-id-card"></i> My Student ID Card
          </button>
          <button class="btn btn-secondary" onclick="window.schoolApp.showAdmissionCardModal('${student.id || user.studentId}')">
            <i class="fa-solid fa-file-invoice"></i> My Admission Card
          </button>
        </div>
      </div>

      <!-- Quick Scholar Stats -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-details">
            <span class="stat-label">Attendance Rate</span>
            <span class="stat-value">${attendancePct}%</span>
            <div class="stat-trend positive"><i class="fa-solid fa-check"></i> Satisfactory Presence</div>
          </div>
          <div class="stat-icon emerald"><i class="fa-solid fa-calendar-check"></i></div>
        </div>

        <div class="stat-card">
          <div class="stat-details">
            <span class="stat-label">Enrolled Class</span>
            <span class="stat-value" style="font-size:20px;">${student.className || 'Grade 10'}</span>
            <div class="stat-trend positive">Admission: ${student.admissionNo || 'Active'}</div>
          </div>
          <div class="stat-icon indigo"><i class="fa-solid fa-school"></i></div>
        </div>

        <div class="stat-card">
          <div class="stat-details">
            <span class="stat-label">Exams Completed</span>
            <span class="stat-value">${myGrades.length}</span>
            <div class="stat-trend positive">Graded Subjects</div>
          </div>
          <div class="stat-icon sky"><i class="fa-solid fa-award"></i></div>
        </div>
      </div>

      <!-- Quick Action Cards -->
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:24px;">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Recent Grades</h3>
            <button class="btn btn-secondary btn-sm" onclick="window.schoolApp.navigateTo('student_grades')">Full Report Card</button>
          </div>
          <div class="table-container">
            <table class="custom-table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Exam</th>
                  <th>Marks</th>
                  <th>Grade</th>
                </tr>
              </thead>
              <tbody>
                ${myGrades.slice(0, 4).map(g => `
                  <tr>
                    <td><strong>${g.subject}</strong></td>
                    <td>${g.examName}</td>
                    <td>${g.marksObtained} / ${g.maxMarks}</td>
                    <td><span class="badge badge-success">${g.grade}</span></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title">My Fee Invoices</h3>
            <button class="btn btn-secondary btn-sm" onclick="window.schoolApp.navigateTo('student_fees')">View All</button>
          </div>
          <div class="table-container">
            <table class="custom-table">
              <thead>
                <tr>
                  <th>Particulars</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${myFees.slice(0, 3).map(f => `
                  <tr>
                    <td>${f.type}</td>
                    <td><strong>${this.config.currency}${f.amount}</strong></td>
                    <td><span class="badge ${f.status === 'paid' ? 'badge-success' : 'badge-warning'}">${f.status.toUpperCase()}</span></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  async renderStudentAttendanceView() {
    const user = auth.getCurrentUser();
    const studentId = user.studentProfile?.id || user.studentId;
    const records = await db.getAll(STORES.ATTENDANCE);

    return `
      <div class="page-header">
        <div class="page-title-group">
          <h1>My Attendance Log</h1>
          <p>Daily class presence record and verification.</p>
        </div>
      </div>

      <div class="card">
        <div class="table-container">
          <table class="custom-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Class Session</th>
                <th>Status</th>
                <th>Marked By</th>
              </tr>
            </thead>
            <tbody>
              ${records.map(a => {
                const status = a.records ? a.records[studentId] : null;
                if (!status) return "";
                const badge = status === "present" ? "badge-success" : status === "late" ? "badge-warning" : "badge-danger";
                return `
                  <tr>
                    <td><strong>${a.date}</strong></td>
                    <td>${a.className || a.classId}</td>
                    <td><span class="badge ${badge}">${status.toUpperCase()}</span></td>
                    <td>${a.markedBy}</td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  async renderStudentGradesView() {
    const user = auth.getCurrentUser();
    const student = user.studentProfile || {};
    const studentId = student.id || user.studentId;
    const grades = await db.getAll(STORES.GRADES);
    const myGrades = grades.filter(g => g.studentId === studentId);

    return `
      <div class="page-header">
        <div class="page-title-group">
          <h1>My Academic Transcript</h1>
          <p>Official examination report card and performance metrics.</p>
        </div>
        <div class="page-actions-group">
          <button class="btn btn-primary" id="btnPrintReportCard">
            <i class="fa-solid fa-print"></i> Print Report Card
          </button>
        </div>
      </div>

      <div class="card">
        <div class="table-container">
          <table class="custom-table">
            <thead>
              <tr>
                <th>Subject</th>
                <th>Exam Period</th>
                <th>Max Marks</th>
                <th>Marks Obtained</th>
                <th>Percentage</th>
                <th>Grade</th>
                <th>Instructor Remarks</th>
              </tr>
            </thead>
            <tbody>
              ${myGrades.map(g => {
                const pct = Math.round((g.marksObtained / g.maxMarks) * 100);
                return `
                  <tr>
                    <td><strong>${g.subject}</strong></td>
                    <td>${g.examName}</td>
                    <td>${g.maxMarks}</td>
                    <td><strong>${g.marksObtained}</strong></td>
                    <td>${pct}%</td>
                    <td><span class="badge badge-success">${g.grade}</span></td>
                    <td>${g.remarks || '—'}</td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  bindStudentGradesEvents() {
    document.getElementById("btnPrintReportCard")?.addEventListener("click", () => {
      this.showReportCardModal();
    });
  }

  async renderStudentFeesView() {
    const user = auth.getCurrentUser();
    const studentId = user.studentProfile?.id || user.studentId;
    const fees = await db.getAll(STORES.FEES);
    const myFees = fees.filter(f => f.studentId === studentId);

    return `
      <div class="page-header">
        <div class="page-title-group">
          <h1>My Tuition & Fee Invoices</h1>
          <p>Review payment receipts and outstanding dues.</p>
        </div>
      </div>

      <div class="card">
        <div class="table-container">
          <table class="custom-table">
            <thead>
              <tr>
                <th>Receipt / Invoice</th>
                <th>Particulars</th>
                <th>Amount</th>
                <th>Due Date</th>
                <th>Status</th>
                <th style="text-align:right;">Receipt</th>
              </tr>
            </thead>
            <tbody>
              ${myFees.map(f => `
                <tr>
                  <td><code>${f.receiptNo}</code></td>
                  <td><strong>${f.type}</strong></td>
                  <td><strong>${this.config.currency}${f.amount}</strong></td>
                  <td>${f.dueDate}</td>
                  <td><span class="badge ${f.status === 'paid' ? 'badge-success' : 'badge-warning'}">${f.status.toUpperCase()}</span></td>
                  <td style="text-align:right;">
                    ${f.status === 'paid' ? `
                      <div style="display:inline-flex; gap:6px;">
                        <button class="btn btn-secondary btn-sm btn-print-receipt" data-id="${f.id}" title="View Receipt">
                          <i class="fa-solid fa-receipt"></i> Receipt
                        </button>
                        <button class="btn btn-secondary btn-sm btn-print-fee-cert" data-id="${f.id}" title="View Certificate">
                          <i class="fa-solid fa-certificate"></i> Certificate
                        </button>
                      </div>
                    ` : '<span>Awaiting Payment</span>'}
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  bindStudentFeesEvents() {
    document.querySelectorAll(".btn-print-receipt").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        this.showPrintableReceiptModal(id);
      });
    });

    document.querySelectorAll(".btn-print-fee-cert").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        this.showFeeCertificateModal(id);
      });
    });
  }

  // =========================================================================
  // 12. MODALS: AUTH (LOGIN & REGISTER)
  // =========================================================================
  showAuthModal(initialTab = "login") {
    const modalEl = document.getElementById("authModalWrapper");
    if (!modalEl) return;
    modalEl.style.display = "flex";

    this.activeAuthTab = initialTab;
    this.renderAuthModalContent();
  }

  hideAuthModal() {
    const modalEl = document.getElementById("authModalWrapper");
    if (modalEl) modalEl.style.display = "none";
  }

  renderAuthModalContent() {
    const container = document.getElementById("authModalInner");
    if (!container) return;

    container.innerHTML = `
      <div class="auth-card">
        <div class="auth-header">
          <div class="auth-logo-badge" style="${this.config.logoUrl ? 'background:#ffffff; padding:2px;' : ''}">
            ${this.config.logoUrl ? `<img src="${this.config.logoUrl}" style="width:100%; height:100%; object-fit:contain; border-radius:inherit;" alt="${this.config.schoolName}">` : `<i class="fa-solid fa-graduation-cap"></i>`}
          </div>
          <h2 class="auth-title">${this.config.schoolName}</h2>
          <p class="auth-subtitle">${this.config.tagline || 'Education Management Portal'}</p>
        </div>

        <div class="auth-tabs">
          <button class="auth-tab-btn ${this.activeAuthTab === 'login' ? 'active' : ''}" id="tabBtnLogin">Sign In</button>
          <button class="auth-tab-btn ${this.activeAuthTab === 'register_teacher' ? 'active' : ''}" id="tabBtnRegTeacher">Register Faculty</button>
          <button class="auth-tab-btn ${this.activeAuthTab === 'register_student' ? 'active' : ''}" id="tabBtnRegStudent">Register Student</button>
        </div>

        ${this.activeAuthTab === 'login' ? `
          <!-- Login Form (CNIC & Phone Based) -->
          <form id="formLogin">
            <div class="form-group">
              <label class="form-label"><i class="fa-solid fa-id-card" style="color:var(--primary); margin-right:4px;"></i> CNIC / B-Form or Mobile Number</label>
              <input type="text" class="form-control" id="loginIdentifier" placeholder="e.g. 42101-1111111-1 or 0300-1111111" required>
              <small style="font-size:11px; color:var(--text-dim); margin-top:4px; display:block;">Enter your 13-digit CNIC or 11-digit Pakistani mobile number</small>
            </div>
            <div class="form-group">
              <label class="form-label"><i class="fa-solid fa-lock" style="color:var(--primary); margin-right:4px;"></i> Password</label>
              <input type="password" class="form-control" id="loginPassword" placeholder="••••••••" required>
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%; margin-top:10px;">
              <i class="fa-solid fa-arrow-right-to-bracket"></i> Sign In to Portal
            </button>
          </form>

          <!-- Master Admin Initial Credentials Helper -->
          <div style="margin-top:20px; background:rgba(79, 70, 229, 0.05); border:1px dashed rgba(79, 70, 229, 0.25); border-radius:10px; padding:12px; text-align:center;">
            <div style="font-size:11px; text-transform:uppercase; letter-spacing:0.06em; color:var(--primary); font-weight:700; margin-bottom:4px;">
              🛡️ Master Administrator Initial Login
            </div>
            <div style="font-size:12px; color:var(--text-muted); margin-bottom:10px;">
              Mobile: <strong style="color:var(--text-main);">0300-1111111</strong> &nbsp;|&nbsp; Pass: <strong style="color:var(--text-main);">admin</strong>
            </div>
            <button type="button" class="btn btn-secondary btn-sm" id="btnAutoFillAdmin" style="width:100%; border-radius:8px; font-size:12px; font-weight:600;">
              <i class="fa-solid fa-key" style="color:var(--primary);"></i> Auto-fill Administrator Credentials
            </button>
          </div>
        ` : this.activeAuthTab === 'register_teacher' ? `
          <!-- Teacher Registration Form (CNIC & Phone Based) -->
          <form id="formRegisterTeacher">
            <div class="form-group">
              <label class="form-label">Faculty Member Full Name</label>
              <input type="text" class="form-control" id="regTchName" placeholder="Dr. Robert Vance" required>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Teacher CNIC (13 digits)</label>
                <input type="text" class="form-control" id="regTchCnic" placeholder="42101-1234567-1" required>
              </div>
              <div class="form-group">
                <label class="form-label">Mobile Phone Number</label>
                <input type="tel" class="form-control" id="regTchPhone" placeholder="0300-1234567" required>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Department / Subject</label>
                <input type="text" class="form-control" id="regTchSubject" placeholder="Mathematics & Physics" required>
              </div>
              <div class="form-group">
                <label class="form-label">Login Password</label>
                <input type="password" class="form-control" id="regTchPass" placeholder="••••••••" required>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Academic Qualifications</label>
              <input type="text" class="form-control" id="regTchQual" placeholder="M.Sc. Mathematics / B.Ed">
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%; margin-top:8px;">
              <i class="fa-solid fa-user-check"></i> Register Faculty Account
            </button>
          </form>
        ` : `
          <!-- Student Registration Form (B-Form CNIC & Phone Based) -->
          <form id="formRegisterStudent">
            <div class="form-group">
              <label class="form-label">Student Full Name</label>
              <input type="text" class="form-control" id="regStdName" placeholder="Muhammad Hamza" required>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Student B-Form / CNIC</label>
                <input type="text" class="form-control" id="regStdCnic" placeholder="42101-9876543-1" required>
              </div>
              <div class="form-group">
                <label class="form-label">Mobile Phone Number</label>
                <input type="tel" class="form-control" id="regStdPhone" placeholder="0300-9876543" required>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Grade / Class</label>
                <select class="form-control" id="regStdClass">
                  <option value="cls_01">Class 1</option>
                  <option value="cls_02">Class 2</option>
                  <option value="cls_09">Grade 9</option>
                  <option value="cls_10">Grade 10</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Login Password</label>
                <input type="password" class="form-control" id="regStdPass" placeholder="••••••••" required>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Father / Guardian Name</label>
                <input type="text" class="form-control" id="regStdParentName" placeholder="Tariq Mehmood">
              </div>
              <div class="form-group">
                <label class="form-label">Guardian CNIC</label>
                <input type="text" class="form-control" id="regStdParentCnic" placeholder="42101-1122334-1">
              </div>
            </div>
            <button type="submit" class="btn btn-primary" style="width:100%; margin-top:8px;">
              <i class="fa-solid fa-user-plus"></i> Register Student Account
            </button>
          </form>
        `}
      </div>
    `;

    // Tab buttons
    document.getElementById("tabBtnLogin")?.addEventListener("click", () => {
      this.activeAuthTab = "login";
      this.renderAuthModalContent();
    });
    document.getElementById("tabBtnRegTeacher")?.addEventListener("click", () => {
      this.activeAuthTab = "register_teacher";
      this.renderAuthModalContent();
    });
    document.getElementById("tabBtnRegStudent")?.addEventListener("click", () => {
      this.activeAuthTab = "register_student";
      this.renderAuthModalContent();
    });

    // Auto-fill Master Admin Credentials
    document.getElementById("btnAutoFillAdmin")?.addEventListener("click", () => {
      const idInput = document.getElementById("loginIdentifier");
      const passInput = document.getElementById("loginPassword");
      if (idInput) idInput.value = "0300-1111111";
      if (passInput) passInput.value = "admin";
      this.showToast("Master Admin credentials auto-filled! Click 'Sign In' to enter.", "info");
    });

    // Form handlers
    document.getElementById("formLogin")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const identifier = document.getElementById("loginIdentifier").value;
        const pass = document.getElementById("loginPassword").value;
        await auth.login(identifier, pass);
        this.showToast("Welcome back!", "success");
      } catch (err) {
        this.showToast(err.message, "error");
      }
    });

    document.getElementById("formRegisterTeacher")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const teacherData = {
          name: document.getElementById("regTchName").value,
          cnic: document.getElementById("regTchCnic").value,
          phone: document.getElementById("regTchPhone").value,
          password: document.getElementById("regTchPass").value,
          subject: document.getElementById("regTchSubject").value,
          qualification: document.getElementById("regTchQual").value,
          assignedClasses: ["Grade 10 - Section A"]
        };
        await auth.registerTeacher(teacherData);
        this.showToast("Faculty account registered with CNIC successfully!", "success");
      } catch (err) {
        this.showToast(err.message, "error");
      }
    });

    document.getElementById("formRegisterStudent")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const classSelect = document.getElementById("regStdClass");
        const studentData = {
          name: document.getElementById("regStdName").value,
          cnic: document.getElementById("regStdCnic").value,
          phone: document.getElementById("regStdPhone").value,
          password: document.getElementById("regStdPass").value,
          classId: classSelect.value,
          className: classSelect.options[classSelect.selectedIndex].text,
          parentName: document.getElementById("regStdParentName")?.value || "",
          parentCnic: document.getElementById("regStdParentCnic")?.value || ""
        };
        await auth.registerStudent(studentData);
        this.showToast("Student registered with B-Form & Phone successfully!", "success");
      } catch (err) {
        this.showToast(err.message, "error");
      }
    });
  }

  // =========================================================================
  // 13. MODAL HELPERS (GENERIC MODAL MANAGER)
  // =========================================================================
  openModal(title, bodyHtml, footerHtml = "") {
    let overlay = document.getElementById("genericModalOverlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "genericModalOverlay";
      overlay.className = "modal-overlay";
      overlay.innerHTML = `
        <div class="modal-window">
          <div class="modal-header">
            <h3 class="modal-title" id="modalTitleText"></h3>
            <button class="modal-close-btn" id="modalCloseBtn"><i class="fa-solid fa-xmark"></i></button>
          </div>
          <div class="modal-body" id="modalBodyContent"></div>
          <div class="modal-footer" id="modalFooterContent"></div>
        </div>
      `;
      document.body.appendChild(overlay);

      overlay.querySelector("#modalCloseBtn").addEventListener("click", () => this.closeModal());
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) this.closeModal();
      });
    }

    overlay.querySelector("#modalTitleText").textContent = title;
    overlay.querySelector("#modalBodyContent").innerHTML = bodyHtml;
    
    const footerEl = overlay.querySelector("#modalFooterContent");
    if (footerHtml) {
      footerEl.innerHTML = footerHtml;
      footerEl.style.display = "flex";
    } else {
      footerEl.style.display = "none";
    }

    overlay.classList.add("active");
  }

  closeModal() {
    const overlay = document.getElementById("genericModalOverlay");
    if (overlay) overlay.classList.remove("active");
  }

  // --- Global Document Printing Engine ---
  printDocument(contentOrSelector = ".printable-area", docTitle = "") {
    let htmlToPrint = "";

    if (typeof contentOrSelector === "string") {
      const el = document.querySelector(contentOrSelector);
      if (el) {
        htmlToPrint = el.outerHTML;
      } else {
        htmlToPrint = contentOrSelector;
      }
    } else if (contentOrSelector instanceof HTMLElement) {
      htmlToPrint = contentOrSelector.outerHTML;
    }

    if (!htmlToPrint) {
      const fallback = document.querySelector("#genericModalOverlay.active .printable-area") ||
                       document.querySelector(".printable-area") ||
                       document.querySelector(".modal-window");
      if (fallback) htmlToPrint = fallback.outerHTML;
    }

    if (!htmlToPrint) {
      window.print();
      return;
    }

    let container = document.getElementById("globalPrintContainer");
    if (!container) {
      container = document.createElement("div");
      container.id = "globalPrintContainer";
      document.body.appendChild(container);
    }

    container.innerHTML = htmlToPrint;
    document.body.classList.add("is-printing-document");

    const prevTitle = document.title;
    if (docTitle) document.title = docTitle;

    const cleanup = () => {
      document.body.classList.remove("is-printing-document");
      if (container) container.innerHTML = "";
      document.title = prevTitle;
      window.removeEventListener("afterprint", cleanup);
    };

    window.addEventListener("afterprint", cleanup, { once: true });

    // Double frame delay ensures browser styles and images calculate before print dialog
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
        setTimeout(cleanup, 3000);
      });
    });
  }

  // --- Student Modal ---
  async showStudentModal(studentId = null) {
    const student = studentId ? await db.getById(STORES.STUDENTS, studentId) : null;
    const classes = await db.getAll(STORES.CLASSES);

    const body = `
      <form id="studentModalForm">
        <!-- Student Photo Upload (ImgBB Cloud API v1) -->
        <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:14px; margin-bottom:16px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <label class="form-label" style="margin-bottom:0;"><i class="fa-solid fa-camera" style="color:var(--primary); margin-right:4px;"></i> Student Profile Photo (ImgBB API v1)</label>
            <span class="badge badge-success" style="font-size:10px;"><i class="fa-solid fa-cloud"></i> ImgBB Cloud</span>
          </div>
          <div style="display:flex; align-items:center; gap:16px;">
            <div id="stdPhotoPreviewBox" style="width:72px; height:72px; border-radius:8px; border:2px dashed rgba(var(--primary-rgb),0.4); overflow:hidden; background:#ffffff; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
              <img id="stdPhotoPreviewImg" src="${student?.photoUrl || 'https://api.dicebear.com/7.x/bottts/svg?seed=' + (student?.name || 'new')}" style="width:100%; height:100%; object-fit:cover;" alt="Photo">
            </div>
            <div style="flex:1; display:flex; flex-direction:column; gap:6px;">
              <input type="file" id="stdModalPhotoFile" accept="image/*" style="display:none;">
              <button type="button" class="btn btn-secondary btn-sm" id="btnUploadStdPhotoTrigger">
                <i class="fa-solid fa-cloud-arrow-up"></i> Upload Photo via ImgBB
              </button>
              <input type="text" class="form-control" id="stdModalPhotoUrl" value="${student?.photoUrl || ''}" placeholder="Live photo URL (hosted on ImgBB)" style="font-size:11px;">
            </div>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Student Full Name</label>
          <input type="text" class="form-control" id="stdModalName" value="${student?.name || ''}" required>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Student B-Form / CNIC</label>
            <input type="text" class="form-control" id="stdModalCnic" value="${student?.cnic || ''}" placeholder="42101-1234567-1" required>
          </div>
          <div class="form-group">
            <label class="form-label">Mobile Phone Number</label>
            <input type="tel" class="form-control" id="stdModalPhone" value="${student?.phone || student?.parentPhone || ''}" placeholder="0300-1234567" required>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Admission Number</label>
            <input type="text" class="form-control" id="stdModalAdmNo" value="${student?.admissionNo || 'ADM-2026-' + Math.floor(100+Math.random()*900)}" required>
          </div>
          <div class="form-group">
            <label class="form-label">Roll Number</label>
            <input type="text" class="form-control" id="stdModalRoll" value="${student?.rollNo || '10A-0' + Math.floor(1+Math.random()*9)}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Class & Section</label>
            <select class="form-control" id="stdModalClass">
              ${classes.map(c => `<option value="${c.id}" ${student?.classId === c.id ? 'selected' : ''}>${c.name} - ${c.section}</option>`).join("")}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Father / Guardian Name</label>
            <input type="text" class="form-control" id="stdModalParent" value="${student?.parentName || ''}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Guardian CNIC</label>
            <input type="text" class="form-control" id="stdModalParentCnic" value="${student?.parentCnic || ''}" placeholder="42101-1122334-1">
          </div>
          <div class="form-group">
            <label class="form-label">Campus / Residential Address</label>
            <input type="text" class="form-control" id="stdModalAddress" value="${student?.address || 'Lahore / Karachi, Pakistan'}">
          </div>
        </div>
      </form>
    `;

    const footer = `
      <button class="btn btn-secondary" onclick="window.schoolApp.closeModal()">Cancel</button>
      <button class="btn btn-primary" id="btnSaveStudentModal">Save Student</button>
    `;

    this.openModal(student ? "Edit Student Record" : "Enroll New Student", body, footer);

    // Bind ImgBB Photo Uploader
    const photoFileInput = document.getElementById("stdModalPhotoFile");
    const btnUploadPhoto = document.getElementById("btnUploadStdPhotoTrigger");
    const photoUrlInput = document.getElementById("stdModalPhotoUrl");
    const photoPreviewImg = document.getElementById("stdPhotoPreviewImg");

    btnUploadPhoto?.addEventListener("click", () => photoFileInput?.click());
    photoFileInput?.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (file) {
        this.showToast("Uploading photo to ImgBB cloud...", "info");
        try {
          const liveUrl = await uploadImageToImgbb(file);
          if (photoUrlInput) photoUrlInput.value = liveUrl;
          if (photoPreviewImg) photoPreviewImg.src = liveUrl;
          this.showToast("Photo uploaded to ImgBB successfully!", "success");
        } catch (err) {
          this.showToast(`Upload failed: ${err.message}`, "error");
        }
      }
    });

    document.getElementById("btnSaveStudentModal")?.addEventListener("click", async () => {
      const clsSelect = document.getElementById("stdModalClass");
      const chosenPhoto = document.getElementById("stdModalPhotoUrl").value.trim() || 
        student?.photoUrl || 
        `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(document.getElementById("stdModalName").value)}`;

      const data = {
        ...(student || {}),
        name: document.getElementById("stdModalName").value,
        cnic: document.getElementById("stdModalCnic").value,
        phone: document.getElementById("stdModalPhone").value,
        email: student?.email || `${document.getElementById("stdModalCnic").value.replace(/\D/g, "")}@student.portal`,
        admissionNo: document.getElementById("stdModalAdmNo").value,
        classId: clsSelect.value,
        className: clsSelect.options[clsSelect.selectedIndex].text,
        rollNo: document.getElementById("stdModalRoll").value,
        parentName: document.getElementById("stdModalParent").value,
        parentCnic: document.getElementById("stdModalParentCnic").value,
        parentPhone: document.getElementById("stdModalPhone").value,
        address: document.getElementById("stdModalAddress").value,
        photoUrl: chosenPhoto,
        status: "Active"
      };

      if (student) {
        await db.update(STORES.STUDENTS, data);
        this.showToast("Student updated successfully", "success");
      } else {
        await db.add(STORES.STUDENTS, data);
        this.showToast("Student enrolled successfully", "success");
      }
      this.closeModal();
    });
  }

  // --- Printable Student ID Card Modal ---
  async showStudentIdCardModal(studentId) {
    const student = await db.getById(STORES.STUDENTS, studentId);
    if (!student) return;

    const body = `
      <div class="printable-area" style="text-align:center; padding:10px;">
        <div style="background:#ffffff; color:#0f172a; border:2px solid #4f46e5; border-radius:16px; padding:24px; max-width:360px; margin:0 auto; box-shadow:0 8px 24px rgba(0,0,0,0.15); position:relative; overflow:hidden;">
          <!-- Card Header Ribbon with School Logo & Monogram -->
          <div style="background:linear-gradient(135deg, #4f46e5, #0ea5e9); color:#fff; padding:14px 12px; margin:-24px -24px 18px -24px; text-align:center;">
            ${this.config.logoUrl ? `
              <img src="${this.config.logoUrl}" class="id-card-school-logo" alt="${this.config.schoolName}">
            ` : `
              <div class="id-card-school-monogram">${(this.config.logoText || 'Edu').slice(0, 4)}</div>
            `}
            <strong style="font-size:15px; letter-spacing:0.02em; display:block;">${this.config.schoolName}</strong>
            <span style="font-size:11px; opacity:0.9;">OFFICIAL STUDENT IDENTITY CARD</span>
          </div>
          
          <img src="${student.photoUrl || 'https://api.dicebear.com/7.x/bottts/svg?seed=' + student.name}" style="width:96px; height:96px; border-radius:50%; border:3px solid #4f46e5; object-fit:cover; margin-bottom:12px; background:#fff;" alt="Photo">
          
          <h3 style="font-size:18px; font-weight:800; color:#0f172a; margin-bottom:4px;">${student.name}</h3>
          <span style="display:inline-block; background:#eef2ff; color:#4f46e5; padding:3px 10px; border-radius:999px; font-size:12px; font-weight:700; margin-bottom:14px;">
            ${student.className} &bull; Roll: ${student.rollNo}
          </span>

          <div style="text-align:left; font-size:12px; color:#475569; display:flex; flex-direction:column; gap:6px; background:#f8fafc; padding:12px; border-radius:8px; border:1px solid #e2e8f0; margin-bottom:14px;">
            <div><strong>Admission #:</strong> <code>${student.admissionNo}</code></div>
            <div><strong>B-Form / CNIC:</strong> <code>${student.cnic || '42101-3333333-3'}</code></div>
            <div><strong>Mobile / Phone:</strong> ${student.phone || student.parentPhone || '0300-3333333'}</div>
            <div><strong>Guardian:</strong> ${student.parentName || '—'}</div>
            <div><strong>Campus:</strong> ${this.config.contact.address}</div>
          </div>

          <!-- Barcode simulation -->
          <div style="font-family:'JetBrains Mono', monospace; font-size:11px; letter-spacing:4px; font-weight:700; color:#0f172a; padding:6px; background:#f1f5f9; border-radius:4px;">
            ||||| | |||| ||| |||||||
            <div style="font-size:9px; letter-spacing:1px; margin-top:2px;">${student.admissionNo}</div>
          </div>
        </div>
      </div>
    `;

    const footer = `
      <button class="btn btn-secondary no-print" onclick="window.schoolApp.closeModal()">Close</button>
      <button class="btn btn-primary no-print" onclick="window.schoolApp.printDocument('.printable-area', 'Student ID Card - ${student.name}')">
        <i class="fa-solid fa-print"></i> Print ID Card
      </button>
    `;

    this.openModal("Student Identity Card", body, footer);
  }

  // --- Printable Official Admission Card / Slip Modal ---
  async showAdmissionCardModal(studentId) {
    const student = await db.getById(STORES.STUDENTS, studentId);
    if (!student) return;

    const body = `
      <div class="printable-area">
        <div class="printable-admission-card">
          <div class="admission-header">
            ${this.config.logoUrl ? `
              <img src="${this.config.logoUrl}" class="doc-school-logo" alt="${this.config.schoolName}">
            ` : `
              <div class="doc-school-monogram">${(this.config.logoText || 'Edu').slice(0, 4)}</div>
            `}
            <div class="admission-title-box">
              <h2 style="font-size:20px; font-weight:800; color:#0f172a; margin:0;">${this.config.schoolName}</h2>
              <div style="font-size:12px; color:#64748b; margin-top:2px;">${this.config.contact.address} &bull; ${this.config.contact.phone}</div>
              <span class="admission-badge-pill">OFFICIAL STUDENT ADMISSION CARD / SLIP</span>
            </div>
            <div class="admission-photo-box">
              <img src="${student.photoUrl || 'https://api.dicebear.com/7.x/bottts/svg?seed=' + student.name}" alt="Candidate Photo">
            </div>
          </div>

          <div class="admission-details-grid">
            <div class="admission-field">
              <span class="admission-field-label">Admission Number</span>
              <span class="admission-field-value"><code>${student.admissionNo}</code></span>
            </div>
            <div class="admission-field">
              <span class="admission-field-label">Assigned Roll Number</span>
              <span class="admission-field-value"><code>${student.rollNo || 'Not Assigned'}</code></span>
            </div>
            <div class="admission-field">
              <span class="admission-field-label">Scholar Full Name</span>
              <span class="admission-field-value">${student.name}</span>
            </div>
            <div class="admission-field">
              <span class="admission-field-label">Student B-Form / CNIC</span>
              <span class="admission-field-value"><code>${student.cnic || '—'}</code></span>
            </div>
            <div class="admission-field">
              <span class="admission-field-label">Father / Guardian Name</span>
              <span class="admission-field-value">${student.parentName || '—'}</span>
            </div>
            <div class="admission-field">
              <span class="admission-field-label">Guardian CNIC</span>
              <span class="admission-field-value"><code>${student.parentCnic || '—'}</code></span>
            </div>
            <div class="admission-field">
              <span class="admission-field-label">Class & Section</span>
              <span class="admission-field-value">${student.className || 'Primary Stream'}</span>
            </div>
            <div class="admission-field">
              <span class="admission-field-label">Contact Mobile</span>
              <span class="admission-field-value">${student.phone || student.parentPhone || '—'}</span>
            </div>
            <div class="admission-field">
              <span class="admission-field-label">Academic Session</span>
              <span class="admission-field-value">${this.config.academicYear}</span>
            </div>
            <div class="admission-field">
              <span class="admission-field-label">Enrollment Status</span>
              <span class="admission-field-value" style="color:#10b981;">&bull; Confirmed & Verified</span>
            </div>
          </div>

          <div class="admission-instructions">
            <strong>Institutional Regulations & Candidate Undertaking:</strong>
            <ol style="margin:4px 0 0 16px; padding:0;">
              <li>This card serves as official admission verification and must be presented during examinations and campus entry.</li>
              <li>Minimum 80% attendance is required to maintain institutional enrollment and qualify for term examinations.</li>
              <li>All institutional fee vouchers must be cleared prior to scheduled due dates.</li>
            </ol>
          </div>

          <div class="admission-signatures-row">
            <div class="admission-sign-col">
              <div>Admissions Officer</div>
              <small style="color:#94a3b8; font-size:10px;">Verified by Registry</small>
            </div>
            <div style="text-align:center; padding-top:6px;">
              <div style="font-family:'JetBrains Mono', monospace; font-size:11px; letter-spacing:4px; font-weight:700;">
                |||| | |||||| | ||| ||||
              </div>
              <span style="font-size:10px; color:#64748b;">${student.admissionNo}</span>
            </div>
            <div class="admission-sign-col">
              <div>Principal / Head of Institution</div>
              <small style="color:#94a3b8; font-size:10px;">Official Seal & Signature</small>
            </div>
          </div>
        </div>
      </div>
    `;

    const footer = `
      <button class="btn btn-secondary no-print" onclick="window.schoolApp.closeModal()">Close</button>
      <button class="btn btn-primary no-print" onclick="window.schoolApp.printDocument('.printable-area', 'Admission Card - ${student.name}')">
        <i class="fa-solid fa-print"></i> Print Admission Card
      </button>
    `;

    this.openModal("Official Admission Card", body, footer);
  }

  // --- Printable Fee Receipt Modal ---
  async showPrintableReceiptModal(feeId) {
    const fee = await db.getById(STORES.FEES, feeId);
    if (!fee) return;

    const student = await db.getById(STORES.STUDENTS, fee.studentId);

    const body = `
      <div class="printable-area">
        <div class="printable-receipt-card">
          <div class="receipt-header">
            <div style="display:flex; align-items:center; gap:16px;">
              ${this.config.logoUrl ? `
                <img src="${this.config.logoUrl}" class="doc-school-logo" alt="School Logo">
              ` : `
                <div class="doc-school-monogram">${(this.config.logoText || 'Edu').slice(0, 4)}</div>
              `}
              <div>
                <div class="receipt-school-name">${this.config.schoolName}</div>
                <div style="font-size:12px; color:#64748b; margin-top:3px;">${this.config.contact.address}</div>
                <div style="font-size:12px; color:#64748b;">Phone: ${this.config.contact.phone} | Email: ${this.config.contact.email}</div>
              </div>
            </div>
            <div style="text-align:right;">
              <span class="receipt-badge">OFFICIAL FEE RECEIPT</span>
              <div style="font-size:14px; font-weight:700; margin-top:6px;">${fee.receiptNo}</div>
              <div style="font-size:11px; color:#64748b;">Date: ${fee.paidDate || fee.dueDate}</div>
            </div>
          </div>

          <div class="receipt-grid">
            <div>
              <span style="font-size:11px; text-transform:uppercase; color:#94a3b8; font-weight:700;">Student Details</span>
              <div style="font-weight:700; font-size:14px; margin-top:2px;">${fee.studentName}</div>
              <div style="color:#64748b;">Class: ${student?.className || 'Enrolled'} &bull; Roll: ${student?.rollNo || '—'}</div>
              <div style="color:#64748b;">Admission No: <code>${student?.admissionNo || '—'}</code></div>
              <div style="color:#64748b;">B-Form / CNIC: <code>${student?.cnic || '—'}</code> &bull; Phone: ${student?.phone || student?.parentPhone || '—'}</div>
            </div>
            <div style="text-align:right;">
              <span style="font-size:11px; text-transform:uppercase; color:#94a3b8; font-weight:700;">Payment Summary</span>
              <div style="font-weight:700; font-size:14px; color:#10b981; margin-top:2px;">Status: PAID IN FULL</div>
              <div style="color:#64748b;">Method: ${fee.paymentMethod || 'Portal Payment'}</div>
              <div style="color:#64748b;">Academic Year: ${this.config.academicYear}</div>
            </div>
          </div>

          <table class="receipt-table">
            <thead>
              <tr>
                <th>Description / Particulars</th>
                <th>Fee Term</th>
                <th style="text-align:right;">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>${fee.type}</strong><br><span style="font-size:11px; color:#64748b;">${fee.remarks || 'Standard curriculum term fee'}</span></td>
                <td>Current Term</td>
                <td style="text-align:right; font-weight:700;">${this.config.currency}${Number(fee.amount).toLocaleString()}</td>
              </tr>
            </tbody>
          </table>

          <div class="receipt-total-row">
            <span>Total Amount Paid</span>
            <span>${this.config.currency}${Number(fee.amount).toLocaleString()}</span>
          </div>

          ${fee.status === "pending" ? paymentInstructionsHTML(this.config, fee.amount) : ""}

          <div class="receipt-footer-stamp">
            <div>
              <em>System generated official receipt. Verified electronically.</em>
            </div>
            <div class="stamp-box">
              Authorized Cashier / Dean
            </div>
          </div>
        </div>
      </div>
    `;

    const footer = `
      <button class="btn btn-secondary no-print" onclick="window.schoolApp.closeModal()">Close</button>
      <button class="btn btn-secondary no-print" onclick="window.schoolApp.showFeeCertificateModal('${fee.id}')">
        <i class="fa-solid fa-certificate"></i> Fee Certificate
      </button>
      <button class="btn btn-primary no-print" onclick="window.schoolApp.printDocument('.printable-area', 'Fee Receipt - ${fee.receiptNo}')">
        <i class="fa-solid fa-print"></i> Print Official Receipt
      </button>
    `;

    this.openModal("Official Fee Receipt", body, footer);
  }

  // --- Printable Official Fee Clearance Certificate Modal ---
  async showFeeCertificateModal(feeId) {
    const fee = await db.getById(STORES.FEES, feeId);
    if (!fee) return;

    const student = await db.getById(STORES.STUDENTS, fee.studentId);

    const body = `
      <div class="printable-area">
        <div class="printable-certificate-card">
          <div class="certificate-header">
            ${this.config.logoUrl ? `
              <img src="${this.config.logoUrl}" class="doc-school-logo" style="width:76px; height:76px; margin:0 auto 8px auto;" alt="Logo">
            ` : `
              <div class="doc-school-monogram" style="width:76px; height:76px; font-size:24px; margin:0 auto 8px auto;">${(this.config.logoText || 'Edu').slice(0, 4)}</div>
            `}
            <h2 style="font-size:22px; font-weight:800; color:#0f172a; margin:0;">${this.config.schoolName}</h2>
            <p style="font-size:12px; color:#64748b; margin:2px 0 0 0;">${this.config.contact.address} &bull; ${this.config.contact.phone}</p>
            <div class="certificate-title">Fee Clearance & Dues Certificate</div>
            <div style="font-size:11.5px; color:#64748b; margin-top:6px;">Certificate Ref: <code>CERT-FEE-${fee.receiptNo.replace('REC-','')}</code> &bull; Date of Issue: ${fee.paidDate || new Date().toISOString().split('T')[0]}</div>
          </div>

          <div class="certificate-body">
            This is to solemnly certify that Scholar <strong>${student?.name || fee.studentName}</strong>, 
            Son/Daughter of <strong>${student?.parentName || 'Guardian'}</strong>, holding B-Form / CNIC <strong>${student?.cnic || 'Verified'}</strong> 
            and registered under Admission No. <strong>${student?.admissionNo || 'Enrolled'}</strong> in Class <strong>${student?.className || 'Academic Stream'}</strong> (Roll No: <strong>${student?.rollNo || '—'}</strong>), 
            has cleared all prescribed institutional tuition and curricular dues totaling <strong>${this.config.currency}${Number(fee.amount).toLocaleString()}</strong> 
            for the term <strong>"${fee.type}"</strong> under Official Receipt No. <strong>${fee.receiptNo}</strong> for Academic Session <strong>${this.config.academicYear}</strong>.
            <br><br>
            As of this verification, all financial dues and accounts for the specified academic period stand fully settled, and the scholar holds zero outstanding institutional dues.
          </div>

          <div class="certificate-signatures">
            <div class="stamp-box">
              <div style="font-weight:700; color:#0f172a;">Accounts & Bursar Office</div>
              <div style="font-size:11px; color:#64748b;">Seal & Signature</div>
            </div>
            <div style="text-align:center;">
              <div style="display:inline-block; border:2px dashed #10b981; color:#10b981; padding:6px 14px; border-radius:6px; font-size:11px; font-weight:800; letter-spacing:1px;">
                OFFICIALLY VERIFIED &bull; ALL DUES PAID
              </div>
            </div>
            <div class="stamp-box">
              <div style="font-weight:700; color:#0f172a;">Principal / Registrar</div>
              <div style="font-size:11px; color:#64748b;">Seal & Signature</div>
            </div>
          </div>
        </div>
      </div>
    `;

    const footer = `
      <button class="btn btn-secondary no-print" onclick="window.schoolApp.closeModal()">Close</button>
      <button class="btn btn-secondary no-print" onclick="window.schoolApp.showPrintableReceiptModal('${fee.id}')">
        <i class="fa-solid fa-receipt"></i> View Receipt
      </button>
      <button class="btn btn-primary no-print" onclick="window.schoolApp.printDocument('.printable-area', 'Fee Certificate - ${student?.name || fee.studentName}')">
        <i class="fa-solid fa-print"></i> Print Fee Certificate
      </button>
    `;

    this.openModal("Official Fee Certificate", body, footer);
  }

  // --- Printable Academic Report Card / Transcript Modal ---
  async showReportCardModal(studentId = null) {
    const user = auth.getCurrentUser();
    const targetStudentId = studentId || user.studentProfile?.id || user.studentId;
    let student = null;

    if (targetStudentId) {
      student = await db.getById(STORES.STUDENTS, targetStudentId);
    }

    if (!student) {
      const allStudents = await db.getAll(STORES.STUDENTS);
      student = allStudents[0];
    }

    if (!student) {
      this.showToast("No student profile found for transcript.", "warning");
      return;
    }

    const allGrades = await db.getAll(STORES.GRADES);
    const myGrades = allGrades.filter(g => g.studentId === student.id);

    const totalMax = myGrades.reduce((sum, g) => sum + Number(g.maxMarks || 0), 0);
    const totalObtained = myGrades.reduce((sum, g) => sum + Number(g.marksObtained || 0), 0);
    const overallPct = totalMax > 0 ? Math.round((totalObtained / totalMax) * 100) : 0;
    const overallGrade = overallPct >= 80 ? "A+" : overallPct >= 70 ? "A" : overallPct >= 60 ? "B" : overallPct >= 50 ? "C" : overallPct >= 40 ? "D" : "F";

    const body = `
      <div class="printable-area">
        <div class="printable-report-card">
          <div class="report-header">
            ${this.config.logoUrl ? `
              <img src="${this.config.logoUrl}" class="doc-school-logo" alt="${this.config.schoolName}">
            ` : `
              <div class="doc-school-monogram">${(this.config.logoText || 'Edu').slice(0, 4)}</div>
            `}
            <div class="report-title-box">
              <h2 style="font-size:20px; font-weight:800; color:#0f172a; margin:0;">${this.config.schoolName}</h2>
              <div style="font-size:12px; color:#64748b; margin-top:2px;">${this.config.contact.address} &bull; ${this.config.contact.phone}</div>
              <span class="report-badge-pill">OFFICIAL ACADEMIC TRANSCRIPT & REPORT CARD</span>
            </div>
            <div style="text-align:right;">
              <div style="font-size:11px; color:#64748b;">Academic Session</div>
              <strong style="font-size:14px; color:#4f46e5;">${this.config.academicYear}</strong>
            </div>
          </div>

          <div class="report-meta-grid">
            <div class="report-meta-item">
              <span class="report-meta-label">Scholar Full Name</span>
              <span class="report-meta-value">${student.name}</span>
            </div>
            <div class="report-meta-item">
              <span class="report-meta-label">Admission Number</span>
              <span class="report-meta-value"><code>${student.admissionNo}</code></span>
            </div>
            <div class="report-meta-item">
              <span class="report-meta-label">Class & Section</span>
              <span class="report-meta-value">${student.className || 'General'}</span>
            </div>
            <div class="report-meta-item">
              <span class="report-meta-label">Student B-Form / CNIC</span>
              <span class="report-meta-value"><code>${student.cnic || '—'}</code></span>
            </div>
            <div class="report-meta-item">
              <span class="report-meta-label">Assigned Roll No</span>
              <span class="report-meta-value"><code>${student.rollNo || '—'}</code></span>
            </div>
            <div class="report-meta-item">
              <span class="report-meta-label">Father / Guardian</span>
              <span class="report-meta-value">${student.parentName || '—'}</span>
            </div>
          </div>

          <table class="report-table">
            <thead>
              <tr>
                <th>Subject</th>
                <th>Exam Period</th>
                <th style="text-align:center;">Max Marks</th>
                <th style="text-align:center;">Marks Obtained</th>
                <th style="text-align:center;">Percentage</th>
                <th style="text-align:center;">Grade</th>
                <th>Teacher Remarks</th>
              </tr>
            </thead>
            <tbody>
              ${myGrades.length > 0 ? myGrades.map(g => {
                const pct = Math.round((g.marksObtained / g.maxMarks) * 100);
                return `
                  <tr>
                    <td><strong>${g.subject}</strong></td>
                    <td>${g.examName}</td>
                    <td style="text-align:center;">${g.maxMarks}</td>
                    <td style="text-align:center; font-weight:700;">${g.marksObtained}</td>
                    <td style="text-align:center;">${pct}%</td>
                    <td style="text-align:center;"><strong>${g.grade}</strong></td>
                    <td>${g.remarks || 'Satisfactory'}</td>
                  </tr>
                `;
              }).join("") : `
                <tr>
                  <td colspan="7" style="text-align:center; padding:16px; color:#64748b;">No formal examination records entered for this session.</td>
                </tr>
              `}
            </tbody>
          </table>

          <div class="report-summary-box">
            <div>Total Marks: <strong>${totalObtained} / ${totalMax}</strong></div>
            <div>Cumulative Percentage: <strong>${overallPct}%</strong></div>
            <div>Standing Grade: <span style="color:#4f46e5; font-size:16px; font-weight:800;">${overallGrade}</span></div>
          </div>

          <div class="admission-signatures-row" style="margin-top:28px;">
            <div class="admission-sign-col">
              <div>Class Incharge</div>
              <small style="color:#94a3b8; font-size:10px;">Signature</small>
            </div>
            <div class="admission-sign-col">
              <div>Controller of Examinations</div>
              <small style="color:#94a3b8; font-size:10px;">Official Audit</small>
            </div>
            <div class="admission-sign-col">
              <div>Principal / Headmistress</div>
              <small style="color:#94a3b8; font-size:10px;">Official Seal & Signature</small>
            </div>
          </div>
        </div>
      </div>
    `;

    const footer = `
      <button class="btn btn-secondary no-print" onclick="window.schoolApp.closeModal()">Close</button>
      <button class="btn btn-primary no-print" onclick="window.schoolApp.printDocument('.printable-area', 'Academic Transcript - ${student.name}')">
        <i class="fa-solid fa-print"></i> Print Transcript
      </button>
    `;

    this.openModal("Official Academic Transcript", body, footer);
  }

  // --- Fee Invoice Modal ---
  // --- v2.1 — Record Online Payment (JazzCash / EasyPaisa / Bank) ---
  async showOnlinePaymentModal(feeId) {
    const fee = await db.getById(STORES.FEES, feeId);
    if (!fee) return;

    const today = new Date().toISOString().split("T")[0];
    const body = `
      <form id="onlinePayForm">
        <div class="form-group">
          <label class="form-label">Student</label>
          <input type="text" class="form-control" value="${fee.studentName} — ${this.config.currency}${Number(fee.amount).toLocaleString()}" disabled>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Payment Method</label>
            <select class="form-control" id="opMethod" required>
              ${PAYMENT_METHODS.map(m => `<option value="${m.id}">${m.label}</option>`).join("")}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Payment Date</label>
            <input type="date" class="form-control" id="opDate" value="${today}" required>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">TID / Transaction Reference</label>
            <input type="text" class="form-control" id="opTid" placeholder="e.g. 34567890123" required>
          </div>
          <div class="form-group">
            <label class="form-label">Sender Phone (optional)</label>
            <input type="text" class="form-control" id="opSenderPhone" placeholder="03xx-xxxxxxx">
          </div>
        </div>
        <p style="font-size:12px; color:var(--text-muted); margin:0;">
          <i class="fa-solid fa-circle-info"></i> Payment "Pending Verification" me jayegi —
          JazzCash / EasyPaisa app me TID check karke Fee Management se <strong>Verify</strong> karein.
        </p>
      </form>
    `;

    const footer = `
      <button class="btn btn-secondary" onclick="window.schoolApp.closeModal()">Cancel</button>
      <button class="btn btn-primary" id="btnSaveOnlinePay">Submit for Verification</button>
    `;

    this.openModal("Record Online Payment", body, footer);

    document.getElementById("btnSaveOnlinePay")?.addEventListener("click", async () => {
      const record = buildPaymentRecord({
        feeId: fee.id,
        studentId: fee.studentId,
        studentName: fee.studentName,
        amount: fee.amount,
        method: document.getElementById("opMethod").value,
        tid: document.getElementById("opTid").value,
        senderPhone: document.getElementById("opSenderPhone").value,
        date: document.getElementById("opDate").value
      });
      await db.add(STORES.ONLINE_PAYMENTS, record);
      this.showToast("Payment submitted for verification!", "success");
      this.closeModal();
      this.refreshCurrentView();
    });
  }

  async showFeeInvoiceModal() {
    const students = await db.getAll(STORES.STUDENTS);

    const body = `
      <form id="feeModalForm">
        <div class="form-group">
          <label class="form-label">Select Student</label>
          <select class="form-control" id="feeStudentSelect" required>
            ${students.map(s => `<option value="${s.id}" data-name="${s.name}" data-class="${s.classId}">${s.name} (${s.admissionNo} - ${s.className})</option>`).join("")}
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Fee Particulars</label>
            <input type="text" class="form-control" id="feeType" value="Quarterly Tuition Fee" required>
          </div>
          <div class="form-group">
            <label class="form-label">Amount (${this.config.currency})</label>
            <input type="number" class="form-control" id="feeAmount" value="12000" required>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Due Date</label>
            <input type="date" class="form-control" id="feeDueDate" value="${new Date().toISOString().split("T")[0]}" required>
          </div>
          <div class="form-group">
            <label class="form-label">Payment Status</label>
            <select class="form-control" id="feeStatus">
              <option value="pending">Pending</option>
              <option value="paid">Paid Now</option>
            </select>
          </div>
        </div>
      </form>
    `;

    const footer = `
      <button class="btn btn-secondary" onclick="window.schoolApp.closeModal()">Cancel</button>
      <button class="btn btn-primary" id="btnSaveFeeModal">Issue Invoice</button>
    `;

    this.openModal("Issue Tuition / Fee Invoice", body, footer);

    document.getElementById("btnSaveFeeModal")?.addEventListener("click", async () => {
      const select = document.getElementById("feeStudentSelect");
      const opt = select.options[select.selectedIndex];
      const isPaid = document.getElementById("feeStatus").value === "paid";

      const fee = {
        receiptNo: `REC-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
        studentId: select.value,
        studentName: opt.getAttribute("data-name"),
        classId: opt.getAttribute("data-class"),
        type: document.getElementById("feeType").value,
        amount: Number(document.getElementById("feeAmount").value),
        dueDate: document.getElementById("feeDueDate").value,
        status: isPaid ? "paid" : "pending",
        paidDate: isPaid ? new Date().toISOString().split("T")[0] : null,
        paymentMethod: isPaid ? "Direct Payment" : "Pending"
      };

      await db.add(STORES.FEES, fee);
      this.showToast("Invoice issued successfully!", "success");
      this.closeModal();
    });
  }

  // --- Teacher Modal ---
  async showTeacherModal(teacherId = null) {
    const teacher = teacherId ? await db.getById(STORES.TEACHERS, teacherId) : null;

    const body = `
      <form id="teacherModalForm">
        <!-- Faculty Avatar / Photo Upload (ImgBB Cloud API v1) -->
        <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:14px; margin-bottom:16px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <label class="form-label" style="margin-bottom:0;"><i class="fa-solid fa-camera" style="color:var(--primary); margin-right:4px;"></i> Faculty Photo (ImgBB API v1)</label>
            <span class="badge badge-success" style="font-size:10px;"><i class="fa-solid fa-cloud"></i> ImgBB Cloud</span>
          </div>
          <div style="display:flex; align-items:center; gap:16px;">
            <div id="tchPhotoPreviewBox" style="width:72px; height:72px; border-radius:8px; border:2px dashed rgba(var(--primary-rgb),0.4); overflow:hidden; background:#ffffff; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
              <img id="tchPhotoPreviewImg" src="${teacher?.avatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + (teacher?.name || 'faculty')}" style="width:100%; height:100%; object-fit:cover;" alt="Photo">
            </div>
            <div style="flex:1; display:flex; flex-direction:column; gap:6px;">
              <input type="file" id="tchModalPhotoFile" accept="image/*" style="display:none;">
              <button type="button" class="btn btn-secondary btn-sm" id="btnUploadTchPhotoTrigger">
                <i class="fa-solid fa-cloud-arrow-up"></i> Upload Photo via ImgBB
              </button>
              <input type="text" class="form-control" id="tchModalPhotoUrl" value="${teacher?.avatar || ''}" placeholder="Live photo URL (hosted on ImgBB)" style="font-size:11px;">
            </div>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Faculty Member Name</label>
          <input type="text" class="form-control" id="tchModalName" value="${teacher?.name || ''}" required>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Teacher CNIC (13 digits)</label>
            <input type="text" class="form-control" id="tchModalCnic" value="${teacher?.cnic || ''}" placeholder="42101-1234567-1" required>
          </div>
          <div class="form-group">
            <label class="form-label">Mobile Phone Number</label>
            <input type="tel" class="form-control" id="tchModalPhone" value="${teacher?.phone || ''}" placeholder="0300-1234567" required>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Employee ID</label>
            <input type="text" class="form-control" id="tchModalEmpId" value="${teacher?.employeeId || 'EMP-' + Math.floor(2000+Math.random()*800)}" required>
          </div>
          <div class="form-group">
            <label class="form-label">Subject / Department</label>
            <input type="text" class="form-control" id="tchModalSubject" value="${teacher?.subject || ''}" required>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Academic Qualifications</label>
            <input type="text" class="form-control" id="tchModalQual" value="${teacher?.qualification || ''}" placeholder="M.Sc. Mathematics / B.Ed">
          </div>
          <div class="form-group">
            <label class="form-label">Joining Date</label>
            <input type="date" class="form-control" id="tchModalJoiningDate" value="${teacher?.joiningDate || new Date().toISOString().split('T')[0]}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Faculty Bio & Highlights (Displayed on Website)</label>
          <textarea class="form-control" id="tchModalBio" rows="2" placeholder="e.g. 7+ years teaching experience in Board Examinations and Science Mentorship">${teacher?.bio || ''}</textarea>
        </div>
      </form>
    `;

    const footer = `
      <button class="btn btn-secondary" onclick="window.schoolApp.closeModal()">Cancel</button>
      <button class="btn btn-primary" id="btnSaveTeacherModal">Save Faculty Member</button>
    `;

    this.openModal(teacher ? "Edit Faculty Member" : "Add Faculty Member", body, footer);

    // Bind ImgBB Photo Uploader
    const photoFileInput = document.getElementById("tchModalPhotoFile");
    const btnUploadPhoto = document.getElementById("btnUploadTchPhotoTrigger");
    const photoUrlInput = document.getElementById("tchModalPhotoUrl");
    const photoPreviewImg = document.getElementById("tchPhotoPreviewImg");

    btnUploadPhoto?.addEventListener("click", () => photoFileInput?.click());
    photoFileInput?.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (file) {
        this.showToast("Uploading faculty photo to ImgBB cloud...", "info");
        try {
          const liveUrl = await uploadImageToImgbb(file);
          if (photoUrlInput) photoUrlInput.value = liveUrl;
          if (photoPreviewImg) photoPreviewImg.src = liveUrl;
          this.showToast("Faculty photo uploaded to ImgBB successfully!", "success");
        } catch (err) {
          this.showToast(`Upload failed: ${err.message}`, "error");
        }
      }
    });

    document.getElementById("btnSaveTeacherModal")?.addEventListener("click", async () => {
      const chosenAvatar = document.getElementById("tchModalPhotoUrl").value.trim() ||
        teacher?.avatar ||
        `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(document.getElementById("tchModalName").value)}`;

      const data = {
        ...(teacher || {}),
        name: document.getElementById("tchModalName").value,
        cnic: document.getElementById("tchModalCnic").value,
        phone: document.getElementById("tchModalPhone").value,
        email: teacher?.email || `${document.getElementById("tchModalCnic").value.replace(/\D/g, "")}@faculty.portal`,
        avatar: chosenAvatar,
        employeeId: document.getElementById("tchModalEmpId").value,
        subject: document.getElementById("tchModalSubject").value,
        qualification: document.getElementById("tchModalQual").value,
        joiningDate: document.getElementById("tchModalJoiningDate")?.value || new Date().toISOString().split("T")[0],
        bio: document.getElementById("tchModalBio")?.value.trim() || "",
        assignedClasses: teacher?.assignedClasses || ["Grade 10 - Section A"],
        status: "Active"
      };

      if (teacher) {
        await db.update(STORES.TEACHERS, data);
        this.showToast("Teacher record updated", "success");
      } else {
        await db.add(STORES.TEACHERS, data);
        this.showToast("Teacher added to faculty", "success");
      }
      this.closeModal();
    });
  }

  // --- Class Modal ---
  async showClassModal() {
    const body = `
      <form id="classModalForm">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Grade / Class Name</label>
            <input type="text" class="form-control" id="clsModalName" placeholder="e.g. Grade 12" required>
          </div>
          <div class="form-group">
            <label class="form-label">Section / Stream</label>
            <input type="text" class="form-control" id="clsModalSection" placeholder="e.g. Section C / Pre-Med" required>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Classroom / Hall</label>
            <input type="text" class="form-control" id="clsModalRoom" placeholder="Hall 401">
          </div>
          <div class="form-group">
            <label class="form-label">Max Student Capacity</label>
            <input type="number" class="form-control" id="clsModalCapacity" value="35">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Subjects (comma-separated)</label>
          <input type="text" class="form-control" id="clsModalSubjects" value="English, Mathematics, Science">
        </div>
      </form>
    `;

    const footer = `
      <button class="btn btn-secondary" onclick="window.schoolApp.closeModal()">Cancel</button>
      <button class="btn btn-primary" id="btnSaveClassModal">Create Class</button>
    `;

    this.openModal("Create New Class & Section", body, footer);

    document.getElementById("btnSaveClassModal")?.addEventListener("click", async () => {
      const cls = {
        name: document.getElementById("clsModalName").value,
        section: document.getElementById("clsModalSection").value,
        room: document.getElementById("clsModalRoom").value,
        capacity: Number(document.getElementById("clsModalCapacity").value),
        subjects: document.getElementById("clsModalSubjects").value.split(",").map(s => s.trim()).filter(Boolean)
      };

      await db.add(STORES.CLASSES, cls);
      this.showToast("Class created successfully!", "success");
      this.closeModal();
    });
  }

  // --- Notice Modal ---
  async showNoticeModal() {
    const body = `
      <form id="noticeModalForm">
        <div class="form-group">
          <label class="form-label">Notice Headline</label>
          <input type="text" class="form-control" id="notModalTitle" placeholder="e.g. Annual Sports Meet Schedule" required>
        </div>
        <div class="form-group">
          <label class="form-label">Notice Message / Content</label>
          <textarea class="form-control" id="notModalContent" rows="4" placeholder="Enter bulletin announcement details..." required></textarea>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Priority Level</label>
            <select class="form-control" id="notModalPriority">
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Target Audience</label>
            <select class="form-control" id="notModalTarget">
              <option value="all">Everyone (All)</option>
              <option value="students">Students Only</option>
              <option value="teachers">Teaching Staff Only</option>
            </select>
          </div>
        </div>
      </form>
    `;

    const footer = `
      <button class="btn btn-secondary" onclick="window.schoolApp.closeModal()">Cancel</button>
      <button class="btn btn-primary" id="btnSaveNoticeModal">Publish Notice</button>
    `;

    this.openModal("Publish School Announcement", body, footer);

    document.getElementById("btnSaveNoticeModal")?.addEventListener("click", async () => {
      const user = auth.getCurrentUser();
      const notice = {
        title: document.getElementById("notModalTitle").value,
        content: document.getElementById("notModalContent").value,
        priority: document.getElementById("notModalPriority").value,
        target: document.getElementById("notModalTarget").value,
        date: new Date().toISOString().split("T")[0],
        author: user?.name || "Administration"
      };

      await db.add(STORES.NOTICES, notice);
      this.showToast("Notice posted to board!", "success");
      this.closeModal();
    });
  }

  // --- Grade Modal ---
  async showGradeModal() {
    const students = await db.getAll(STORES.STUDENTS);

    const body = `
      <form id="gradeModalForm">
        <div class="form-group">
          <label class="form-label">Select Student</label>
          <select class="form-control" id="grdStudentSelect" required>
            ${students.map(s => `<option value="${s.id}" data-name="${s.name}" data-class="${s.classId}">${s.name} (${s.admissionNo} - ${s.className})</option>`).join("")}
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Examination Name</label>
            <input type="text" class="form-control" id="grdExamName" value="Mid-Term Examinations" required>
          </div>
          <div class="form-group">
            <label class="form-label">Subject</label>
            <input type="text" class="form-control" id="grdSubject" value="Mathematics" required>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Marks Obtained</label>
            <input type="number" class="form-control" id="grdObtained" value="92" required>
          </div>
          <div class="form-group">
            <label class="form-label">Total / Max Marks</label>
            <input type="number" class="form-control" id="grdMax" value="100" required>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Teacher Remarks</label>
          <input type="text" class="form-control" id="grdRemarks" placeholder="Commendable grasp of subject matter">
        </div>
      </form>
    `;

    const footer = `
      <button class="btn btn-secondary" onclick="window.schoolApp.closeModal()">Cancel</button>
      <button class="btn btn-primary" id="btnSaveGradeModal">Record Marks</button>
    `;

    this.openModal("Record Student Exam Marks", body, footer);

    document.getElementById("btnSaveGradeModal")?.addEventListener("click", async () => {
      const select = document.getElementById("grdStudentSelect");
      const opt = select.options[select.selectedIndex];
      const obtained = Number(document.getElementById("grdObtained").value);
      const max = Number(document.getElementById("grdMax").value);
      const pct = (obtained / max) * 100;
      
      let letterGrade = "F";
      if (pct >= 90) letterGrade = "A+";
      else if (pct >= 80) letterGrade = "A";
      else if (pct >= 70) letterGrade = "B";
      else if (pct >= 60) letterGrade = "C";
      else if (pct >= 50) letterGrade = "D";

      const gradeItem = {
        studentId: select.value,
        studentName: opt.getAttribute("data-name"),
        classId: opt.getAttribute("data-class"),
        examName: document.getElementById("grdExamName").value,
        subject: document.getElementById("grdSubject").value,
        marksObtained: obtained,
        maxMarks: max,
        grade: letterGrade,
        remarks: document.getElementById("grdRemarks").value,
        date: new Date().toISOString().split("T")[0]
      };

      await db.add(STORES.GRADES, gradeItem);
      this.showToast("Marks recorded to gradebook!", "success");
      this.closeModal();
    });
  }

  // =========================================================================
  // 14. OFFICIAL CHARACTER & EXPERIENCE CERTIFICATES (1-CLICK PRINTABLE)
  // =========================================================================

  // --- Student Character & Conduct Certificate (Classic A4 Portrait) ---
  async showCharacterCertificateModal(studentId) {
    const student = await db.getById(STORES.STUDENTS, studentId);
    if (!student) return;

    const issueDate = new Date().toLocaleDateString("en-PK", { day: "2-digit", month: "long", year: "numeric" });
    const refNo = `${(this.config.schoolShortName || 'OSST')}/CC-${new Date().getFullYear()}/${student.admissionNo ? student.admissionNo.replace(/\D/g, "").slice(-4) : Math.floor(1000 + Math.random() * 9000)}`;
    const sessionStr = student.session || `${new Date().getFullYear() - 1} - ${new Date().getFullYear() + 1}`;
    const pronounSonDaughter = (student.gender && student.gender.toLowerCase() === "female") ? "Daughter" : "Son";
    const pronounHeShe = (student.gender && student.gender.toLowerCase() === "female") ? "She" : "He";
    const pronounHisHer = (student.gender && student.gender.toLowerCase() === "female") ? "her" : "his";

    const body = `
      <div class="printable-area">
        <div class="printable-character-card">
          <div class="cc-outer-border">
            <div class="cc-middle-border">
              <div class="cc-inner-border">
                
                <!-- Corner Ornaments -->
                <div class="cc-corner-decor cc-corner-tl"></div>
                <div class="cc-corner-decor cc-corner-tr"></div>
                <div class="cc-corner-decor cc-corner-bl"></div>
                <div class="cc-corner-decor cc-corner-br"></div>

                <!-- Watermark Centered -->
                ${this.config.logoUrl ? `
                  <div class="cc-watermark-overlay" style="background-image:url('${this.config.logoUrl}');"></div>
                ` : ''}

                <div class="cc-content-wrapper">
                  <!-- Religious Motto -->
                  <div class="cc-top-motto">In the Name of Allah, the Most Gracious, the Most Merciful</div>
                  <div class="cc-second-motto">“O My Lord, Advance Me in Knowledge”</div>

                  <!-- Institutional Crest & Header -->
                  <div class="cc-crest-container">
                    ${this.config.logoUrl ? `
                      <img src="${this.config.logoUrl}" class="cc-crest-img" alt="${this.config.schoolName}">
                    ` : `
                      <div class="char-cert-monogram">${(this.config.logoText || 'Edu').slice(0, 4)}</div>
                    `}
                  </div>

                  <h1 class="cc-school-name">${this.config.schoolName}</h1>
                  <div class="cc-school-address">${this.config.contact.address || ''}</div>

                  <!-- Certificate Title Banner -->
                  <div class="cc-ribbon-wrapper">
                    <div class="cc-ribbon-banner">CHARACTER CERTIFICATE</div>
                  </div>

                  <!-- Ledger Metadata Bar -->
                  <div class="cc-meta-ledger">
                    <div><strong>Ref No:</strong> <code>${refNo}</code></div>
                    <div><strong>Date of Issue:</strong> ${issueDate}</div>
                  </div>

                  <!-- Clean Formal Certification Statement -->
                  <div class="cc-statement-body">
                    This is to certify that <span class="cc-field-fill">${student.name}</span>,
                    ${pronounSonDaughter} of <span class="cc-field-fill">${student.parentName || student.fatherName || 'Guardian'}</span>,
                    bearing Roll Number <span class="cc-field-fill">${student.rollNo || student.admissionNo || '—'}</span>,
                    Admission Number <span class="cc-field-fill">${student.admissionNo || '—'}</span>,
                    and B-Form / CNIC Number <span class="cc-field-fill">${student.cnic || '—'}</span>,
                    has been a regular student of this institution in <span class="cc-field-fill">${student.className || 'General'}</span>
                    during the academic session <span class="cc-field-fill">${sessionStr}</span>.
                    <br><br>
                    During ${pronounHisHer} period of study in this institution, ${pronounHisHer} conduct and moral character
                    were found to be <span class="cc-field-fill">Good / Satisfactory</span>.
                    <br><br>
                    We wish ${pronounHisHer} every success in future academic endeavors.
                  </div>

                  <!-- Principal Signature Only -->
                  <div class="cc-single-signature-row">
                    <div class="cc-sig-block-right">
                      <div class="cc-sig-line">Principal</div>
                      <div class="cc-sig-sub">Signature & Official Stamp</div>
                    </div>
                  </div>

                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    const footer = `
      <button class="btn btn-secondary no-print" onclick="window.schoolApp.closeModal()">Close</button>
      <button class="btn btn-primary no-print" onclick="window.schoolApp.printDocument('.printable-area', 'Character Certificate - ${student.name}')">
        <i class="fa-solid fa-print"></i> Print Character Certificate (A4)
      </button>
    `;

    this.openModal("Official Character Certificate", body, footer);
  }

  // --- Faculty Experience & Service Certificate ---
  async showTeacherExperienceCertificateModal(teacherId) {
    const teacher = await db.getById(STORES.TEACHERS, teacherId);
    if (!teacher) return;

    const issueDate = new Date().toLocaleDateString("en-PK", { day: "2-digit", month: "long", year: "numeric" });
    const refNo = `EXP-${new Date().getFullYear()}-${teacher.employeeId ? teacher.employeeId.replace(/\D/g, "") : Math.floor(2000 + Math.random() * 800)}`;
    const joinDate = teacher.joiningDate ? new Date(teacher.joiningDate).toLocaleDateString("en-PK", { day: "2-digit", month: "long", year: "numeric" }) : "the inception of academic session";

    const body = `
      <div class="printable-area">
        <div class="printable-experience-card">
          <!-- Letterhead Header -->
          <div class="exp-cert-letterhead">
            ${this.config.logoUrl ? `
              <img src="${this.config.logoUrl}" style="width:76px; height:76px; object-fit:contain;" alt="School Logo">
            ` : `
              <div class="char-cert-monogram" style="width:76px; height:76px; font-size:24px; margin:0;">${(this.config.logoText || 'Edu').slice(0, 4)}</div>
            `}
            <div style="flex:1;">
              <h1 style="font-size:22px; font-weight:900; color:#0f172a; margin:0; text-transform:uppercase;">${this.config.schoolName}</h1>
              <div style="font-size:12px; color:#475569; margin-top:2px;">
                ${this.config.contact.address || 'Campus Address, Pakistan'} &bull; Phone: ${this.config.contact.phone || '0300-1111111'}
              </div>
              <div style="font-size:11px; color:#64748b;">
                Email: ${this.config.contact.email || 'admin@school.com'} ${this.config.contact.website ? '• Web: ' + this.config.contact.website : ''}
              </div>
            </div>
            <div style="text-align:right; font-size:12px; color:#475569;">
              <div><strong>Ref:</strong> <code>${refNo}</code></div>
              <div style="margin-top:4px;"><strong>Date:</strong> ${issueDate}</div>
            </div>
          </div>

          <div class="exp-cert-title-badge">
            <span>SERVICE & EXPERIENCE CERTIFICATE</span>
          </div>

          <!-- Formal Teacher Experience Text -->
          <div class="exp-cert-body">
            This is to certify that <strong>${teacher.name}</strong>,
            holding CNIC Number <strong>${teacher.cnic || '—'}</strong>
            and Employee ID <strong>${teacher.employeeId}</strong>,
            has served as a dedicated Faculty Member / Teacher in the Department of <strong>${teacher.subject || 'Academics'}</strong>
            at <strong>${this.config.schoolName}</strong> from <strong>${joinDate}</strong> to <strong>${issueDate}</strong>.
            <br><br>
            During their tenure of service at this institution, they successfully handled instructional duties for classes:
            <strong>${(teacher.assignedClasses || []).join(", ") || 'Assigned Batches'}</strong>.
            Their academic qualifications on institutional record are <strong>${teacher.qualification || 'M.Sc. / B.Ed'}</strong>.
            <br><br>
            We found them to be an industrious, honest, punctual, and professionally skilled educator with excellent classroom management
            and student engagement capabilities. Their moral character and conduct toward colleagues and students remained outstanding.
            <br><br>
            They leave the institution on their own accord. We highly appreciate their valuable services and wish them continued success,
            prosperity, and accomplishment in their future professional career.
          </div>

          <!-- Signatures -->
          <div class="char-cert-signatures" style="margin-top:60px;">
            <div class="signature-block">
              <div class="signature-line">Head of Department / HR</div>
              <small style="color:#64748b; font-size:11px;">Academic Evaluation</small>
            </div>

            <div class="signature-block">
              <div class="official-stamp-box">
                OFFICIAL<br>CAMPUS<br>STAMP
              </div>
            </div>

            <div class="signature-block">
              <div class="signature-line">Principal / Director</div>
              <small style="color:#64748b; font-size:11px;">Issuing Authority</small>
            </div>
          </div>
        </div>
      </div>
    `;

    const footer = `
      <button class="btn btn-secondary no-print" onclick="window.schoolApp.closeModal()">Close</button>
      <button class="btn btn-primary no-print" onclick="window.schoolApp.printDocument('.printable-area', 'Experience Certificate - ${teacher.name}')">
        <i class="fa-solid fa-print"></i> Print Experience Certificate
      </button>
    `;

    this.openModal("Official Faculty Experience Certificate", body, footer);
  }

  // --- Admission Inquiry Success Confirmation Modal ---
  showAdmissionInquirySuccessModal(inq) {
    const body = `
      <div class="printable-area" style="text-align:center; padding:10px;">
        <div style="background:#ffffff; color:#0f172a; border:2px solid #10b981; border-radius:14px; padding:24px; max-width:440px; margin:0 auto; box-shadow:0 8px 24px rgba(0,0,0,0.15);">
          <div style="width:60px; height:60px; border-radius:50%; background:#ecfdf5; color:#10b981; display:flex; align-items:center; justify-content:center; font-size:28px; margin:0 auto 12px auto;">
            <i class="fa-solid fa-check"></i>
          </div>
          <h3 style="font-size:20px; font-weight:800; color:#0f172a; margin-bottom:4px;">Admission Application Received!</h3>
          <p style="font-size:13px; color:#64748b; margin-bottom:18px;">Your online application has been securely submitted to ${this.config.schoolName}.</p>

          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:14px; text-align:left; font-size:13px; line-height:1.7; margin-bottom:18px;">
            <div><strong>Application Reference #:</strong> <code style="color:#4f46e5; font-weight:800; font-size:14px;">${inq.refNo}</code></div>
            <div><strong>Applicant Name:</strong> ${inq.name}</div>
            <div><strong>Desired Grade / Class:</strong> ${inq.className}</div>
            <div><strong>Father / Guardian:</strong> ${inq.parentName}</div>
            <div><strong>Contact Mobile:</strong> ${inq.phone}</div>
            <div><strong>Date of Submission:</strong> ${new Date().toLocaleDateString("en-PK")}</div>
          </div>

          <div style="font-size:11.5px; color:#475569; line-height:1.5;">
            Please save this reference number. Our Admissions Directorate will review your application and contact you for document verification and interview.
          </div>
        </div>
      </div>
    `;

    const footer = `
      <button class="btn btn-secondary no-print" onclick="window.schoolApp.closeModal()">Close</button>
      <button class="btn btn-primary no-print" onclick="window.schoolApp.printDocument('.printable-area', 'Admission Slip - ${inq.refNo}')">
        <i class="fa-solid fa-print"></i> Print Slip
      </button>
    `;

    this.openModal("Admission Application Received", body, footer);
  }

  // =========================================================================
  // 15. PUBLIC COLLEGE / SCHOOL LANDING PAGE CONTROLLER
  // =========================================================================
  async renderPublicLandingPage() {
    const landing = document.getElementById("publicLandingPage");
    const appEl = document.getElementById("app");
    if (!landing) return;

    if (appEl) appEl.style.display = "none";
    landing.style.display = "block";

    const user = auth.getCurrentUser();
    const classes = await db.getAll(STORES.CLASSES);
    const teachers = await db.getAll(STORES.TEACHERS);

    const lp = this.config.landingPage || DEFAULT_CONFIG.landingPage;
    const about = lp.about || {};
    const programs = lp.programs || {};
    const faculty = lp.faculty || {};
    const admission = lp.admission || {};
    const contact = lp.contact || {};
    const hero = lp.hero || {};

    const logoHtml = this.config.logoUrl && this.config.logoUrl.trim()
      ? `<img src="${this.config.logoUrl}" alt="${this.config.schoolName}">`
      : `<i class="fa-solid fa-graduation-cap"></i>`;

    landing.innerHTML = `
      ${user ? `
        <!-- Floating Admin Topbar when logged-in staff is previewing website -->
        <div class="admin-landing-topbar">
          <div>
            <i class="fa-solid fa-shield-halved" style="margin-right:6px;"></i>
            Previewing Public Website as <strong>${user.name}</strong> (${user.role.toUpperCase()})
          </div>
          <button class="btn-back-erp" id="btnReturnToERP">
            <i class="fa-solid fa-arrow-left" style="margin-right:4px;"></i> Return to Portal Dashboard
          </button>
        </div>
      ` : ''}

      <!-- Main Navigation Header -->
      <header class="landing-nav">
        <a href="#" class="landing-brand">
          <div class="landing-brand-logo">
            ${logoHtml}
          </div>
          <div class="landing-brand-text">
            <h2>${this.config.schoolName}</h2>
            <span>${this.config.tagline || 'Excellence in Education'}</span>
          </div>
        </a>

        <ul class="landing-nav-links">
          <li><a href="#about">About Campus</a></li>
          <li><a href="#programs">Academic Programs</a></li>
          <li><a href="#faculty">Distinguished Faculty</a></li>
          <li><a href="#admission">Online Admission</a></li>
          <li><a href="#contact">Contact</a></li>
        </ul>

        <button class="landing-menu-toggle" id="landingMenuToggle" aria-label="Open menu">
          <i class="fa-solid fa-bars"></i>
        </button>

        <div class="landing-nav-actions">
          <button class="btn-portal-login" id="btnLandingSignIn">
            <i class="fa-solid fa-right-to-bracket"></i>
            <span>${user ? 'Access Dashboard' : 'Portal Sign In'}</span>
          </button>
        </div>
      </header>

      <!-- Hero Section -->
      <section class="landing-hero">
        <div class="hero-pill-badge">
          <i class="fa-solid fa-graduation-cap"></i>
          <span>${hero.badge || `Admissions Open for Session ${this.config.academicYear || '2026 - 2027'}`}</span>
        </div>

        <h1 class="hero-title">
          ${hero.title || 'Inspiring Academic Excellence, Shaping Future Leaders at'}
          <span class="hero-title-highlight">${this.config.schoolName}</span>
        </h1>

        <p class="hero-subtext">
          ${hero.subtitle || 'A premier educational institution committed to intellectual brilliance, character development, state-of-the-art computer & science laboratories, and high-caliber faculty mentorship.'}
        </p>

        <div class="hero-cta-group">
          <a href="#admission" class="hero-btn-primary">
            <i class="fa-solid fa-file-pen"></i> Apply for Online Admission
          </a>
          <button class="hero-btn-secondary" id="heroPortalBtn">
            <i class="fa-solid fa-chalkboard-user"></i> ${user ? 'Go to Dashboard' : 'Student & Staff Portal'}
          </button>
        </div>

        <!-- Institutional Stats Strip -->
        <div class="stats-strip">
          <div class="stat-strip-box">
            <div class="stat-strip-num">100%</div>
            <div class="stat-strip-lbl">Board Examination Success</div>
          </div>
          <div class="stat-strip-box">
            <div class="stat-strip-num">${teachers.length > 0 ? teachers.length : '15+'}</div>
            <div class="stat-strip-lbl">Certified Faculty Mentors</div>
          </div>
          <div class="stat-strip-box">
            <div class="stat-strip-num">${classes.length > 0 ? classes.length : '10+'}</div>
            <div class="stat-strip-lbl">Academic Grades & Streams</div>
          </div>
          <div class="stat-strip-box">
            <div class="stat-strip-num">24/7</div>
            <div class="stat-strip-lbl">Safe & Monitored Campus</div>
          </div>
        </div>
      </section>

      <!-- About Campus & Facilities Section -->
      <section class="landing-section" id="about">
        <div class="section-head">
          <span class="section-pill">${about.pill || 'World-Class Infrastructure'}</span>
          <h2 class="section-title">${about.title || 'Designed for Modern Learning'}</h2>
          <p class="section-subtitle">
            ${about.subtitle || 'Our campus provides holistic educational facilities to foster curiosity, scientific aptitude, and moral integrity.'}
          </p>
        </div>

        <div class="facilities-grid">
          <div class="facility-card">
            <div class="facility-icon"><i class="fa-solid fa-flask-vial"></i></div>
            <h3>${about.f1_title || 'Modern Science Laboratories'}</h3>
            <p>${about.f1_desc || 'Fully equipped Physics, Chemistry, and Biology laboratories enabling hands-on experimental learning according to board curriculum.'}</p>
          </div>

          <div class="facility-card">
            <div class="facility-icon"><i class="fa-solid fa-desktop"></i></div>
            <h3>${about.f2_title || 'ICT & Computer Laboratories'}</h3>
            <p>${about.f2_desc || 'High-speed networked computing workstations dedicated to computer science, coding, and technological literacy.'}</p>
          </div>

          <div class="facility-card">
            <div class="facility-icon"><i class="fa-solid fa-book-open-reader"></i></div>
            <h3>${about.f3_title || 'Resourceful Library'}</h3>
            <p>${about.f3_desc || 'Thousands of reference books, educational journals, and digital study resources promoting continuous self-learning.'}</p>
          </div>

          <div class="facility-card">
            <div class="facility-icon"><i class="fa-solid fa-futbol"></i></div>
            <h3>${about.f4_title || 'Sports & Physical Development'}</h3>
            <p>${about.f4_desc || 'Expansive athletic grounds and dedicated coaches fostering teamwork, sportsmanship, and physical health.'}</p>
          </div>

          <div class="facility-card">
            <div class="facility-icon"><i class="fa-solid fa-van-shuttle"></i></div>
            <h3>${about.f5_title || 'Safe Student Transport'}</h3>
            <p>${about.f5_desc || 'Dedicated institutional transport fleet covering all major residential sectors with GPS tracking and trained drivers.'}</p>
          </div>

          <div class="facility-card">
            <div class="facility-icon"><i class="fa-solid fa-shield-halved"></i></div>
            <h3>${about.f6_title || 'Secure & Disciplined Campus'}</h3>
            <p>${about.f6_desc || 'Round-the-clock security personnel, automated attendance tracking, and comprehensive CCTV surveillance across campus.'}</p>
          </div>
        </div>
      </section>

      <!-- Academic Programs & Classes Section -->
      <section class="landing-section" id="programs" style="background:rgba(255,255,255,0.015); border-radius:24px;">
        <div class="section-head">
          <span class="section-pill">${programs.pill || 'Curriculum & Grades'}</span>
          <h2 class="section-title">${programs.title || 'Academic Programs Offered'}</h2>
          <p class="section-subtitle">
            ${programs.subtitle || 'Rigorous educational pathways tailored to cultivate analytical thinking, linguistic fluency, and competitive board preparation.'}
          </p>
        </div>

        <div class="programs-grid">
          ${classes.length > 0 ? classes.map(c => `
            <div class="program-card">
              <div class="program-header">
                <h3>${c.name}</h3>
                <span class="program-section-name">${c.section}</span>
              </div>
              <div style="font-size:12.5px; color:#94a3b8; margin-bottom:8px;">
                <i class="fa-solid fa-door-open" style="color:var(--primary); margin-right:4px;"></i> Room: ${c.room || 'Classroom'} &bull; Max Capacity: ${c.capacity || 35}
              </div>
              <div style="font-size:12px; font-weight:700; color:#cbd5e1; margin-top:6px;">Key Curriculum Subjects:</div>
              <div class="subject-tags">
                ${(c.subjects || ["English", "Mathematics", "Science", "Urdu"]).map(sub => `
                  <span class="subject-tag">${sub}</span>
                `).join("")}
              </div>
              <div style="margin-top:auto; padding-top:14px; border-top:1px solid rgba(255,255,255,0.06); display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:11.5px; color:#10b981; font-weight:700;"><i class="fa-solid fa-circle-check"></i> Admissions Open</span>
                <a href="#admission" style="font-size:12px; color:#38bdf8; text-decoration:none; font-weight:700;">Enroll &rarr;</a>
              </div>
            </div>
          `).join("") : `
            <div class="program-card">
              <h3>Primary & Middle Wings</h3>
              <p style="font-size:13px; color:#94a3b8;">${programs.primaryOverview || 'Class 1 to Class 8 comprehensive foundational education in English, Mathematics, General Science, and Social Studies.'}</p>
            </div>
            <div class="program-card">
              <h3>Matric / Secondary Wing</h3>
              <p style="font-size:13px; color:#94a3b8;">${programs.secondaryOverview || 'Grade 9 & Grade 10 Science & Computer Science streams with specialized preparation for Board Examinations.'}</p>
            </div>
          `}
        </div>
      </section>

      <!-- Distinguished Faculty & Mentors Section -->
      <section class="landing-section" id="faculty">
        <div class="section-head">
          <span class="section-pill">${faculty.pill || 'Experienced Educators'}</span>
          <h2 class="section-title">${faculty.title || 'Our Distinguished Faculty'}</h2>
          <p class="section-subtitle">
            ${faculty.subtitle || 'Passionate teachers holding higher qualifications committed to academic rigor, concept building, and individual mentorship.'}
          </p>
        </div>

        ${faculty.principalMessage ? `
          <div style="background:rgba(79, 70, 229, 0.08); border-left:4px solid var(--primary); border-radius:12px; padding:18px 24px; margin-bottom:32px; max-width:850px; margin-left:auto; margin-right:auto;">
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px; font-weight:700; color:#38bdf8; font-size:13px;">
              <i class="fa-solid fa-quote-left"></i> Principal's Academic Message
            </div>
            <p style="font-style:italic; font-size:14px; color:#e2e8f0; line-height:1.7; margin:0;">
              "${faculty.principalMessage}"
            </p>
          </div>
        ` : ''}

        <div class="faculty-grid">
          ${teachers.length > 0 ? teachers.map(t => `
            <div class="faculty-card">
              <img src="${t.avatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + t.name}" class="faculty-avatar" alt="${t.name}">
              <h3>${t.name}</h3>
              <div class="faculty-dept">${t.subject}</div>
              <div class="faculty-qual"><i class="fa-solid fa-graduation-cap"></i> ${t.qualification || 'M.Sc. / B.Ed'}</div>
              <div class="faculty-bio">
                ${t.bio && t.bio.trim() ? t.bio : 'Experienced subject specialist mentoring students towards top academic achievements and intellectual brilliance.'}
              </div>
            </div>
          `).join("") : `
            <div class="faculty-card">
              <div class="faculty-avatar" style="display:flex; align-items:center; justify-content:center; background:#1e293b; color:#38bdf8; font-size:32px;">
                <i class="fa-solid fa-chalkboard-user"></i>
              </div>
              <h3>Certified Subject Specialists</h3>
              <div class="faculty-dept">Sciences & Humanities</div>
              <div class="faculty-qual">M.Sc. / M.Phil / B.Ed</div>
              <div class="faculty-bio">
                Our faculty consists of experienced educators dedicated to student success and moral character building.
              </div>
            </div>
          `}
        </div>
      </section>

      <!-- Online Admission & Enrollment Application Section -->
      <section class="landing-section" id="admission">
        <div class="section-head">
          <span class="section-pill">${admission.pill || 'Apply Online Today'}</span>
          <h2 class="section-title">${admission.title || 'Online Admission Application'}</h2>
          <p class="section-subtitle">
            ${admission.subtitle || 'Take the first step toward quality education. Submit your admission inquiry online and receive an instant application tracking number.'}
          </p>
        </div>

        ${admission.instructions ? `
          <div style="background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.25); border-radius:12px; padding:14px 20px; margin-bottom:24px; max-width:820px; margin-left:auto; margin-right:auto; font-size:13px; color:#cbd5e1; line-height:1.6;">
            <strong style="color:#34d399;"><i class="fa-solid fa-circle-info"></i> Admission Instructions & Requirements:</strong>
            ${admission.instructions}
            ${admission.hotline ? `<div style="margin-top:6px; font-weight:700;"><i class="fa-brands fa-whatsapp" style="color:#34d399; margin-right:4px;"></i> Helpline / WhatsApp: ${admission.hotline}</div>` : ''}
          </div>
        ` : ''}

        <div class="admission-box">
          <form id="formPublicAdmissionInquiry">
            <div class="admission-grid">
              <div class="form-group">
                <label class="form-label" style="color:#ffffff;">Scholar Full Name *</label>
                <input type="text" class="form-control" id="inqStudentName" placeholder="Muhammad Hamza" required>
              </div>

              <div class="form-group">
                <label class="form-label" style="color:#ffffff;">Student B-Form / CNIC *</label>
                <input type="text" class="form-control" id="inqStudentCnic" placeholder="42101-1234567-1" required>
              </div>

              <div class="form-group">
                <label class="form-label" style="color:#ffffff;">Father / Guardian Full Name *</label>
                <input type="text" class="form-control" id="inqParentName" placeholder="Tariq Mehmood" required>
              </div>

              <div class="form-group">
                <label class="form-label" style="color:#ffffff;">Mobile Phone / WhatsApp *</label>
                <input type="tel" class="form-control" id="inqPhone" placeholder="0300-1234567" required>
              </div>

              <div class="form-group">
                <label class="form-label" style="color:#ffffff;">Desired Grade / Class *</label>
                <select class="form-control" id="inqClassSelect" required>
                  ${classes.length > 0 ? classes.map(c => `
                    <option value="${c.id}" data-name="${c.name} - ${c.section}">${c.name} (${c.section})</option>
                  `).join("") : `
                    <option value="cls_01" data-name="Class 1">Class 1</option>
                    <option value="cls_09" data-name="Grade 9">Grade 9 (Science)</option>
                    <option value="cls_10" data-name="Grade 10">Grade 10 (Science)</option>
                  `}
                </select>
              </div>

              <div class="form-group">
                <label class="form-label" style="color:#ffffff;">Previous School / Marks %</label>
                <input type="text" class="form-control" id="inqPrevSchool" placeholder="e.g. Army Public School (88% marks)">
              </div>
            </div>

            <div class="form-group" style="margin-top:16px;">
              <label class="form-label" style="color:#ffffff;">Residential Address</label>
              <input type="text" class="form-control" id="inqAddress" placeholder="Street / Sector / City">
            </div>

            <div class="form-group">
              <label class="form-label" style="color:#ffffff;">Special Requirements / Additional Notes</label>
              <textarea class="form-control" id="inqNotes" rows="2" placeholder="Any special guidance or transport requirement..."></textarea>
            </div>

            <button type="submit" class="hero-btn-primary" style="width:100%; justify-content:center; margin-top:20px; font-size:16px;">
              <i class="fa-solid fa-paper-plane"></i> Submit Official Admission Application
            </button>
          </form>
        </div>
      </section>

      <!-- Campus Contact Section -->
      <section class="landing-section" id="contact" style="border-top:1px solid rgba(255,255,255,0.08); padding-bottom:50px;">
        <div class="section-head">
          <span class="section-pill">${contact.pill || 'Visit Our Campus'}</span>
          <h2 class="section-title">${contact.title || 'Get In Touch With Us'}</h2>
          <p class="section-subtitle">
            ${contact.subtitle || 'Our admissions office is open Monday to Saturday from 8:00 AM to 2:00 PM.'}
          </p>
        </div>

        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap:24px; text-align:center;">
          <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:24px;">
            <i class="fa-solid fa-location-dot" style="font-size:28px; color:#38bdf8; margin-bottom:12px;"></i>
            <h4 style="color:#ffffff; margin:0 0 6px 0;">Campus Location</h4>
            <p style="color:#94a3b8; font-size:13px; margin:0;">${contact.address || this.config.contact.address || 'Campus Address, Pakistan'}</p>
            ${contact.mapDirections ? `<small style="color:#64748b; font-size:11px; display:block; margin-top:6px;"><i class="fa-solid fa-signs-post"></i> ${contact.mapDirections}</small>` : ''}
          </div>

          <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:24px;">
            <i class="fa-solid fa-phone" style="font-size:28px; color:#10b981; margin-bottom:12px;"></i>
            <h4 style="color:#ffffff; margin:0 0 6px 0;">Direct Phone & WhatsApp</h4>
            <p style="color:#94a3b8; font-size:13px; margin:0;">${contact.phone || this.config.contact.phone || '0300-1111111'}</p>
            ${contact.hours ? `<small style="color:#64748b; font-size:11px; display:block; margin-top:6px;"><i class="fa-regular fa-clock"></i> ${contact.hours}</small>` : ''}
          </div>

          <div style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:24px;">
            <i class="fa-solid fa-envelope" style="font-size:28px; color:#818cf8; margin-bottom:12px;"></i>
            <h4 style="color:#ffffff; margin:0 0 6px 0;">Official Email</h4>
            <p style="color:#94a3b8; font-size:13px; margin:0;">${contact.email || this.config.contact.email || 'admin@school.com'}</p>
          </div>
        </div>
      </section>

      <!-- Institutional Footer -->
      <footer class="landing-footer">
        <div style="margin-bottom:12px; font-weight:700; color:#f1f5f9; font-size:15px;">
          ${this.config.schoolName}
        </div>
        <p style="margin:0 0 16px 0; font-size:12px;">
          ${this.config.tagline || 'Excellence in Education'} &bull; Academic Year ${this.config.academicYear || '2026-2027'}
        </p>
        <div style="font-size:11px; opacity:0.6;">
          &copy; ${new Date().getFullYear()} ${this.config.schoolName}. Powered by EduCore Institutional ERP Suite.
        </div>
      </footer>
    `;

    this.bindLandingPageEvents();
  }

  // --- Bind Public Landing Page Events ---
  bindLandingPageEvents() {
    // Return to ERP Button (For authenticated users previewing site)
    document.getElementById("btnReturnToERP")?.addEventListener("click", () => {
      this.switchToPortal("dashboard");
    });

    // Portal Login Trigger (Navbar and Hero)
    const handleLoginClick = () => {
      const user = auth.getCurrentUser();
      if (user) {
        this.switchToPortal("dashboard");
      } else {
        this.showAuthModal("login");
      }
    };

    document.getElementById("btnLandingSignIn")?.addEventListener("click", handleLoginClick);
    document.getElementById("heroPortalBtn")?.addEventListener("click", handleLoginClick);

    // v2.2 — Landing mobile nav hamburger
    const landingMenuBtn = document.getElementById("landingMenuToggle");
    const landingNavLinks = document.querySelector("#publicLandingPage .landing-nav-links");
    landingMenuBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = landingNavLinks?.classList.toggle("open");
      landingMenuBtn.innerHTML = isOpen
        ? '<i class="fa-solid fa-xmark"></i>'
        : '<i class="fa-solid fa-bars"></i>';
    });
    // Close mobile menu when a link is tapped
    landingNavLinks?.querySelectorAll("a").forEach(a => {
      a.addEventListener("click", () => {
        landingNavLinks.classList.remove("open");
        if (landingMenuBtn) landingMenuBtn.innerHTML = '<i class="fa-solid fa-bars"></i>';
      });
    });
    // Close mobile menu when tapping outside (guard: bind only once)
    if (!document.body.dataset.landingOutsideClickBound) {
      document.body.dataset.landingOutsideClickBound = "1";
      document.addEventListener("click", (e) => {
        const links = document.querySelector("#publicLandingPage .landing-nav-links");
        const btn = document.getElementById("landingMenuToggle");
        if (links?.classList.contains("open") &&
            !e.target.closest(".landing-nav-links") &&
            !e.target.closest("#landingMenuToggle")) {
          links.classList.remove("open");
          if (btn) btn.innerHTML = '<i class="fa-solid fa-bars"></i>';
        }
      });
    }

    // Online Admission Form Submit Handler
    document.getElementById("formPublicAdmissionInquiry")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const classSelect = document.getElementById("inqClassSelect");
        const selectedOption = classSelect.options[classSelect.selectedIndex];
        const className = selectedOption ? selectedOption.getAttribute("data-name") || selectedOption.text : "General";

        const refNo = `ADM-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

        const inquiryData = {
          id: `inq_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
          refNo: refNo,
          name: document.getElementById("inqStudentName").value.trim(),
          cnic: document.getElementById("inqStudentCnic").value.trim(),
          parentName: document.getElementById("inqParentName").value.trim(),
          phone: document.getElementById("inqPhone").value.trim(),
          classId: classSelect.value,
          className: className,
          previousSchool: document.getElementById("inqPrevSchool")?.value.trim() || "—",
          address: document.getElementById("inqAddress")?.value.trim() || "—",
          notes: document.getElementById("inqNotes")?.value.trim() || "",
          status: "Pending",
          createdAt: new Date().toISOString()
        };

        await db.add(STORES.INQUIRIES, inquiryData);
        this.showAdmissionInquirySuccessModal(inquiryData);
        e.target.reset();
      } catch (err) {
        this.showToast(`Submission error: ${err.message}`, "error");
      }
    });

    // Smooth scrolling for internal anchor links
    document.querySelectorAll('#publicLandingPage a[href^="#"]').forEach(anchor => {
      anchor.addEventListener("click", function (e) {
        const targetId = this.getAttribute("href");
        if (targetId && targetId !== "#") {
          const targetEl = document.querySelector(targetId);
          if (targetEl) {
            e.preventDefault();
            targetEl.scrollIntoView({ behavior: "smooth" });
          }
        }
      });
    });
  }
}

// Instantiate and expose globally
window.schoolApp = new SchoolApp();
window.printDocument = (target, title) => window.schoolApp.printDocument(target, title);

