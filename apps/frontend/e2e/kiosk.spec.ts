/**
 * The attendance kiosk in a real browser (rubric gate `kiosk`).
 *
 * The camera is fake but the face check is real: getUserMedia is replaced
 * with a canvas stream, and the test draws whichever photograph matches the
 * instruction on screen (look straight, turn left, turn right). The photos
 * are the synthetic person the API suites use; the server matches them
 * against an enrolment made with the unmirrored set, with the same face
 * worker, thresholds and presentation-attack checks as anywhere else.
 *
 * Needs the API, face worker and seeded database (see playwright.config.ts)
 * and E2E_FIXTURE_DIR with corp.json from the seed.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const API = (process.env.API_BASE ?? 'http://127.0.0.1:5000').replace(/\/$/, '');
const FIXTURES = process.env.E2E_FIXTURE_DIR ?? path.resolve(HERE, '..', '..', 'backend', '.e2e-fixtures');
const FACES = path.resolve(HERE, '..', '..', 'backend', 'src', 'tests', 'fixtures', 'faces');
const corp = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'corp.json'), 'utf8'));
const A = corp.A;
const RUN = Date.now().toString(36).slice(-6);
const PIN = '2468';

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const dataUrl = (file: string) => `data:image/jpeg;base64,${fs.readFileSync(path.join(FACES, file)).toString('base64')}`;
type FakeCamera = { __setCamera: (url: string) => Promise<void> };
const POSE_OF = (instruction: string) => (/straight/i.test(instruction) ? 'center' : /left/i.test(instruction) ? 'left' : 'right');

let kioskId = '';
let siteId = '';
let pairingCode = '';
let employeeCode = '';

async function enrol(request: APIRequestContext) {
  const e1 = A.employees[0];
  await request.post(`${API}/api/biometrics/subjects/employee/${e1}/consent`, { headers: bearer(A.token), data: { basis: `Signed consent form (kiosk browser test ${RUN})` } });
  const ch = await (await request.post(`${API}/api/biometrics/challenges`, {
    headers: bearer(A.token), data: { purpose: 'enroll', subjectType: 'employee', subjectId: e1 },
  })).json();
  await new Promise((r) => setTimeout(r, 900));
  const steps: string[] = ch.steps;
  const multipart: Record<string, string> = { challengeId: ch.challengeId, frameTimes: JSON.stringify(steps.map((_, i) => i * 800)) };
  const files = steps.map((p, i) => ({ name: `f${i}.jpg`, mimeType: 'image/jpeg', buffer: fs.readFileSync(path.join(FACES, `synthetic-${p}.jpg`)) }));
  // Playwright's multipart takes one value per key; the API wants several "frames", so build the body by hand.
  const boundary = `----kiosk${RUN}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(multipart)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  for (const f of files) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="frames"; filename="${f.name}"\r\nContent-Type: image/jpeg\r\n\r\n`));
    parts.push(f.buffer, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const r = await request.post(`${API}/api/biometrics/enroll`, {
    headers: { ...bearer(A.token), 'Content-Type': `multipart/form-data; boundary=${boundary}` }, data: Buffer.concat(parts),
  });
  expect(r.status(), `enrolment: ${await r.text()}`).toBe(201);
}

/** A camera that shows whatever the test draws. */
async function fakeCamera(page: Page) {
  await page.addInitScript(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d')!;
    let img: HTMLImageElement | null = null;
    (window as unknown as FakeCamera).__setCamera = (url: string) => new Promise<void>((resolve) => {
      const i = new Image();
      i.onload = () => { img = i; canvas.width = i.naturalWidth; canvas.height = i.naturalHeight; resolve(); };
      i.src = url;
    });
    setInterval(() => { if (img) ctx.drawImage(img, 0, 0); }, 30);
    const stream = () => canvas.captureStream(15);
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => stream(), configurable: true });
  });
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  // A clean slate for employee 1 and the controls; face matching on.
  await request.post(`${API}/api/workforce/my/check-out`, { headers: bearer(A.empToken) });
  await request.put(`${API}/api/checkin-controls/settings`, { headers: bearer(A.adminToken), data: { geofence: 'off', network: 'off', device: 'off', shift_window: 'off' } });
  await request.put(`${API}/api/biometrics/settings`, { headers: bearer(A.dirToken), data: { enabled: true, threshold: 0.5 } });
  const emps = await (await request.get(`${API}/api/corporate/employees?limit=200`, { headers: bearer(A.adminToken) })).json();
  employeeCode = emps.data.find((e: { id: string; employee_id: string }) => e.id === A.employees[0]).employee_id;
  await enrol(request);
  const site = await (await request.post(`${API}/api/checkin-controls/sites`, {
    headers: bearer(A.adminToken), data: { name: `Browser kiosk site ${RUN}`, latitude: 6.3, longitude: -10.8 },
  })).json();
  siteId = site.site.id;
  const created = await (await request.post(`${API}/api/kiosk/admin/devices`, {
    headers: bearer(A.adminToken), data: { siteId, label: `Front door ${RUN}`, pin: PIN },
  })).json();
  kioskId = created.kiosk.id;
  pairingCode = created.pairingCode;
});

