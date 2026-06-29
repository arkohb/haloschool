-- HALOSCHOOL MULTI-TENANT MIGRATION
-- Change school_id to use school name slug instead of auto-incremented integers
-- Date: 2026-06-29

-- STEP 1: Backup existing data (if needed)
-- Run this BEFORE migration to backup: SELECT * INTO schools_backup FROM schools;

-- STEP 2: Add new columns
ALTER TABLE schools ADD COLUMN id_new VARCHAR(255);
ALTER TABLE schools ADD COLUMN name_display VARCHAR(255);

-- STEP 3: Migrate existing schools (if any)
-- For existing schools, generate slug from name
UPDATE schools 
SET id_new = LOWER(TRIM(REPLACE(REPLACE(REPLACE(REPLACE(name, ' ', '-'), '.', ''), '''', ''), '&', 'and')))
WHERE id_new IS NULL;

-- Handle duplicates by appending numbers
-- (This is handled in application logic, not SQL)

-- STEP 4: Drop old foreign keys
ALTER TABLE users DROP CONSTRAINT fk_users_school;
ALTER TABLE classes DROP CONSTRAINT fk_classes_school;
ALTER TABLE students DROP CONSTRAINT fk_students_school;
ALTER TABLE fees DROP CONSTRAINT fk_fees_school;
ALTER TABLE announcements DROP CONSTRAINT fk_announcements_school;

-- STEP 5: Migrate data to new columns
UPDATE users SET school_id = (SELECT id_new FROM schools WHERE schools.id = users.school_id) WHERE school_id IS NOT NULL;
UPDATE classes SET school_id = (SELECT id_new FROM schools WHERE schools.id = classes.school_id) WHERE school_id IS NOT NULL;
UPDATE students SET school_id = (SELECT id_new FROM schools WHERE schools.id = students.school_id) WHERE school_id IS NOT NULL;
UPDATE fees SET school_id = (SELECT id_new FROM schools WHERE schools.id = fees.school_id) WHERE school_id IS NOT NULL;
UPDATE announcements SET school_id = (SELECT id_new FROM schools WHERE schools.id = announcements.school_id) WHERE school_id IS NOT NULL;

-- STEP 6: Update schools table
ALTER TABLE schools DROP PRIMARY KEY;
ALTER TABLE schools DROP COLUMN id;
ALTER TABLE schools RENAME COLUMN id_new TO id;
ALTER TABLE schools ADD PRIMARY KEY (id);

-- STEP 7: Update school_id columns to VARCHAR
ALTER TABLE users MODIFY school_id VARCHAR(255);
ALTER TABLE classes MODIFY school_id VARCHAR(255);
ALTER TABLE students MODIFY school_id VARCHAR(255);
ALTER TABLE fees MODIFY school_id VARCHAR(255);
ALTER TABLE announcements MODIFY school_id VARCHAR(255);

-- STEP 8: Add foreign keys back
ALTER TABLE users ADD CONSTRAINT fk_users_school FOREIGN KEY (school_id) REFERENCES schools(id);
ALTER TABLE classes ADD CONSTRAINT fk_classes_school FOREIGN KEY (school_id) REFERENCES schools(id);
ALTER TABLE students ADD CONSTRAINT fk_students_school FOREIGN KEY (school_id) REFERENCES schools(id);
ALTER TABLE fees ADD CONSTRAINT fk_fees_school FOREIGN KEY (school_id) REFERENCES schools(id);
ALTER TABLE announcements ADD CONSTRAINT fk_announcements_school FOREIGN KEY (school_id) REFERENCES schools(id);

-- STEP 9: Add enrollment columns to users
ALTER TABLE users ADD COLUMN enrollment_token VARCHAR(255) UNIQUE NULL;
ALTER TABLE users ADD COLUMN temporary_password VARCHAR(255) NULL;
ALTER TABLE users ADD COLUMN must_change_password BOOLEAN DEFAULT false;

-- STEP 10: Verification
SELECT 'Migration complete! Check:' as status;
SELECT COUNT(*) as schools_count FROM schools;
SELECT COUNT(*) as users_count FROM users;
SELECT COUNT(*) as classes_count FROM classes;

