-- 033: biometric templates become tenant-owned, with one template per student.
--
-- student_face_embeddings carried no tenant column, so the only thing tying a
-- face template to a school was the student row it pointed at. Any query that
-- reached the table without joining students — and the face-scan route did
-- exactly that — was unscoped. This is the most sensitive data in the system,
-- so it carries its own ownership rather than borrowing someone else's.
--
-- The unique constraint was (student_id, embedding_hash), which stores a new
-- row per distinct capture: every ON CONFLICT (student_id) upsert in the
-- application raised 42P10 and fell through to a delete-then-insert written
-- as an error handler. A student has one current template; say so.

ALTER TABLE student_face_embeddings
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE RESTRICT;

UPDATE student_face_embeddings sfe
   SET tenant_id = s.tenant_id
  FROM students s
 WHERE s.id = sfe.student_id AND sfe.tenant_id IS NULL;

-- A template whose student no longer exists cannot be attributed to a tenant
-- and must not linger unscoped.
DELETE FROM student_face_embeddings WHERE tenant_id IS NULL;

ALTER TABLE student_face_embeddings ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_student_face_embeddings_tenant
  ON student_face_embeddings (tenant_id);

-- Keep only the most recent capture per student before the constraint lands.
DELETE FROM student_face_embeddings a
 USING student_face_embeddings b
 WHERE a.student_id = b.student_id
   AND (a.captured_at < b.captured_at
        OR (a.captured_at = b.captured_at AND a.id < b.id));

ALTER TABLE student_face_embeddings
  DROP CONSTRAINT IF EXISTS student_face_embeddings_student_id_embedding_hash_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_face_embeddings_student
  ON student_face_embeddings (student_id);
