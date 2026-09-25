# Face matching

Status: implemented and tested (API suite `faceMatchingApi`, unit and model tests
in `apps/backend/src/biometrics/biometrics.test.ts`). Off by default per tenant.

## What it is for

- **Schools:** a lecturer identifies a student in front of the camera during a
  class and records them present. The attendance record cites the match.
- **Employers:** an employee checks in with their face. The check-in cites the
  match.

Manual marking and plain check-in remain available at all times. Face matching
is an additional signal, never the only way to record attendance.

## What it proves, and what it does not

A successful match establishes that:

1. every photo contained exactly one face, large enough to describe;
2. the face's descriptor, computed **on the server** by dlib's ResNet-34
   face-recognition network (128 dimensions), is within the tenant's threshold
   (default 0.50 Euclidean; the network's published operating point is 0.60) of
   the enrolled template, and for identification is clearly closer to one
   student than to any other in the class;
3. all photos show the same person;
4. the head turned in the random order the server asked for (centre, left,
   right, shuffled), judged from 68 facial landmarks. A flat photo turned in
   front of the camera does not change this measure, so a printed or on-screen
   still image fails (verified in a browser with a still-image camera feed).

It does **not** establish:

- resistance to a **prepared video** of the person turning their head, to a
  **deepfake**, or to a **virtual camera** injecting frames. The pose challenge
  is random (1 in 6 chance a given recording fits), but a video with both turns
  can be cut to fit. There is no certified presentation-attack detection
  (ISO/IEC 30107-3).
- identity beyond "this face matches the one HR/the school enrolled". Whoever
  supervised the enrolment is responsible for it being the right person, which
  is why self-enrolment is refused.

Attendance records say "face matched", never "identity verified".

## Roles and permissions

| Action | Students | Employees |
|---|---|---|
| Turn on/off, set threshold | school `admin` | `admin`, `hr_director` |
| Record / withdraw consent | school `admin` | `admin`, `hr`, `hr_director`, or the employee themselves |
| Enrol (supervised capture) | school `admin`, or a lecturer who teaches the student | `admin`, `hr`, `hr_director`, never self |
| Verify (1:1) | — | the employee, for themselves |
| Identify (1:N) | lecturer, within a class they teach | — |
| Delete a template | school `admin` | `admin`, `hr`, `hr_director` |
| Read status | admin, the student's lecturer, the student | HR roles, the employee |
| Read the log | admin | HR roles |

Every lookup is inside the caller's tenant; another tenant's person reads as 404.

## Workflow

1. An administrator turns face matching on (`PUT /api/biometrics/settings`).
2. Consent is recorded with its basis, e.g. "Guardian's signed form, 12 March"
   (`POST /api/biometrics/subjects/:type/:id/consent`).
3. A supervised enrolment: `POST /api/biometrics/challenges {purpose:'enroll'}`
   returns a challenge (steps, expiry: 120 s, single use), then three photos go
   to `POST /api/biometrics/enroll`. The template is the average descriptor.
4. Use:
   - class: challenge `identify` → `POST /api/biometrics/identify` → `matchId`
     → cite it as `face_match_id` in `POST /api/faculty/attendance/mark` or
     `/api/faculty/attendance/facial-match`, or `faceMatchId` in
     `POST /api/attendance/mark-with-face`;
   - employee: challenge `verify` → `POST /api/biometrics/verify` → `matchId` →
     `POST /api/workforce/my/check-in {faceMatchId}`.
5. A match is usable for five minutes, by the person who made it, for the
   person it matched, once (unique index on the attendance column).

## Data model (migration 056)

- `biometric_consents`: one current consent per person; withdrawal is a
  timestamp, never a delete.
- `face_templates`: one per person; AES-256-GCM ciphertext, IV, tag and key
  version. The tenant, person and model are bound as associated data, so a
  ciphertext copied to another row will not open.
- `biometric_challenges`: issued-to, purpose, steps, expiry, consumed-at.
- `biometric_events`: append-only log of every consent change, enrolment,
  match and deletion, with outcome, reason, distance and threshold.
- `school_attendance.face_match_event_id`, `corporate_checkins.face_match_event_id`:
  a check constraint refuses `face_verified = true` without one.

Triggers keep every row inside its person's tenant, require current consent for
a template, and delete templates when consent is withdrawn, a student stops
being enrolled, an employee stops being employed, or the record is deleted.

## Configuration

| Variable | Meaning |
|---|---|
| `BIOMETRIC_TEMPLATE_KEY` | 32 bytes, as 64 hex characters or base64. Without it face matching is unavailable (503), never run with a default key. |
| `BIOMETRIC_TEMPLATE_KEY_VERSION` | Version stamped on new templates (default 1). |
| `BIOMETRIC_TEMPLATE_KEY_PREVIOUS`, `..._PREVIOUS_VERSION` | Lets templates sealed under the previous key still open during a rotation. |
| `FACE_ENGINE_CONCURRENCY` | Images analysed at once (default 2). |

Per tenant (`tenant_settings`): `biometrics.enabled`, `biometrics.match_threshold`
(clamped to 0.35–0.60).

## Limits and abuse controls

- Images: JPEG or PNG only, at most 2 MB, 160–4096 px per side, checked from
  the header before decoding; held in memory for the request and never stored.
- 30 challenges per user per 10 minutes.
- After five failed check-in matches in 15 minutes, face check-in pauses for
  that employee for 15 minutes (plain check-in still works).

## Operational requirements

- The server runs TensorFlow natively (`@tensorflow/tfjs-node`), which needs a
  glibc-based image (not Alpine) and about 500 MB of memory per concurrent
  analysis. Model weights ship in `@vladmandic/face-api` (MIT); the recognition
  network is dlib's (public domain / Boost licence).
- Losing `BIOMETRIC_TEMPLATE_KEY` makes every template unopenable; people must be
  re-enrolled. Back the key up separately from the database.
- Deleted templates remain in database backups until those backups expire.

## Testing

- `npx vitest run src/biometrics` — pose, matching, encryption, header checks,
  and the real networks on the fixture photos (same person under 0.5, different
  person over 0.6, poses read correctly, mirroring flips them).
- `src/tests/faceMatchingApi.e2e.py` — consent, enrolment failures (wrong pose
  order, two people, no face, two faces), identification, impostor refusal,
  single use of a match, withdrawal, employee check-in, pause after failures,
  tenant and role boundaries.
- Fixtures and their provenance: `apps/backend/src/tests/fixtures/faces/README.md`.
