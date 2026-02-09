# Database Cleanup & Migration Reset

This directory contains scripts for cleaning up failed database migrations and resetting the database schema.

## Quick Start

### Option 1: Automatic Cleanup (Recommended)

```powershell
cd C:\smartattend\apps\backend
.\scripts\cleanup-migrations.ps1
```

This will:
1. ✓ Connect to your database
2. ✓ Remove failed migrations (001_init_schema.sql, 004_superadmin_system.sql)
3. ✓ Display remaining migrations
4. ✓ Provide next steps

### Option 2: Manual Cleanup with psql

If you have PostgreSQL client tools installed:

```powershell
# Set up environment
$env:DATABASE_URL = "your_database_url_here"

# Connect and run cleanup
psql $env:DATABASE_URL -f .\scripts\cleanup-migrations.sql
```

### Option 3: Manual SQL Execution

Connect to your database directly using any PostgreSQL client (pgAdmin, DBeaver, etc.) and run:

```sql
DELETE FROM migrations WHERE name = '001_init_schema.sql';
DELETE FROM migrations WHERE name = '004_superadmin_system.sql';
SELECT * FROM migrations ORDER BY executed_at;
```

## After Cleanup

Restart the backend to re-execute migrations:

```powershell
cd C:\smartattend\apps\backend
npm run dev
```

You should see:
```
[MIGRATION] Running 001_init_schema.sql...
[MIGRATION] ✓ 001_init_schema.sql completed
[MIGRATION] Running 004_superadmin_system.sql...
[MIGRATION] ✓ 004_superadmin_system.sql completed
```

## Troubleshooting

### "Error: Could not find .env file"
Run the script from the backend directory or parent directory:
```powershell
cd C:\smartattend\apps\backend
.\scripts\cleanup-migrations.ps1
```

### "Error: node_modules not found"
Install dependencies first:
```powershell
npm install
```

### "Error: connect ECONNREFUSED"
Make sure PostgreSQL is running:
```powershell
# Check if PostgreSQL is running (Windows)
Get-Service postgresql-* | Select-Object Name, Status
```

### Database still has errors after cleanup
The fixes required:
1. Migration 001 had indexes on tables dropped in 002
2. Migration 002 was missing the `description` column on `platforms`

These have been fixed in the migration files. After cleanup, the correct versions will be applied.

## Full Database Reset (Advanced)

⚠️ **WARNING: This will delete ALL data!**

If you need to completely reset the database:

```sql
TRUNCATE TABLE migrations CASCADE;
-- Then restart the backend to re-run all migrations from scratch
```

## Files

- `cleanup-migrations.ps1` - PowerShell cleanup script (automated)
- `cleanup-migrations.sql` - Raw SQL cleanup (manual)
