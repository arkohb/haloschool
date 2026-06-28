/* =====================================================================
   HaloSchool — multi-tenant School Management System (SaaS)
   ---------------------------------------------------------------------
   One self-contained Node service (built-in node:sqlite, zero deps) that
   serves the API and all role dashboards. Paystack for MoMo/card fees.
   Same stack & one-click Railway deploy as the rest of the bundle.

   Roles: super (platform), school_admin, teacher, student, parent.
   Every record except School/super is scoped by school_id and isolated.
   ===================================================================== */
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const AUTH_SECRET = process.env.AUTH_SECRET || "change-me-school-secret";
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "";
const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY || "";
const DEFAULT_CURRENCY = process.env.CURRENCY || "GHS";
const APP_URL = process.env.APP_URL || "";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const MAIL_FROM = process.env.MAIL_FROM || "onboarding@resend.dev";
const ARKESEL_API_KEY = process.env.ARKESEL_API_KEY || "";
const SMS_SENDER = (process.env.SMS_SENDER || "HaloSchool").slice(0, 11);

/* ===================== security hardening ===================== */
const NODE_ENV = process.env.NODE_ENV || "development";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
const MAX_BODY = 1024 * 1024; // 1 MB (allows a small school-logo data URL; still anti-DoS)
const CSP = [
  "default-src 'self'", "base-uri 'self'", "object-src 'none'", "frame-ancestors 'self'", "form-action 'self'",
  "img-src 'self' data: https:",
  "script-src 'self' 'unsafe-inline' https://js.paystack.co https://paystack.com https://*.paystack.com https://*.paystack.co",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://paystack.com https://*.paystack.com",
  "font-src 'self' https://fonts.gstatic.com https://paystack.com https://*.paystack.com",
  "connect-src 'self' https://api.paystack.co https://paystack.com https://*.paystack.com https://*.paystack.co",
  "frame-src https://paystack.com https://*.paystack.com https://*.paystack.co",
].join("; ");

if (NODE_ENV === "production" && (AUTH_SECRET === "change-me-school-secret" || AUTH_SECRET.length < 16)) {
  console.error("FATAL: set a strong AUTH_SECRET (16+ random chars) before running in production.");
  process.exit(1);
}

function clientIp(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
}
const _rl = new Map();
function rateLimit(req, bucket, max, windowMs) {
  const key = clientIp(req) + "|" + bucket, now = Date.now();
  let e = _rl.get(key);
  if (!e || now > e.reset) { e = { count: 0, reset: now + windowMs }; _rl.set(key, e); }
  e.count++; return e.count <= max;
}
setInterval(() => { const now = Date.now(); for (const [k, e] of _rl) if (now > e.reset) _rl.delete(k); }, 60000).unref();
function safeEqual(a, b) {
  const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
function securityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(self), camera=(), microphone=()");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", CSP);
}
function applyCors(req, res) {
  const origin = req.headers.origin;
  // IMPORTANT: Always allow authorization and content-type headers
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "authorization,content-type");
  
  // If there's an origin, set CORS headers
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
}
  }
}
/* ============================================================== */

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || __dirname;
const db = new DatabaseSync(path.join(DATA_DIR, "school.db"));
db.exec(`
CREATE TABLE IF NOT EXISTS schools(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, code TEXT UNIQUE NOT NULL, logo TEXT,
  contact_phone TEXT, contact_email TEXT, address TEXT,
  currency TEXT NOT NULL DEFAULT 'GHS',
  status TEXT NOT NULL DEFAULT 'pending',           -- pending|active|suspended
  subscription_status TEXT NOT NULL DEFAULT 'trial',-- trial|active|overdue
  subscription_until TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT, school_id INTEGER,
  role TEXT NOT NULL,                                -- super|school_admin|teacher|student|parent
  name TEXT NOT NULL, login_id TEXT UNIQUE NOT NULL, email TEXT, phone TEXT,
  pass_hash TEXT NOT NULL, salt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',             -- active|pending|suspended
  must_change_pw INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS classes(
  id INTEGER PRIMARY KEY AUTOINCREMENT, school_id INTEGER NOT NULL,
  name TEXT NOT NULL, section TEXT, teacher_id INTEGER, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS teachers(
  id INTEGER PRIMARY KEY AUTOINCREMENT, school_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL, qualifications TEXT, employment_status TEXT DEFAULT 'active',
  employment_date TEXT, phone TEXT, subjects TEXT, bio TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS students(
  id INTEGER PRIMARY KEY AUTOINCREMENT, school_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL, admission_no TEXT, class_id INTEGER,
  grade TEXT, section TEXT, parent_user_id INTEGER,
  enrollment_status TEXT DEFAULT 'enrolled', created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS courses(
  id INTEGER PRIMARY KEY AUTOINCREMENT, school_id INTEGER NOT NULL,
  name TEXT NOT NULL, code TEXT, class_id INTEGER, teacher_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS attendance(
  id INTEGER PRIMARY KEY AUTOINCREMENT, school_id INTEGER NOT NULL,
  class_id INTEGER NOT NULL, student_id INTEGER NOT NULL, date TEXT NOT NULL,
  status TEXT NOT NULL, marked_by INTEGER, created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(class_id, student_id, date)
);
CREATE TABLE IF NOT EXISTS exams(
  id INTEGER PRIMARY KEY AUTOINCREMENT, school_id INTEGER NOT NULL,
  name TEXT NOT NULL, term TEXT, class_id INTEGER, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS assignments(
  id INTEGER PRIMARY KEY AUTOINCREMENT, school_id INTEGER NOT NULL,
  course_id INTEGER NOT NULL, teacher_id INTEGER NOT NULL,
  title TEXT NOT NULL, description TEXT, due_date TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS submissions(
  id INTEGER PRIMARY KEY AUTOINCREMENT, assignment_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL, submitted_at TEXT,
  content TEXT, grade REAL, feedback TEXT, marked_at TEXT
);
CREATE TABLE IF NOT EXISTS results(
  id INTEGER PRIMARY KEY AUTOINCREMENT, school_id INTEGER NOT NULL,
  exam_id INTEGER NOT NULL, course_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
  score REAL, max_score REAL DEFAULT 100, grade TEXT, remark TEXT,
  entered_by INTEGER, created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(exam_id, course_id, student_id)
);
CREATE TABLE IF NOT EXISTS timetable(
  id INTEGER PRIMARY KEY AUTOINCREMENT, school_id INTEGER NOT NULL,
  class_id INTEGER NOT NULL, day INTEGER NOT NULL, period INTEGER NOT NULL,
  course_id INTEGER, start_time TEXT, end_time TEXT
);
CREATE TABLE IF NOT EXISTS invoices(
  id INTEGER PRIMARY KEY AUTOINCREMENT, school_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL, term TEXT, title TEXT,
  amount_due_minor INTEGER NOT NULL, amount_paid_minor INTEGER DEFAULT 0,
  due_date TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS payments(
  id INTEGER PRIMARY KEY AUTOINCREMENT, school_id INTEGER NOT NULL,
  invoice_id INTEGER NOT NULL, student_id INTEGER NOT NULL, payer_user_id INTEGER,
  amount_minor INTEGER NOT NULL, currency TEXT, channel TEXT,
  reference TEXT UNIQUE NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  paid_at TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS fee_structures(
  id INTEGER PRIMARY KEY AUTOINCREMENT, school_id INTEGER NOT NULL,
  term TEXT, class_id INTEGER, name TEXT NOT NULL, amount_minor INTEGER NOT NULL,
  due_date TEXT, installments INTEGER DEFAULT 1, late_fee_percent REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS fee_reminders(
  id INTEGER PRIMARY KEY AUTOINCREMENT, school_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL, invoice_id INTEGER,
  reminder_days_before INTEGER DEFAULT 7, last_sent_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT, school_id INTEGER,
  actor_user_id INTEGER, action TEXT, detail TEXT, created_at TEXT DEFAULT (datetime('now'))
);
`);

/* idempotent migration: add report-card config columns to schools if missing */
for (const col of [
  "banner TEXT", "motto TEXT", "head_name TEXT", "head_signature TEXT",
  "report_footer TEXT", "grading_scale TEXT", "report_template TEXT",
  "ca_weight INTEGER DEFAULT 30", "exam_weight INTEGER DEFAULT 70", "next_term TEXT", "academic_year TEXT"
]) {
  try { db.exec(`ALTER TABLE schools ADD COLUMN ${col}`); } catch { /* already exists */ }
}
try { db.exec(`ALTER TABLE classes ADD COLUMN next_class_id INTEGER`); } catch { /* already exists */ }
try { db.exec(`ALTER TABLE students ADD COLUMN report_released_at TEXT`); } catch { /* already exists */ }
for (const col of ["conduct TEXT", "attitude TEXT", "interest TEXT", "class_remark TEXT"]) {
  try { db.exec(`ALTER TABLE students ADD COLUMN ${col}`); } catch { /* already exists */ }
}
for (const col of ["ca_score REAL", "exam_score REAL"]) {
  try { db.exec(`ALTER TABLE results ADD COLUMN ${col}`); } catch { /* already exists */ }
}
for (const col of ["qualifications TEXT", "employment_status TEXT DEFAULT 'active'", "employment_date TEXT", "phone TEXT", "bio TEXT"]) {
  try { db.exec(`ALTER TABLE teachers ADD COLUMN ${col}`); } catch { /* already exists */ }
}
db.exec(`CREATE TABLE IF NOT EXISTS announcements(
  id INTEGER PRIMARY KEY AUTOINCREMENT, school_id INTEGER NOT NULL,
  author_id INTEGER, title TEXT, body TEXT, audience TEXT DEFAULT 'all',
  created_at TEXT DEFAULT (datetime('now'))
);`);

db.exec(`CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT, school_id INTEGER NOT NULL,
  sender_id INTEGER NOT NULL, recipient_id INTEGER NOT NULL,
  subject TEXT, body TEXT NOT NULL, attachment_url TEXT,
  read_at TEXT, created_at TEXT DEFAULT (datetime('now'))
);`);

db.exec(`CREATE TABLE IF NOT EXISTS incidents(
  id INTEGER PRIMARY KEY AUTOINCREMENT, school_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL, teacher_id INTEGER, date TEXT NOT NULL,
  incident_type TEXT NOT NULL, description TEXT, severity TEXT DEFAULT 'minor',
  created_at TEXT DEFAULT (datetime('now'))
);`);

db.exec(`CREATE TABLE IF NOT EXISTS consequences(
  id INTEGER PRIMARY KEY AUTOINCREMENT, school_id INTEGER NOT NULL,
  incident_id INTEGER NOT NULL, consequence_type TEXT NOT NULL,
  description TEXT, start_date TEXT, end_date TEXT, status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);`);

/* seed / self-heal super admin
   Seeds the platform super admin. If a super already exists but
   SUPER_ADMIN_EMAIL + SUPER_ADMIN_PASSWORD are set, the stored login and
   password are re-synced to those env values on every boot. This prevents
   the "stale password" problem where the very first boot generated a random
   password (because the env var wasn't set yet) and later setting the env
   var had no effect. */
