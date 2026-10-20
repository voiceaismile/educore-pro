/**
 * =========================================================================
 * 🌐 EDUCORE PRO — Internationalization (i18n) Module
 * English / Urdu language system. Translations are pure data; the active
 * language lives in localStorage ("educore_lang", default "en").
 * Urdu strings are proper Urdu script (NOT Roman Urdu), kept short for UI.
 * =========================================================================
 */

/** All UI translations, keyed by language then key. */
export const TRANSLATIONS = {
  en: {
    // --- Navigation ---
    nav_dashboard: "Dashboard",
    nav_students: "Students",
    nav_teachers: "Teachers",
    nav_classes: "Classes",
    nav_attendance: "Attendance",
    nav_fees: "Fees",
    nav_exams: "Exams",
    nav_library: "Library",
    nav_transport: "Transport",
    nav_expenses: "Expenses",
    nav_payroll: "Payroll",
    nav_timetable: "Timetable",
    nav_homework: "Homework",
    nav_admissions: "Admissions",
    nav_settings: "Settings",

    // --- Buttons ---
    btn_save: "Save",
    btn_cancel: "Cancel",
    btn_delete: "Delete",
    btn_edit: "Edit",
    btn_add: "Add",
    btn_search: "Search",
    btn_print: "Print",
    btn_verify: "Verify",
    btn_reject: "Reject",
    btn_submit: "Submit",
    btn_close: "Close",
    btn_view: "View",
    btn_download: "Download",

    // --- Fee terms ---
    fee_pending: "Pending",
    fee_paid: "Paid",
    fee_overdue: "Overdue",
    fee_invoice: "Invoice",
    fee_receipt: "Receipt",
    fee_amount: "Amount",
    fee_due_date: "Due Date",
    fee_issue_invoice: "Issue Invoice",
    fee_type: "Fee Type",
    fee_total_outstanding: "Total Outstanding",
    fee_mark_paid: "Mark Paid",
    fee_record_online: "Record Online Payment",
    fee_payment_method: "Payment Method",
    fee_transaction_id: "Transaction ID",
    fee_pending_verifications: "Pending Verifications",

    // --- Dashboard ---
    dash_total_students: "Total Students",
    dash_total_teachers: "Total Teachers",
    dash_total_classes: "Total Classes",
    dash_fee_collected: "Fee Collected",
    dash_fee_pending: "Fee Pending",
    dash_attendance_today: "Today's Attendance",
    dash_new_admissions: "New Admissions",
    dash_revenue: "Revenue",

    // --- Common fields ---
    field_name: "Name",
    field_phone: "Phone",
    field_address: "Address",
    field_date: "Date",
    field_status: "Status",
    field_actions: "Actions",
    field_class: "Class",
    field_roll_no: "Roll No",
    field_admission_no: "Admission No",
    field_father_name: "Father Name",
    field_date_of_birth: "Date of Birth",
    field_gender: "Gender",

    // --- Students ---
    student_add: "Add Student",
    student_list: "Student List",

    // --- PWA ---
    pwa_install_app: "Install App",
    pwa_install_desc: "Install for quick access",
    pwa_install: "Install",
    pwa_dismiss: "Dismiss",

    // --- Misc ---
    misc_welcome: "Welcome",
    misc_logout: "Logout",
    misc_language: "Language",
    misc_loading: "Loading…",
    misc_no_data: "No data found",
    misc_success: "Success",
    misc_error: "Error",
    misc_confirm: "Confirm",
    misc_yes: "Yes",
    misc_no: "No",

    // --- Attendance / Exams / Settings extras ---
    att_present: "Present",
    att_absent: "Absent",
    att_leave: "Leave",
    exam_add: "Add Exam",
    exam_marks: "Marks",
    exam_grade: "Grade",
    exam_result: "Result",
    set_general: "General",
    set_school_name: "School Name",
    dash_welcome_back: "Welcome back"
  },

  ur: {
    // --- Navigation ---
    nav_dashboard: "ڈیش بورڈ",
    nav_students: "طلبہ",
    nav_teachers: "اساتذہ",
    nav_classes: "جماعتیں",
    nav_attendance: "حاضری",
    nav_fees: "فیس",
    nav_exams: "امتحانات",
    nav_library: "لائبریری",
    nav_transport: "ٹرانسپورٹ",
    nav_expenses: "اخراجات",
    nav_payroll: "تنخواہیں",
    nav_timetable: "ٹائم ٹیبل",
    nav_homework: "ہوم ورک",
    nav_admissions: "داخلے",
    nav_settings: "ترتیبات",

    // --- Buttons ---
    btn_save: "محفوظ کریں",
    btn_cancel: "منسوخ کریں",
    btn_delete: "حذف کریں",
    btn_edit: "ترمیم",
    btn_add: "شامل کریں",
    btn_search: "تلاش",
    btn_print: "پرنٹ",
    btn_verify: "تصدیق کریں",
    btn_reject: "مسترد کریں",
    btn_submit: "جمع کرائیں",
    btn_close: "بند کریں",
    btn_view: "دیکھیں",
    btn_download: "ڈاؤن لوڈ",

    // --- Fee terms ---
    fee_pending: "زیر التواء",
    fee_paid: "ادا شدہ",
    fee_overdue: "واجب الادا",
    fee_invoice: "چالان",
    fee_receipt: "رسید",
    fee_amount: "رقم",
    fee_due_date: "آخری تاریخ",
    fee_issue_invoice: "چالان جاری کریں",
    fee_type: "فیس کی قسم",
    fee_total_outstanding: "کل بقایا",
    fee_mark_paid: "ادا شدہ کریں",
    fee_record_online: "آن لائن ادائیگی درج کریں",
    fee_payment_method: "ادائیگی کا طریقہ",
    fee_transaction_id: "ٹرانزیکشن آئی ڈی",
    fee_pending_verifications: "زیر التواء تصدیقات",

    // --- Dashboard ---
    dash_total_students: "کل طلبہ",
    dash_total_teachers: "کل اساتذہ",
    dash_total_classes: "کل جماعتیں",
    dash_fee_collected: "وصول شدہ فیس",
    dash_fee_pending: "بقایا فیس",
    dash_attendance_today: "آج کی حاضری",
    dash_new_admissions: "نئے داخلے",
    dash_revenue: "آمدنی",

    // --- Common fields ---
    field_name: "نام",
    field_phone: "فون",
    field_address: "پتہ",
    field_date: "تاریخ",
    field_status: "حیثیت",
    field_actions: "عمل",
    field_class: "جماعت",
    field_roll_no: "رول نمبر",
    field_admission_no: "داخلہ نمبر",
    field_father_name: "والد کا نام",
    field_date_of_birth: "تاریخ پیدائش",
    field_gender: "صنف",

    // --- Students ---
    student_add: "طالب علم شامل کریں",
    student_list: "طلبہ کی فہرست",

    // --- PWA ---
    pwa_install_app: "ایپ انسٹال کریں",
    pwa_install_desc: "تیز رسائی کے لیے ایپ انسٹال کریں",
    pwa_install: "انسٹال کریں",
    pwa_dismiss: "بند کریں",

    // --- Misc ---
    misc_welcome: "خوش آمدید",
    misc_logout: "لاگ آؤٹ",
    misc_language: "زبان",
    misc_loading: "لوڈ ہو رہا ہے…",
    misc_no_data: "کوئی ڈیٹا نہیں ملا",
    misc_success: "کامیاب",
    misc_error: "خرابی",
    misc_confirm: "تصدیق کریں",
    misc_yes: "جی ہاں",
    misc_no: "نہیں",

    // --- Attendance / Exams / Settings extras ---
    att_present: "حاضر",
    att_absent: "غیر حاضر",
    att_leave: "چھٹی",
    exam_add: "امتحان شامل کریں",
    exam_marks: "نمبرات",
    exam_grade: "گریڈ",
    exam_result: "نتیجہ",
    set_general: "عام",
    set_school_name: "اسکول کا نام",
    dash_welcome_back: "خوش آمدید"
  }
};

