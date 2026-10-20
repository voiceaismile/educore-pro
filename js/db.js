/**
 * =========================================================================
 * 💾 EDUCORE OFFLINE-FIRST DATABASE (IndexedDB)
 * =========================================================================
 * Provides fast, 100% offline persistence for all school records.
 * Automatically queues changes for Firebase RTDB and Firestore sync.
 * =========================================================================
 */

const DB_NAME = "EduCoreSchoolDB";
const DB_VERSION = 4;

export const STORES = {
  USERS: "users",
  STUDENTS: "students",
  TEACHERS: "teachers",
  CLASSES: "classes",
  ATTENDANCE: "attendance",
  GRADES: "grades",
  FEES: "fees",
  NOTICES: "notices",
  INQUIRIES: "inquiries",
  ONLINE_PAYMENTS: "onlinePayments",
  EXPENSES: "expenses",
  SALARIES: "salaries",
  DISCOUNTS: "discounts",
  TIMETABLES: "timetables",
  DATESHEETS: "datesheets",
  BOOKS: "books",
  BOOK_ISSUES: "bookIssues",
  STAFF_ATTENDANCE: "staffAttendance",
  LEAVES: "leaves",
  SYNC_QUEUE: "syncQueue"
};

class LocalDatabase {
  constructor() {
    this.db = null;
    this.initPromise = null;
  }

