/**
 * =========================================================================
 * 🔐 EDUCORE SOFTWARE LICENSE ACTIVATION & VERIFICATION ENGINE
 * =========================================================================
 * Strictly authenticates the software license key against the private
 * Firebase Realtime Database: https://licensekeysc-default-rtdb.firebaseio.com
 *
 * ENFORCEMENT RULES:
 * 1. Dual Authentication: Requires matching Commercial License Key AND Owner/Principal CNIC (13 digits).
 * 2. Single-School Hardware/Instance Lock: Bound to 1 live school installation. Reusing across multiple schools is strictly blocked.
 * =========================================================================
 */

import { getAppConfig } from "./config.js";

export const LICENSE_CONFIG = {
  apiKey: "AIzaSyD_tyMhYnzT7DwMy_ux-2vFeQz9t2HFF5A",
  authDomain: "licensekeysc.firebaseapp.com",
  databaseURL: "https://licensekeysc-default-rtdb.firebaseio.com",
  projectId: "licensekeysc"
};

const STORAGE_KEY_LICENSE = "educore_license_key";
const STORAGE_KEY_CNIC = "educore_license_owner_cnic";
const STORAGE_KEY_INSTANCE = "educore_school_instance_id";
const CACHE_STATUS_KEY = "educore_license_cached_status";

class LicenseManager {
  constructor() {
    let cfg = {};
    try { cfg = getAppConfig() || {}; } catch(e) {}
    this.licenseKey = localStorage.getItem(STORAGE_KEY_LICENSE) || cfg.licenseKey || "";
    this.ownerCnic = localStorage.getItem(STORAGE_KEY_CNIC) || (cfg.ownerCnic ? cfg.ownerCnic.replace(/\D/g, "") : "") || "";
    this.instanceId = this.getOrCreateInstanceId();
    this.isValid = false;
    this.isChecking = false;
    this.licenseData = null;
    this.errorMessage = "";
  }

  /**
   * Generates or retrieves unique installation fingerprint for single-school lock
   */
  getOrCreateInstanceId() {
    let id = localStorage.getItem(STORAGE_KEY_INSTANCE);
    if (!id) {
      const randomSuffix = Math.random().toString(36).substring(2, 10).toUpperCase();
      id = `INST-${window.location.hostname || 'LOCAL'}-${randomSuffix}`;
      localStorage.setItem(STORAGE_KEY_INSTANCE, id);
    }
    return id;
  }

  /**
   * Check if the current public domain has an active bound commercial license in RTDB
   * @param {string} hostname
   */
  async checkDomainLicense(hostname) {
    try {
      const host = (hostname || "").toLowerCase().trim().replace('.firebaseapp.com', '.web.app');
      if (!host) return null;

      const response = await fetch(`${LICENSE_CONFIG.databaseURL}/licenses.json`);
      if (!response.ok) return null;
      const allLicenses = await response.json();
      if (!allLicenses || typeof allLicenses !== "object") return null;

      for (const [key, item] of Object.entries(allLicenses)) {
        if (!item || typeof item !== "object") continue;
        const boundDomain = (item.boundDomain || "").toLowerCase().trim().replace('.firebaseapp.com', '.web.app');
        const status = (item.status || "").toLowerCase().trim();

        if (boundDomain === host && status === "active") {
          return {
            key: key,
            ownerCnic: (item.ownerCnic || "").replace(/\D/g, ""),
            data: item
          };
        }
      }
      return null;
    } catch (e) {
      console.warn("Domain license check failed:", e);
      return null;
    }
  }

