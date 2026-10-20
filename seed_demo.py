#!/usr/bin/env python3
"""Seed realistic demo data for EDUCORE PRO — Al-Noor Grammar School (fictional)."""
import json, urllib.request, time, random

BASE = "https://schoolmangementpanel-default-rtdb.firebaseio.com"
AVATAR_BASE = "assets/demo-avatars"

def put(path, data):
    req = urllib.request.Request(f"{BASE}/{path}.json", data=json.dumps(data).encode(), method="PUT")
    urllib.request.urlopen(req, timeout=20)

random.seed(42)

# --- Teachers ---
teacher_names = [
    ("Ayesha Khan", "Mathematics", "Female"),
    ("Muhammad Imran", "English", "Male"),
    ("Fatima Raza", "Urdu", "Female"),
    ("Ali Hassan", "Science", "Male"),
    ("Sana Malik", "Islamiat", "Female"),
    ("Usman Tariq", "Computer Science", "Male"),
    ("Hina Shahid", "Nazra Quran", "Female"),
    ("Bilal Ahmed", "Social Studies", "Male"),
]
teachers = {}
for i, (name, subject, gender) in enumerate(teacher_names, 1):
    tid = f"tch_2026_{i:03d}"
    teachers[tid] = {
        "id": tid,
        "name": name,
        "subject": subject,
        "gender": gender,
        "phone": f"0300-{1000000 + i * 123456 % 8999999}",
        "cnic": f"33100-{1000000 + i * 76543 % 8999999}-{i % 10}",
        "photo": f"{AVATAR_BASE}/teacher{i}.jpg",
        "qualification": "M.A." if i % 2 == 0 else "B.Ed.",
        "joiningDate": "2024-04-01",
        "salary": 35000 + (i * 2000),
        "status": "Active",
    }

# --- Students ---
first_names_b = ["Ahmed", "Ali", "Usman", "Bilal", "Hamza", "Danish", "Fahad", "Saad", "Umar", "Talha", "Zain", "Arslan"]
first_names_g = ["Ayesha", "Fatima", "Sana", "Hina", "Mahnoor", "Iqra", "Zainab", "Maryam", "Areeba", "Laiba", "Saba", "Rabia"]
last_names = ["Khan", "Ahmed", "Malik", "Raza", "Hussain", "Sheikh", "Butt", "Chaudhry", "Farooq", "Iqbal", "Nawaz", "Siddiqui"]
classes = [("Class 1", "Section A"), ("Class 1", "Section B"), ("Class 2", "Section A"), ("Class 3", "Section A")]

students = {}
for i in range(1, 25):
    is_boy = i % 2 == 1
    fn = random.choice(first_names_b if is_boy else first_names_g)
    ln = random.choice(last_names)
    cls, sec = classes[(i - 1) % len(classes)]
    sid = f"stu_2026_{i:03d}"
    students[sid] = {
        "id": sid,
        "name": f"{fn} {ln}",
        "gender": "Male" if is_boy else "Female",
        "admissionNo": f"ADM-2026-{600 + i}",
        "rollNo": f"{cls.split()[1]}-{i:02d}",
        "className": cls,
        "section": sec,
        "dob": f"201{7 + (i % 3)}-0{(i % 9) + 1}-1{(i % 9) + 1}",
        "bform": f"33101-{1000000 + i * 111111 % 8999999}-{i % 10}",
        "phone": f"0321-{1000000 + i * 222222 % 8999999}",
        "guardian": f"{random.choice(first_names_b)} {ln}",
        "guardianCnic": f"33100-{2000000 + i * 333333 % 7999999}-{(i + 3) % 10}",
        "address": f"House {10 + i}, Street {i % 5 + 1}, Madina Town, Faisalabad",
        "photo": f"{AVATAR_BASE}/student{(i % 12) + 1}.jpg",
        "admissionDate": "2026-04-01",
        "status": "Active",
        "monthlyFee": 2500,
    }

# --- Fee invoices (Oct 2026) ---
fees = {}
for i, (sid, s) in enumerate(list(students.items())[:20], 1):
    fid = f"fee_2026_oct_{i:03d}"
    paid = i % 4 != 0  # 3/4 paid
    fees[fid] = {
        "id": fid,
        "studentId": sid,
        "studentName": s["name"],
        "admissionNo": s["admissionNo"],
        "month": "2026-10",
        "amount": 2500,
        "status": "PAID" if paid else "PENDING",
        "paidDate": "2026-10-05" if paid else None,
        "dueDate": "2026-10-10",
    }

# --- Notices ---
notices = {
    "ntc_001": {"id": "ntc_001", "title": "Parent-Teacher Meeting", "content": "Parent-teacher meeting for Class 1-3 will be held on Saturday, 25 Oct 2026 at 10:00 AM in the school hall. All parents are requested to attend.", "date": "2026-10-18", "audience": "all"},
    "ntc_002": {"id": "ntc_002", "title": "Winter Uniform From November", "content": "Students must wear winter uniform starting 1st November 2026. Available at the school uniform shop.", "date": "2026-10-15", "audience": "all"},
    "ntc_003": {"id": "ntc_003", "title": "Monthly Test Schedule", "content": "Monthly tests for October will start from 28 Oct 2026. Date sheet has been shared with class teachers.", "date": "2026-10-12", "audience": "students"},
}

print("Seeding teachers...")
put("teachers", teachers)
print("Seeding students...")
put("students", students)
print("Seeding fees...")
put("fees", fees)
print("Seeding notices...")
put("notices", notices)
print(f"DONE: {len(teachers)} teachers, {len(students)} students, {len(fees)} invoices, {len(notices)} notices")