(function seedSuper() {
  const email = (process.env.SUPER_ADMIN_EMAIL || "super@haloschool.app").toLowerCase();
  const envPass = process.env.SUPER_ADMIN_PASSWORD;
  const existing = db.prepare("SELECT id, login_id FROM users WHERE role='super' LIMIT 1").get();

  if (existing) {
    if (envPass) {
      const salt = crypto.randomBytes(16).toString("hex");
      const ph = hashPassword(envPass, salt);
      try {
        db.prepare("UPDATE users SET login_id=?, email=?, pass_hash=?, salt=?, status='active' WHERE id=?")
          .run(email, email, ph, salt, existing.id);
      } catch {
        // login_id collision (another user holds that email) — at least reset the password
        db.prepare("UPDATE users SET pass_hash=?, salt=?, status='active' WHERE id=?").run(ph, salt, existing.id);
      }
      console.log("Super admin credentials synced to SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD.");
    }
    return;
  }

  const pass = envPass || crypto.randomBytes(6).toString("hex");
  const salt = crypto.randomBytes(16).toString("hex");
  db.prepare(`INSERT INTO users(school_id,role,name,login_id,email,pass_hash,salt,status)
              VALUES (NULL,'super','Super Admin',?,?,?,?,'active')`)
    .run(email, email, hashPassword(pass, salt), salt);
  console.log("==================================================");
  console.log(" SUPER ADMIN  login: " + email + (envPass ? "  (using SUPER_ADMIN_PASSWORD)" : ("   password: " + pass)));
  console.log(" (set SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD to control this)");
  console.log("==================================================");
})();

/* ---------- helpers ---------- */
function hashPassword(pw, salt) { return crypto.scryptSync(String(pw), salt, 64).toString("hex"); }
function checkPassword(pw, hash, salt) {
  const a = Buffer.from(hashPassword(pw, salt), "hex"), b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function signToken(user) {
  const payload = Buffer.from(JSON.stringify({ id: user.id, exp: Date.now() + 30 * 86400000 })).toString("base64url");
  const sig = crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
  return payload + "." + sig;
}
function userFromToken(token) {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let data; try { data = JSON.parse(Buffer.from(payload, "base64url").toString()); } catch { return null; }
  if (data.exp && Date.now() > data.exp) return null;
  return db.prepare("SELECT * FROM users WHERE id=?").get(data.id) || null;
}
function bearer(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? userFromToken(h.slice(7)) : null;
}
const readBody = (req) => new Promise((resolve) => {
  let d = "", len = 0, done = false;
  req.on("data", (c) => { if (done) return; len += c.length; if (len > MAX_BODY) { done = true; try { req.destroy(); } catch {} return resolve(""); } d += c; });
  req.on("end", () => { if (!done) resolve(d); });
  req.on("error", () => { if (!done) { done = true; resolve(""); } });
});
const jread = async (req) => { try { return JSON.parse((await readBody(req)) || "{}"); } catch { return {}; } };
function json(res, code, obj) {
  if (res.writableEnded || res.destroyed) return;
  try { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); } catch {}
}
function baseUrl(req) { return APP_URL || ((req.headers["x-forwarded-proto"] || "http") + "://" + (req.headers.host || "")); }
const ref = (p) => p + "-" + crypto.randomBytes(5).toString("hex").toUpperCase();
const tempPw = () => crypto.randomBytes(4).toString("hex");
function audit(schoolId, actorId, action, detail) {
  db.prepare("INSERT INTO audit_log(school_id,actor_user_id,action,detail) VALUES (?,?,?,?)")
    .run(schoolId, actorId, action, typeof detail === "string" ? detail : JSON.stringify(detail));
}
function gradeFor(pct) {
  return pct >= 80 ? "A" : pct >= 70 ? "B" : pct >= 60 ? "C" : pct >= 50 ? "D" : pct >= 40 ? "E" : "F";
}
const DEFAULT_GRADING = [
  { min: 80, grade: "A", remark: "Excellent" },
  { min: 70, grade: "B", remark: "Very good" },
  { min: 60, grade: "C", remark: "Good" },
  { min: 50, grade: "D", remark: "Credit" },
  { min: 40, grade: "E", remark: "Pass" },
  { min: 0, grade: "F", remark: "Fail" },
];
function gradingScaleFor(school) {
  try { const g = JSON.parse(school.grading_scale || "null"); if (Array.isArray(g) && g.length) return g; } catch {}
  return DEFAULT_GRADING;
}
function overallRemark(pct, scale) {
  for (const b of scale) if (pct >= b.min) return b.remark || "";
  return "";
}
function schoolCurrency(schoolId) {
  const s = db.prepare("SELECT currency FROM schools WHERE id=?").get(schoolId);
  return s?.currency || DEFAULT_CURRENCY;
}
const money = (m, c = DEFAULT_CURRENCY) => (c === "GHS" ? "₵" : c === "NGN" ? "₦" : c + " ") + (Number(m || 0) / 100).toLocaleString();

/* ---------- Paystack ---------- */
async function verifyPaystack(reference) {
  const r = await fetch("https://api.paystack.co/transaction/verify/" + encodeURIComponent(reference),
    { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } });
  const d = await r.json();
  if (!d.status) throw new Error(d.message || "verify failed");
  return d.data;
}

/* ---------- notifications (optional) ---------- */
async function sendEmail(to, subject, html) {
  if (!to) return;
  if (!RESEND_API_KEY) { console.log(`📨 (no RESEND_API_KEY) email -> ${to}: ${subject}`); return; }
  try { await fetch("https://api.resend.com/emails", { method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, html }) }); } catch {}
}
async function sendSMS(to, text) {
  let p = String(to || "").replace(/[^\d]/g, ""); if (!p) return;
  if (p.startsWith("00")) p = p.slice(2); if (p.startsWith("0")) p = "233" + p.slice(1); else if (p.length === 9) p = "233" + p;
  if (!ARKESEL_API_KEY) { console.log(`📱 (no ARKESEL_API_KEY) SMS -> ${p}: ${text}`); return; }
  try { await fetch("https://sms.arkesel.com/api/v2/sms/send", { method: "POST",
    headers: { "api-key": ARKESEL_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ sender: SMS_SENDER, message: text, recipients: [p] }) }); } catch {}
}
function notify(user, subject, sms, html) {
  if (user?.phone) sendSMS(user.phone, sms).catch(() => {});
  if (user?.email) sendEmail(user.email, subject, html).catch(() => {});
}
const mailWrap = (title, body) =>
  `<div style="font-family:sans-serif;max-width:460px;margin:auto">
     <div style="background:#171410;color:#e0a92b;padding:14px 18px;border-radius:12px 12px 0 0;font-weight:bold;font-size:18px">HaloSchool</div>
     <div style="border:1px solid #e2d6bd;border-top:none;border-radius:0 0 12px 12px;padding:18px"><h2 style="margin:.2em 0">${title}</h2>${body}</div></div>`;

/* create a user with generated credentials; returns {user_id, login_id, password} */
function createUser(schoolId, role, { name, email, phone }, codePrefix) {
  const school = db.prepare("SELECT code FROM schools WHERE id=?").get(schoolId);
  let login = (email || "").trim().toLowerCase();
  if (!login || db.prepare("SELECT id FROM users WHERE login_id=?").get(login)) {
    login = `${school.code}-${codePrefix}${crypto.randomBytes(2).toString("hex")}`.toLowerCase();
  }
  const pw = tempPw(), salt = crypto.randomBytes(16).toString("hex");
  const r = db.prepare(`INSERT INTO users(school_id,role,name,login_id,email,phone,pass_hash,salt,status,must_change_pw)
                        VALUES (?,?,?,?,?,?,?,?,'active',1)`)
    .run(schoolId, role, name, login, email || null, phone || null, hashPassword(pw, salt), salt);
  return { user_id: r.lastInsertRowid, login_id: login, password: pw };
}
function sendCredentials(schoolId, name, contact, login, pw, base) {
  const link = base ? `${base}/` : "";
  const sms = `HaloSchool: account created for ${name}. Login: ${login}  Temp password: ${pw}${link ? "  " + link : ""}`;
  notify(contact, "Your HaloSchool login", sms,
    mailWrap("Your login details", `<p>An account was created for <b>${name}</b>.</p>
      <p>Login ID: <b>${login}</b><br>Temporary password: <b>${pw}</b></p>
      <p>You'll be asked to change the password on first sign-in.${link ? ` <a href="${link}">Open HaloSchool</a>` : ""}</p>`));
}

/* =====================================================================
   HTTP server
   ===================================================================== */
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon" };
const PAGES = { "/": "index.html", "/index.html": "index.html", "/super": "super.html", "/super.html": "super.html", "/admin": "admin.html", "/admin.html": "admin.html",
  "/teacher": "teacher.html", "/teacher.html": "teacher.html", "/student": "student.html", "/student.html": "student.html", "/parent": "parent.html", "/parent.html": "parent.html" };
