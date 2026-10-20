/**
 * =========================================================================
 * 🏫 EDUCORE PRO - SCHOOL MANAGEMENT SYSTEM
 * WHITE-LABEL & RESELLER CONFIGURATION FILE
 * =========================================================================
 * 
 * TO RESELL OR CUSTOMIZE FOR A NEW SCHOOL:
 * 1. Simply edit the schoolName, tagline, contact info, and currency below.
 * 2. Add the client's Firebase credentials for online backup & sync.
 * 3. Or use the built-in Admin Settings UI to customize and export this file!
 * =========================================================================
 */

export const DEFAULT_CONFIG = {
  // --- 🎓 School Branding ---
  schoolName: "School Management System",
  schoolShortName: "School Portal",
  tagline: "Inspiring Excellence, Fostering Innovation",
  logoText: "EduPortal",
  licenseKey: "", // Active Commercial License Key
  ownerCnic: "",       // Registered Owner CNIC
  establishedYear: "2026",
  academicYear: "2026 - 2027",
  currency: "PKR ", // Pakistan Rupees (PKR / Rs.)

  // --- 📍 Contact Information ---
  contact: {
    email: "admin@school.com",
    phone: "0300-1111111",
    address: "Campus Address, Pakistan",
    website: ""
  },

  // --- 🌐 Public Landing Page Sections (Customizable by Principal / Admin) ---
  landingPage: {
    hero: {
      badge: "Admissions Open for Session 2026 - 2027",
      title: "Inspiring Academic Excellence, Shaping Future Leaders at",
      subtitle: "A premier educational institution committed to intellectual brilliance, character development, state-of-the-art computer & science laboratories, and high-caliber faculty mentorship.",
      session: "2026 - 2027"
    },
    about: {
      pill: "World-Class Infrastructure",
      title: "Designed for Modern Learning",
      subtitle: "Our campus provides holistic educational facilities to foster curiosity, scientific aptitude, and moral integrity.",
      f1_title: "Modern Science Laboratories",
      f1_desc: "Fully equipped Physics, Chemistry, and Biology laboratories enabling hands-on experimental learning according to board curriculum.",
      f2_title: "ICT & Computer Laboratories",
      f2_desc: "High-speed networked computing workstations dedicated to computer science, coding, and technological literacy.",
      f3_title: "Resourceful Library",
      f3_desc: "Thousands of reference books, educational journals, and digital study resources promoting continuous self-learning.",
      f4_title: "Sports & Physical Development",
      f4_desc: "Expansive athletic grounds and dedicated coaches fostering teamwork, sportsmanship, and physical health.",
      f5_title: "Safe Student Transport",
      f5_desc: "Dedicated institutional transport fleet covering all major residential sectors with GPS tracking and trained drivers.",
      f6_title: "Secure & Disciplined Campus",
      f6_desc: "Round-the-clock security personnel, automated attendance tracking, and comprehensive CCTV surveillance across campus."
    },
    programs: {
      pill: "Curriculum & Grades",
      title: "Academic Programs Offered",
      subtitle: "Rigorous educational pathways tailored to cultivate analytical thinking, linguistic fluency, and competitive board preparation.",
      primaryOverview: "Class 1 to Class 8 comprehensive foundational education in English, Mathematics, General Science, and Social Studies.",
      secondaryOverview: "Grade 9 & Grade 10 Science & Computer Science streams with specialized preparation for Board Examinations."
    },
    faculty: {
      pill: "Experienced Educators",
      title: "Our Distinguished Faculty",
      subtitle: "Passionate teachers holding higher qualifications committed to academic rigor, concept building, and individual mentorship.",
      principalMessage: "Our teachers are more than instructors — they are mentors who cultivate critical reasoning, personal discipline, and ethical leadership in every student."
    },
    admission: {
      pill: "Apply Online Today",
      title: "Online Admission Application",
      subtitle: "Take the first step toward quality education. Submit your admission inquiry online and receive an instant application tracking number.",
      session: "Session 2026 - 2027",
      instructions: "Admissions are granted based on merit and evaluation. Bring previous school leaving certificates, B-Form copy, and parent CNIC copy upon interview.",
      hotline: "0300-1111111"
    },
    contact: {
      pill: "Visit Our Campus",
      title: "Get In Touch With Us",
      subtitle: "Our admissions office is open Monday to Saturday from 8:00 AM to 2:00 PM.",
      hours: "Monday to Saturday: 8:00 AM - 2:00 PM",
      address: "Campus Address, Pakistan",
      phone: "0300-1111111",
      email: "admin@school.com",
      mapDirections: "Main Campus Boulevard, Education City"
    }
  },

  // --- 🎨 Appearance & Theme ---
  theme: {
    primaryColor: "#4f46e5", // Modern Royal Indigo
    primaryHover: "#4338ca",
    accentColor: "#06b6d4",  // Cyan/Teal
    successColor: "#10b981", // Emerald
    warningColor: "#f59e0b", // Amber
    dangerColor: "#ef4444",  // Crimson
    sidebarBg: "#0f172a",    // Deep Navy Slate
  },

  // --- 💼 Reseller / Software License Details ---
  reseller: {
    productName: "EduCore School ERP (White-label Edition)",
    version: "3.5.0 Pro",
    licensee: "Commercial Educational License",
    resellerName: "Apex Software Systems",
    supportUrl: "https://support.educore-system.com"
  },

  // --- 🔥 Firebase Configuration (Free Tier Compatible) ---
  // If blank or offline, system runs 100% locally with IndexedDB.
  // When keys are added and internet is available, RTDB & Firestore sync automatically!
  firebase: {
    apiKey: "AIzaSyCFUwRe01ryqA3u0kuyf_BCBjlfp6IQpT4",
    authDomain: "schoolmangementpanel.firebaseapp.com",
    databaseURL: "https://schoolmangementpanel-default-rtdb.firebaseio.com",
    projectId: "schoolmangementpanel",
    storageBucket: "schoolmangementpanel.firebasestorage.app",
    messagingSenderId: "166142224188",
    appId: "1:166142224188:web:f646fe31479e70f432a039",
    measurementId: "G-NG99VCZXB5"
  },

  // Sync settings
  sync: {
    autoSyncOnOnline: true,
    syncIntervalMinutes: 5,
    enableFirestore: true,
    enableRTDB: true
  }
};

