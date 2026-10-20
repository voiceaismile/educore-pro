/**
 * =========================================================================
 * 🔐 EDUCORE AUTHENTICATION & ACCESS CONTROL (PAKISTAN CNIC & PHONE BASED)
 * Supports: CNIC (B-Form) & Mobile Number Login & Registration
 * Works 100% Offline with IndexedDB, Syncs to Firebase Cloud
 * =========================================================================
 */

import { db, STORES } from "./db.js";
import { sessionLock } from "./session-lock.js";

const SESSION_KEY = "educore_active_session";

/**
 * Normalizes phone number into clean Pakistani mobile string (e.g. "03001234567")
 */
export function normalizePhone(phone) {
  if (!phone) return "";
  let digits = phone.toString().replace(/\D/g, "");
  // If starts with 92, replace 923... with 03...
  if (digits.startsWith("92") && digits.length === 12) {
    digits = "0" + digits.slice(2);
  }
  return digits;
}

/**
 * Normalizes CNIC / B-Form into 13 pure digits (e.g. "4210112345671")
 */
export function normalizeCnic(cnic) {
  if (!cnic) return "";
  return cnic.toString().replace(/\D/g, "");
}

/**
 * Formats 13 digits into standard Pakistani CNIC pattern: xxxxx-xxxxxxx-x
 */
export function formatCnic(cnic) {
  const digits = normalizeCnic(cnic);
  if (digits.length !== 13) return cnic || "";
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}

/**
 * Formats 11 digits into standard Pakistani mobile pattern: 03xx-xxxxxxx
 */
export function formatPhone(phone) {
  const digits = normalizePhone(phone);
  if (digits.length !== 11) return phone || "";
  return `${digits.slice(0, 4)}-${digits.slice(4)}`;
}

class AuthManager {
  constructor() {
    this.currentUser = null;
    this.restoreSession();
  }

  restoreSession() {
    try {
      const saved = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
      if (saved) {
        this.currentUser = JSON.parse(saved);
      }
    } catch (e) {
      console.warn("Could not restore session:", e);
      this.currentUser = null;
    }
  }

  getCurrentUser() {
    return this.currentUser;
  }

  isAuthenticated() {
    return !!this.currentUser;
  }

  isAdmin() {
    return this.currentUser && this.currentUser.role === "admin";
  }

  isTeacher() {
    return this.currentUser && this.currentUser.role === "teacher";
  }

  isStudent() {
    return this.currentUser && this.currentUser.role === "student";
  }

  setSession(user, remember = true) {
    this.currentUser = user;
    const str = JSON.stringify(user);
    sessionStorage.setItem(SESSION_KEY, str);
    if (remember) {
      localStorage.setItem(SESSION_KEY, str);
    }
    window.dispatchEvent(new CustomEvent("authStateChanged", { detail: { user } }));
  }

  async logout() {
    // v3.3 — release the admin session lock (best effort, non-blocking)
    try { await sessionLock.release(); } catch (e) {}
    this.currentUser = null;
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
    window.dispatchEvent(new CustomEvent("authStateChanged", { detail: { user: null } }));
  }

  /**
   * Universal Login: Supports CNIC / B-Form, Mobile Phone Number, or Email
   */
  async login(identifier, password, roleHint = null) {
    await db.init();
    const users = await db.getAll(STORES.USERS);

    const rawInput = (identifier || "").trim();
    const cleanLower = rawInput.toLowerCase();
    const inputDigits = rawInput.replace(/\D/g, "");
    const inputPhoneNorm = normalizePhone(rawInput);
    const cleanPass = (password || "").trim();

    if (!rawInput || !cleanPass) {
      throw new Error("Please enter your CNIC / Mobile Number and Password.");
    }

    const match = users.find(u => {
      const uCnicDigits = normalizeCnic(u.cnic);
      const uPhoneNorm = normalizePhone(u.phone);
      const uEmail = (u.email || "").toLowerCase();

      // Check CNIC match (with or without dashes)
      const cnicMatches = inputDigits.length >= 7 && (uCnicDigits === inputDigits || (u.cnic && u.cnic === rawInput));

      // Check Phone match (supports 03xx, +92, or digits)
      const phoneMatches = inputPhoneNorm.length >= 7 && (uPhoneNorm === inputPhoneNorm || uPhoneNorm.endsWith(inputPhoneNorm));

      // Check Email fallback
      const emailMatches = uEmail === cleanLower;

      const identityMatches = cnicMatches || phoneMatches || emailMatches;
      const roleMatches = roleHint ? u.role === roleHint : true;

      return identityMatches && roleMatches;
    });

    if (!match) {
      throw new Error("No account found matching this CNIC / Phone number.");
    }

    if (match.password !== cleanPass) {
      throw new Error("Incorrect password. Please verify and try again.");
    }

    // Attach profile details if teacher or student
    let fullProfile = { ...match };
    if (match.role === "teacher" && match.teacherId) {
      const teacherDetails = await db.getById(STORES.TEACHERS, match.teacherId);
      if (teacherDetails) fullProfile.teacherProfile = teacherDetails;
    } else if (match.role === "student" && match.studentId) {
      const studentDetails = await db.getById(STORES.STUDENTS, match.studentId);
      if (studentDetails) fullProfile.studentProfile = studentDetails;
    }

    // v3.3 — Single admin session: block if another admin is actively logged in
    if (fullProfile.role === "admin") {
      await sessionLock.acquire(fullProfile); // throws if another admin holds the lock
    }

    this.setSession(fullProfile);
    return fullProfile;
  }

