# 🧪 Testing Guide for Multi-Tenant Update

## Pre-Deployment Testing

### 1. Database Migration Testing

```bash
# Backup production database
cp school.db school.db.pre-migration

# Run migration in test database
sqlite3 school_test.db < migrations/001-school-name-id.sql

# Verify structure
sqlite3 school_test.db ".schema schools"
sqlite3 school_test.db ".schema users"

# Check data integrity
sqlite3 school_test.db "SELECT COUNT(*) FROM schools;"
sqlite3 school_test.db "SELECT COUNT(*) FROM users;"
```

### 2. Server Startup Testing

```bash
# Start server with test database
DATABASE=school_test.db node backend/server.js

# Check for errors in console
# Should see: "Server running on..."
# Should NOT see: "Syntax error" or database errors
```

### 3. Unit Tests

Test these functions individually:

```javascript
// Test slug generation
console.log(generateSchoolSlug("Sunrise Academy"));
// Expected: "sunrise-academy"

console.log(generateSchoolSlug("St. James High School"));
// Expected: "st-james-high-school"

console.log(generateSchoolSlug("ABC-123 School"));
// Expected: "abc-123-school"

// Test enrollment token generation
console.log(generateEnrollmentToken());
// Expected: "enr_" + 32 random chars

// Test password generation
console.log(generateTemporaryPassword());
// Expected: "TmpPwd#2026XXXXXXXX"
```

## Integration Tests

### Test 1: School Registration

```bash
curl -X POST http://localhost:5000/api/school/signup \
  -H "Content-Type: application/json" \
  -d '{
    "school_name": "Test School 2026",
    "admin_name": "Admin Name",
    "email": "admin@testschool.com",
    "phone": "+233 24 123 4567",
    "password": "TestPassword123",
    "tier": "professional"
  }'

# Expected Response:
{
  "message": "School registered successfully",
  "school_id": "test-school-2026",
  "school_name": "Test School 2026",
  "status": "pending_approval"
}
```

### Test 2: Super Admin Approval

```bash
curl -X POST http://localhost:5000/api/super/approve-school \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_SUPER_TOKEN" \
  -d '{
    "school_id": "test-school-2026",
    "action": "approve"
  }'

# Expected Response:
{
  "message": "Test School 2026 approved!",
  "school_id": "test-school-2026"
}
```

### Test 3: School Admin Login

```bash
curl -X POST http://localhost:5000/api/login \
  -H "Content-Type: application/json" \
  -d '{
    "login_id": "admin@testschool.com",
    "password": "TestPassword123"
  }'

# Expected Response:
{
  "token": "eyJhbGc...",
  "role": "school_admin",
  "school_id": "test-school-2026",
  "school_name": "Test School 2026",
  "name": "Admin Name"
}

# Save the token for next tests:
TOKEN="eyJhbGc..."
```

### Test 4: Add Teacher with Enrollment

```bash
curl -X POST http://localhost:5000/api/admin/add-teacher \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Teacher Name",
    "email": "teacher@testschool.com",
    "phone": "+233 24 987 6543",
    "subject": "Mathematics"
  }'

# Expected Response:
{
  "message": "Teacher added to Test School 2026",
  "email": "teacher@testschool.com",
  "enrollment_link": "http://localhost:5000/enroll/enr_abc123...",
  "temporary_password": "TmpPwd#2026xyz..."
}

# Save enrollment details:
ENROLLMENT_TOKEN="enr_abc123..."
TEMP_PASSWORD="TmpPwd#2026xyz..."
```

### Test 5: Get Enrollment Data

```bash
curl "http://localhost:5000/api/enrollment-data?token=$ENROLLMENT_TOKEN"

# Expected Response:
{
  "school_id": "test-school-2026",
  "school_name": "Test School 2026",
  "email": "teacher@testschool.com",
  "role": "teacher",
  "name": "Teacher Name"
}
```

### Test 6: Complete Enrollment

```bash
curl -X POST http://localhost:5000/api/enroll \
  -H "Content-Type: application/json" \
  -d '{
    "enrollment_token": "'$ENROLLMENT_TOKEN'",
    "email": "teacher@testschool.com",
    "new_password": "TeacherPassword123"
  }'

# Expected Response:
{
  "token": "eyJhbGc...",
  "school_id": "test-school-2026",
  "role": "teacher",
  "redirect": "/teacher"
}

# Save token:
TEACHER_TOKEN="eyJhbGc..."
```

