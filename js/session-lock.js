/**
 * session-lock.js — Single Administrator Session Lock (v3.3)
 *
 * Ensures only ONE administrator is logged in at a time across all devices,
 * preventing edit conflicts. Uses Firebase RTDB as the shared lock store.
 *
 * - Only applies to role "admin" (teachers, students, parents are unrestricted).
 * - Lock = RTDB node `adminSession`: { sessionId, userId, userName, loginAt, heartbeatAt }
 * - Heartbeat every 60s keeps the lock fresh; stale locks (>3 min) can be taken over.
 * - On clean logout the lock is released immediately.
 */

import { getAppConfig } from "./config.js";

const LOCK_PATH = "adminSession";
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const STALE_AFTER_MS = 3 * 60 * 1000;

function newSessionId() {
  return "sess_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
}

class SessionLock {
  constructor() {
    this._sdk = null;
    this._rtdb = null;
    this._initPromise = null;
    this.sessionId = null;
    this.heartbeatTimer = null;
  }

  async _ensureInit() {
    if (this._rtdb) return true;
    if (this._initPromise) return this._initPromise;
    this._initPromise = (async () => {
      try {
        const config = getAppConfig();
        const fbConfig = config?.firebase || {};
        if (!fbConfig.databaseURL) return false;
        const [appMod, dbMod] = await Promise.all([
          import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js"),
          import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js"),
        ]);
        const apps = appMod.getApps();
        const app = apps.length > 0 ? apps[0] : appMod.initializeApp(fbConfig);
        this._sdk = dbMod;
        this._rtdb = dbMod.getDatabase(app);
        return true;
      } catch (e) {
        console.warn("SessionLock: Firebase init failed (offline?)", e);
        this._initPromise = null;
        return false;
      }
    })();
    return this._initPromise;
  }

  async _readLock() {
    if (!(await this._ensureInit())) return null; // offline → no lock info
    try {
      const snap = await this._sdk.get(this._sdk.child(this._sdk.ref(this._rtdb), LOCK_PATH));
      return snap.exists() ? snap.val() : null;
    } catch (e) {
      return null;
    }
  }

  async _writeLock(data) {
    if (!(await this._ensureInit())) return false;
    try {
      await this._sdk.set(this._sdk.ref(this._rtdb, LOCK_PATH), data);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Try to acquire the admin lock. Throws if another admin holds a fresh lock.
   */
  async acquire(user) {
    const existing = await this._readLock();
    const now = Date.now();

    if (existing && existing.sessionId && existing.heartbeatAt) {
      const age = now - existing.heartbeatAt;
      const isMine = existing.sessionId === this.sessionId;
      if (!isMine && age < STALE_AFTER_MS) {
        const holderName = existing.userName || "Another administrator";
        const minsAgo = Math.max(1, Math.round(age / 60000));
        throw new Error(
          `${holderName} is currently logged in as administrator (active ${minsAgo} min ago). ` +
          `Only one admin session is allowed at a time to prevent data conflicts.`
        );
      }
      // Stale lock → take over (previous admin likely closed browser without logout)
    }

    this.sessionId = newSessionId();
    const lock = {
      sessionId: this.sessionId,
      userId: user.id || user.email || "admin",
      userName: user.name || user.email || "Administrator",
      loginAt: now,
      heartbeatAt: now,
    };
    await this._writeLock(lock);
    this._startHeartbeat();
    return lock;
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(async () => {
      if (!this.sessionId || !(await this._ensureInit())) return;
      try {
        const snap = await this._sdk.get(this._sdk.child(this._sdk.ref(this._rtdb), LOCK_PATH));
        const current = snap.exists() ? snap.val() : null;
        if (current && current.sessionId === this.sessionId) {
          await this._sdk.update(this._sdk.ref(this._rtdb, LOCK_PATH), { heartbeatAt: Date.now() });
        } else {
          this._stopHeartbeat();
          this.sessionId = null;
        }
      } catch (e) { /* offline — retry next tick */ }
    }, HEARTBEAT_INTERVAL_MS);
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** Release the lock on logout (only if it's ours). */
  async release() {
    this._stopHeartbeat();
    if (!this.sessionId || !(await this._ensureInit())) {
      this.sessionId = null;
      return;
    }
    try {
      const snap = await this._sdk.get(this._sdk.child(this._sdk.ref(this._rtdb), LOCK_PATH));
      const current = snap.exists() ? snap.val() : null;
      if (current && current.sessionId === this.sessionId) {
        await this._sdk.set(this._sdk.ref(this._rtdb, LOCK_PATH), null);
      }
    } catch (e) { /* best effort */ }
    this.sessionId = null;
  }
}

export const sessionLock = new SessionLock();
