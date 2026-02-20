-- Add gender column to students and faculty tables
ALTER TABLE students ADD COLUMN IF NOT EXISTS gender VARCHAR(20);
ALTER TABLE faculty ADD COLUMN IF NOT EXISTS gender VARCHAR(20);

-- Add comments
COMMENT ON COLUMN students.gender IS 'Gender of the student (e.g., Male, Female, Other, Prefer not to say)';
COMMENT ON COLUMN faculty.gender IS 'Gender of the faculty member (e.g., Male, Female, Other, Prefer not to say)';
