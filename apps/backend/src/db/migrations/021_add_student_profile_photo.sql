-- Add profile photo URL to students table
-- This allows storing student profile pictures

ALTER TABLE students ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS address TEXT;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_students_profile_photo ON students(id) WHERE profile_photo_url IS NOT NULL;

-- Add comment
COMMENT ON COLUMN students.profile_photo_url IS 'URL of the student profile photo (stored in static files or cloud storage)';