const LANG_KEY = "educore_lang";
const SUPPORTED = ["en", "ur"];

/** Current language code ("en" | "ur"). */
export function getLanguage() {
  try {
    const l = localStorage.getItem(LANG_KEY);
    return SUPPORTED.includes(l) ? l : "en";
  } catch (e) {
    return "en";
  }
}

/**
 * Switch language, persist it, and notify the app.
 * App views should re-render on the "languageChanged" event.
 */
export function setLanguage(lang) {
  if (!SUPPORTED.includes(lang)) return false;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch (e) {}
  document.documentElement.setAttribute("lang", lang);
  document.documentElement.setAttribute("dir", lang === "ur" ? "rtl" : "ltr");
  window.dispatchEvent(new CustomEvent("languageChanged", { detail: { lang } }));
  return true;
}

/**
 * Translate a key in the current language.
 * Falls back to English, then to the key itself.
 */
export function t(key) {
  const lang = getLanguage();
  const table = TRANSLATIONS[lang] || TRANSLATIONS.en;
  if (table[key] != null) return table[key];
  if (TRANSLATIONS.en[key] != null) return TRANSLATIONS.en[key];
  return key;
}

/** True when the active language is Urdu (right-to-left). */
export function isRTL() {
  return getLanguage() === "ur";
}

/**
 * Translate all static elements carrying data-i18n="key".
 * Sets textContent to the translated string.
 */
export function applyI18nToStatic(root) {
  const scope = root || document;
  scope.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) el.textContent = t(key);
  });
}
