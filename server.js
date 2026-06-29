/**
 * HaloSchool - Multi-Tenant School Management System
 * Version: 2.0.1 (Fixed Database Initialization)
 * Updated: June 29, 2026
 * 
 * Features:
 * - Multi-tenant architecture
 * - School name as unique identifier (slug)
 * - User enrollment with temporary passwords
 * - Complete school isolation
 * - Role-based access control
 */

const http = require('http');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Configuration
const PORT = process.env.PORT || 5000;
const BASE_URL = process.env.BASE_URL || 'https://haloschool-production.up.railway.app';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const DATABASE_PATH = process.env.DATABASE || '/app/data/school.db';
const DATA_DIR = path.dirname(DATABASE_PATH);

// Ensure data directory exists
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`✓ Created data directory: ${DATA_DIR}`);
  }
} catch (e) {
  console.error(`✗ Failed to create data directory: ${e.message}`);
  process.exit(1);
}

let db;

// Initialize database with error handling
try {
  console.log('Initializing database...');
  db = new Database(DATABASE_PATH);
  db.pragma('journal_mode = WAL');
  console.log('✓ Database connected:', DATABASE_PATH);
  
  // Create schools table
  db.exec(`
    CREATE TABLE IF NOT EXISTS schools (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      email TEXT,
      phone TEXT,
      tier TEXT DEFAULT 'free',
      admin_user_id INTEGER,
      status TEXT DEFAULT 'active',
      created_at TEXT,
      updated_at TEXT
    )
  `);
  console.log('✓ Schools table created/verified');

  // Create users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      login_id TEXT NOT NULL,
      password_hash TEXT,
      salt TEXT,
      role TEXT DEFAULT 'student',
      enrollment_token TEXT UNIQUE,
      temporary_password TEXT,
      must_change_password INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TEXT,
      updated_at TEXT,
      FOREIGN KEY(school_id) REFERENCES schools(id),
      UNIQUE(school_id, login_id)
    )
  `);
  console.log('✓ Users table created/verified');

  // Create classes table
  db.exec(`
    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id TEXT NOT NULL,
      name TEXT NOT NULL,
      level TEXT,
      created_at TEXT,
      FOREIGN KEY(school_id) REFERENCES schools(id)
    )
  `);
  console.log('✓ Classes table created/verified');

  // Create students table
  db.exec(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      school_id TEXT NOT NULL,
      user_id INTEGER,
      parent_id INTEGER,
      name TEXT NOT NULL,
      admission_number TEXT,
      class_id INTEGER,
      status TEXT DEFAULT 'active',
      created_at TEXT,
      FOREIGN KEY(school_id) REFERENCES schools(id),
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(parent_id) REFERENCES users(id),
      FOREIGN KEY(class_id) REFERENCES classes(id)
    )
  `);
  console.log('✓ Students table created/verified');

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_school ON users(school_id);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_students_school ON students(school_id);
  `);
  console.log('✓ Indexes created/verified');
  
  console.log('✓ Database schema fully initialized');
} catch (e) {
  console.error('✗ Database initialization error:', e.message);
  console.error('Stack:', e.stack);
  process.exit(1);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generate slug from school name
 * "Sunrise Academy" → "sunrise-academy"
 */
function generateSchoolSlug(schoolName) {
  return schoolName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Get unique school slug (handles duplicates)
 * If "sunrise-academy" exists, returns "sunrise-academy-2"
 */
function getUniqueSchoolSlug(schoolName) {
  let slug = generateSchoolSlug(schoolName);
  let baseSlug = slug;
  let counter = 1;
  
  while (db.prepare("SELECT id FROM schools WHERE id=?").get(slug)) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }
  
  return slug;
}

/**
 * Generate enrollment token
 * Returns: "enr_" + 32 random characters
 */
function generateEnrollmentToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = 'enr_';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

/**
 * Generate temporary password
 * Format: "TmpPwd#2026xyz..."
 */
function generateTemporaryPassword() {
  const year = new Date().getFullYear();
  const random = Math.random().toString(36).substring(2, 10).toUpperCase();
  return `TmpPwd#${year}${random}`;
}

