/**
 * =========================================================================
 * 📲 EDUCORE PRO — PWA Helpers (service worker + install prompt)
 * =========================================================================
 * - registerServiceWorker(): registers ./sw.js, fails silently when the file
 *   or the API is unavailable (file://, old browsers).
 * - installPromptHandler(): call once at boot; captures beforeinstallprompt.
 * - showInstallPrompt() / isInstallable(): drive the "Install App" UI.
 * - renderInstallBanner(): dismissible install banner HTML (data-i18n keys).
 *
 * ICON NOTE: manifest.json icons use an inline SVG data URI (graduation-cap
 * emoji on brand indigo) so the PWA is installable with zero binary assets.
 * For production, generate real 192px / 512px PNGs and point the manifest
 * "icons" entries at them (e.g. "icons/icon-192.png").
 * Pure logic + HTML strings — DOM wiring is the caller's job.
 * =========================================================================
 */

let deferredPrompt = null;
let promptFired = false;

/**
 * Register ./sw.js when service workers are supported.
 * Resolves true on success, false otherwise — never throws.
 */
export async function registerServiceWorker() {
  try {
    if (!("serviceWorker" in navigator)) return false;
    if (!window.isSecureContext && location.hostname !== "localhost") return false;
    const reg = await navigator.serviceWorker.register("./sw.js");
    return Boolean(reg);
  } catch (e) {
    return false;
  }
}

/**
 * Attach the beforeinstallprompt listener once. Must be called at app boot.
 * Also treats an already-installed PWA (display-mode: standalone) as
 * non-installable so the banner never shows inside the installed app.
 */
export function installPromptHandler() {
  if (promptFired) return;
  promptFired = true;
  try {
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredPrompt = e;
      window.dispatchEvent(new CustomEvent("pwaInstallable", { detail: {} }));
    });
    window.addEventListener("appinstalled", () => {
      deferredPrompt = null;
      window.dispatchEvent(new CustomEvent("pwaInstalled", { detail: {} }));
    });
  } catch (e) {}
}

/** True when the browser has offered installation and it wasn't used yet. */
export function isInstallable() {
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return false;
    if (window.navigator.standalone === true) return false; // iOS
  } catch (e) {}
  return deferredPrompt !== null;
}

/**
 * Show the captured install prompt. Resolves with the user's choice
 * ("accepted" | "dismissed") or null when no prompt is available.
 */
export async function showInstallPrompt() {
  if (!deferredPrompt) return null;
  try {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    return outcome || null;
  } catch (e) {
    return null;
  }
}

/**
 * Dismissible "Install App" banner HTML. Uses data-i18n keys so the
 * app's language system translates it via applyI18nToStatic().
 * Caller: insert into the page, wire #btnPwaInstall -> showInstallPrompt()
 * and #btnPwaDismiss -> hide the banner (persist dismissal in localStorage).
 */
export function renderInstallBanner() {
  return `
    <div id="pwaInstallBanner" class="pwa-install-banner" role="dialog" aria-live="polite">
      <div class="pwa-install-icon"><i class="fa-solid fa-mobile-screen-button"></i></div>
      <div class="pwa-install-text">
        <strong data-i18n="pwa_install_app">Install App</strong>
        <span data-i18n="pwa_install_desc">Install for quick access</span>
      </div>
      <button type="button" class="btn btn-primary btn-sm" id="btnPwaInstall">
        <span data-i18n="pwa_install">Install</span>
      </button>
      <button type="button" class="pwa-install-dismiss" id="btnPwaDismiss" aria-label="Dismiss">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>
  `;
}

/** localStorage key tracking a dismissed install banner. */
export const PWA_BANNER_DISMISSED_KEY = "educore_pwa_banner_dismissed";

/** True when the user previously dismissed the install banner. */
export function wasInstallBannerDismissed() {
  try {
    return localStorage.getItem(PWA_BANNER_DISMISSED_KEY) === "1";
  } catch (e) {
    return false;
  }
}

/** Remember that the user dismissed the install banner. */
export function dismissInstallBanner() {
  try {
    localStorage.setItem(PWA_BANNER_DISMISSED_KEY, "1");
  } catch (e) {}
}