### Test 7: Teacher Dashboard Access

```bash
curl -H "Authorization: Bearer $TEACHER_TOKEN" \
  http://localhost:5000/api/teacher/classes

# Expected Response:
{
  "classes": [...]  # Only Test School 2026 classes
}
```

### Test 8: Duplicate School Name Handling

```bash
curl -X POST http://localhost:5000/api/school/signup \
  -H "Content-Type: application/json" \
  -d '{
    "school_name": "Test School 2026",
    "admin_name": "Another Admin",
    "email": "admin2@testschool.com",
    "phone": "+233 24 987 6543",
    "password": "TestPassword123",
    "tier": "professional"
  }'

# Expected Response (should NOT fail):
{
  "message": "School registered successfully",
  "school_id": "test-school-2026-2",  # Note the -2
  "school_name": "Test School 2026",
  "status": "pending_approval"
}
```

## Browser Testing

### Enrollment Page

1. Open browser: `http://localhost:5000/enroll/enr_abc123...`
2. Should see:
   - Loading spinner briefly
   - School name: "Test School 2026"
   - Email: "teacher@testschool.com"
   - Role: "Teacher"
   - Password fields
3. Enter password: `TeacherPassword123`
4. Confirm password: `TeacherPassword123`
5. Click "Set Password & Login"
6. Should redirect to `/teacher` dashboard

### Dashboard Verification

1. Login as school admin for School 1
2. Check header shows: "Test School 2026"
3. Add a second teacher
4. Logout and login as school admin for School 2 (if exists)
5. Verify School 2's data is NOT visible
6. Verify School 1's data is NOT visible

## Security Testing

### Test: Cross-School Access Prevention

```bash
# Get token for School 1 admin
TOKEN_SCHOOL_1="..."

# Try to access School 2 data
curl -H "Authorization: Bearer $TOKEN_SCHOOL_1" \
  "http://localhost:5000/api/admin/students?school_id=school-2"

# Expected Response: 403 Forbidden
# Should NOT return data from school-2
```

### Test: Invalid Enrollment Token

```bash
curl -X POST http://localhost:5000/api/enroll \
  -H "Content-Type: application/json" \
  -d '{
    "enrollment_token": "invalid_token",
    "email": "teacher@testschool.com",
    "new_password": "Password123"
  }'

# Expected Response: 404 Not Found
```

### Test: JWT Expiration

```bash
# Use an expired token
curl -H "Authorization: Bearer expired_token" \
  http://localhost:5000/api/teacher/classes

# Expected Response: 401 Unauthorized
```

## Performance Testing

### Load Testing

```bash
# Test 100 concurrent connections
ab -n 1000 -c 100 http://localhost:5000/api/teacher/classes

# Should complete without errors
# Response time should be < 500ms per request
```

## Rollback Testing

1. Create test data with new system
2. Run full rollback
3. Verify old system still works
4. Verify data is intact

## Checklist

- [ ] Database migration runs without errors
- [ ] Server starts successfully with new code
- [ ] School registration works
- [ ] School slug generation is correct
- [ ] Duplicate school names handled properly
- [ ] Super admin can approve/reject schools
- [ ] School admin can login
- [ ] School admin can add teacher
- [ ] Enrollment link works
- [ ] Enrollment page loads correctly
- [ ] Teacher can complete enrollment
- [ ] Teacher can login
- [ ] Teacher dashboard shows school name
- [ ] Cross-school data access is blocked
- [ ] Invalid tokens are rejected
- [ ] Performance is acceptable
- [ ] Rollback works if needed

## Common Issues and Fixes

### Issue: "school_id type mismatch"
**Fix:** Ensure all school_id columns are VARCHAR(255) after migration

### Issue: Enrollment link returns 404
**Fix:** Verify enrollment_token exists in users table

### Issue: Teacher login fails
**Fix:** Verify school_id matches between users and schools tables

### Issue: Dashboard shows all schools' data
**Fix:** Ensure API endpoints filter by `me.school_id` from JWT