  /**
   * Register a new Student based on Student B-Form / CNIC and Phone Number
   */
  async registerStudent(studentData) {
    await db.init();
    const { name, cnic, phone, password, classId, className, rollNo, parentName, parentCnic, gender, dob } = studentData;

    const formattedCnic = formatCnic(cnic);
    const cleanCnicDigits = normalizeCnic(cnic);
    const formattedPhone = formatPhone(phone);
    const cleanPhoneDigits = normalizePhone(phone);

    if (!name || !name.trim()) throw new Error("Student full name is required.");
    if (cleanCnicDigits.length !== 13) throw new Error("Please enter a valid 13-digit Student CNIC / B-Form number.");
    if (cleanPhoneDigits.length < 10) throw new Error("Please enter a valid Pakistani Mobile Number (e.g. 0300-1234567).");
    if (!password || password.trim().length < 3) throw new Error("Password must be at least 3 characters.");

    // Check if CNIC or Phone already registered in USERS store
    const existingUsers = await db.getAll(STORES.USERS);
    if (existingUsers.some(u => normalizeCnic(u.cnic) === cleanCnicDigits)) {
      throw new Error("An account with this CNIC / B-Form is already registered.");
    }
    if (existingUsers.some(u => normalizePhone(u.phone) === cleanPhoneDigits)) {
      throw new Error("An account with this Mobile Phone number is already registered.");
    }

    const studentId = `std_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    const admissionNo = `ADM-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`;

    const newStudentProfile = {
      id: studentId,
      admissionNo,
      name: name.trim(),
      cnic: formattedCnic,
      phone: formattedPhone,
      email: `${cleanCnicDigits}@student.portal`,
      rollNo: rollNo || `R-${Math.floor(10 + Math.random() * 90)}`,
      classId: classId || "cls_10a",
      className: className || "Grade 10 - Section A",
      gender: gender || "Male",
      dob: dob || "2010-01-01",
      parentName: parentName || "Parent / Guardian",
      parentCnic: parentCnic ? formatCnic(parentCnic) : "",
      parentPhone: formattedPhone,
      address: "Enrolled Campus",
      status: "Active",
      photoUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name)}`,
      joinedDate: new Date().toISOString().split("T")[0]
    };

    const newUser = {
      id: `usr_${Date.now()}`,
      name: name.trim(),
      cnic: formattedCnic,
      phone: formattedPhone,
      email: newStudentProfile.email,
      password: password.trim(),
      role: "student",
      studentId: studentId,
      avatar: newStudentProfile.photoUrl
    };

    await db.add(STORES.STUDENTS, newStudentProfile);
    await db.add(STORES.USERS, newUser);

    const fullProfile = { ...newUser, studentProfile: newStudentProfile };
    this.setSession(fullProfile);
    return fullProfile;
  }

  /**
   * Register a new Teacher based on Teacher CNIC and Mobile Phone Number
   */
  async registerTeacher(teacherData) {
    await db.init();
    const { name, cnic, phone, password, subject, qualification, assignedClasses } = teacherData;

    const formattedCnic = formatCnic(cnic);
    const cleanCnicDigits = normalizeCnic(cnic);
    const formattedPhone = formatPhone(phone);
    const cleanPhoneDigits = normalizePhone(phone);

    if (!name || !name.trim()) throw new Error("Faculty member name is required.");
    if (cleanCnicDigits.length !== 13) throw new Error("Please enter a valid 13-digit Teacher CNIC number.");
    if (cleanPhoneDigits.length < 10) throw new Error("Please enter a valid Pakistani Mobile Number (e.g. 0300-1234567).");
    if (!password || password.trim().length < 3) throw new Error("Password must be at least 3 characters.");

    const existingUsers = await db.getAll(STORES.USERS);
    if (existingUsers.some(u => normalizeCnic(u.cnic) === cleanCnicDigits)) {
      throw new Error("An account with this CNIC is already registered.");
    }
    if (existingUsers.some(u => normalizePhone(u.phone) === cleanPhoneDigits)) {
      throw new Error("An account with this Mobile Phone number is already registered.");
    }

    const teacherId = `tch_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
    const employeeId = `EMP-${Math.floor(2000 + Math.random() * 900)}`;

    const newTeacherProfile = {
      id: teacherId,
      employeeId,
      name: name.trim(),
      cnic: formattedCnic,
      phone: formattedPhone,
      email: `${cleanCnicDigits}@faculty.portal`,
      subject: subject || "General Subjects",
      qualification: qualification || "B.Ed / M.Sc.",
      assignedClasses: assignedClasses || ["Grade 10 - Section A"],
      status: "Active",
      joiningDate: new Date().toISOString().split("T")[0],
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`
    };

    const newUser = {
      id: `usr_${Date.now()}`,
      name: name.trim(),
      cnic: formattedCnic,
      phone: formattedPhone,
      email: newTeacherProfile.email,
      password: password.trim(),
      role: "teacher",
      teacherId: teacherId,
      avatar: newTeacherProfile.avatar
    };

    await db.add(STORES.TEACHERS, newTeacherProfile);
    await db.add(STORES.USERS, newUser);

    const fullProfile = { ...newUser, teacherProfile: newTeacherProfile };
    this.setSession(fullProfile);
    return fullProfile;
  }

  /**
   * Helper to log in as the default Master Administrator
   */
  async loginAsMasterAdmin() {
    return await this.login("0300-1111111", "admin", "admin");
  }
}

export const auth = new AuthManager();
