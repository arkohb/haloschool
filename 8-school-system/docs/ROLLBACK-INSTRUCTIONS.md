# 🔄 Rollback Instructions

If you need to undo the multi-tenant changes, follow these steps.

## Option 1: Quick Rollback (If Migration Not Yet Run)

1. **Do NOT run the migration SQL**
2. Simply:
   - Remove `enroll.html` from public/
   - Revert `server.js` to previous version
   - Git: `git revert HEAD`

## Option 2: Full Rollback (After Migration Completed)

### Step 1: Backup Current Database
```bash
sqlite3 school.db ".backup school.db.post-migration"
```

### Step 2: Restore from Pre-Migration Backup
```bash
cp school.db.backup school.db
# OR
sqlite3 school.db < schema-backup.sql
```

### Step 3: Revert Code
```bash
git revert HEAD
# OR manually restore previous server.js
```

### Step 4: Restart Server
```bash
npm start
```

## Option 3: Manual Database Rollback

If you need to manually convert school slugs back to integers:

```sql
-- Create new integer ID column
ALTER TABLE schools ADD COLUMN id_integer INT AUTO_INCREMENT;

-- Map slugs back to integers (adjust mapping as needed)
UPDATE schools SET id_integer = 1 WHERE id = 'sunrise-academy';
UPDATE schools SET id_integer = 2 WHERE id = 'st-james-high-school';
-- ... continue for all schools ...

-- Update all foreign keys
UPDATE users SET school_id = (SELECT id_integer FROM schools WHERE schools.id = users.school_id);
-- ... repeat for all tables ...

-- Drop old ID column and rename new one
ALTER TABLE schools DROP COLUMN id;
ALTER TABLE schools RENAME COLUMN id_integer TO id;
```

## Important Notes

- **Always backup first!** This cannot be undone without backup.
- Enrollment tokens will be lost if you rollback
- Users who completed enrollment will need to re-enroll
- School data itself is safe and preserved

## Prevention

To prevent needing rollback:
1. Test in staging environment first
2. Keep database backups
3. Have a rollback plan before deploying
4. Document all changes

## Support

If rollback fails:
1. Restore from backup
2. Don't attempt further changes
3. Contact support with:
   - Error messages
   - Database version
   - What you were trying to do