  async init() {
    if (this.db) return this.db;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Create object stores if not present
        if (!db.objectStoreNames.contains(STORES.USERS)) {
          const userStore = db.createObjectStore(STORES.USERS, { keyPath: "id" });
          userStore.createIndex("email", "email", { unique: true });
          userStore.createIndex("role", "role", { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.STUDENTS)) {
          const studentStore = db.createObjectStore(STORES.STUDENTS, { keyPath: "id" });
          studentStore.createIndex("admissionNo", "admissionNo", { unique: true });
          studentStore.createIndex("classId", "classId", { unique: false });
          studentStore.createIndex("email", "email", { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.TEACHERS)) {
          const teacherStore = db.createObjectStore(STORES.TEACHERS, { keyPath: "id" });
          teacherStore.createIndex("employeeId", "employeeId", { unique: true });
          teacherStore.createIndex("email", "email", { unique: true });
        }

        if (!db.objectStoreNames.contains(STORES.CLASSES)) {
          db.createObjectStore(STORES.CLASSES, { keyPath: "id" });
        }

        if (!db.objectStoreNames.contains(STORES.ATTENDANCE)) {
          const attStore = db.createObjectStore(STORES.ATTENDANCE, { keyPath: "id" });
          attStore.createIndex("date_class", ["date", "classId"], { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.GRADES)) {
          const gradeStore = db.createObjectStore(STORES.GRADES, { keyPath: "id" });
          gradeStore.createIndex("studentId", "studentId", { unique: false });
          gradeStore.createIndex("classId", "classId", { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.FEES)) {
          const feeStore = db.createObjectStore(STORES.FEES, { keyPath: "id" });
          feeStore.createIndex("studentId", "studentId", { unique: false });
          feeStore.createIndex("status", "status", { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.NOTICES)) {
          db.createObjectStore(STORES.NOTICES, { keyPath: "id" });
        }

        if (!db.objectStoreNames.contains(STORES.INQUIRIES)) {
          const inqStore = db.createObjectStore(STORES.INQUIRIES, { keyPath: "id" });
          inqStore.createIndex("status", "status", { unique: false });
          inqStore.createIndex("phone", "phone", { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.ONLINE_PAYMENTS)) {
          const payStore = db.createObjectStore(STORES.ONLINE_PAYMENTS, { keyPath: "id" });
          payStore.createIndex("feeId", "feeId", { unique: false });
          payStore.createIndex("status", "status", { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.EXPENSES)) {
          const expStore = db.createObjectStore(STORES.EXPENSES, { keyPath: "id" });
          expStore.createIndex("date", "date", { unique: false });
          expStore.createIndex("category", "category", { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.SALARIES)) {
          const salStore = db.createObjectStore(STORES.SALARIES, { keyPath: "id" });
          salStore.createIndex("teacherId", "teacherId", { unique: false });
          salStore.createIndex("month", "month", { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.DISCOUNTS)) {
          const dscStore = db.createObjectStore(STORES.DISCOUNTS, { keyPath: "id" });
          dscStore.createIndex("studentId", "studentId", { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.TIMETABLES)) {
          const ttStore = db.createObjectStore(STORES.TIMETABLES, { keyPath: "id" });
          ttStore.createIndex("classId", "classId", { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.DATESHEETS)) {
          const dsStore = db.createObjectStore(STORES.DATESHEETS, { keyPath: "id" });
          dsStore.createIndex("classId", "classId", { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.BOOKS)) {
          db.createObjectStore(STORES.BOOKS, { keyPath: "id" });
        }

        if (!db.objectStoreNames.contains(STORES.BOOK_ISSUES)) {
          const biStore = db.createObjectStore(STORES.BOOK_ISSUES, { keyPath: "id" });
          biStore.createIndex("bookId", "bookId", { unique: false });
          biStore.createIndex("studentId", "studentId", { unique: false });
          biStore.createIndex("status", "status", { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.STAFF_ATTENDANCE)) {
          const saStore = db.createObjectStore(STORES.STAFF_ATTENDANCE, { keyPath: "id" });
          saStore.createIndex("date", "date", { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.LEAVES)) {
          const lvStore = db.createObjectStore(STORES.LEAVES, { keyPath: "id" });
          lvStore.createIndex("teacherId", "teacherId", { unique: false });
          lvStore.createIndex("status", "status", { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.SYNC_QUEUE)) {
          db.createObjectStore(STORES.SYNC_QUEUE, { keyPath: "id" });
        }
      };

      request.onsuccess = async (event) => {
        this.db = event.target.result;
        await this.seedInitialDataIfEmpty();
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error("IndexedDB initialization error:", event.target.error);
        reject(event.target.error);
      };
    });

    return this.initPromise;
  }

  // --- Generic Helpers ---

  async getAll(storeName) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async getById(storeName, id) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async add(storeName, item, queueSync = true) {
    await this.init();
    if (!item.id) {
      item.id = `${storeName.slice(0, 3)}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }
    item.updatedAt = new Date().toISOString();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([storeName, STORES.SYNC_QUEUE], "readwrite");
      const store = tx.objectStore(storeName);
      const req = store.add(item);

      req.onsuccess = () => {
        if (queueSync && storeName !== STORES.SYNC_QUEUE) {
          const syncStore = tx.objectStore(STORES.SYNC_QUEUE);
          syncStore.put({
            id: `sync_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            collection: storeName,
            action: "create",
            data: item,
            timestamp: new Date().toISOString()
          });
        }
      };

      tx.oncomplete = () => {
        window.dispatchEvent(new CustomEvent("dbChanged", { detail: { store: storeName, action: "add", item } }));
        resolve(item);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async update(storeName, item, queueSync = true) {
    await this.init();
    item.updatedAt = new Date().toISOString();

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([storeName, STORES.SYNC_QUEUE], "readwrite");
      const store = tx.objectStore(storeName);
      store.put(item);

      if (queueSync && storeName !== STORES.SYNC_QUEUE) {
        const syncStore = tx.objectStore(STORES.SYNC_QUEUE);
        syncStore.put({
          id: `sync_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          collection: storeName,
          action: "update",
          data: item,
          timestamp: new Date().toISOString()
        });
      }

      tx.oncomplete = () => {
        window.dispatchEvent(new CustomEvent("dbChanged", { detail: { store: storeName, action: "update", item } }));
        resolve(item);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async delete(storeName, id, queueSync = true) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([storeName, STORES.SYNC_QUEUE], "readwrite");
      const store = tx.objectStore(storeName);
      store.delete(id);

      if (queueSync && storeName !== STORES.SYNC_QUEUE) {
        const syncStore = tx.objectStore(STORES.SYNC_QUEUE);
        syncStore.put({
          id: `sync_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          collection: storeName,
          action: "delete",
          data: { id },
          timestamp: new Date().toISOString()
        });
      }

      tx.oncomplete = () => {
        window.dispatchEvent(new CustomEvent("dbChanged", { detail: { store: storeName, action: "delete", id } }));
        resolve(true);
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async clearStore(storeName) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  // --- Backup Snapshot & Restore ---

  async dumpAll() {
    await this.init();
    const snapshot = {};
    for (const key of Object.values(STORES)) {
      if (key !== STORES.SYNC_QUEUE) {
        snapshot[key] = await this.getAll(key);
      }
    }
    snapshot._meta = {
      exportedAt: new Date().toISOString(),
      systemVersion: "3.5.0",
      totalRecords: Object.values(snapshot).reduce((acc, curr) => acc + (Array.isArray(curr) ? curr.length : 0), 0)
    };
    return snapshot;
  }

  async restoreAll(snapshot) {
    await this.init();
    for (const [storeName, items] of Object.entries(snapshot)) {
      if (storeName.startsWith("_") || storeName === STORES.SYNC_QUEUE) continue;
      if (Object.values(STORES).includes(storeName) && Array.isArray(items)) {
        await this.clearStore(storeName);
        for (const item of items) {
          await this.add(storeName, item, false);
        }
      }
    }
    window.dispatchEvent(new CustomEvent("dbRestored"));
    return true;
  }

  // --- Seed Initial Data ---

  async seedInitialDataIfEmpty() {
    const existingUsers = await this.getAll(STORES.USERS);
    if (existingUsers && existingUsers.length > 0) {
      return;
    }

    console.log("⚡ Initializing fresh, clean School Management Database (Zero Demo Data)...");

    // 1. Clean Starter Classes (Zero students, zero assigned teachers)
    const starterClasses = [
      { id: "cls_01", name: "Class 1", section: "Section A", room: "Room 101", teacherId: "", subjects: ["English", "Mathematics", "Urdu", "General Science"], capacity: 35 },
      { id: "cls_02", name: "Class 2", section: "Section A", room: "Room 102", teacherId: "", subjects: ["English", "Mathematics", "Urdu", "General Science"], capacity: 35 },
      { id: "cls_09", name: "Grade 9", section: "Science", room: "Hall 201", teacherId: "", subjects: ["Mathematics", "Physics", "Chemistry", "Biology", "English", "Urdu"], capacity: 40 },
      { id: "cls_10", name: "Grade 10", section: "Science", room: "Hall 202", teacherId: "", subjects: ["Mathematics", "Physics", "Chemistry", "Biology", "English", "Urdu"], capacity: 40 }
    ];
    for (const c of starterClasses) await this.add(STORES.CLASSES, c, false);

    // 2. Default Master Administrator Account
    const defaultAdmin = {
      id: "usr_admin",
      name: "Principal / Administrator",
      email: "admin@school.com",
      cnic: "42101-1111111-1",
      phone: "0300-1111111",
      password: "admin",
      role: "admin",
      createdAt: new Date().toISOString()
    };
    await this.add(STORES.USERS, defaultAdmin, false);

    console.log("✅ Fresh, clean School Management Database initialized successfully (0 demo records)!");
  }

  // --- Reset Entire Database to Clean Slate (Purge all records, keep Admin only) ---
  async clearAllDataKeepAdmin() {
    await this.init();
    const storesToClear = [
      STORES.STUDENTS,
      STORES.TEACHERS,
      STORES.FEES,
      STORES.ATTENDANCE,
      STORES.GRADES,
      STORES.NOTICES,
      STORES.INQUIRIES,
      STORES.ONLINE_PAYMENTS,
      STORES.EXPENSES,
      STORES.SALARIES,
      STORES.DISCOUNTS,
      STORES.TIMETABLES,
      STORES.DATESHEETS,
      STORES.BOOKS,
      STORES.BOOK_ISSUES,
      STORES.STAFF_ATTENDANCE,
      STORES.LEAVES,
      STORES.SYNC_QUEUE
    ];

    for (const store of storesToClear) {
      await this.clear(store);
    }

    // Keep only admin user account
    const allUsers = await this.getAll(STORES.USERS);
    const adminUsers = allUsers.filter(u => u.role === "admin");
    await this.clear(STORES.USERS);

    if (adminUsers.length > 0) {
      for (const a of adminUsers) await this.add(STORES.USERS, a, false);
    } else {
      await this.add(STORES.USERS, {
        id: "usr_admin",
        name: "Principal / Administrator",
        email: "admin@school.com",
        cnic: "42101-1111111-1",
        phone: "0300-1111111",
        password: "admin",
        role: "admin",
        createdAt: new Date().toISOString()
      }, false);
    }

    // Starter classes
    const starterClasses = [
      { id: "cls_01", name: "Class 1", section: "Section A", room: "Room 101", teacherId: "", subjects: ["English", "Mathematics", "Urdu", "General Science"], capacity: 35 },
      { id: "cls_02", name: "Class 2", section: "Section A", room: "Room 102", teacherId: "", subjects: ["English", "Mathematics", "Urdu", "General Science"], capacity: 35 },
      { id: "cls_09", name: "Grade 9", section: "Science", room: "Hall 201", teacherId: "", subjects: ["Mathematics", "Physics", "Chemistry", "Biology", "English", "Urdu"], capacity: 40 },
      { id: "cls_10", name: "Grade 10", section: "Science", room: "Hall 202", teacherId: "", subjects: ["Mathematics", "Physics", "Chemistry", "Biology", "English", "Urdu"], capacity: 40 }
    ];
    for (const c of starterClasses) await this.add(STORES.CLASSES, c, false);
  }
}

export const db = new LocalDatabase();