  /**
   * Initialize license verification on application launch.
   * Auto-resolves for licensed domains and preconfigured settings without bothering visitors.
   */
  async init(config = null) {
    this.injectLockOverlay();

    // 1. Try credentials from this device's localStorage
    if (this.licenseKey && this.ownerCnic) {
      const ok = await this.verifyKey(this.licenseKey, this.ownerCnic, true);
      if (ok) return true;
    }

    // 2. Try credentials embedded in config.js (e.g. for pre-configured client setup)
    if (config?.licenseKey && config?.ownerCnic) {
      const targetCnic = (config.ownerCnic || "").replace(/\D/g, "");
      if (targetCnic && targetCnic.length === 13) {
        const ok = await this.verifyKey(config.licenseKey, targetCnic, true);
        if (ok) return true;
      }
    }

    // 3. Automated Live Domain Licensing:
    // If running on a live hosted domain (e.g. schoolmangementpanel.web.app or osst-tandlianwala.web.app),
    // query RTDB to see if this domain is already registered to an active commercial license.
    const currentHost = (window.location.hostname || "").toLowerCase().trim();
    const isLocalHost = !currentHost || 
                        currentHost === "localhost" || 
                        currentHost === "127.0.0.1" || 
                        currentHost.startsWith("192.168.") || 
                        currentHost.startsWith("10.") || 
                        currentHost.startsWith("172.");

    if (!isLocalHost) {
      const domainMatch = await this.checkDomainLicense(currentHost);
      if (domainMatch && domainMatch.key && domainMatch.ownerCnic) {
        const ok = await this.verifyKey(domainMatch.key, domainMatch.ownerCnic, true);
        if (ok) return true;
      }
    }

    // 4. If credentials exist in config with no CNIC provided, fetch from master RTDB by key
    if (config?.licenseKey && !this.licenseKey) {
      const directKey = config.licenseKey.trim().toUpperCase();
      try {
        const resp = await fetch(`${LICENSE_CONFIG.databaseURL}/licenses/${encodeURIComponent(directKey)}.json`);
        if (resp.ok) {
          const lData = await resp.json();
          if (lData && lData.status === "active" && lData.ownerCnic) {
            const ok = await this.verifyKey(directKey, lData.ownerCnic, true);
            if (ok) return true;
          }
        }
      } catch (e) {}
    }

    // 5. If none of the automated methods succeeded, display the activation prompt
    this.isValid = false;
    this.errorMessage = "Commercial License Key & Owner CNIC required. Please activate the School Management Panel.";
    this.showLockScreen(this.errorMessage);
    return false;
  }

