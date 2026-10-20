/**
 * =========================================================================
 * ✉️ EDUCORE PRO — SMS Fallback Integration
 * =========================================================================
 * HONEST MODEL: real SMS delivery needs the SCHOOL's own gateway account
 * (Telenor / Jazz / custom HTTP API). Browsers cannot send SMS directly and
 * this app has no backend, so this module:
 *   1. stores the school's gateway credentials (config.sms),
 *   2. builds provider-specific payloads (documented shapes — for the
 *      school's server / gateway dashboard, NOT sent from here),
 *   3. generates short GSM-7-safe (<160 char) reminder texts,
 *   4. offers one-tap clipboard copy for manual sending from any phone.
 * Pure helpers + settings view — no DOM except in bind functions.
 * =========================================================================
 */

import { DEFAULT_CONFIG, saveAppConfig } from "./config.js";
import { daysOverdue } from "./whatsapp.js";

/**
 * Supported SMS gateways (Pakistan). Credentials belong to the school —
 * never hardcode keys here.
 */
export const SMS_PROVIDERS = [
  { id: "telenor", label: "Telenor SMS API", doc: "Connect / Corporate SMS API (username + password / API key)" },
  { id: "jazz", label: "Jazz SMS API", doc: "Mobilink/Jazz enterprise SMS API (API key + sender mask)" },
  { id: "custom", label: "Custom HTTP API", doc: "Koi bhi HTTP GET/POST SMS gateway (URL template)" }
];

/** Default SMS settings shape (merged over in getSmsSettings). */
export const DEFAULT_SMS_SETTINGS = {
  provider: "telenor",
  apiKey: "",
  senderId: "",   // approved sender mask / short code, e.g. "SCHOOL"
  apiUrl: "",     // only for "custom" provider
  enabled: false
};

/**
 * School's SMS gateway settings, merged over defaults.
 * NOTE: apiKey is stored in localStorage (same as other school config) —
 * treat the device as the school's own trusted machine.
 */
export function getSmsSettings(config) {
  return { ...DEFAULT_SMS_SETTINGS, ...((config && config.sms) || {}) };
}

/**
 * Persist SMS settings into the app config.
 *
 * @param {object} settings - partial settings ({provider, apiKey, senderId, apiUrl, enabled})
 */
export function saveSmsSettings(settings) {
  const clean = {
    provider: String(settings.provider || "telenor"),
    apiKey: String(settings.apiKey || "").trim(),
    senderId: String(settings.senderId || "").trim().toUpperCase().slice(0, 11),
    apiUrl: String(settings.apiUrl || "").trim(),
    enabled: Boolean(settings.enabled)
  };
  saveAppConfig({ sms: clean });
  return clean;
}

/** Human label for a provider id. */
export function providerLabel(id) {
  const p = SMS_PROVIDERS.find(x => x.id === id);
  return p ? p.label : id;
}