test.afterAll(async ({ request }) => {
  await request.post(`${API}/api/workforce/my/check-out`, { headers: bearer(A.empToken) });
  if (kioskId) await request.delete(`${API}/api/kiosk/admin/devices/${kioskId}`, { headers: bearer(A.adminToken) });
  if (siteId) await request.delete(`${API}/api/checkin-controls/sites/${siteId}`, { headers: bearer(A.adminToken) });
  await request.delete(`${API}/api/biometrics/subjects/employee/${A.employees[0]}/consent`, { headers: bearer(A.token), data: { reason: 'kiosk browser test done' } });
});

let page: Page;

test('the kiosk pairs with the code an administrator was shown', async ({ browser }) => {
  page = await browser.newPage();
  await fakeCamera(page);
  await page.goto('/kiosk?idle=6');
  await expect(page.getByRole('heading', { name: 'Pair this kiosk' })).toBeVisible();
  await page.getByLabel('Pairing code').fill('AAAA-AAAA');
  await page.getByRole('button', { name: 'Pair' }).click();
  await expect(page.getByRole('alert')).toContainText('not valid');
  await page.getByLabel('Pairing code').fill(pairingCode.toLowerCase());
  await page.getByRole('button', { name: 'Pair' }).click();
  await expect(page.getByRole('heading', { name: 'Check in or out' })).toBeVisible();
  await expect(page.getByText(`Front door ${RUN}`)).toBeVisible();
});

test('an unknown number is refused without saying whose numbers exist', async () => {
  await page.getByLabel('Employee number').fill('NOBODY-123');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert')).toContainText('No employee with that number');
});

test('an employee checks in by face, with the fake camera', async () => {
  await page.evaluate((u) => (window as unknown as FakeCamera).__setCamera(u), dataUrl('synthetic-center-m.jpg'));
  await page.getByLabel('Employee number').fill(employeeCode);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: /Hello, Emp1 A\./ })).toBeVisible();
  await page.getByRole('button', { name: 'Check in with my face' }).click();
  const dialog = page.getByRole('dialog');
  const instruction = dialog.getByText(/^Step \d of \d:/);
  await expect(instruction).toBeVisible();
  const steps = Number(/of (\d):/.exec((await instruction.textContent()) ?? '')?.[1] ?? 0);
  expect(steps).toBeGreaterThanOrEqual(2);
  for (let step = 1; step <= steps; step++) {
    await expect(instruction).toContainText(`Step ${step} of ${steps}:`);
    const text = (await instruction.textContent()) ?? '';
    // Show the pose asked for, as a person would, then take the photo.
    await page.evaluate((u) => (window as unknown as FakeCamera).__setCamera(u), dataUrl(`synthetic-${POSE_OF(text)}-m.jpg`));
    await page.waitForTimeout(900);
    await dialog.getByRole('button', { name: 'Take photo' }).click();
  }
  await expect(page.getByRole('status')).toContainText(/Emp1 A\. checked in at/, { timeout: 30_000 });
});

test('the result clears itself for the next person', async () => {
  await expect(page.getByRole('heading', { name: 'Check in or out' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel('Employee number')).toHaveValue('');
});

test('the attendant checks the employee out with the PIN, after a wrong one', async () => {
  await page.getByLabel('Employee number').fill(employeeCode);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('You are checked in. Check out?')).toBeVisible();
  await page.getByRole('button', { name: 'Use the attendant instead' }).click();
  await page.getByLabel('Attendant PIN').fill('0000');
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('alert')).toContainText('That PIN is not right');
  await page.getByLabel('Attendant PIN').fill(PIN);
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('status')).toContainText(/Emp1 A\. checked out at/);
});

test('left alone, it starts again and forgets who was there', async () => {
  await expect(page.getByRole('heading', { name: 'Check in or out' })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Employee number').fill(employeeCode);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: /Hello, Emp1 A\./ })).toBeVisible();
  await expect(page.getByText('Nobody was using the kiosk, so it started again.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: /Hello/ })).toHaveCount(0);
});

test('a kiosk token reaches nothing but the kiosk', async ({ request }) => {
  const token = await page.evaluate(() => localStorage.getItem('jjelotech.kioskToken'));
  expect(token).toBeTruthy();
  const r = await request.get(`${API}/api/workforce/my/attendance`, { headers: { Authorization: `Kiosk ${token}` } });
  expect(r.status()).toBe(401);
  const r2 = await request.get(`${API}/api/kiosk/session`, { headers: bearer(A.adminToken) });
  expect(r2.status()).toBe(401);
});

test('a revoked kiosk asks to be paired again', async ({ request }) => {
  const r = await request.delete(`${API}/api/kiosk/admin/devices/${kioskId}`, { headers: bearer(A.adminToken) });
  expect(r.status()).toBe(200);
  kioskId = '';
  await page.getByLabel('Employee number').fill(employeeCode);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Pair this kiosk' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('no longer paired');
  expect(await page.evaluate(() => localStorage.getItem('jjelotech.kioskToken'))).toBeNull();
});