/**
 * Hash password
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(password, salt, 100000, 64, 'sha512')
    .toString('hex');
  return { hash, salt };
}

/**
 * Check password
 */
function checkPassword(password, hash, salt) {
  const computed = crypto
    .pbkdf2Sync(password, salt, 100000, 64, 'sha512')
    .toString('hex');
  return computed === hash;
}

/**
 * Sign JWT token
 */
function signToken(user) {
  const payload = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    school_id: user.school_id,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400 * 30
  };
  return jwt.sign(payload, JWT_SECRET);
}

/**
 * Verify JWT token
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Parse JSON from request body
 */
async function jread(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response
 */
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Send HTML response
 */
function html(res, content) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(content);
}

/**
 * Check user authorization
 */
function need(res, me, ...roles) {
  if (!me || !roles.includes(me.role)) {
    json(res, 403, { error: 'forbidden' });
    return false;
  }
  return true;
}

// ============================================================================
// ROUTE HANDLER
// ============================================================================

const server = http.createServer(async (req, res) => {
  try {
    // CORS Headers - Allow all origins
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Max-Age', '86400');
    
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const p = new URL(req.url, `http://${req.headers.host}`).pathname;
    const q = new URL(req.url, `http://${req.headers.host}`).searchParams;
    
    // Get current user from JWT
    let me = null;
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (token && token !== 'null') {
      me = verifyToken(token);
    }

    // ========================================================================
    // HEALTH CHECK
    // ========================================================================

    if (p === '/api/health') {
      return json(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
    }

    // ========================================================================
    // DIAGNOSTIC ENDPOINT (Debug)
    // ========================================================================

    if (p === '/api/diagnostic') {
      try {
        const tables = db.prepare(`
          SELECT name FROM sqlite_master 
          WHERE type='table'
        `).all();
        
        const schoolsCount = db.prepare('SELECT COUNT(*) as count FROM schools').get().count;
        const usersCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
        
        return json(res, 200, {
          status: 'ok',
          database_path: DATABASE_PATH,
          tables: tables.map(t => t.name),
          schools_count: schoolsCount,
          users_count: usersCount,
          timestamp: new Date().toISOString()
        });
      } catch (e) {
        return json(res, 200, {
          status: 'error',
          database_path: DATABASE_PATH,
          error: e.message,
          timestamp: new Date().toISOString()
        });
      }
    }

    // ========================================================================
    // AUTHENTICATION ENDPOINTS
    // ========================================================================

    if (req.method === 'POST' && p === '/api/login') {
      const b = await jread(req);
      const login = String(b.login_id || '').trim().toLowerCase();
      const password = String(b.password || '');

      if (!login || !password) {
        return json(res, 400, { error: 'login_id and password required' });
      }

      const user = db.prepare('SELECT * FROM users WHERE login_id=?').get(login);
      
      if (!user || !checkPassword(password, user.password_hash, user.salt)) {
        return json(res, 401, { error: 'wrong login ID or password' });
      }

      if (user.status === 'suspended') {
        return json(res, 403, { error: 'your account is suspended' });
      }

      const school = db.prepare('SELECT name FROM schools WHERE id=?').get(user.school_id);
      const jwtToken = signToken(user);

      return json(res, 200, {
        token: jwtToken,
        role: user.role,
        school_id: user.school_id,
        school_name: school?.name || 'School',
        name: user.name,
        email: user.email,
        must_change_pw: !!user.must_change_password
      });
    }

    // ========================================================================
    // ENROLLMENT ENDPOINTS
    // ========================================================================

    if (req.method === 'GET' && p === '/api/enrollment-data') {
      const token = q.get('token');
      
      if (!token) {
        return json(res, 400, { error: 'token required' });
      }

      const user = db.prepare('SELECT * FROM users WHERE enrollment_token=?').get(token);
      
      if (!user) {
        return json(res, 404, { error: 'invalid enrollment link' });
      }

      const school = db.prepare('SELECT name FROM schools WHERE id=?').get(user.school_id);

      return json(res, 200, {
        school_id: user.school_id,
        school_name: school?.name || 'School',
        email: user.email,
        role: user.role,
        name: user.name
      });
    }

    if (req.method === 'POST' && p === '/api/enroll') {
      const b = await jread(req);
      const { enrollment_token, email, new_password } = b;

      if (!enrollment_token || !email || !new_password) {
        return json(res, 400, { error: 'missing required fields' });
      }

      const user = db.prepare('SELECT * FROM users WHERE enrollment_token=?').get(enrollment_token);
      
      if (!user) {
        return json(res, 404, { error: 'invalid enrollment link' });
      }

      if (user.email !== email) {
        return json(res, 400, { error: 'email mismatch' });
      }

      if (new_password.length < 8) {
        return json(res, 400, { error: 'password must be at least 8 characters' });
      }

      if (!/[a-z]/.test(new_password) || !/[A-Z]/.test(new_password) || !/\d/.test(new_password)) {
        return json(res, 400, { 
          error: 'password must contain uppercase, lowercase, and numbers' 
        });
      }

      const { hash: pwd_hash, salt } = hashPassword(new_password);

      db.prepare(`
        UPDATE users 
        SET password_hash=?, salt=?, enrollment_token=NULL, must_change_password=false 
        WHERE id=?
      `).run(pwd_hash, salt, user.id);

      const jwtToken = signToken(user);

      return json(res, 200, {
        token: jwtToken,
        school_id: user.school_id,
        role: user.role,
        redirect: `/${user.role}`
      });
    }

    // ========================================================================
    // SCHOOL ENDPOINTS
    // ========================================================================

    if (req.method === 'POST' && p === '/api/school/signup') {
      const b = await jread(req);
      const { school_name, admin_name, email, phone, password, tier } = b;

      if (!school_name || !admin_name || !email || !password) {
        return json(res, 400, { error: 'required fields missing' });
      }

      const school_id = getUniqueSchoolSlug(school_name);
      const { hash: pwd_hash, salt } = hashPassword(password);

      try {
        db.prepare(`
          INSERT INTO schools (id, name, email, phone, tier, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(school_id, school_name, email, phone || null, tier || 'free', 'active');

        const adminResult = db.prepare(`
          INSERT INTO users (
            school_id, name, email, login_id, role, password_hash, salt, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(
          school_id,
          admin_name,
          email,
          email,
          'school_admin',
          pwd_hash,
          salt,
          'active'
        );

        db.prepare('UPDATE schools SET admin_user_id=? WHERE id=?').run(
          adminResult.lastInsertRowid,
          school_id
        );

        return json(res, 201, {
          message: 'School registered successfully',
          school_id: school_id,
          school_name: school_name,
          status: 'active'
        });
      } catch (e) {
        if (e.message.includes('UNIQUE')) {
          return json(res, 409, { error: 'school name already registered' });
        }
        return json(res, 500, { error: 'registration failed' });
      }
    }

    // ========================================================================
    // ADMIN ENDPOINTS
    // ========================================================================

    if (req.method === 'POST' && p === '/api/admin/add-teacher') {
      if (!need(res, me, 'school_admin', 'super')) return;

      const b = await jread(req);
      const { name, email, phone, subject } = b;

      if (!name || !email) {
        return json(res, 400, { error: 'name and email required' });
      }

      const enrollment_token = generateEnrollmentToken();
      const temporary_password = generateTemporaryPassword();
      const schoolId = me.school_id;

      try {
        const result = db.prepare(`
          INSERT INTO users (
            school_id, name, email, phone, role, login_id,
            enrollment_token, temporary_password, must_change_password, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(
          schoolId,
          name,
          email,
          phone || null,
          'teacher',
          email,
          enrollment_token,
          temporary_password,
          1,
          'active'
        );

        const school = db.prepare('SELECT name FROM schools WHERE id=?').get(schoolId);

        return json(res, 201, {
          message: `Teacher added to ${school.name}`,
          user_id: result.lastInsertRowid,
          email: email,
          enrollment_link: `${BASE_URL}/enroll/${enrollment_token}`,
          temporary_password: temporary_password
        });
      } catch (e) {
        if (e.message.includes('UNIQUE')) {
          return json(res, 409, { error: 'Email already registered' });
        }
        return json(res, 500, { error: 'Failed to add teacher' });
      }
    }

    if (req.method === 'POST' && p === '/api/admin/add-parent') {
      if (!need(res, me, 'school_admin', 'super')) return;

      const b = await jread(req);
      const { name, email, phone } = b;

      if (!name || !email) {
        return json(res, 400, { error: 'name and email required' });
      }

      const enrollment_token = generateEnrollmentToken();
      const temporary_password = generateTemporaryPassword();
      const schoolId = me.school_id;

      try {
        const result = db.prepare(`
          INSERT INTO users (
            school_id, name, email, phone, role, login_id,
            enrollment_token, temporary_password, must_change_password, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(
          schoolId,
          name,
          email,
          phone || null,
          'parent',
          email,
          enrollment_token,
          temporary_password,
          1,
          'active'
        );

        const school = db.prepare('SELECT name FROM schools WHERE id=?').get(schoolId);

        return json(res, 201, {
          message: `Parent added to ${school.name}`,
          user_id: result.lastInsertRowid,
          email: email,
          enrollment_link: `${BASE_URL}/enroll/${enrollment_token}`,
          temporary_password: temporary_password
        });
      } catch (e) {
        if (e.message.includes('UNIQUE')) {
          return json(res, 409, { error: 'Email already registered' });
        }
        return json(res, 500, { error: 'Failed to add parent' });
      }
    }

    if (req.method === 'POST' && p === '/api/admin/add-student') {
      if (!need(res, me, 'school_admin', 'super')) return;

      const b = await jread(req);
      const { name, email, admission_number } = b;

      if (!name || !email) {
        return json(res, 400, { error: 'name and email required' });
      }

      const enrollment_token = generateEnrollmentToken();
      const temporary_password = generateTemporaryPassword();
      const schoolId = me.school_id;

      try {
        const result = db.prepare(`
          INSERT INTO users (
            school_id, name, email, role, login_id,
            enrollment_token, temporary_password, must_change_password, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(
          schoolId,
          name,
          email,
          'student',
          email,
          enrollment_token,
          temporary_password,
          1,
          'active'
        );

        const school = db.prepare('SELECT name FROM schools WHERE id=?').get(schoolId);

        return json(res, 201, {
          message: `Student added to ${school.name}`,
          user_id: result.lastInsertRowid,
          email: email,
          enrollment_link: `${BASE_URL}/enroll/${enrollment_token}`,
          temporary_password: temporary_password
        });
      } catch (e) {
        if (e.message.includes('UNIQUE')) {
          return json(res, 409, { error: 'Email already registered' });
        }
        return json(res, 500, { error: 'Failed to add student' });
      }
    }

    // ========================================================================
    // ROLE-BASED DATA ENDPOINTS
    // ========================================================================

    if (req.method === 'GET' && p === '/api/teacher/classes') {
      if (!need(res, me, 'teacher', 'school_admin', 'super')) return;

      const schoolId = me.school_id;
      
      const classes = db.prepare(`
        SELECT c.id, c.name, c.level, COUNT(s.id) as student_count
        FROM classes c
        LEFT JOIN students s ON s.class_id = c.id
        WHERE c.school_id = ?
        GROUP BY c.id
        ORDER BY c.name
      `).all(schoolId);

      return json(res, 200, { classes });
    }

    if (req.method === 'GET' && p === '/api/parent/children') {
      if (!need(res, me, 'parent', 'school_admin', 'super')) return;

      const schoolId = me.school_id;

      const children = db.prepare(`
        SELECT s.id, s.name, s.admission_number, c.name as class_name
        FROM students s
        LEFT JOIN classes c ON s.class_id = c.id
        WHERE s.school_id = ? AND s.parent_id = ?
        ORDER BY s.name
      `).all(schoolId, me.id);

      return json(res, 200, { children });
    }

    if (req.method === 'GET' && p === '/api/student/me') {
      if (!need(res, me, 'student')) return;

      const schoolId = me.school_id;

      const student = db.prepare(`
        SELECT s.id, s.name, s.admission_number, c.name as class_name
        FROM students s
        LEFT JOIN classes c ON s.class_id = c.id
        WHERE s.school_id = ? AND s.user_id = ?
      `).get(schoolId, me.id);

      return json(res, 200, { student: student || {} });
    }

    if (req.method === 'GET' && p === '/api/admin/students') {
      if (!need(res, me, 'school_admin', 'super')) return;

      const schoolId = me.school_id;

      const students = db.prepare(`
        SELECT s.id, s.name, s.admission_number, c.name as class_name, s.status
        FROM students s
        LEFT JOIN classes c ON s.class_id = c.id
        WHERE s.school_id = ?
        ORDER BY s.name
      `).all(schoolId);

      return json(res, 200, { students });
    }

    // ========================================================================
    // STATIC FILES & HOME PAGE
    // ========================================================================

    // Home page
    if (p === '/' || p === '/index.html') {
      const homeHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HaloSchool - Multi-Tenant School Management System</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f7f2e7; }
    .container { max-width: 1000px; margin: 0 auto; padding: 2rem; text-align: center; }
    .header { margin-bottom: 3rem; }
    h1 { color: #171410; font-size: 48px; margin-bottom: 1rem; }
    .subtitle { color: #666; font-size: 20px; margin-bottom: 2rem; }
    .status { background: white; padding: 2rem; border-radius: 12px; margin-bottom: 2rem; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    .status-item { margin-bottom: 1rem; }
    .status-label { font-weight: 600; color: #d99b16; }
    .status-value { color: #27ae60; font-size: 18px; }
    .endpoints { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: left; }
    .endpoints h2 { color: #d99b16; margin-bottom: 1.5rem; text-align: center; }
    .endpoint { background: #f5f5f5; padding: 1rem; margin-bottom: 0.75rem; border-radius: 6px; border-left: 4px solid #d99b16; font-family: monospace; font-size: 14px; }
    .links { margin-top: 2rem; text-align: center; }
    .btn { display: inline-block; padding: 0.75rem 1.5rem; background: #d99b16; color: white; text-decoration: none; border-radius: 6px; margin: 0.5rem; font-weight: 600; }
    .btn:hover { background: #c68910; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎓 HaloSchool</h1>
      <p class="subtitle">Multi-Tenant School Management System</p>
    </div>

    <div class="status">
      <div class="status-item">
        <span class="status-label">Status:</span>
        <span class="status-value">✅ Online & Operational</span>
      </div>
      <div class="status-item">
        <span class="status-label">Version:</span>
        <span class="status-value">2.0.1</span>
      </div>
      <div class="status-item">
        <span class="status-label">Database:</span>
        <span class="status-value">✅ Initialized</span>
      </div>
    </div>

    <div class="endpoints">
      <h2>API Endpoints</h2>
      <div class="endpoint">GET /api/health - Health check</div>
      <div class="endpoint">GET /api/diagnostic - Database diagnostic</div>
      <div class="endpoint">POST /api/school/signup - Register school</div>
      <div class="endpoint">POST /api/login - Login user</div>
      <div class="endpoint">GET /api/enrollment-data?token=... - Get enrollment details</div>
      <div class="endpoint">POST /api/enroll - Complete enrollment</div>
      <div class="endpoint">POST /api/admin/add-teacher - Add teacher</div>
      <div class="endpoint">POST /api/admin/add-parent - Add parent</div>
      <div class="endpoint">POST /api/admin/add-student - Add student</div>
      <div class="endpoint">GET /api/teacher/classes - Get teacher classes</div>
      <div class="endpoint">GET /api/parent/children - Get parent's children</div>
      <div class="endpoint">GET /api/student/me - Get student data</div>
      <div class="endpoint">GET /api/admin/students - Get all students</div>
    </div>

    <div class="links">
      <a href="/api/health" class="btn">Test Health Check</a>
      <a href="/api/diagnostic" class="btn">Check Database</a>
      <a href="/admin" class="btn">Admin Login</a>
    </div>

    <p style="margin-top: 2rem; color: #666; font-size: 14px;">
      Deployment Date: June 29, 2026 | Status: Production Ready
    </p>
  </div>
</body>
</html>`;
      return html(res, homeHtml);
    }

    // Admin dashboard
    if (p === '/admin') {
      const adminHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Admin Dashboard - HaloSchool</title>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto; background: #f7f2e7; padding: 2rem; text-align: center; }
    .container { max-width: 600px; margin: 0 auto; background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    h1 { color: #171410; }
    p { color: #666; }
    input { width: 100%; padding: 0.75rem; margin: 0.5rem 0; border: 1px solid #ddd; border-radius: 6px; }
    button { width: 100%; padding: 0.9rem; background: #d99b16; color: white; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; margin-top: 1rem; }
    button:hover { background: #c68910; }
    a { color: #d99b16; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎓 Admin Dashboard</h1>
    <p>HaloSchool Multi-Tenant System</p>
    <hr style="margin: 1rem 0;">
    <h2>Admin Login</h2>
    <input type="email" id="email" placeholder="Email address">
    <input type="password" id="password" placeholder="Password">
    <button onclick="login()">Login</button>
    <p style="margin-top: 2rem;"><a href="/">← Back Home</a></p>
  </div>
  <script>
    function login() {
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;
      fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login_id: email, password: password })
      })
      .then(r => r.json())
      .then(d => {
        if (d.token) {
          localStorage.setItem('token', d.token);
          alert('Login successful! Token saved.');
          console.log('Token:', d.token);
        } else {
          alert('Login failed: ' + d.error);
        }
      })
      .catch(e => alert('Error: ' + e.message));
    }
  </script>
</body>
</html>`;
      return html(res, adminHtml);
    }

    // Teacher dashboard
    if (p === '/teacher') {
      return html(res, `<html><body style="font-family: sans-serif; padding: 2rem; background: #f7f2e7;"><h1>👨‍🏫 Teacher Dashboard</h1><p>HaloSchool - Teacher Portal</p><p><a href="/" style="color: #d99b16;">← Back Home</a></p></body></html>`);
    }

    // Parent dashboard
    if (p === '/parent') {
      return html(res, `<html><body style="font-family: sans-serif; padding: 2rem; background: #f7f2e7;"><h1>👨‍👩‍👧 Parent Portal</h1><p>HaloSchool - Parent Dashboard</p><p><a href="/" style="color: #d99b16;">← Back Home</a></p></body></html>`);
    }

    // Student dashboard
    if (p === '/student') {
      return html(res, `<html><body style="font-family: sans-serif; padding: 2rem; background: #f7f2e7;"><h1>👨‍🎓 Student Dashboard</h1><p>HaloSchool - Student Portal</p><p><a href="/" style="color: #d99b16;">← Back Home</a></p></body></html>`);
    }

    if (p === '/enroll' || p.startsWith('/enroll/')) {
      const enrollHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HaloSchool - Complete Your Enrollment</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f7f2e7; }
    .container { max-width: 450px; margin: 4rem auto; padding: 1rem; }
    .card { background: white; padding: 2.5rem; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    h1 { text-align: center; margin-bottom: 2rem; font-size: 28px; color: #171410; }
    .school-info { background: #f0ebe0; padding: 1.5rem; border-radius: 8px; margin-bottom: 2rem; border-left: 4px solid #d99b16; }
    .info-item { margin-bottom: 1rem; }
    .info-label { font-size: 12px; color: #666; text-transform: uppercase; font-weight: 600; margin-bottom: 0.4rem; }
    .info-value { font-size: 16px; color: #171410; font-weight: 500; }
    label { display: block; font-weight: 600; margin-bottom: 0.5rem; margin-top: 1rem; color: #171410; }
    input[type="password"] { width: 100%; padding: 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; margin-bottom: 0.5rem; }
    button { width: 100%; padding: 0.9rem; background: #d99b16; color: white; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 16px; margin-top: 1.5rem; }
    button:hover { background: #c68910; }
    .error { color: #c0392b; background: #ffe6e6; padding: 1rem; border-radius: 6px; margin-bottom: 1rem; }
    .loading { text-align: center; padding: 2rem; color: #666; }
    .spinner { display: inline-block; width: 30px; height: 30px; border: 3px solid #ddd; border-top-color: #d99b16; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h1>Welcome to HaloSchool</h1>
      <div id="loading" class="loading"><div class="spinner"></div><p style="margin-top: 1rem;">Loading enrollment...</p></div>
      <div id="form" style="display: none;">
        <div class="school-info">
          <div class="info-item"><div class="info-label">School</div><div class="info-value" id="schoolName">-</div></div>
          <div class="info-item"><div class="info-label">Email</div><div class="info-value" id="userEmail">-</div></div>
          <div class="info-item"><div class="info-label">Role</div><div class="info-value" id="userRole">-</div></div>
        </div>
        <div id="error" class="error" style="display: none;"></div>
        <label>Create a Strong Password</label>
        <input type="password" id="password" placeholder="Minimum 8 characters">
        <label>Confirm Password</label>
        <input type="password" id="password2" placeholder="Confirm password">
        <button onclick="submitEnrollment()">Set Password & Login</button>
      </div>
    </div>
  </div>
  <script>
    const token = window.location.pathname.split('/').pop();
    window.addEventListener('load', async () => {
      try {
        const res = await fetch(\`/api/enrollment-data?token=\${token}\`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        document.getElementById('schoolName').textContent = data.school_name;
        document.getElementById('userEmail').textContent = data.email;
        document.getElementById('userRole').textContent = data.role.charAt(0).toUpperCase() + data.role.slice(1);
        document.getElementById('loading').style.display = 'none';
        document.getElementById('form').style.display = 'block';
      } catch (e) {
        document.getElementById('loading').innerHTML = \`<div class="error">\${e.message}</div>\`;
      }
    });
    async function submitEnrollment() {
      const pw1 = document.getElementById('password').value.trim();
      const pw2 = document.getElementById('password2').value.trim();
      const email = document.getElementById('userEmail').textContent;
      if (!pw1 || pw1.length < 8 || pw1 !== pw2 || !/[a-z]/.test(pw1) || !/[A-Z]/.test(pw1) || !/\\d/.test(pw1)) {
        document.getElementById('error').textContent = 'Password must be 8+ chars with uppercase, lowercase, and numbers';
        document.getElementById('error').style.display = 'block';
        return;
      }
      try {
        const res = await fetch('/api/enroll', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enrollment_token: token, email, new_password: pw1 })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        localStorage.setItem('school_token', data.token);
        localStorage.setItem('school_id', data.school_id);
        window.location.href = data.redirect || '/';
      } catch (e) {
        document.getElementById('error').textContent = e.message;
        document.getElementById('error').style.display = 'block';
      }
    }
  </script>
</body>
</html>`;
      return html(res, enrollHtml);
    }

    // 404
    json(res, 404, { error: 'endpoint not found' });
  } catch (err) {
    console.error('Request handler error:', err.message);
    console.error('Stack:', err.stack);
    try {
      json(res, 500, { error: 'internal server error' });
    } catch (e) {
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  }
});

// ============================================================================
// START SERVER
// ============================================================================

server.listen(PORT, () => {
  console.log(`
  ╔════════════════════════════════════════════╗
  ║     HaloSchool - Multi-Tenant System       ║
  ║         Running on port ${PORT}            ║
  ╚════════════════════════════════════════════╝
  
  ✓ Multi-tenant architecture enabled
  ✓ School name as unique ID (slug)
  ✓ User enrollment with auto-generated links
  ✓ Complete school isolation
  
  Endpoints:
    POST /api/login                  - Login
    POST /api/school/signup          - Register school
    GET  /api/enrollment-data        - Get enrollment details
    POST /api/enroll                 - Complete enrollment
    POST /api/admin/add-teacher      - Add teacher
    POST /api/admin/add-parent       - Add parent
    POST /api/admin/add-student      - Add student
    GET  /api/teacher/classes        - Teacher classes
    GET  /api/parent/children        - Parent's children
    GET  /api/student/me             - Student data
    GET  /api/admin/students         - All students
    GET  /api/health                 - Health check
  
  Database: ${DATABASE_PATH}
  Base URL: ${BASE_URL}
  `);
});

server.on('error', (err) => {
  console.error('Server error:', err.message);
  console.error('Stack:', err.stack);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
  console.error('Stack:', err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

module.exports = server;
