-- Add title and address columns to faculty table
ALTER TABLE faculty ADD COLUMN IF NOT EXISTS title VARCHAR(50);
ALTER TABLE faculty ADD COLUMN IF NOT EXISTS address TEXT;