function schoolNameOf(config) {
  return (config && (config.schoolName || config.instituteName)) || "School";
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Concise fee-reminder SMS text — GSM-7 safe (plain ASCII, Roman Urdu),
 * max 160 characters so it stays a single SMS segment.
 *
 * @param {string} studentName
 * @param {object} fee - { type, amount, dueDate, studentName }
 * @param {object} config
 * @returns {string} <= 160 chars
 */
export function smsTextForFeeReminder(studentName, fee, config) {
  const school = schoolNameOf(config).replace(/[^\x20-\x7E]/g, "").slice(0, 18) || "School";
  const name = String(studentName || fee.studentName || "Student").replace(/[^\x20-\x7E]/g, "").slice(0, 20);
  const cur = "Rs";
  const amount = Number(fee.amount || 0).toLocaleString("en-US");
  const days = daysOverdue(fee.dueDate);
  const due = fee.dueDate || "";

  let text = `AoA! ${school}: ${name} ki fee ${cur} ${amount} (${due}) ${days} din overdue hai. Barah-e-karam jald ada karein. - ${school}`;

  // Hard guarantee: single segment
  if (text.length > 160) {
    text = `AoA! ${school}: ${name} ki fee ${cur} ${amount} overdue hai. Jald ada karein. - ${school}`;
  }
  if (text.length > 160) text = text.slice(0, 157) + "...";
  return text;
}

/**
 * Build a provider-specific SMS payload (DOCUMENTED SHAPE ONLY).
 *
 * This function does NOT send anything — there is no backend here and API
 * keys must never leave the school's own server. Hand the returned object
 * to the school's server-side script / gateway dashboard, or use "Copy text"
 * to send manually from a phone.
 *
 * @param {string} to - destination in international format (e.g. 923001234567)
 * @param {string} message - SMS text (use smsTextForFeeReminder)
 * @param {object} settings - from getSmsSettings()
 * @returns {{ provider:string, ready:boolean, payload:object, note:string }}
 */
export function buildSmsPayload(to, message, settings) {
  const s = { ...DEFAULT_SMS_SETTINGS, ...(settings || {}) };
  const ready = Boolean(s.enabled && s.apiKey && to && message);

  let payload;
  let note;
  if (s.provider === "telenor") {
    payload = {
      method: "POST",
      endpoint: "https://api.telenor.com.pk/sms/v1/send (sample — confirm with Telenor docs)",
      headers: { "Authorization": "Bearer <API_KEY>", "Content-Type": "application/json" },
      body: { to, from: s.senderId || "SCHOOL", text: message }
    };
    note = "Telenor Connect/Corporate SMS API — exact endpoint apne account docs se confirm karein.";
  } else if (s.provider === "jazz") {
    payload = {
      method: "POST",
      endpoint: "https://api.jazz.com.pk/sms/v1/send (sample — confirm with Jazz docs)",
      headers: { "apikey": "<API_KEY>", "Content-Type": "application/json" },
      body: { to, sender: s.senderId || "SCHOOL", message }
    };
    note = "Jazz enterprise SMS API — sender mask Jazz se approve karwana zaroori hai.";
  } else {
    payload = {
      method: "GET",
      url: (s.apiUrl || "<API_URL>")
        .replace("{to}", encodeURIComponent(to))
        .replace("{msg}", encodeURIComponent(message))
        .replace("{key}", encodeURIComponent("<API_KEY>"))
    };
    note = "Custom gateway — URL me {to}, {msg}, {key} placeholders use karein.";
  }

  // Never echo the real key back in logs/objects handed around.
  return { provider: s.provider, ready, payload, note };
}

/**
 * Copy text to clipboard (manual-send fallback). Falls back to a
 * temporary textarea for older browsers.
 *
 * @param {string} text
 * @returns {Promise<boolean>} true on success
 */
export async function copySmsText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* fall through */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * SMS settings view HTML: provider select, credentials, sender ID,
 * enable toggle — plus an honest note that a gateway account is required.
 *
 * @param {object} app - EduCoreApp instance (uses app.config)
 * @returns {string} HTML
 */
export function renderSmsSettingsView(app) {
  const s = getSmsSettings(app.config);

  const providerOpts = SMS_PROVIDERS.map(p =>
    `<option value="${p.id}" ${s.provider === p.id ? "selected" : ""}>${esc(p.label)}</option>`
  ).join("");

  return `
    <div class="page-header">
      <div class="page-title-group">
        <h1><i class="fa-solid fa-message" style="color:#0ea5e9;"></i> SMS Fallback Settings</h1>
        <p>Jin parents ke paas WhatsApp nahi, unko SMS reminder — aapke apne SMS gateway account se.</p>
      </div>
    </div>

    <div class="card" style="border-left:4px solid #f59e0b; margin-bottom:16px;">
      <div style="display:flex; gap:10px; align-items:flex-start;">
        <i class="fa-solid fa-circle-info" style="color:#f59e0b; margin-top:2px;"></i>
        <div style="font-size:13px; color:var(--text-dim, #475569);">
          <strong>SMS bhejne ke liye aapka apna gateway account chahiye</strong> (Telenor / Jazz / koi HTTP SMS service).
          Yahan credentials save karein — asal SMS aapke server ya gateway dashboard se jayega.
          Filhal har reminder ka text <strong>copy</strong> karke apne phone se manually bhi bhej sakte hain.
        </div>
      </div>
    </div>

    <div class="card">
      <form id="formSmsSettings">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">SMS Provider</label>
            <select class="form-control" id="smsProvider" name="provider">${providerOpts}</select>
            <small class="form-hint" id="smsProviderDoc"></small>
          </div>
          <div class="form-group">
            <label class="form-label">Enable SMS fallback</label>
            <select class="form-control" id="smsEnabled" name="enabled">
              <option value="1" ${s.enabled ? "selected" : ""}>Enabled</option>
              <option value="0" ${!s.enabled ? "selected" : ""}>Disabled</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">API Key / Password</label>
            <input type="password" class="form-control" id="smsApiKey" name="apiKey"
                   value="${esc(s.apiKey)}" placeholder="Gateway API key" autocomplete="off">
          </div>
          <div class="form-group">
            <label class="form-label">Sender ID / Mask</label>
            <input type="text" class="form-control" id="smsSenderId" name="senderId"
                   value="${esc(s.senderId)}" placeholder="e.g. SUNRISE" maxlength="11">
            <small class="form-hint">Jazz/Telenor se approved mask (max 11 chars)</small>
          </div>
        </div>
        <div class="form-group" id="smsCustomUrlWrap" style="display:${s.provider === "custom" ? "block" : "none"};">
          <label class="form-label">Custom API URL template</label>
          <input type="text" class="form-control" id="smsApiUrl" name="apiUrl"
                 value="${esc(s.apiUrl)}" placeholder="https://gateway.example/send?to={to}&msg={msg}&key={key}">
          <small class="form-hint"><code>{to}</code>, <code>{msg}</code>, <code>{key}</code> placeholders use karein</small>
        </div>
        <button type="submit" class="btn btn-primary">
          <i class="fa-solid fa-floppy-disk"></i> Save SMS Settings
        </button>
      </form>
    </div>

    <div class="card" style="margin-top:16px;">
      <h3 class="card-title"><i class="fa-solid fa-flask"></i> SMS Preview</h3>
      <p style="font-size:13px; color:var(--text-dim, #64748b);">Fee reminder ka SMS kuch aisa lagega (160 chars se kam, 1 SMS):</p>
      <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:12px 14px;
                  font-family:monospace; font-size:13px; max-width:420px;">
        ${esc(smsTextForFeeReminder("Ahmed Khan", { amount: 2500, dueDate: "2026-10-05", studentName: "Ahmed Khan" }, app.config))}
      </div>
      <div style="margin-top:8px; font-size:12px; color:var(--text-dim, #64748b);">
        Length: ${smsTextForFeeReminder("Ahmed Khan", { amount: 2500, dueDate: "2026-10-05", studentName: "Ahmed Khan" }, app.config).length} chars
      </div>
    </div>`;
}

/**
 * Wire up the SMS settings form.
 *
 * @param {object} app - EduCoreApp instance (uses app.config, app.showToast)
 */
export function bindSmsSettingsEvents(app) {
  const providerSel = document.getElementById("smsProvider");
  const docHint = document.getElementById("smsProviderDoc");
  const customWrap = document.getElementById("smsCustomUrlWrap");

  const showDoc = () => {
    const p = SMS_PROVIDERS.find(x => x.id === providerSel.value);
    if (docHint && p) docHint.textContent = p.doc;
    if (customWrap) customWrap.style.display = providerSel.value === "custom" ? "block" : "none";
  };
  providerSel?.addEventListener("change", showDoc);
  showDoc();

  document.getElementById("formSmsSettings")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    saveSmsSettings({
      provider: fd.get("provider"),
      apiKey: fd.get("apiKey"),
      senderId: fd.get("senderId"),
      apiUrl: fd.get("apiUrl"),
      enabled: String(fd.get("enabled")) === "1"
    });
    app.config = { ...app.config, sms: getSmsSettings(app.config) };
    app.showToast("SMS settings save ho gayi.", "success");
  });
}