function serveStatic(res, pathname) {
  const rel = PAGES[pathname] || pathname.replace(/^\/+/, "");
  const full = path.join(__dirname, "public", rel);
  if (!full.startsWith(path.join(__dirname, "public"))) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/html" }); return res.end("<h1>404</h1>"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream" }); res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  securityHeaders(res);
  applyCors(req, res);
  const url = new URL(req.url, "http://x");
  const p = url.pathname, q = url.searchParams;
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  // throttle auth + payment endpoints per IP (brute-force / abuse guard)
  if (/login|signup/.test(p) && req.method === "POST") {
    if (!rateLimit(req, "auth", 12, 5 * 60 * 1000)) return json(res, 429, { error: "Too many attempts. Please wait a few minutes and try again." });
  } else if (p.startsWith("/api/invoices") || p === "/api/pay/verify") {
    if (!rateLimit(req, "pay", 40, 5 * 60 * 1000)) return json(res, 429, { error: "Too many requests, please slow down." });
  }

  try {
    if (p === "/health") return json(res, 200, { ok: true, time: new Date().toISOString() });
    if (p === "/api/config") return json(res, 200, { publicKey: PAYSTACK_PUBLIC_KEY, currency: DEFAULT_CURRENCY });

    /* ---------------- AUTH ---------------- */
    if (req.method === "POST" && p === "/api/school/signup") {
      const b = await jread(req);
      const sname = String(b.school_name || "").trim(), aname = String(b.admin_name || "").trim();
      const email = String(b.email || "").trim().toLowerCase(), pw = String(b.password || "");
      if (!sname || !aname || !email || pw.length < 6) return json(res, 400, { error: "school name, your name, email and a 6+ char password are required" });
      if (db.prepare("SELECT id FROM users WHERE login_id=?").get(email)) return json(res, 409, { error: "that email is already registered" });
      let code = sname.replace(/[^a-z0-9]/gi, "").slice(0, 5).toUpperCase() || "SCH";
      while (db.prepare("SELECT id FROM schools WHERE code=?").get(code)) code += crypto.randomBytes(1).toString("hex").slice(0, 1).toUpperCase();
      const sr = db.prepare("INSERT INTO schools(name,code,contact_email,contact_phone,status) VALUES (?,?,?,?,'pending')")
        .run(sname, code, email, String(b.phone || "").trim());
      const salt = crypto.randomBytes(16).toString("hex");
      db.prepare(`INSERT INTO users(school_id,role,name,login_id,email,phone,pass_hash,salt,status)
                  VALUES (?,'school_admin',?,?,?,?,?,?,'pending')`)
        .run(sr.lastInsertRowid, aname, email, email, String(b.phone || "").trim(), hashPassword(pw, salt), salt);
      return json(res, 200, { ok: true, message: "School registered. A platform super admin must approve it before you can sign in." });
    }

    if (req.method === "POST" && p === "/api/login") {
      const b = await jread(req);
      const login = String(b.login_id || "").trim().toLowerCase();
      const u = db.prepare("SELECT * FROM users WHERE login_id=?").get(login);
      if (!u || !checkPassword(String(b.password || ""), u.pass_hash, u.salt)) return json(res, 401, { error: "wrong login ID or password" });
      if (u.status === "suspended") return json(res, 403, { error: "your account is suspended" });
      if (u.status === "pending") return json(res, 403, { error: "your school is awaiting super-admin approval" });
      if (u.role !== "super") {
        const s = db.prepare("SELECT status FROM schools WHERE id=?").get(u.school_id);
        if (s?.status === "pending") return json(res, 403, { error: "your school is awaiting super-admin approval" });
        if (s?.status === "suspended") return json(res, 403, { error: "this school is suspended" });
      }
      return json(res, 200, { token: signToken(u), role: u.role, name: u.name, must_change_pw: !!u.must_change_pw });
    }

    /* everything below needs a user */
    const me = bearer(req);
    const need = (...roles) => { if (!me) { json(res, 401, { error: "unauthorized" }); return false; }
      if (!roles.includes(me.role)) { json(res, 403, { error: "forbidden" }); return false; } return true; };

    if (req.method === "GET" && p === "/api/me") {
      if (!me) return json(res, 401, { error: "unauthorized" });
      const school = me.school_id ? db.prepare("SELECT id,name,code,logo,address,contact_phone,contact_email,currency,status,subscription_status FROM schools WHERE id=?").get(me.school_id) : null;
      return json(res, 200, { id: me.id, role: me.role, name: me.name, login_id: me.login_id, must_change_pw: !!me.must_change_pw, school });
    }
    if (req.method === "POST" && p === "/api/change-password") {
      if (!me) return json(res, 401, { error: "unauthorized" });
      const b = await jread(req);
      if (String(b.password || "").length < 6) return json(res, 400, { error: "new password must be at least 6 characters" });
      const salt = crypto.randomBytes(16).toString("hex");
      db.prepare("UPDATE users SET pass_hash=?, salt=?, must_change_pw=0 WHERE id=?").run(hashPassword(b.password, salt), salt, me.id);
      return json(res, 200, { ok: true });
    }

    /* ================= SUPER ADMIN ================= */
    if (p.startsWith("/api/super/")) {
      if (!need("super")) return;
      if (req.method === "GET" && p === "/api/super/overview") {
        const schools = db.prepare(`SELECT s.*,
            (SELECT COUNT(*) FROM users u WHERE u.school_id=s.id AND u.role='student') students,
            (SELECT COUNT(*) FROM users u WHERE u.school_id=s.id AND u.role='teacher') teachers
          FROM schools s ORDER BY s.created_at DESC`).all();
        const counts = {
          schools: schools.length,
          pending: schools.filter((s) => s.status === "pending").length,
          students: db.prepare("SELECT COUNT(*) n FROM users WHERE role='student'").get().n,
          fees_collected: db.prepare("SELECT COALESCE(SUM(amount_minor),0) s FROM payments WHERE status='paid'").get().s,
        };
        return json(res, 200, { counts, schools });
      }
      const m = p.match(/^\/api\/super\/schools\/(\d+)\/(approve|suspend|activate)$/);
      if (req.method === "POST" && m) {
        const id = Number(m[1]), status = m[2] === "suspend" ? "suspended" : "active";
        db.prepare("UPDATE schools SET status=? WHERE id=?").run(status, id);
        if (m[2] !== "suspend") db.prepare("UPDATE users SET status='active' WHERE school_id=? AND role='school_admin' AND status='pending'").run(id);
        return json(res, 200, { ok: true, status });
      }
      return json(res, 404, { error: "not found" });
    }

    const S = me ? me.school_id : null;   // tenant scope for everything below

    /* ================= SCHOOL ADMIN ================= */
    if (p.startsWith("/api/admin/")) {
      if (!need("school_admin")) return;
      const base = baseUrl(req);

      if (p === "/api/admin/school") {
        const SEL = "SELECT id,name,code,logo,contact_phone,contact_email,address,currency,banner,motto,head_name,head_signature,report_footer,grading_scale,report_template,ca_weight,exam_weight,next_term,academic_year FROM schools WHERE id=?";
        if (req.method === "GET") {
          return json(res, 200, { school: db.prepare(SEL).get(S) });
        }
        if (req.method === "PUT") {
          const b = await jread(req);
          const fields = ["name", "logo", "contact_phone", "contact_email", "address", "currency", "banner", "motto", "head_name", "head_signature", "report_footer", "grading_scale", "report_template", "ca_weight", "exam_weight", "next_term", "academic_year"];
          const cols = fields.filter((f) => b[f] !== undefined);
          if (cols.length) {
            db.prepare(`UPDATE schools SET ${cols.map((f) => f + "=?").join(",")} WHERE id=?`).run(...cols.map((f) => b[f] ?? null), S);
            audit(S, me.id, "update_school", { fields: cols });
          }
          return json(res, 200, { ok: true, school: db.prepare(SEL).get(S) });
        }
      }

      if (req.method === "POST" && p === "/api/admin/announcements") {
        const b = await jread(req);
        const audience = ["all", "parents", "students", "teachers"].includes(b.audience) ? b.audience : "all";
        if (!(b.title || "").trim()) return json(res, 400, { error: "title required" });
        const info = db.prepare("INSERT INTO announcements(school_id,author_id,title,body,audience) VALUES (?,?,?,?,?)")
          .run(S, me.id, String(b.title).slice(0, 200), String(b.body || "").slice(0, 4000), audience);
        let sent = 0;
        if (b.broadcast) {
          const roles = audience === "all" ? ["parent", "student", "teacher"] : audience === "parents" ? ["parent"] : audience === "students" ? ["student"] : ["teacher"];
          const ph = roles.map(() => "?").join(",");
          const users = db.prepare(`SELECT email,phone FROM users WHERE school_id=? AND role IN (${ph}) AND (phone IS NOT NULL OR email IS NOT NULL)`).all(S, ...roles);
          const sch = db.prepare("SELECT name FROM schools WHERE id=?").get(S);
          const sms = `${sch.name}: ${b.title}. ${String(b.body || "").slice(0, 200)}`;
          const html = mailWrap(String(b.title), `<p>${String(b.body || "").replace(/</g, "&lt;")}</p>`);
          for (const u of users) { notify(u, String(b.title), sms, html); sent++; }
        }
        audit(S, me.id, "announcement", { id: info.lastInsertRowid, audience, broadcast: !!b.broadcast, sent });
        return json(res, 200, { ok: true, id: info.lastInsertRowid, sent });
      }
      const mDelAnn = p.match(/^\/api\/admin\/announcements\/(\d+)$/);
      if (req.method === "DELETE" && mDelAnn) {
        db.prepare("DELETE FROM announcements WHERE id=? AND school_id=?").run(Number(mDelAnn[1]), S);
        return json(res, 200, { ok: true });
      }

      const mRemarks = p.match(/^\/api\/admin\/students\/(\d+)\/remarks$/);
      if (req.method === "PUT" && mRemarks) {
        const sid = Number(mRemarks[1]);
        const st = db.prepare("SELECT id FROM students WHERE id=? AND school_id=?").get(sid, S);
        if (!st) return json(res, 404, { error: "student not found" });
        const b = await jread(req);
        const f = ["conduct", "attitude", "interest", "class_remark"].filter((k) => b[k] !== undefined);
        if (f.length) db.prepare(`UPDATE students SET ${f.map((k) => k + "=?").join(",")} WHERE id=?`).run(...f.map((k) => b[k] ?? null), sid);
        return json(res, 200, { ok: true });
      }

      const mNotifyRep = p.match(/^\/api\/admin\/students\/(\d+)\/send-report$/);
      if (req.method === "POST" && mNotifyRep) {
        const sid = Number(mNotifyRep[1]);
        const st = db.prepare(`SELECT s.id, u.name sname, pu.name pname, pu.email pemail, pu.phone pphone,
          u.email semail, u.phone sphone FROM students s JOIN users u ON u.id=s.user_id
          LEFT JOIN users pu ON pu.id=s.parent_user_id WHERE s.id=? AND s.school_id=?`).get(sid, S);
        if (!st) return json(res, 404, { error: "student not found" });
        const sch = db.prepare("SELECT name FROM schools WHERE id=?").get(S);
        const base = baseUrl(req);
        const sms = `${sch.name}: ${st.sname}'s term report card is ready. Sign in to view & download: ${base}`;
        const html = mailWrap("Term report ready", `<p><b>${st.sname}'s</b> term report card is now available on your HaloSchool dashboard.</p><p>Sign in to view and download it.</p><p><a href="${base}">${base}</a></p>`);
        let recipients = 0;
        if (st.pemail || st.pphone) { notify({ email: st.pemail, phone: st.pphone }, "Term report ready", sms, html); recipients++; }
        if (st.semail || st.sphone) { notify({ email: st.semail, phone: st.sphone }, "Term report ready", sms, html); recipients++; }
        db.prepare("UPDATE students SET report_released_at=datetime('now') WHERE id=?").run(sid);
        audit(S, me.id, "send_report", { student_id: sid, recipients });
        return json(res, 200, { ok: true, recipients });
      }

      if (req.method === "GET" && p === "/api/admin/overview") {
        return json(res, 200, {
          students: db.prepare("SELECT COUNT(*) n FROM students WHERE school_id=?").get(S).n,
          teachers: db.prepare("SELECT COUNT(*) n FROM teachers WHERE school_id=?").get(S).n,
          classes: db.prepare("SELECT COUNT(*) n FROM classes WHERE school_id=?").get(S).n,
          fees_due: db.prepare("SELECT COALESCE(SUM(amount_due_minor-amount_paid_minor),0) s FROM invoices WHERE school_id=? AND status!='paid'").get(S).s,
          fees_paid: db.prepare("SELECT COALESCE(SUM(amount_paid_minor),0) s FROM invoices WHERE school_id=?").get(S).s,
        });
      }

      if (p === "/api/admin/teachers") {
        if (req.method === "GET")
          return json(res, 200, { teachers: db.prepare(`SELECT t.id,t.qualifications,t.employment_status,t.employment_date,t.phone,t.subjects,t.bio,u.name,u.login_id,u.email,u.status,
            (SELECT COUNT(*) FROM classes WHERE teacher_id=t.id) classes,
            (SELECT COUNT(*) FROM courses WHERE teacher_id=t.id) courses
            FROM teachers t JOIN users u ON u.id=t.user_id WHERE t.school_id=? ORDER BY u.name`).all(S) });
        if (req.method === "POST") {
          const b = await jread(req);
          if (!b.name) return json(res, 400, { error: "name required" });
          const cred = createUser(S, "teacher", b, "t");
          const tr = db.prepare("INSERT INTO teachers(school_id,user_id,qualifications,employment_status,employment_date,phone,subjects,bio) VALUES (?,?,?,?,?,?,?,?)").run(S, cred.user_id, String(b.qualifications || ""), String(b.employment_status || "active"), b.employment_date || null, b.phone || null, String(b.subjects || ""), String(b.bio || ""));
          sendCredentials(S, b.name, { email: b.email, phone: b.phone }, cred.login_id, cred.password, base);
          audit(S, me.id, "create_teacher", { id: tr.lastInsertRowid, name: b.name });
          return json(res, 200, { ok: true, login_id: cred.login_id, password: cred.password });
        }
      }

      /* ---- teacher profile update ---- */
      const mTeacher = p.match(/^\/api\/admin\/teachers\/(\d+)$/);
      if (req.method === "PUT" && mTeacher) {
        const tid = Number(mTeacher[1]);
        const t = db.prepare("SELECT user_id FROM teachers WHERE id=? AND school_id=?").get(tid, S);
        if (!t) return json(res, 404, { error: "teacher not found" });
        const b = await jread(req);
        const f = ["qualifications", "employment_status", "employment_date", "phone", "subjects", "bio"].filter((k) => b[k] !== undefined);
        if (f.length) db.prepare(`UPDATE teachers SET ${f.map((k) => k + "=?").join(",")} WHERE id=?`).run(...f.map((k) => b[k] ?? null), tid);
        // also update user email/status if provided
        if (b.email || b.status) {
          const uf = [];
          if (b.email) uf.push("email=?");
          if (b.status) uf.push("status=?");
          if (uf.length) db.prepare(`UPDATE users SET ${uf.join(",")} WHERE id=?`).run(b.email || undefined, b.status || undefined, t.user_id).filter(Boolean);
        }
        return json(res, 200, { ok: true });
      }

      if (req.method === "GET" && p === "/api/admin/student-card") {
        const sid = Number(q.get("student_id"));
        if (!sid) return json(res, 400, { error: "student_id required" });
        const st = db.prepare(`SELECT s.id, s.admission_no, u.name, cl.name class_name
          FROM students s JOIN users u ON u.id=s.user_id LEFT JOIN classes cl ON cl.id=s.class_id
          WHERE s.id=? AND s.school_id=?`).get(sid, S);
        if (!st) return json(res, 404, { error: "student not found" });
        const school = db.prepare("SELECT name, logo FROM schools WHERE id=?").get(S);
        return json(res, 200, { student: st, school });
      }

      if (req.method === "GET" && p === "/api/admin/tabulation") {
        const classId = Number(q.get("class_id")), examId = Number(q.get("exam_id"));
        if (!classId) return json(res, 400, { error: "class_id required" });
        const cl = db.prepare("SELECT id, name FROM classes WHERE id=? AND school_id=?").get(classId, S);
        if (!cl) return json(res, 404, { error: "class not found" });
        const exam = examId ? db.prepare("SELECT id, name, term FROM exams WHERE id=? AND school_id=?").get(examId, S) : null;
        // all courses for this class
        const courses = db.prepare("SELECT id, name FROM courses WHERE class_id=? AND school_id=? ORDER BY name").all(classId, S);
        // all students in the class, ordered by average descending (for ranking)
        const students = db.prepare(`SELECT s.id, u.name, s.admission_no
          FROM students s JOIN users u ON u.id=s.user_id
          WHERE s.school_id=? AND s.class_id=? AND s.enrollment_status='enrolled' ORDER BY u.name`).all(S, classId);
        // build results matrix: for each student + course combo, get their marks
        const results = {};
        for (const co of courses) {
          results[co.id] = {};
          if (examId) {
            db.prepare(`SELECT r.student_id, r.score, r.max_score, r.grade, r.ca_score, r.exam_score
              FROM results r WHERE r.exam_id=? AND r.course_id=? AND r.school_id=?`).all(examId, co.id, S).forEach((r) => {
              results[co.id][r.student_id] = r;
            });
          }
        }
        // compute overall average + ranking for each student (across all courses this exam)
        const studentStats = {};
        for (const st of students) {
          let total = 0, count = 0;
          for (const co of courses) {
            const r = results[co.id][st.id];
            if (r && r.score) { total += r.score; count++; }
          }
          const avg = count ? Math.round(total / count * 10) / 10 : null;
          studentStats[st.id] = { average: avg };
        }
        // rank students by average
        const ranked = students.map((st) => ({ ...st, average: studentStats[st.id].average }))
          .sort((a, b) => (b.average || 0) - (a.average || 0))
          .map((st, idx) => ({ ...st, rank: idx + 1 }));
        return json(res, 200, { class: cl, exam, courses, students: ranked, results, school: db.prepare("SELECT name, code FROM schools WHERE id=?").get(S) });
      }

      if (p === "/api/admin/classes") {
        if (req.method === "GET")
          return json(res, 200, { classes: db.prepare(`SELECT c.*, u.name teacher_name,
            (SELECT name FROM classes nc WHERE nc.id=c.next_class_id) next_class_name,
            (SELECT COUNT(*) FROM students s WHERE s.class_id=c.id) students
            FROM classes c LEFT JOIN teachers t ON t.id=c.teacher_id LEFT JOIN users u ON u.id=t.user_id
            WHERE c.school_id=? ORDER BY c.name`).all(S) });
        if (req.method === "POST") {
          const b = await jread(req);
          if (!b.name) return json(res, 400, { error: "class name required" });
          const r = db.prepare("INSERT INTO classes(school_id,name,section,teacher_id) VALUES (?,?,?,?)")
            .run(S, String(b.name), String(b.section || ""), b.teacher_id || null);
          return json(res, 200, { ok: true, id: r.lastInsertRowid });
        }
      }

      const mClass = p.match(/^\/api\/admin\/classes\/(\d+)$/);
      if (req.method === "PUT" && mClass) {
        const cid = Number(mClass[1]);
        const cl = db.prepare("SELECT id FROM classes WHERE id=? AND school_id=?").get(cid, S);
        if (!cl) return json(res, 404, { error: "class not found" });
        const b = await jread(req);
        const f = ["name", "section", "teacher_id", "next_class_id"].filter((k) => b[k] !== undefined);
        if (f.length) db.prepare(`UPDATE classes SET ${f.map((k) => k + "=?").join(",")} WHERE id=?`).run(...f.map((k) => b[k] === "" ? null : b[k]), cid);
        return json(res, 200, { ok: true });
      }

      /* ---- promotion: preview one class ---- */
      if (req.method === "GET" && p === "/api/admin/promote") {
        const cid = Number(q.get("class_id"));
        const cl = db.prepare("SELECT id,name,next_class_id FROM classes WHERE id=? AND school_id=?").get(cid, S);
        if (!cl) return json(res, 404, { error: "class not found" });
        const nextName = cl.next_class_id ? (db.prepare("SELECT name FROM classes WHERE id=?").get(cl.next_class_id)?.name || null) : null;
        const students = db.prepare(`SELECT s.id, u.name, s.admission_no, s.enrollment_status,
            COALESCE((SELECT SUM(amount_due_minor-amount_paid_minor) FROM invoices i WHERE i.student_id=s.id),0) balance_minor
          FROM students s JOIN users u ON u.id=s.user_id
          WHERE s.school_id=? AND s.class_id=? ORDER BY u.name`).all(S, cid);
        return json(res, 200, { class: cl, next_class_name: nextName, students, currency: schoolCurrency(S) });
      }

      /* ---- promotion: apply decisions for one class ---- */
      if (req.method === "POST" && p === "/api/admin/promote") {
        const b = await jread(req);
        const cid = Number(b.class_id);
        const cl = db.prepare("SELECT id,next_class_id FROM classes WHERE id=? AND school_id=?").get(cid, S);
        if (!cl) return json(res, 404, { error: "class not found" });
        const setClass = db.prepare("UPDATE students SET class_id=?, enrollment_status=? WHERE id=? AND school_id=?");
        let promoted = 0, repeated = 0, graduated = 0, withdrawn = 0;
        for (const d of (b.decisions || [])) {
          const sid = Number(d.student_id);
          if (d.action === "promote") {
            if (cl.next_class_id) { setClass.run(cl.next_class_id, "enrolled", sid, S); promoted++; }
            else { setClass.run(null, "graduated", sid, S); graduated++; }
          } else if (d.action === "graduate") { setClass.run(null, "graduated", sid, S); graduated++; }
          else if (d.action === "withdraw") { setClass.run(null, "withdrawn", sid, S); withdrawn++; }
          else { repeated++; } // repeat = leave as-is
        }
        if (b.reset_term) db.prepare("UPDATE students SET report_released_at=NULL,conduct=NULL,attitude=NULL,interest=NULL,class_remark=NULL WHERE class_id IS NOT NULL AND school_id=? AND id IN (" + (b.decisions || []).map(() => "?").join(",") + ")").run(S, ...(b.decisions || []).map((d) => Number(d.student_id)));
        audit(S, me.id, "promote_class", { class_id: cid, promoted, repeated, graduated, withdrawn });
        return json(res, 200, { ok: true, promoted, repeated, graduated, withdrawn });
      }

      /* ---- academic-year rollover: promote everyone per class mapping ---- */
      if (req.method === "POST" && p === "/api/admin/rollover") {
        const b = await jread(req);
        // snapshot first to avoid cascading double-promotion
        const roster = db.prepare("SELECT id, class_id FROM students WHERE school_id=? AND enrollment_status='enrolled' AND class_id IS NOT NULL").all(S);
        const nextOf = {};
        db.prepare("SELECT id,next_class_id FROM classes WHERE school_id=?").all(S).forEach((c) => { nextOf[c.id] = c.next_class_id; });
        const toNext = db.prepare("UPDATE students SET class_id=?, enrollment_status='enrolled' WHERE id=?");
        const toGrad = db.prepare("UPDATE students SET class_id=NULL, enrollment_status='graduated' WHERE id=?");
        let promoted = 0, graduated = 0;
        for (const s of roster) {
          const nxt = nextOf[s.class_id];
          if (nxt) { toNext.run(nxt, s.id); promoted++; }
          else { toGrad.run(s.id); graduated++; }
        }
        if (b.reset_term !== false) db.prepare("UPDATE students SET report_released_at=NULL,conduct=NULL,attitude=NULL,interest=NULL,class_remark=NULL WHERE school_id=?").run(S);
        if (b.new_year) db.prepare("UPDATE schools SET academic_year=? WHERE id=?").run(String(b.new_year), S);
        audit(S, me.id, "year_rollover", { promoted, graduated, new_year: b.new_year || null });
        return json(res, 200, { ok: true, promoted, graduated, academic_year: b.new_year || null });
      }

      if (p === "/api/admin/courses") {
        if (req.method === "GET")
          return json(res, 200, { courses: db.prepare(`SELECT co.*, cl.name class_name, u.name teacher_name
            FROM courses co LEFT JOIN classes cl ON cl.id=co.class_id
            LEFT JOIN teachers t ON t.id=co.teacher_id LEFT JOIN users u ON u.id=t.user_id
            WHERE co.school_id=? ORDER BY co.name`).all(S) });
        if (req.method === "POST") {
          const b = await jread(req);
          if (!b.name) return json(res, 400, { error: "course name required" });
          const r = db.prepare("INSERT INTO courses(school_id,name,code,class_id,teacher_id) VALUES (?,?,?,?,?)")
            .run(S, String(b.name), String(b.code || ""), b.class_id || null, b.teacher_id || null);
          return json(res, 200, { ok: true, id: r.lastInsertRowid });
        }
      }

      if (p === "/api/admin/students") {
        if (req.method === "GET")
          return json(res, 200, { students: db.prepare(`SELECT s.id,s.admission_no,s.grade,s.section,s.class_id,s.enrollment_status,
              u.name,u.login_id,u.email,u.phone, cl.name class_name,
              (SELECT name FROM users pu WHERE pu.id=s.parent_user_id) parent_name
            FROM students s JOIN users u ON u.id=s.user_id LEFT JOIN classes cl ON cl.id=s.class_id
            WHERE s.school_id=? ORDER BY u.name`).all(S) });
        if (req.method === "POST") {
          const b = await jread(req);
          if (!b.name) return json(res, 400, { error: "student name required" });
          const cred = createUser(S, "student", b, "s");
          // optional parent
          let parentUserId = null, parentCred = null;
          if (b.parent_name || b.parent_email || b.parent_phone) {
            parentCred = createUser(S, "parent", { name: b.parent_name || (b.name + "'s parent"), email: b.parent_email, phone: b.parent_phone }, "p");
            parentUserId = parentCred.user_id;
          }
          const admission = `${db.prepare("SELECT code FROM schools WHERE id=?").get(S).code}-${String(db.prepare("SELECT COUNT(*) n FROM students WHERE school_id=?").get(S).n + 1).padStart(4, "0")}`;
          const sr = db.prepare(`INSERT INTO students(school_id,user_id,admission_no,class_id,grade,section,parent_user_id)
                                 VALUES (?,?,?,?,?,?,?)`).run(S, cred.user_id, admission, b.class_id || null, String(b.grade || ""), String(b.section || ""), parentUserId);
          sendCredentials(S, b.name, { email: b.email, phone: b.phone }, cred.login_id, cred.password, base);
          if (parentCred) sendCredentials(S, b.parent_name || "Parent", { email: b.parent_email, phone: b.parent_phone }, parentCred.login_id, parentCred.password, base);
          audit(S, me.id, "enroll_student", { id: sr.lastInsertRowid, name: b.name });
          return json(res, 200, { ok: true, admission_no: admission,
            student_login: cred.login_id, student_password: cred.password,
            parent_login: parentCred?.login_id || null, parent_password: parentCred?.password || null });
        }
      }

      if (p === "/api/admin/exams") {
        if (req.method === "GET")
          return json(res, 200, { exams: db.prepare(`SELECT e.*, cl.name class_name FROM exams e
            LEFT JOIN classes cl ON cl.id=e.class_id WHERE e.school_id=? ORDER BY e.created_at DESC`).all(S) });
        if (req.method === "POST") {
          const b = await jread(req);
          if (!b.name) return json(res, 400, { error: "exam name required" });
          const r = db.prepare("INSERT INTO exams(school_id,name,term,class_id) VALUES (?,?,?,?)")
            .run(S, String(b.name), String(b.term || ""), b.class_id || null);
          return json(res, 200, { ok: true, id: r.lastInsertRowid });
        }
      }

      if (p === "/api/admin/timetable") {
        if (req.method === "GET") {
          const cid = Number(q.get("class_id"));
          return json(res, 200, { slots: db.prepare(`SELECT tt.*, co.name course_name, u.name teacher_name
            FROM timetable tt LEFT JOIN courses co ON co.id=tt.course_id
            LEFT JOIN teachers t ON t.id=co.teacher_id LEFT JOIN users u ON u.id=t.user_id
            WHERE tt.school_id=? AND tt.class_id=? ORDER BY tt.day,tt.period`).all(S, cid) });
        }
        if (req.method === "POST") {
          const b = await jread(req);
          db.prepare("INSERT INTO timetable(school_id,class_id,day,period,course_id,start_time,end_time) VALUES (?,?,?,?,?,?,?)")
            .run(S, Number(b.class_id), Number(b.day), Number(b.period), b.course_id || null, String(b.start_time || ""), String(b.end_time || ""));
          return json(res, 200, { ok: true });
        }
      }

      if (p === "/api/admin/invoices") {
        if (req.method === "GET")
          return json(res, 200, { invoices: db.prepare(`SELECT i.*, u.name student_name, s.admission_no
            FROM invoices i JOIN students s ON s.id=i.student_id JOIN users u ON u.id=s.user_id
            WHERE i.school_id=? ORDER BY i.created_at DESC`).all(S), currency: schoolCurrency(S) });
        if (req.method === "POST") {
          const b = await jread(req);
          const amount = Math.round(Number(b.amount || 0) * 100);
          if (!b.student_id || amount <= 0) return json(res, 400, { error: "student and a fee amount are required" });
          const r = db.prepare(`INSERT INTO invoices(school_id,student_id,term,title,amount_due_minor,due_date) VALUES (?,?,?,?,?,?)`)
            .run(S, Number(b.student_id), String(b.term || ""), String(b.title || "School fees"), amount, String(b.due_date || ""));
          audit(S, me.id, "create_invoice", { id: r.lastInsertRowid, amount });
          // notify parent if any
          const st = db.prepare("SELECT parent_user_id,user_id FROM students WHERE id=?").get(Number(b.student_id));
          const contact = db.prepare("SELECT email,phone,name FROM users WHERE id=?").get(st.parent_user_id || st.user_id);
          if (contact) notify(contact, "New school invoice",
            `HaloSchool: a fee of ${money(amount, schoolCurrency(S))} is due. Sign in to pay by MoMo or card.`,
            mailWrap("New invoice", `<p>A fee of <b>${money(amount, schoolCurrency(S))}</b> is due.</p><p>Sign in to pay by Mobile Money or card.</p>`));
          return json(res, 200, { ok: true, id: r.lastInsertRowid });
        }
      }

      if (req.method === "GET" && p === "/api/admin/audit")
        return json(res, 200, { log: db.prepare(`SELECT a.*, u.name actor FROM audit_log a LEFT JOIN users u ON u.id=a.actor_user_id
          WHERE a.school_id=? ORDER BY a.id DESC LIMIT 100`).all(S) });

      return json(res, 404, { error: "not found" });
    }

    /* ================= TEACHER ================= */
    if (p.startsWith("/api/teacher/")) {
      if (!need("teacher")) return;
      const t = db.prepare("SELECT * FROM teachers WHERE user_id=? AND school_id=?").get(me.id, S);
      if (!t) return json(res, 404, { error: "teacher profile missing" });

      if (req.method === "GET" && p === "/api/teacher/classes") {
        const classes = db.prepare(`SELECT DISTINCT cl.id,cl.name,cl.section FROM classes cl
          WHERE cl.school_id=? AND (cl.teacher_id=? OR cl.id IN (SELECT class_id FROM courses WHERE teacher_id=?)) ORDER BY cl.name`).all(S, t.id, t.id);
        const courses = db.prepare(`SELECT co.id,co.name,co.class_id, cl.name class_name FROM courses co
          LEFT JOIN classes cl ON cl.id=co.class_id WHERE co.school_id=? AND co.teacher_id=? ORDER BY co.name`).all(S, t.id);
        const exams = db.prepare("SELECT id,name,term,class_id FROM exams WHERE school_id=? ORDER BY id DESC").all(S);
        return json(res, 200, { classes, courses, exams });
      }
      if (req.method === "GET" && p === "/api/teacher/roster") {
        const cid = Number(q.get("class_id"));
        const students = db.prepare(`SELECT s.id, u.name FROM students s JOIN users u ON u.id=s.user_id
          WHERE s.school_id=? AND s.class_id=? ORDER BY u.name`).all(S, cid);
        const date = q.get("date");
        let marks = {};
        if (date) db.prepare("SELECT student_id,status FROM attendance WHERE class_id=? AND date=?").all(cid, date).forEach((r) => marks[r.student_id] = r.status);
        return json(res, 200, { students, attendance: marks });
      }
      if (req.method === "POST" && p === "/api/teacher/attendance") {
        const b = await jread(req);
        const cid = Number(b.class_id), date = String(b.date);
        if (!cid || !date) return json(res, 400, { error: "class and date required" });
        const up = db.prepare(`INSERT INTO attendance(school_id,class_id,student_id,date,status,marked_by) VALUES (?,?,?,?,?,?)
          ON CONFLICT(class_id,student_id,date) DO UPDATE SET status=excluded.status, marked_by=excluded.marked_by`);
        let absent = [];
        for (const r of (b.records || [])) {
          up.run(S, cid, Number(r.student_id), date, r.status, me.id);
          if (r.status === "absent") absent.push(Number(r.student_id));
        }
        // flag absences to parents
        for (const sid of absent) {
          const st = db.prepare("SELECT parent_user_id, user_id, (SELECT name FROM users WHERE id=students.user_id) sname FROM students WHERE id=?").get(sid);
          const contact = db.prepare("SELECT email,phone FROM users WHERE id=?").get(st.parent_user_id || st.user_id);
          if (contact) notify(contact, "Absence recorded", `HaloSchool: ${st.sname} was marked absent on ${date}.`, mailWrap("Absence", `<p>${st.sname} was marked <b>absent</b> on ${date}.</p>`));
        }
        return json(res, 200, { ok: true, saved: (b.records || []).length });
      }
      if (req.method === "GET" && p === "/api/teacher/results") {
        const examId = Number(q.get("exam_id")), courseId = Number(q.get("course_id"));
        const sch = db.prepare("SELECT ca_weight,exam_weight FROM schools WHERE id=?").get(S);
        const weights = { ca: sch?.ca_weight ?? 30, exam: sch?.exam_weight ?? 70 };
        const course = courseId ? db.prepare("SELECT * FROM courses WHERE id=? AND school_id=?").get(courseId, S) : null;
        if (!course) return json(res, 200, { students: [], results: {}, weights });
        const students = db.prepare(`SELECT s.id,u.name FROM students s JOIN users u ON u.id=s.user_id
          WHERE s.school_id=? AND s.class_id=? ORDER BY u.name`).all(S, course.class_id);
        const existing = {};
        if (examId) db.prepare("SELECT student_id,ca_score,exam_score,score,max_score,grade FROM results WHERE exam_id=? AND course_id=?").all(examId, courseId).forEach((r) => existing[r.student_id] = r);
        return json(res, 200, { students, results: existing, weights });
      }
      if (req.method === "POST" && p === "/api/teacher/results") {
        const b = await jread(req);
        const examId = Number(b.exam_id), courseId = Number(b.course_id);
        const up = db.prepare(`INSERT INTO results(school_id,exam_id,course_id,student_id,ca_score,exam_score,score,max_score,grade,entered_by) VALUES (?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(exam_id,course_id,student_id) DO UPDATE SET ca_score=excluded.ca_score,exam_score=excluded.exam_score,score=excluded.score,max_score=excluded.max_score,grade=excluded.grade,entered_by=excluded.entered_by`);
        for (const r of (b.records || [])) {
          let ca = null, exam = null, total;
          if (r.ca != null || r.exam != null) { ca = Number(r.ca || 0); exam = Number(r.exam || 0); total = ca + exam; }
          else { total = Number(r.score || 0); }
          up.run(S, examId, courseId, Number(r.student_id), ca, exam, total, 100, gradeFor(total), me.id);
        }
        audit(S, me.id, "enter_results", { exam_id: examId, course_id: courseId, count: (b.records || []).length });
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: "not found" });
    }

    /* ================= ASSIGNMENTS / HOMEWORK ================= */
    /* teacher: create and view assignments for their courses */
    if (req.method === "POST" && p === "/api/teacher/assignments") {
      const b = await jread(req);
      if (!(b.title || "").trim() || !b.course_id) return json(res, 400, { error: "title and course required" });
      const co = db.prepare("SELECT teacher_id FROM courses WHERE id=? AND school_id=?").get(b.course_id, S);
      if (!co || co.teacher_id !== me.id) return json(res, 403, { error: "forbidden" });
      const r = db.prepare("INSERT INTO assignments(school_id,course_id,teacher_id,title,description,due_date) VALUES (?,?,?,?,?,?)")
        .run(S, b.course_id, me.id, String(b.title).slice(0, 200), String(b.description || "").slice(0, 2000), b.due_date || null);
      audit(S, me.id, "post_assignment", { assignment_id: r.lastInsertRowid, course_id: b.course_id });
      return json(res, 200, { ok: true, id: r.lastInsertRowid });
    }
    if (req.method === "GET" && p === "/api/teacher/assignments") {
      const courseId = Number(q.get("course_id"));
      const assignments = courseId
        ? db.prepare(`SELECT a.id, a.title, a.description, a.due_date, a.created_at,
            (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id=a.id) submitted,
            (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id=a.id AND s.submitted_at IS NULL) pending
          FROM assignments a WHERE a.school_id=? AND a.course_id=? AND a.teacher_id=? ORDER BY a.due_date DESC`).all(S, courseId, me.id)
        : [];
      return json(res, 200, { assignments });
    }
    /* teacher: grade submissions */
    const mGrade = p.match(/^\/api\/teacher\/submissions\/(\d+)\/grade$/);
    if (req.method === "PUT" && mGrade) {
      const sid = Number(mGrade[1]);
      const sub = db.prepare("SELECT a.teacher_id FROM submissions s JOIN assignments a ON a.id=s.assignment_id WHERE s.id=?").get(sid);
      if (!sub || sub.teacher_id !== me.id) return json(res, 403, { error: "forbidden" });
      const b = await jread(req);
      if (b.grade != null || b.feedback != null) {
        const f = ["grade", "feedback"].filter((k) => b[k] !== undefined);
        if (f.length) db.prepare(`UPDATE submissions SET ${f.map((k) => k + "=?").join(",")} ${b.grade != null ? ",marked_at=datetime('now')" : ""} WHERE id=?`)
          .run(...f.map((k) => b[k] ?? null), sid);
      }
      return json(res, 200, { ok: true });
    }

    /* students: list assignments for their courses + submit */
    if (req.method === "GET" && p === "/api/student/assignments") {
      if (me.role !== "student") return json(res, 403, { error: "forbidden" });
      const st = db.prepare("SELECT class_id FROM students WHERE user_id=? AND school_id=?").get(me.id, S);
      if (!st) return json(res, 404, { error: "student not found" });
      const assigns = db.prepare(`SELECT a.id, a.title, a.description, a.due_date, a.created_at, c.name course,
          (SELECT submitted_at FROM submissions s WHERE s.assignment_id=a.id AND s.student_id=?) submitted_at,
          (SELECT grade FROM submissions s WHERE s.assignment_id=a.id AND s.student_id=?) grade,
          (SELECT feedback FROM submissions s WHERE s.assignment_id=a.id AND s.student_id=?) feedback
        FROM assignments a JOIN courses c ON c.id=a.course_id
        WHERE a.school_id=? AND c.class_id=? ORDER BY a.due_date DESC`).all(me.id, me.id, me.id, S, st.class_id);
      return json(res, 200, { assignments: assigns });
    }
    if (req.method === "POST" && p === "/api/student/submissions") {
      if (me.role !== "student") return json(res, 403, { error: "forbidden" });
      const b = await jread(req);
      const aid = Number(b.assignment_id);
      const st = db.prepare("SELECT class_id FROM students WHERE user_id=? AND school_id=?").get(me.id, S);
      if (!st) return json(res, 404, { error: "student not found" });
      const a = db.prepare("SELECT a.id FROM assignments a JOIN courses c ON c.id=a.course_id WHERE a.id=? AND a.school_id=? AND c.class_id=?").get(aid, S, st.class_id);
      if (!a) return json(res, 403, { error: "not your assignment" });
      db.prepare("INSERT OR REPLACE INTO submissions(assignment_id,student_id,submitted_at,content) VALUES (?,?,datetime('now'),?)")
        .run(aid, db.prepare("SELECT id FROM students WHERE user_id=? AND school_id=?").get(me.id, S).id, String(b.content || "").slice(0, 5000));
      audit(S, me.id, "submit_assignment", { assignment_id: aid });
      return json(res, 200, { ok: true });
    }

    /* parents: view their child's assignments */
    const mParentAssign = p.match(/^\/api\/parent\/child\/(\d+)\/assignments$/);
    if (req.method === "GET" && mParentAssign) {
      if (me.role !== "parent") return json(res, 403, { error: "forbidden" });
      const sid = Number(mParentAssign[1]);
      const s = db.prepare("SELECT class_id FROM students WHERE id=? AND school_id=? AND parent_user_id=?").get(sid, S, me.id);
      if (!s) return json(res, 403, { error: "not your child" });
      const assigns = db.prepare(`SELECT a.id, a.title, a.description, a.due_date, a.created_at, c.name course,
          (SELECT submitted_at FROM submissions s WHERE s.assignment_id=a.id AND s.student_id=?) submitted_at,
          (SELECT grade FROM submissions s WHERE s.assignment_id=a.id AND s.student_id=?) grade,
          (SELECT feedback FROM submissions s WHERE s.assignment_id=a.id AND s.student_id=?) feedback
        FROM assignments a JOIN courses c ON c.id=a.course_id
        WHERE a.school_id=? AND c.class_id=? ORDER BY a.due_date DESC`).all(sid, sid, sid, S, s.class_id);
      return json(res, 200, { assignments: assigns });
    }

    /* ================= STUDENT / PARENT shared read ================= */
    function studentDetail(studentId) {
      const s = db.prepare(`SELECT s.*, u.name, u.login_id, cl.name class_name FROM students s
        JOIN users u ON u.id=s.user_id LEFT JOIN classes cl ON cl.id=s.class_id WHERE s.id=?`).get(studentId);
      if (!s) return null;
      const timetable = db.prepare(`SELECT tt.day,tt.period,tt.start_time,tt.end_time, co.name course FROM timetable tt
        LEFT JOIN courses co ON co.id=tt.course_id WHERE tt.class_id=? ORDER BY tt.day,tt.period`).all(s.class_id);
      const att = db.prepare("SELECT status, COUNT(*) n FROM attendance WHERE student_id=? GROUP BY status").all(studentId);
      const attendance = { present: 0, absent: 0, late: 0 }; att.forEach((r) => attendance[r.status] = r.n);
      const results = db.prepare(`SELECT r.score,r.max_score,r.grade,r.ca_score,r.exam_score,r.course_id,r.exam_id, co.name course, e.name exam, e.term FROM results r
        LEFT JOIN courses co ON co.id=r.course_id LEFT JOIN exams e ON e.id=r.exam_id
        WHERE r.student_id=? ORDER BY e.id DESC, co.name`).all(studentId);
      const invoices = db.prepare("SELECT * FROM invoices WHERE student_id=? ORDER BY created_at DESC").all(studentId);
      return { student: { id: s.id, name: s.name, admission_no: s.admission_no, class_name: s.class_name, grade: s.grade, section: s.section,
        report_released_at: s.report_released_at, conduct: s.conduct, attitude: s.attitude, interest: s.interest, class_remark: s.class_remark, class_id: s.class_id },
        timetable, attendance, results, invoices, currency: schoolCurrency(s.school_id) };
    }

    if (req.method === "GET" && p === "/api/student/me") {
      if (!need("student")) return;
      const s = db.prepare("SELECT id FROM students WHERE user_id=? AND school_id=?").get(me.id, S);
      if (!s) return json(res, 404, { error: "student profile missing" });
      return json(res, 200, studentDetail(s.id));
    }

    if (req.method === "GET" && p === "/api/parent/children") {
      if (!need("parent")) return;
      const kids = db.prepare(`SELECT s.id, u.name, cl.name class_name FROM students s JOIN users u ON u.id=s.user_id
        LEFT JOIN classes cl ON cl.id=s.class_id WHERE s.parent_user_id=? AND s.school_id=? ORDER BY u.name`).all(me.id, S);
      return json(res, 200, { children: kids });
    }
    const mChild = p.match(/^\/api\/parent\/child\/(\d+)$/);
    if (req.method === "GET" && mChild) {
      if (!need("parent")) return;
      const sid = Number(mChild[1]);
      const owns = db.prepare("SELECT id FROM students WHERE id=? AND parent_user_id=? AND school_id=?").get(sid, me.id, S);
      if (!owns) return json(res, 403, { error: "not your child" });
      return json(res, 200, studentDetail(sid));
    }

    /* ---- report card (student own, parent's child, admin any) ---- */
    /* ---- announcements (read: any signed-in user, scoped by audience) ---- */
    if (req.method === "GET" && p === "/api/announcements") {
      if (!me) return json(res, 401, { error: "unauthorized" });
      const aud = me.role === "parent" ? "parents" : me.role === "student" ? "students" : me.role === "teacher" ? "teachers" : null;
      const rows = me.role === "school_admin"
        ? db.prepare("SELECT a.id,a.title,a.body,a.audience,a.created_at,u.name author FROM announcements a LEFT JOIN users u ON u.id=a.author_id WHERE a.school_id=? ORDER BY a.id DESC LIMIT 50").all(S)
        : db.prepare("SELECT a.id,a.title,a.body,a.audience,a.created_at,u.name author FROM announcements a LEFT JOIN users u ON u.id=a.author_id WHERE a.school_id=? AND a.audience IN ('all',?) ORDER BY a.id DESC LIMIT 50").all(S, aud);
      return json(res, 200, { announcements: rows });
    }

    /* ---- parent-teacher messaging ---- */
    if (req.method === "POST" && p === "/api/messages") {
      if (!me) return json(res, 401, { error: "unauthorized" });
      const b = await jread(req);
      if (!b.recipient_id || !b.body) return json(res, 400, { error: "recipient_id and body required" });
      // verify recipient exists in same school and allowed role
      const recip = db.prepare("SELECT u.id, u.role, u.phone FROM users u WHERE u.id=? AND u.school_id=?").get(b.recipient_id, S);
      if (!recip) return json(res, 403, { error: "recipient not found" });
      // teachers can message parents, parents can message teachers
      const allowed = (me.role === "teacher" && recip.role === "parent") || (me.role === "parent" && recip.role === "teacher");
      if (!allowed) return json(res, 403, { error: "cannot message this role" });
      const m = db.prepare("INSERT INTO messages(school_id,sender_id,recipient_id,subject,body) VALUES (?,?,?,?,?)").run(S, me.id, b.recipient_id, b.subject || null, b.body);
      // send SMS notification to recipient
      notify(S, b.recipient_id, `Message from ${me.name}`, `${me.name} sent you a message: ${b.body.substring(0, 50)}...`, recip.phone);
      audit(S, me.id, "send_message", { to: b.recipient_id, id: m.lastInsertRowid });
      return json(res, 201, { ok: true, id: m.lastInsertRowid });
    }

    if (req.method === "GET" && p === "/api/messages") {
      if (!me) return json(res, 401, { error: "unauthorized" });
      // get all messages where user is sender or recipient, grouped by conversation
      const msgs = db.prepare(`
        SELECT m.id, m.sender_id, m.recipient_id, m.subject, m.body, m.created_at, m.read_at,
          CASE WHEN m.sender_id=? THEN u2.name ELSE u1.name END other_name,
          CASE WHEN m.sender_id=? THEN u2.id ELSE u1.id END other_id,
          CASE WHEN m.sender_id=? THEN u2.role ELSE u1.role END other_role
        FROM messages m
        JOIN users u1 ON u1.id=m.sender_id
        JOIN users u2 ON u2.id=m.recipient_id
        WHERE m.school_id=? AND (m.sender_id=? OR m.recipient_id=?)
        ORDER BY m.created_at DESC LIMIT 200
      `).all(me.id, me.id, me.id, S, me.id, me.id);
      // group by conversation partner
      const convs = {};
      for (const m of msgs) {
        const key = [me.id, m.other_id].sort().join("_");
        if (!convs[key]) {
          convs[key] = {
            other_id: m.other_id,
            other_name: m.other_name,
            other_role: m.other_role,
            latest: m.created_at,
            unread: 0,
            messages: []
          };
        }
        convs[key].messages.push(m);
        if (!m.read_at && m.recipient_id === me.id) convs[key].unread++;
      }
      return json(res, 200, { conversations: Object.values(convs) });
    }

    if (req.method === "GET" && p.match(/^\/api\/messages\/(\d+)$/)) {
      if (!me) return json(res, 401, { error: "unauthorized" });
      const other_id = Number(p.split("/").pop());
      // get conversation with this user
      const msgs = db.prepare(`
        SELECT m.id, m.sender_id, m.recipient_id, m.subject, m.body, m.created_at, m.read_at, u1.name sender_name, u2.name recipient_name
        FROM messages m
        JOIN users u1 ON u1.id=m.sender_id
        JOIN users u2 ON u2.id=m.recipient_id
        WHERE m.school_id=? AND ((m.sender_id=? AND m.recipient_id=?) OR (m.sender_id=? AND m.recipient_id=?))
        ORDER BY m.created_at ASC
      `).all(S, me.id, other_id, other_id, me.id);
      if (!msgs.length) return json(res, 200, { messages: [] });
      // mark all recipient messages as read
      db.prepare("UPDATE messages SET read_at=datetime('now') WHERE school_id=? AND sender_id=? AND recipient_id=? AND read_at IS NULL").run(S, other_id, me.id);
      return json(res, 200, { messages: msgs });
    }

    /* ---- discipline: incident logging ---- */
    if (req.method === "POST" && p === "/api/incidents") {
      if (!me || (me.role !== "school_admin" && me.role !== "teacher")) return json(res, 403, { error: "forbidden" });
      const b = await jread(req);
      if (!b.student_id || !b.date || !b.incident_type) return json(res, 400, { error: "student_id, date, incident_type required" });
      const st = db.prepare("SELECT user_id, parent_user_id FROM students WHERE id=? AND school_id=?").get(b.student_id, S);
      if (!st) return json(res, 404, { error: "student not found" });
      const severity = ["minor", "major", "severe"].includes(b.severity) ? b.severity : "minor";
      const inc = db.prepare("INSERT INTO incidents(school_id,student_id,teacher_id,date,incident_type,description,severity) VALUES (?,?,?,?,?,?,?)").run(S, b.student_id, me.role === "teacher" ? me.id : null, b.date, b.incident_type, b.description || null, severity);
      audit(S, me.id, "log_incident", { student_id: b.student_id, type: b.incident_type, severity });
      // notify parent of severe incidents
      if (severity === "severe" || severity === "major") {
        const p_user = db.prepare("SELECT name, phone FROM users WHERE id=?").get(st.parent_user_id);
        if (p_user) notify(S, st.parent_user_id, `Serious incident: ${b.incident_type}`, `${b.incident_type}: ${b.description || "See details in portal"}`, p_user.phone);
      }
      return json(res, 201, { ok: true, id: inc.lastInsertRowid });
    }

    if (req.method === "GET" && p === "/api/incidents") {
      if (!me) return json(res, 401, { error: "unauthorized" });
      const student_id = q.get("student_id");
      const class_id = q.get("class_id");
      let sql = "SELECT i.id, i.student_id, i.date, i.incident_type, i.severity, i.description, u.name student_name, u2.name teacher_name FROM incidents i JOIN users u ON u.id IN (SELECT user_id FROM students WHERE id=i.student_id) LEFT JOIN users u2 ON u2.id=i.teacher_id WHERE i.school_id=?";
      const params = [S];
      // admins see all, teachers see their students, parents see their child
      if (me.role === "teacher") {
        sql += " AND i.student_id IN (SELECT id FROM students WHERE class_id IN (SELECT id FROM classes WHERE teacher_id=?))";
        params.push(me.id);
      } else if (me.role === "parent") {
        sql += " AND i.student_id IN (SELECT id FROM students WHERE parent_user_id=?)";
        params.push(me.id);
      }
      if (student_id) { sql += " AND i.student_id=?"; params.push(student_id); }
      if (class_id) { sql += " AND i.student_id IN (SELECT id FROM students WHERE class_id=?)"; params.push(class_id); }
      sql += " ORDER BY i.date DESC";
      const incidents = db.prepare(sql).all(...params);
      return json(res, 200, { incidents });
    }

    const mIncident = p.match(/^\/api\/incidents\/(\d+)$/);
    if (req.method === "GET" && mIncident) {
      if (!me) return json(res, 401, { error: "unauthorized" });
      const inc_id = Number(mIncident[1]);
      const inc = db.prepare(`SELECT i.*, u.name student_name, u2.name teacher_name
        FROM incidents i JOIN users u ON u.id IN (SELECT user_id FROM students WHERE id=i.student_id)
        LEFT JOIN users u2 ON u2.id=i.teacher_id WHERE i.id=? AND i.school_id=?`).get(inc_id, S);
      if (!inc) return json(res, 404, { error: "incident not found" });
      const consequences = db.prepare("SELECT * FROM consequences WHERE incident_id=? ORDER BY created_at DESC").all(inc_id);
      return json(res, 200, { incident: inc, consequences });
    }

    if (req.method === "POST" && p === "/api/consequences") {
      if (!me || me.role !== "school_admin") return json(res, 403, { error: "forbidden" });
      const b = await jread(req);
      if (!b.incident_id || !b.consequence_type) return json(res, 400, { error: "incident_id and consequence_type required" });
      const inc = db.prepare("SELECT student_id FROM incidents WHERE id=? AND school_id=?").get(b.incident_id, S);
      if (!inc) return json(res, 404, { error: "incident not found" });
      const cons = db.prepare("INSERT INTO consequences(school_id,incident_id,consequence_type,description,start_date,end_date,status) VALUES (?,?,?,?,?,?,?)").run(S, b.incident_id, b.consequence_type, b.description || null, b.start_date || null, b.end_date || null, "pending");
      audit(S, me.id, "add_consequence", { incident_id: b.incident_id, type: b.consequence_type });
      // notify parent of suspension/serious consequences
      if (["suspension", "expulsion"].includes(b.consequence_type)) {
        const st = db.prepare("SELECT parent_user_id FROM students WHERE id=?").get(inc.student_id);
        if (st?.parent_user_id) {
          const p_user = db.prepare("SELECT name, phone FROM users WHERE id=?").get(st.parent_user_id);
          if (p_user) notify(S, st.parent_user_id, `Consequence: ${b.consequence_type}`, `Your child has been ${b.consequence_type}: ${b.description || "See details in portal"}`, p_user.phone);
        }
      }
      return json(res, 201, { ok: true, id: cons.lastInsertRowid });
    }

    if (req.method === "PUT" && p.match(/^\/api\/consequences\/(\d+)$/)) {
      if (!me || me.role !== "school_admin") return json(res, 403, { error: "forbidden" });
      const cons_id = Number(p.split("/").pop());
      const b = await jread(req);
      if (b.status) db.prepare("UPDATE consequences SET status=? WHERE id=? AND school_id=?").run(b.status, cons_id, S);
      return json(res, 200, { ok: true });
    }

    /* ---- fee ledger: student fee statement ---- */
    if (req.method === "GET" && p === "/api/fee-ledger") {
      if (!me) return json(res, 401, { error: "unauthorized" });
      const student_id = q.get("student_id");
      if (!student_id) return json(res, 400, { error: "student_id required" });
      const st = db.prepare("SELECT id, parent_user_id FROM students WHERE id=? AND school_id=?").get(student_id, S);
      if (!st) return json(res, 404, { error: "student not found" });
      // verify access
      const allowed = me.role === "school_admin" || (me.role === "parent" && st.parent_user_id === me.id) || (me.role === "student" && db.prepare("SELECT id FROM students WHERE id=? AND user_id=?").get(student_id, me.id));
      if (!allowed) return json(res, 403, { error: "forbidden" });
      // get all invoices for student with payment details
      const invoices = db.prepare(`SELECT i.id, i.title, i.term, i.amount_due_minor, i.amount_paid_minor, i.due_date, i.status, i.created_at,
        SUM(p.amount_minor) total_payments FROM invoices i
        LEFT JOIN payments p ON p.invoice_id=i.id AND p.status='completed'
        WHERE i.student_id=? AND i.school_id=? GROUP BY i.id ORDER BY i.due_date DESC`).all(student_id, S);
      // calculate totals
      const total_due = invoices.reduce((sum, i) => sum + i.amount_due_minor, 0);
      const total_paid = invoices.reduce((sum, i) => sum + (i.total_payments || 0), 0);
      const balance = total_due - total_paid;
      return json(res, 200, { invoices, summary: { total_due, total_paid, balance, currency: db.prepare("SELECT currency FROM schools WHERE id=?").get(S).currency || "GHS" } });
    }

    if (req.method === "POST" && p === "/api/fee-reminders/send") {
      if (!me || me.role !== "school_admin") return json(res, 403, { error: "forbidden" });
      const b = await jread(req);
      const student_id = b.student_id;
      if (!student_id) return json(res, 400, { error: "student_id required" });
      // get student's parent
      const st = db.prepare("SELECT parent_user_id FROM students WHERE id=? AND school_id=?").get(student_id, S);
      if (!st) return json(res, 404, { error: "student not found" });
      // get outstanding invoices
      const invoices = db.prepare(`SELECT i.id, i.title, i.amount_due_minor, i.amount_paid_minor, i.due_date
        FROM invoices i WHERE i.student_id=? AND i.school_id=? AND i.status != 'paid' AND (i.amount_due_minor - COALESCE(i.amount_paid_minor,0)) > 0`).all(student_id, S);
      if (!invoices.length) return json(res, 200, { ok: true, sent: 0 });
      const p_user = db.prepare("SELECT name, phone FROM users WHERE id=?").get(st.parent_user_id);
      if (!p_user) return json(res, 200, { ok: true, sent: 0 });
      // send reminder for each outstanding invoice
      const cur = db.prepare("SELECT currency FROM schools WHERE id=?").get(S).currency || "GHS";
      for (const inv of invoices) {
        const outstanding = inv.amount_due_minor - (inv.amount_paid_minor || 0);
        const due_text = inv.due_date ? new Date(inv.due_date + "T00:00Z").toLocaleDateString() : "—";
        notify(S, st.parent_user_id, `Fee reminder: ${inv.title}`, `Outstanding: ${cur}${(outstanding / 100).toLocaleString()} due ${due_text}. Pay via portal or Mobile Money.`, p_user.phone);
        db.prepare("UPDATE fee_reminders SET last_sent_at=datetime('now') WHERE student_id=? AND invoice_id=?").run(student_id, inv.id);
      }
      audit(S, me.id, "send_fee_reminder", { student_id, count: invoices.length });
      return json(res, 200, { ok: true, sent: invoices.length });
    }

    const mReport = p.match(/^\/api\/report\/(\d+)$/);
    if (req.method === "GET" && mReport) {
      if (!me) return json(res, 401, { error: "unauthorized" });
      const sid = Number(mReport[1]);
      const s = db.prepare("SELECT * FROM students WHERE id=?").get(sid);
      if (!s || s.school_id !== S) return json(res, 404, { error: "not found" });
      const allowed = me.role === "school_admin" || (me.role === "student" && db.prepare("SELECT id FROM students WHERE id=? AND user_id=?").get(sid, me.id))
        || (me.role === "parent" && s.parent_user_id === me.id);
      if (!allowed) return json(res, 403, { error: "forbidden" });
      const school = db.prepare("SELECT name,code,logo,address,contact_phone,contact_email,banner,motto,head_name,head_signature,report_footer,grading_scale,report_template,currency,ca_weight,exam_weight,next_term FROM schools WHERE id=?").get(S);
      const detail = studentDetail(sid);
      const grading = gradingScaleFor(school);
      // class position: rank students in the same class by average percentage across their results
      let position = null, classSize = 0, average = null;
      if (s.class_id) {
        const rows = db.prepare(`SELECT r.student_id, AVG(r.score*100.0/NULLIF(r.max_score,0)) avg
          FROM results r JOIN students st ON st.id=r.student_id
          WHERE st.class_id=? AND st.school_id=? GROUP BY r.student_id`).all(s.class_id, S);
        classSize = db.prepare("SELECT COUNT(*) n FROM students WHERE class_id=? AND school_id=?").get(s.class_id, S).n;
        const ranked = rows.map((r) => ({ id: r.student_id, avg: r.avg || 0 })).sort((a, b) => b.avg - a.avg);
        const mine = ranked.find((r) => r.id === sid);
        if (mine) { average = Math.round(mine.avg * 10) / 10; position = ranked.findIndex((r) => r.id === sid) + 1; }
      }
      // subject position: rank within class for each (exam,course) the student sat
      const subjectPos = {};
      if (s.class_id) {
        for (const r of detail.results) {
          const key = r.exam_id + ":" + r.course_id;
          if (subjectPos[key] != null) continue;
          const peers = db.prepare(`SELECT r.student_id, r.score FROM results r JOIN students st ON st.id=r.student_id
            WHERE r.exam_id=? AND r.course_id=? AND st.class_id=? AND st.school_id=? ORDER BY r.score DESC`).all(r.exam_id, r.course_id, s.class_id, S);
          const idx = peers.findIndex((p2) => p2.student_id === sid);
          if (idx >= 0) subjectPos[key] = { pos: idx + 1, of: peers.length };
        }
      }
      const ordinal = (n) => { const s2 = ["th", "st", "nd", "rd"], v = n % 100; return n + (s2[(v - 20) % 10] || s2[v] || s2[0]); };
      detail.results = detail.results.map((r) => { const sp = subjectPos[r.exam_id + ":" + r.course_id]; return { ...r, subject_position: sp ? ordinal(sp.pos) : "" }; });
      const remark = average == null ? "" : overallRemark(average, grading);
      return json(res, 200, { school, ...detail, grading, position, position_ordinal: position ? ordinal(position) : "", classSize, average, remark,
        ca_weight: school.ca_weight ?? 30, exam_weight: school.exam_weight ?? 70, next_term: school.next_term || "", generated_at: new Date().toISOString() });
    }

    /* ================= FEE PAYMENT (parent/student) ================= */
    const mPayInit = p.match(/^\/api\/invoices\/(\d+)\/pay-init$/);
    if (req.method === "POST" && mPayInit) {
      if (!me || !["parent", "student"].includes(me.role)) return json(res, 403, { error: "forbidden" });
      const inv = db.prepare("SELECT * FROM invoices WHERE id=? AND school_id=?").get(Number(mPayInit[1]), S);
      if (!inv) return json(res, 404, { error: "invoice not found" });
      // ownership: student self or parent of student
      const st = db.prepare("SELECT user_id,parent_user_id FROM students WHERE id=?").get(inv.student_id);
      if (!(st.user_id === me.id || st.parent_user_id === me.id)) return json(res, 403, { error: "not your invoice" });
      if (inv.status === "paid") return json(res, 400, { error: "this invoice is already paid" });
      const remaining = inv.amount_due_minor - inv.amount_paid_minor;
      const reference = ref("FEE");
      db.prepare("INSERT INTO payments(school_id,invoice_id,student_id,payer_user_id,amount_minor,currency,reference) VALUES (?,?,?,?,?,?,?)")
        .run(S, inv.id, inv.student_id, me.id, remaining, schoolCurrency(S), reference);
      return json(res, 200, { reference, amount_minor: remaining, email: me.email || me.login_id, publicKey: PAYSTACK_PUBLIC_KEY, currency: schoolCurrency(S) });
    }

    if (req.method === "POST" && p === "/api/pay/verify") {
      if (!me) return json(res, 401, { error: "unauthorized" });
      const b = await jread(req);
      const reference = String(b.reference || "");
      const pay = db.prepare("SELECT * FROM payments WHERE reference=? AND school_id=?").get(reference, S);
      if (!pay) return json(res, 404, { error: "payment not found" });
      try {
        const data = await verifyPaystack(reference);
        if (data.status !== "success") return json(res, 400, { error: "payment not successful" });
        const r = applyFeePayment(pay, data);
        if (!r.ok) return json(res, 400, { error: "amount paid is less than expected" });
        return json(res, 200, { ok: true, invoice_status: r.invoice_status });
      } catch (e) { return json(res, 502, { error: "could not verify: " + e.message }); }
    }

    if (req.method === "POST" && p === "/paystack/webhook") {
      const raw = await readBody(req);
      const sig = req.headers["x-paystack-signature"];
      const expected = crypto.createHmac("sha512", PAYSTACK_SECRET_KEY).update(raw).digest("hex");
      if (!safeEqual(sig || "", expected)) return json(res, 401, { error: "bad signature" });
      const evt = JSON.parse(raw || "{}");
      if (evt.event === "charge.success") {
        const pay = db.prepare("SELECT * FROM payments WHERE reference=?").get(evt.data.reference);
        if (pay) applyFeePayment(pay, evt.data);
      }
      return json(res, 200, { received: true });
    }

    /* ---- static pages ---- */
    if (req.method === "GET") return serveStatic(res, p);
    return json(res, 404, { error: "not found" });
  } catch (e) {
    console.error("ERR", p, e);
    return json(res, 500, { error: e.message || "server error" });
  }
});

