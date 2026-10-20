/**
 * =========================================================================
 * 🔥 EDUCORE FIREBASE SYNC & BACKUP ENGINE
 * Dual-Sync: Cloud Firestore + Realtime Database (RTDB)
 * =========================================================================
 * - Works 100% offline via IndexedDB
 * - Automatically pushes pending changes when internet reconnects
 * - Provides full 1-click cloud backup & cloud restore
 * =========================================================================
 */

import { getAppConfig } from "./config.js";
import { db, STORES } from "./db.js";

class FirebaseSyncManager {
  constructor() {
    this.app = null;
    this.firestore = null;
    this.rtdb = null;
    this.isInitialized = false;
    this.isSyncing = false;
    this.isOnline = navigator.onLine;
    this.lastSyncTime = localStorage.getItem("educore_last_sync_time") || null;
    this.initEventListeners();
  }

  initEventListeners() {
    window.addEventListener("online", () => {
      this.isOnline = true;
      this.notifyStatus("online", "Internet reconnected. Ready to sync.");
      if (getAppConfig().sync.autoSyncOnOnline) {
        this.syncPendingQueue();
      }
    });

    window.addEventListener("offline", () => {
      this.isOnline = false;
      this.notifyStatus("offline", "Operating in Offline Mode. All changes saved locally in IndexedDB.");
    });

    // Re-check config when updated in Admin settings
    window.addEventListener("configUpdated", () => {
      this.reinitializeFirebase();
    });
  }

  notifyStatus(state, message = "") {
    window.dispatchEvent(
      new CustomEvent("syncStatusChanged", {
        detail: {
          state, // 'online' | 'offline' | 'syncing' | 'synced' | 'unconfigured' | 'error'
          isOnline: this.isOnline,
          message,
          lastSyncTime: this.lastSyncTime
        }
      })
    );
  }