/**
 * Load configuration from LocalStorage if user customized it via Admin Panel,
 * otherwise fallback to DEFAULT_CONFIG.
 */
export function getAppConfig() {
  try {
    const saved = localStorage.getItem("educore_app_config");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.currency === "$") parsed.currency = "PKR ";
      const fbConfig = (parsed.firebase && parsed.firebase.apiKey) ? parsed.firebase : DEFAULT_CONFIG.firebase;
      
      const landingPage = {
        ...DEFAULT_CONFIG.landingPage,
        ...(parsed.landingPage || {}),
        hero: { ...DEFAULT_CONFIG.landingPage.hero, ...(parsed.landingPage?.hero || {}) },
        about: { ...DEFAULT_CONFIG.landingPage.about, ...(parsed.landingPage?.about || {}) },
        programs: { ...DEFAULT_CONFIG.landingPage.programs, ...(parsed.landingPage?.programs || {}) },
        faculty: { ...DEFAULT_CONFIG.landingPage.faculty, ...(parsed.landingPage?.faculty || {}) },
        admission: { ...DEFAULT_CONFIG.landingPage.admission, ...(parsed.landingPage?.admission || {}) },
        contact: { ...DEFAULT_CONFIG.landingPage.contact, ...(parsed.landingPage?.contact || {}) }
      };

      return { ...DEFAULT_CONFIG, ...parsed, firebase: fbConfig, landingPage };
    }
  } catch (e) {
    console.warn("Could not read custom config from localStorage:", e);
  }
  return DEFAULT_CONFIG;
}

/**
 * Save updated configuration to LocalStorage and trigger event.
 */
export function saveAppConfig(newConfig) {
  try {
    const current = getAppConfig();
    const mergedLanding = newConfig.landingPage ? {
      ...current.landingPage,
      ...newConfig.landingPage,
      hero: { ...(current.landingPage?.hero || {}), ...(newConfig.landingPage?.hero || {}) },
      about: { ...(current.landingPage?.about || {}), ...(newConfig.landingPage?.about || {}) },
      programs: { ...(current.landingPage?.programs || {}), ...(newConfig.landingPage?.programs || {}) },
      faculty: { ...(current.landingPage?.faculty || {}), ...(newConfig.landingPage?.faculty || {}) },
      admission: { ...(current.landingPage?.admission || {}), ...(newConfig.landingPage?.admission || {}) },
      contact: { ...(current.landingPage?.contact || {}), ...(newConfig.landingPage?.contact || {}) }
    } : current.landingPage;

    const merged = { ...current, ...newConfig, landingPage: mergedLanding };
    localStorage.setItem("educore_app_config", JSON.stringify(merged));
    window.dispatchEvent(new CustomEvent("configUpdated", { detail: merged }));
    return true;
  } catch (e) {
    console.error("Failed to save config:", e);
    return false;
  }
}