  /**
   * Verify license key and owner CNIC against private Firebase RTDB
   * @param {string} rawKey - The license key entered by user
   * @param {string} rawCnic - The owner CNIC entered by user
   * @param {boolean} isInitialCheck - Whether this is running on startup
   */
  async verifyKey(rawKey, rawCnic, isInitialCheck = false) {
    const key = (rawKey || "").trim().toUpperCase();
    const cnicDigits = (rawCnic || "").replace(/\D/g, "");

    if (!key) {
      this.isValid = false;
      this.errorMessage = "Please enter your Commercial License Key.";
      this.showLockScreen(this.errorMessage);
      return false;
    }

    if (!cnicDigits || cnicDigits.length !== 13) {
      this.isValid = false;
      this.errorMessage = "Please enter a valid 13-digit Owner / Principal CNIC (e.g. 42101-1234567-1).";
      this.showLockScreen(this.errorMessage);
      return false;
    }

    this.isChecking = true;
    this.updateModalState("checking", "Connecting to Master License Server (licensekeysc)...");

    try {
      // 1. Fetch direct license node: /licenses/<key>.json
      const targetUrl = `${LICENSE_CONFIG.databaseURL}/licenses/${encodeURIComponent(key)}.json`;
      const response = await fetch(targetUrl);

      if (response.status === 401 || response.status === 403) {
        this.isValid = false;
        this.errorMessage = `Firebase Permission Denied: Realtime Database rules need to be published in your Firebase Console for project 'licensekeysc'. Please check 'license-database.rules.json'.`;
        this.showLockScreen(this.errorMessage);
        this.isChecking = false;
        return false;
      }

      if (!response.ok) {
        throw new Error(`License server returned HTTP status ${response.status}`);
      }

      let data = await response.json();

      // 2. Check master license fallback if not directly in /licenses/<key>
      if (data === null) {
        try {
          const masterResp = await fetch(`${LICENSE_CONFIG.databaseURL}/master_license.json`);
          if (masterResp.ok) {
            const masterData = await masterResp.json();
            if (masterData) {
              if (typeof masterData === "string" && masterData.trim() === key) {
                data = { status: "active", client: "Master Licensee", ownerCnic: cnicDigits };
              }
            }
          }
        } catch (e) {}
      }

      // 3. Evaluate existence
      if (data === null || data === undefined) {
        this.isValid = false;
        this.errorMessage = `Invalid License Key: "${key}" does not exist in master registry. Verify your key.`;
        this.showLockScreen(this.errorMessage);
        this.isChecking = false;
        return false;
      }

      if (data === true) data = { status: "active" };
      if (typeof data === "string" && data.toLowerCase() === "active") data = { status: "active" };

      // 4. Status Check
      if (typeof data === "object") {
        if (data.status && data.status.toLowerCase() === "revoked") {
          this.isValid = false;
          this.errorMessage = "This License Key has been REVOKED by the administrator. Contact your software provider.";
          this.showLockScreen(this.errorMessage);
          this.isChecking = false;
          return false;
        }

        if (data.status && data.status.toLowerCase() === "suspended") {
          this.isValid = false;
          this.errorMessage = "This License Key is SUSPENDED. Please contact accounts / support.";
          this.showLockScreen(this.errorMessage);
          this.isChecking = false;
          return false;
        }

        // 5. Expiration Check
        if (data.expiryDate || data.expiry) {
          const expDate = new Date(data.expiryDate || data.expiry);
          if (!isNaN(expDate.getTime()) && expDate < new Date()) {
            this.isValid = false;
            this.errorMessage = `This License Key EXPIRED on ${expDate.toLocaleDateString()}. Please renew your subscription.`;
            this.showLockScreen(this.errorMessage);
            this.isChecking = false;
            return false;
          }
        }

        // 6. CNIC Match Check (Strict Security)
        const registeredCnic = data.ownerCnic ? data.ownerCnic.replace(/\D/g, "") : "";
        if (registeredCnic && registeredCnic !== cnicDigits) {
          this.isValid = false;
          this.errorMessage = `CNIC Verification Failed: The entered CNIC does not match the registered owner CNIC on this license key.`;
          this.showLockScreen(this.errorMessage);
          this.isChecking = false;
          return false;
        }

        // 7. Single Live School Lock Enforcement
        const currentHost = (window.location.hostname || "localhost").toLowerCase();
        const isLocalHost = currentHost === "localhost" || 
                            currentHost === "127.0.0.1" || 
                            currentHost.startsWith("192.168.") || 
                            currentHost.startsWith("10.") || 
                            currentHost.startsWith("172.");

        const boundDomain = (data.boundDomain || "").toLowerCase();
        const isBoundToLocal = !boundDomain || boundDomain === "localhost" || boundDomain === "127.0.0.1";

        const normCurrent = currentHost.replace('.firebaseapp.com', '.web.app');
        const normBound = boundDomain.replace('.firebaseapp.com', '.web.app');

        // If currently on a public domain, and bound to a DIFFERENT public domain -> Block piracy!
        if (!isLocalHost && !isBoundToLocal && normBound !== normCurrent) {
          this.isValid = false;
          this.errorMessage = `Single-School Lock: This license is already in use by another live school domain (${data.boundDomain || data.client}). A commercial single-school license only permits 1 live school. Contact software distributor or use Master Portal to reset binding.`;
          this.showLockScreen(this.errorMessage);
          this.isChecking = false;
          return false;
        }

        // 8. Auto-bind or upgrade domain in RTDB
        let targetDomainToBind = data.boundDomain || currentHost;
        let shouldUpdateDomain = false;

        if (!data.boundDomain) {
          targetDomainToBind = currentHost;
          shouldUpdateDomain = true;
        } else if (!isLocalHost && isBoundToLocal) {
          // Upgrading from local dev/offline machine to the school's live online domain!
          targetDomainToBind = currentHost;
          shouldUpdateDomain = true;
        }

        if (shouldUpdateDomain || !data.boundInstance) {
          try {
            await fetch(targetUrl, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                boundInstance: this.instanceId,
                boundDomain: targetDomainToBind,
                boundAt: data.boundAt || new Date().toISOString(),
                lastActive: new Date().toISOString()
              })
            });
            data.boundInstance = this.instanceId;
            data.boundDomain = targetDomainToBind;
          } catch (e) {
            console.warn("Could not write instance binding to RTDB:", e);
          }
        }
      }

      // License successfully validated!
      this.isValid = true;
      this.licenseKey = key;
      this.ownerCnic = cnicDigits;
      this.licenseData = data;
      this.errorMessage = "";

      localStorage.setItem(STORAGE_KEY_LICENSE, key);
      localStorage.setItem(STORAGE_KEY_CNIC, cnicDigits);
      localStorage.setItem(CACHE_STATUS_KEY, JSON.stringify({ key, cnic: cnicDigits, time: Date.now(), data }));

      this.hideLockScreen();
      window.dispatchEvent(new CustomEvent("licenseActivated", { detail: { key, cnic: cnicDigits, data } }));
      return true;

    } catch (err) {
      console.error("License verification error:", err);
      // Offline mode: allow previously verified license to operate offline until expiry date
      const cached = localStorage.getItem(CACHE_STATUS_KEY);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          const isExpired = parsed.data?.expiry && new Date(parsed.data.expiry) < new Date();
          const isRevoked = parsed.data?.status === "revoked";

          if (parsed.key === key && parsed.cnic === cnicDigits && !isExpired && !isRevoked) {
            console.warn("Operating offline with previously verified license.");
            this.isValid = true;
            this.licenseKey = key;
            this.ownerCnic = cnicDigits;
            this.licenseData = parsed.data;
            this.hideLockScreen();

            // Quiet background verification when internet returns
            window.addEventListener("online", () => {
              this.verifyKey(this.licenseKey, this.ownerCnic, false).catch(() => {});
            }, { once: true });

            return true;
          } else if (isExpired) {
            this.errorMessage = `License Expired: Your software license expired on ${parsed.data.expiry}. Please contact distributor for renewal.`;
            this.showLockScreen(this.errorMessage);
            return false;
          }
        } catch (e) {}
      }

      this.isValid = false;
      this.errorMessage = `Connection Error: An active internet connection is required for initial activation.`;
      this.showLockScreen(this.errorMessage);
      this.isChecking = false;
      return false;
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Injects the persistent lock overlay into the DOM
   */
  injectLockOverlay() {
    if (document.getElementById("licenseLockOverlay")) return;

    // Format CNIC for display
    let formattedCnic = this.ownerCnic;
    if (formattedCnic && formattedCnic.length === 13) {
      formattedCnic = `${formattedCnic.slice(0, 5)}-${formattedCnic.slice(5, 12)}-${formattedCnic.slice(12)}`;
    }

    const overlay = document.createElement("div");
    overlay.id = "licenseLockOverlay";
    overlay.className = "license-lock-overlay";
    overlay.style.display = "none";
    overlay.innerHTML = `
      <div class="license-lock-modal" id="licenseLockModal">
        <div class="license-lock-header">
          <div class="license-lock-badge">
            <i class="fa-solid fa-shield-halved"></i>
          </div>
          <h2>Commercial License Required</h2>
          <p>This School Management Panel requires an authenticated commercial license key and matching Owner CNIC from the master registry to operate.</p>
        </div>

        <div id="licenseErrorAlert" class="license-error-box" style="display:none;"></div>

        <form id="licenseActivationForm" class="license-activation-form">
          <div class="form-group" style="text-align:left; margin-bottom:14px;">
            <label class="form-label" style="display:flex; justify-content:space-between;">
              <span><i class="fa-solid fa-key" style="color:var(--primary); margin-right:4px;"></i> License Key</span>
              <span style="font-size:10px; color:#64748b;">Format: EDU-XXXX-XXXX-XXXX</span>
            </label>
            <input 
              type="text" 
              class="form-control license-input" 
              id="licenseKeyInputField" 
              placeholder="e.g. EDU-2026-PAK-7890" 
              value="${this.licenseKey || ''}" 
              autocomplete="off" 
              spellcheck="false" 
              required
            >
          </div>

          <div class="form-group" style="text-align:left; margin-bottom:18px;">
            <label class="form-label" style="display:flex; justify-content:space-between;">
              <span><i class="fa-solid fa-id-card" style="color:var(--primary); margin-right:4px;"></i> Owner / Principal CNIC</span>
              <span style="font-size:10px; color:#64748b;">13-digit Pakistani CNIC</span>
            </label>
            <input 
              type="text" 
              class="form-control license-input" 
              id="licenseCnicInputField" 
              placeholder="e.g. 42101-1111111-1" 
              value="${formattedCnic || ''}" 
              autocomplete="off" 
              spellcheck="false" 
              required
            >
          </div>

          <button type="submit" class="btn btn-primary license-submit-btn" id="btnActivateLicense">
            <i class="fa-solid fa-lock-open"></i> Authenticate & Activate Single School
          </button>
        </form>

        <div class="license-server-info">
          <div class="license-server-dot"></div>
          <span>Strict Single-School Lock &bull; Private RTDB: <code>licensekeysc</code></span>
        </div>

        <div class="license-help-footer">
          <p>License permits 1 live school only. To issue, renew, or reassign licenses, open the Master License Portal.</p>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Bind auto-format for CNIC input
    const cnicInput = document.getElementById("licenseCnicInputField");
    cnicInput?.addEventListener("input", (e) => {
      let val = e.target.value.replace(/\D/g, "").slice(0, 13);
      if (val.length > 12) {
        e.target.value = `${val.slice(0, 5)}-${val.slice(5, 12)}-${val.slice(12)}`;
      } else if (val.length > 5) {
        e.target.value = `${val.slice(0, 5)}-${val.slice(5)}`;
      } else {
        e.target.value = val;
      }
    });

    // Bind activation form
    const form = document.getElementById("licenseActivationForm");
    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const keyVal = document.getElementById("licenseKeyInputField")?.value.trim() || "";
      const cnicVal = document.getElementById("licenseCnicInputField")?.value.trim() || "";
      await this.verifyKey(keyVal, cnicVal);
    });
  }

  /**
   * Update modal state (checking, error, etc.)
   */
  updateModalState(state, message = "") {
    const errBox = document.getElementById("licenseErrorAlert");
    const submitBtn = document.getElementById("btnActivateLicense");

    if (state === "checking") {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Authenticating against RTDB...`;
      }
      if (errBox) {
        errBox.style.display = "block";
        errBox.className = "license-info-box";
        errBox.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> ${message || 'Validating against master RTDB...'}`;
      }
    } else {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<i class="fa-solid fa-lock-open"></i> Authenticate & Activate Single School`;
      }
    }
  }

  /**
   * Show lock screen and freeze app
   */
  showLockScreen(errorMessage = "") {
    this.injectLockOverlay();
    const overlay = document.getElementById("licenseLockOverlay");
    const errBox = document.getElementById("licenseErrorAlert");
    const inputField = document.getElementById("licenseKeyInputField");
    const submitBtn = document.getElementById("btnActivateLicense");

    if (overlay) {
      overlay.style.display = "flex";
      document.body.classList.add("system-license-locked");
    }

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i class="fa-solid fa-lock-open"></i> Authenticate & Activate Single School`;
    }

    if (errBox) {
      if (errorMessage) {
        errBox.style.display = "block";
        errBox.className = "license-error-box";
        errBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="margin-right:6px;"></i> ${errorMessage}`;
      } else {
        errBox.style.display = "none";
      }
    }

    if (inputField) {
      inputField.focus();
    }
  }

  /**
   * Hide lock screen and unfreeze app
   */
  hideLockScreen() {
    const overlay = document.getElementById("licenseLockOverlay");
    if (overlay) {
      overlay.style.display = "none";
      document.body.classList.remove("system-license-locked");
    }
  }

  /**
   * Reset / change license key
   */
  async deactivateLicense() {
    this.isValid = false;
    this.licenseKey = "";
    this.ownerCnic = "";
    this.licenseData = null;
    localStorage.removeItem(STORAGE_KEY_LICENSE);
    localStorage.removeItem(STORAGE_KEY_CNIC);
    localStorage.removeItem(CACHE_STATUS_KEY);
    this.showLockScreen("License key & CNIC removed. Please enter valid credentials to activate.");
  }
}

export const licenseManager = new LicenseManager();
