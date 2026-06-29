# 🏢 HaloSchool Multi-Tenant Implementation Guide

## Overview
This guide explains how to implement the multi-tenant architecture with school name as unique identifier.

## Files Included in This Update

```
backend/
  ├── migrations/
  │   └── 001-school-name-id.sql          (Database migration)
  ├── public/
  │   └── enroll.html                     (Enrollment page for users)
  └── server.js                           (Updated with multi-tenant logic)

MULTITENANT-IMPLEMENTATION-GUIDE.md        (This file)
ROLLBACK-INSTRUCTIONS.md                   (How to undo if needed)
TESTING-GUIDE.md                          (How to test the changes)
```

## Architecture Changes

### School ID Format
**Before:** `school_id = 1, 2, 3` (auto-increment integer)
**After:** `school_id = "sunrise-academy"` (school name slug)

### Key Functions to Add

```javascript
// 1. Generate slug from school name
function generateSchoolSlug(schoolName) {
  return schoolName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// 2. Handle duplicate school names
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

// 3. Generate enrollment token (already exists, keep as is)
function generateEnrollmentToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = 'enr_';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

// 4. Generate temporary password
function generateTemporaryPassword() {
  const year = new Date().getFullYear();
  const random = Math.random().toString(36).substring(2, 10).toUpperCase();
  return `TmpPwd#${year}${random}`;
}
```

## API Endpoints to Add/Update

### 1. `/api/enroll` - Complete Enrollment
```javascript
POST /api/enroll
Body: {
  enrollment_token: "enr_...",
  email: "user@school.com",
  new_password: "SecurePassword123"
}
Returns: {
  token: "jwt_token",
  school_id: "school-name",
  role: "teacher",
  redirect: "/teacher"
}
```

### 2. `/api/enrollment-data` - Get Enrollment Details
```javascript
GET /api/enrollment-data?token=enr_...
Returns: {
  school_id: "school-name",
  school_name: "School Name",
  email: "user@school.com",
  role: "teacher",
  name: "User Name"
}
```

### 3. `/api/admin/add-teacher` - Add Teacher
```javascript
POST /api/admin/add-teacher
Requires: school_admin role
Body: {
  name: "Teacher Name",
  email: "teacher@school.com",
  phone: "+233...",
  subject: "Mathematics"
}
Returns: {
  message: "Teacher added to School Name",
  enrollment_link: "/enroll/enr_...",
  temporary_password: "TmpPwd#..."
}
```

### 4. `/api/admin/add-parent` - Add Parent
```javascript
POST /api/admin/add-parent
Similar to add-teacher
```

### 5. `/api/admin/add-student` - Add Student
```javascript
POST /api/admin/add-student
Similar to add-teacher
```

## Database Migration Steps

1. **Backup your database first!**
   ```bash
   # SQLite
   sqlite3 school.db ".backup school.db.backup"
   ```

2. **Run the migration**
   ```bash
   sqlite3 school.db < migrations/001-school-name-id.sql
   ```

3. **Verify the migration**
   ```bash
   sqlite3 school.db "SELECT COUNT(*) as schools FROM schools;"
   ```

## JWT Token Update

Update the `signToken()` function to include `school_id`:

```javascript
function signToken(user) {
  const payload = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    school_id: user.school_id,  // ← ADD THIS LINE
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400 * 30
  };
  return jwt.sign(payload, JWT_SECRET);
}
```

## API Filtering by School_ID

Update all API endpoints to filter by `me.school_id` from JWT:

```javascript
// Example: /api/teacher/classes
if (req.method === "GET" && p === "/api/teacher/classes") {
  if (!need("teacher", "school_admin", "super")) return;
  
  const schoolId = me.school_id;  // ← From JWT token
  
  const classes = db.prepare(`
    SELECT * FROM classes
    WHERE school_id = ?
  `).all(schoolId);
  
  return json(res, 200, { classes });
}
```

## School Registration Endpoint Update

```javascript
if (req.method === "POST" && p === "/api/school/signup") {
  const b = await jread(req);
  const { school_name, admin_name, email, phone, password, tier } = b;
  
  // Generate unique slug
  const school_id = getUniqueSchoolSlug(school_name);
  
  // Create school with slug as ID
  db.prepare(`
    INSERT INTO schools (id, name, email, phone, tier, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(school_id, school_name, email, phone, tier, 'pending');
  
  // Create school admin
  const { hash, salt } = hashPassword(password);
  db.prepare(`
    INSERT INTO users (
      school_id, name, email, login_id, role, password_hash, salt, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(school_id, admin_name, email, email, 'school_admin', hash, salt, 'pending');
}
```

## Login Endpoint Update

Ensure JWT includes school_id:

```javascript
if (req.method === "POST" && p === "/api/login") {
  // ... existing logic ...
  
  const token = signToken(u);  // Now includes school_id
  
  return json(res, 200, {
    token: token,
    school_id: u.school_id,       // ← Return school_id
    school_name: school?.name,    // ← Return school name
    role: u.role,
    // ... other fields ...
  });
}
```

## Frontend Updates

Update dashboard headers to show school name:

```javascript
// In dashboard HTML initialization
const schoolName = localStorage.getItem('school_name') || 'School';
document.getElementById('schoolHeader').textContent = schoolName;
```

## Testing Checklist

- [ ] Database migration completes without errors
- [ ] Can register a new school: "My Test School"
- [ ] School slug generated: "my-test-school"
- [ ] Super admin can approve the school
- [ ] School admin can login
- [ ] School admin can add a teacher
- [ ] Teacher receives enrollment email (or console log)
- [ ] Teacher can complete enrollment
- [ ] Teacher can login to dashboard
- [ ] Teacher sees only their school's data
- [ ] Second teacher in same school can be added
- [ ] Admin from different school cannot see first school's data

## Troubleshooting

### Migration Fails
1. Check if all tables have school_id column
2. Verify foreign key constraints exist
3. Backup and restore from backup if needed

### School Admin Cannot Login
1. Verify school_id in users table matches schools.id
2. Check that school status is 'active'
3. Verify password hash is correct

### Duplicate School Names
1. System automatically adds "-2", "-3", etc.
2. Check schools table for correct slugs
3. Verify uniqueness constraint works

## Rollback Instructions

See `ROLLBACK-INSTRUCTIONS.md` if you need to undo these changes.

## Support

For issues, check:
1. Database migration output
2. Server console logs
3. Browser developer console (F12)
4. API responses