  async getFirebaseSdk() {
    try {
      const [appMod, firestoreMod, dbMod] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js"),
        import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js")
      ]);
      return {
        initializeApp: appMod.initializeApp,
        getApps: appMod.getApps,
        getFirestore: firestoreMod.getFirestore,
        doc: firestoreMod.doc,
        setDoc: firestoreMod.setDoc,
        getDoc: firestoreMod.getDoc,
        collection: firestoreMod.collection,
        getDocs: firestoreMod.getDocs,
        deleteDoc: firestoreMod.deleteDoc,
        getDatabase: dbMod.getDatabase,
        ref: dbMod.ref,
        set: dbMod.set,
        get: dbMod.get,
        child: dbMod.child
      };
    } catch (err) {
      console.warn("Could not load Firebase ESM SDK from CDN (probably offline):", err.message);
      return null;
    }
  }

  async initialize() {
    const config = getAppConfig();
    const fbConfig = config.firebase;

    if (!fbConfig || !fbConfig.apiKey || fbConfig.apiKey.trim() === "") {
      this.isInitialized = false;
      this.notifyStatus("unconfigured", "Offline mode active. Add Firebase keys in Admin Settings to enable cloud sync.");
      return false;
    }

    try {
      const sdk = await this.getFirebaseSdk();
      if (!sdk) {
        this.notifyStatus("offline", "Offline mode active (CDN unreachable). Changes saved locally.");
        return false;
      }

      // Initialize or get existing app
      const existingApps = sdk.getApps();
      this.app = existingApps.length > 0 ? existingApps[0] : sdk.initializeApp(fbConfig);

      if (config.sync.enableFirestore) {
        try {
          this.firestore = sdk.getFirestore(this.app);
        } catch (e) {
          console.warn("Firestore init warning:", e);
        }
      }

      if (config.sync.enableRTDB && fbConfig.databaseURL) {
        try {
          this.rtdb = sdk.getDatabase(this.app);
        } catch (e) {
          console.warn("Realtime Database init warning:", e);
        }
      }

      this.isInitialized = true;
      this.notifyStatus("online", "Connected to Firebase (Firestore & RTDB ready)");
      return true;
    } catch (err) {
      console.error("Firebase init failed:", err);
      this.notifyStatus("error", `Firebase connection error: ${err.message}`);
      return false;
    }
  }

  async reinitializeFirebase() {
    this.app = null;
    this.firestore = null;
    this.rtdb = null;
    this.isInitialized = false;
    return await this.initialize();
  }

  /**
   * Sync pending changes queue from IndexedDB to Firebase
   */
  async syncPendingQueue() {
    if (!this.isOnline) {
      this.notifyStatus("offline", "Device is offline. Changes remain safely in local IndexedDB.");
      return { success: false, reason: "offline" };
    }

    if (!this.isInitialized) {
      const ok = await this.initialize();
      if (!ok) return { success: false, reason: "unconfigured" };
    }

    if (this.isSyncing) return { success: true, message: "Sync already in progress" };

    this.isSyncing = true;
    this.notifyStatus("syncing", "Syncing local changes with Firebase...");

    try {
      const queue = await db.getAll(STORES.SYNC_QUEUE);
      if (!queue || queue.length === 0) {
        this.isSyncing = false;
        this.lastSyncTime = new Date().toLocaleTimeString();
        localStorage.setItem("educore_last_sync_time", this.lastSyncTime);
        this.notifyStatus("synced", `Up to date (Last synced at ${this.lastSyncTime})`);
        return { success: true, count: 0 };
      }

      const sdk = await this.getFirebaseSdk();
      let syncedCount = 0;

      for (const item of queue) {
        try {
          const { collection: colName, action, data } = item;

          // 1. Sync to Cloud Firestore if enabled
          if (this.firestore && data && data.id) {
            const docRef = sdk.doc(this.firestore, colName, data.id);
            if (action === "create" || action === "update") {
              await sdk.setDoc(docRef, data, { merge: true });
            } else if (action === "delete") {
              await sdk.deleteDoc(docRef);
            }
          }

          // 2. Sync to Firebase Realtime Database (RTDB) if enabled
          if (this.rtdb && data && data.id) {
            const dbRef = sdk.ref(this.rtdb, `${colName}/${data.id}`);
            if (action === "create" || action === "update") {
              await sdk.set(dbRef, data);
            } else if (action === "delete") {
              await sdk.set(dbRef, null);
            }
          }

          // Delete from local sync queue once pushed
          await db.delete(STORES.SYNC_QUEUE, item.id, false);
          syncedCount++;
        } catch (itemErr) {
          console.warn("Error syncing queue item:", item, itemErr);
        }
      }

      this.lastSyncTime = new Date().toLocaleTimeString();
      localStorage.setItem("educore_last_sync_time", this.lastSyncTime);
      this.notifyStatus("synced", `Successfully synced ${syncedCount} records to Firebase!`);
      return { success: true, count: syncedCount };
    } catch (err) {
      console.error("Queue sync error:", err);
      this.notifyStatus("error", `Sync failed: ${err.message}`);
      return { success: false, error: err.message };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * v3.0 — PULL latest data from Firebase RTDB into local IndexedDB.
   * RTDB is the source of truth: every store is refreshed with the
   * latest cloud data. Runs silently in background on boot.
   * Skipped when offline or RTDB not configured.
   */
  async pullFromRTDB() {
    if (!this.isOnline) return { success: false, reason: "offline" };

    if (!this.isInitialized) {
      const ok = await this.initialize();
      if (!ok) return { success: false, reason: "unconfigured" };
    }

    if (!this.rtdb) return { success: false, reason: "rtdb-disabled" };

    const sdk = await this.getFirebaseSdk();
    if (!sdk) return { success: false, reason: "sdk-unavailable" };

    // All data stores (skip sync queue itself and users for safety)
    const SKIP = new Set([STORES.SYNC_QUEUE, STORES.USERS]);
    const storeNames = Object.values(STORES).filter(s => !SKIP.has(s));

    let pulledCount = 0;
    const pulledStores = [];

    for (const storeName of storeNames) {
      try {
        const snap = await sdk.get(sdk.child(sdk.ref(this.rtdb), storeName));
        const data = snap.exists() ? snap.val() : null;
        const records = (data && typeof data === "object")
          ? Object.values(data).filter(r => r && r.id)
          : [];
        const rtdbIds = new Set(records.map(r => r.id));

        // v3.4 — Mirror: delete local records that no longer exist in RTDB
        // (so deleted/junk data doesn't linger in IndexedDB)
        try {
          const localRecs = await db.getAll(storeName);
          for (const lr of (localRecs || [])) {
            if (lr && lr.id && !rtdbIds.has(lr.id)) {
              await db.delete(storeName, lr.id, false);
            }
          }
        } catch (e) {}

        for (const rec of records) {
          // Upsert: RTDB wins (latest information). queueSync=false
          // so pulled data isn't re-queued for push.
          await db.update(storeName, rec, false);
          pulledCount++;
        }
        pulledStores.push(storeName);
      } catch (e) {
        console.warn(`RTDB pull failed for ${storeName}:`, e.message);
      }
    }

    this.lastSyncTime = new Date().toLocaleTimeString();
    localStorage.setItem("educore_last_sync_time", this.lastSyncTime);
    return { success: true, count: pulledCount, stores: pulledStores };
  }

  /**
   * v3.0 — Full two-way sync: PULL latest from RTDB first,
   * then PUSH local pending changes. Best of both worlds.
   */
  async fullSync() {
    if (!this.isOnline) {
      this.notifyStatus("offline", "Device is offline. Changes remain safely in local IndexedDB.");
      return { success: false, reason: "offline" };
    }
    if (this.isSyncing) return { success: true, message: "Sync already in progress" };

    this.isSyncing = true;
    this.notifyStatus("syncing", "Syncing with Firebase (fetching latest + uploading changes)...");

    try {
      // 1. PULL latest from RTDB (source of truth)
      const pull = await this.pullFromRTDB();

      // 2. PUSH local pending changes
      this.isSyncing = false; // allow syncPendingQueue to run
      const push = await this.syncPendingQueue();

      const msg = `Up to date — ${pull.count || 0} records fetched, ${push.count || 0} uploaded.`;
      this.notifyStatus("synced", msg);
      // Refresh UI so latest data shows immediately
      window.dispatchEvent(new CustomEvent("dbChanged"));
      return { success: true, pull, push };
    } catch (err) {
      console.error("Full sync error:", err);
      this.notifyStatus("error", `Sync failed: ${err.message}`);
      return { success: false, error: err.message };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Complete Snapshot Cloud Backup:
   * Writes the complete database snapshot to Firestore & Realtime Database
   */
  async backupFullDatabaseToCloud() {
    if (!this.isOnline) {
      throw new Error("Cannot backup to cloud while offline. Please connect to internet.");
    }

    if (!this.isInitialized) {
      const ok = await this.initialize();
      if (!ok) {
        throw new Error("Firebase is not configured yet. Enter credentials in Admin Settings.");
      }
    }

    this.notifyStatus("syncing", "Performing complete cloud backup to Firestore & RTDB...");

    const snapshot = await db.dumpAll();
    const sdk = await this.getFirebaseSdk();
    const config = getAppConfig();
    const backupKey = `school_backup_${Date.now()}`;

    let rtdbSuccess = false;
    let firestoreSuccess = false;

    // 1. RTDB unified backup node
    if (this.rtdb) {
      try {
        const rtdbBackupRef = sdk.ref(this.rtdb, `school_backups/latest`);
        await sdk.set(rtdbBackupRef, snapshot);
        
        // Also keep archive node
        const rtdbArchiveRef = sdk.ref(this.rtdb, `school_backups/history/${backupKey}`);
        await sdk.set(rtdbArchiveRef, {
          exportedAt: snapshot._meta.exportedAt,
          totalRecords: snapshot._meta.totalRecords
        });
        rtdbSuccess = true;
      } catch (e) {
        console.warn("RTDB backup warning:", e);
      }
    }

    // 2. Firestore individual collections + backup doc
    if (this.firestore) {
      try {
        // Write master backup manifest
        const backupDoc = sdk.doc(this.firestore, "backups", "latest");
        await sdk.setDoc(backupDoc, {
          meta: snapshot._meta,
          schoolName: config.schoolName,
          updatedAt: new Date().toISOString()
        });

        // Batch write store items to Firestore
        for (const [colName, items] of Object.entries(snapshot)) {
          if (colName.startsWith("_")) continue;
          if (Array.isArray(items)) {
            for (const item of items) {
              if (item.id) {
                const docRef = sdk.doc(this.firestore, colName, item.id);
                await sdk.setDoc(docRef, item, { merge: true });
              }
            }
          }
        }
        firestoreSuccess = true;
      } catch (e) {
        console.warn("Firestore backup warning:", e);
      }
    }

    this.lastSyncTime = new Date().toLocaleTimeString();
    localStorage.setItem("educore_last_sync_time", this.lastSyncTime);
    this.notifyStatus("synced", `Cloud Backup Complete! (Firestore: ${firestoreSuccess ? '✅' : '—'}, RTDB: ${rtdbSuccess ? '✅' : '—'})`);

    return {
      success: true,
      timestamp: this.lastSyncTime,
      firestoreSuccess,
      rtdbSuccess,
      totalRecords: snapshot._meta.totalRecords
    };
  }

  /**
   * Restore database from latest Firebase Cloud backup
   */
  async restoreFromCloud() {
    if (!this.isOnline) throw new Error("Internet connection required to restore from Cloud.");
    if (!this.isInitialized) {
      const ok = await this.initialize();
      if (!ok) throw new Error("Firebase not configured.");
    }

    this.notifyStatus("syncing", "Fetching latest backup from Firebase...");
    const sdk = await this.getFirebaseSdk();

    let backupData = null;

    // Try RTDB first
    if (this.rtdb) {
      try {
        const dbRef = sdk.ref(this.rtdb);
        const snapshot = await sdk.get(sdk.child(dbRef, "school_backups/latest"));
        if (snapshot.exists()) {
          backupData = snapshot.val();
        }
      } catch (e) {
        console.warn("RTDB restore fetch failed, trying Firestore:", e);
      }
    }

    // Try Firestore if RTDB didn't have it
    if (!backupData && this.firestore) {
      backupData = {};
      for (const storeName of Object.values(STORES)) {
        if (storeName === STORES.SYNC_QUEUE) continue;
        const colRef = sdk.collection(this.firestore, storeName);
        const colSnap = await sdk.getDocs(colRef);
        const list = [];
        colSnap.forEach(doc => list.push(doc.data()));
        backupData[storeName] = list;
      }
    }

    if (!backupData || Object.keys(backupData).length === 0) {
      throw new Error("No backup found in Firebase RTDB or Firestore.");
    }

    await db.restoreAll(backupData);
    this.notifyStatus("synced", "Successfully restored local data from Firebase Cloud!");
    return true;
  }
}

export const syncManager = new FirebaseSyncManager();