/* apply a verified fee payment to its invoice (amount-checked, idempotent) */
function applyFeePayment(pay, data) {
  if (pay.status === "paid") return { ok: true, invoice_status: db.prepare("SELECT status FROM invoices WHERE id=?").get(pay.invoice_id)?.status };
  if ((data.currency || pay.currency) !== pay.currency || Number(data.amount || 0) < pay.amount_minor) {
    // accept partial: credit whatever actually came in, but never more than charged
  }
  const credited = Math.min(Number(data.amount || 0), pay.amount_minor);
  if (credited <= 0) return { ok: false };
  db.prepare("UPDATE payments SET status='paid', channel=?, paid_at=datetime('now'), amount_minor=? WHERE id=?")
    .run(data.channel || null, credited, pay.id);
  const inv = db.prepare("SELECT * FROM invoices WHERE id=?").get(pay.invoice_id);
  const paid = inv.amount_paid_minor + credited;
  const status = paid >= inv.amount_due_minor ? "paid" : "partial";
  db.prepare("UPDATE invoices SET amount_paid_minor=?, status=? WHERE id=?").run(paid, status, inv.id);
  audit(pay.school_id, pay.payer_user_id, "fee_payment", { invoice_id: inv.id, amount: credited, reference: pay.reference });
  // notify payer/parent
  const payer = db.prepare("SELECT email,phone,name FROM users WHERE id=?").get(pay.payer_user_id);
  if (payer) notify(payer, "Payment received",
    `HaloSchool: payment of ${money(credited, pay.currency)} received. Invoice is now ${status}.`,
    mailWrap("Payment received", `<p>We received <b>${money(credited, pay.currency)}</b>.</p><p>Invoice status: <b>${status}</b>.</p>`));
  return { ok: true, invoice_status: status };
}

server.listen(PORT, () => console.log(`HaloSchool on :${PORT}  (data: ${DATA_DIR})`));
