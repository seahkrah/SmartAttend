/**
 * The face-matching evaluation harness (brief 5.4; rubric gate `face-eval`).
 *
 *   npx tsx src/scripts/faceEval.ts <dataset-dir> [--threshold 0.5] [--out <report.json>]
 *
 * The dataset directory holds images and a manifest.json:
 *
 *   {
 *     "name": "...", "purpose": "evaluation" | "smoke",
 *     "licence": "...", "consent": "...", "provenance": "...",
 *     "identities": [
 *       { "id": "p001", "demographics": { "sex": "...", "ageBand": "...", "skinTone": "..." },
 *         "images": [ { "file": "p001/1.jpg", "lighting": "indoor", "device": "phone" } ] }
 *     ]
 *   }
 *
 * Each image is described by the same engine the API uses (the first face
 * found). Every pair of images is then compared: pairs of one person are
 * genuine, pairs of two people are impostors. The report gives:
 *   - FAR (impostor pairs at or under the threshold) and FRR (genuine pairs
 *     over it) at the chosen threshold;
 *   - ROC data over thresholds 0.30 to 0.80;
 *   - the same broken down by lighting and device class (pairs that share
 *     both images' class) and by demographic group;
 *   - images in which no face was found (failure to acquire), which count
 *     against FRR.
 * It states the dataset's size and limits. scripts/face-eval/check-report.mjs
 * holds the report to the gate. A "smoke" manifest (the test fixtures, say)
 * runs the harness but never passes the gate.
 */
import fs from 'fs'
import path from 'path'
import { analyzeFrame } from '../biometrics/engine.js'
import { distance, MODEL_ID } from '../biometrics/matching.js'

interface Image { file: string; lighting?: string; device?: string }
interface Identity { id: string; demographics?: Record<string, string>; images: Image[] }
interface Manifest { name: string; purpose: string; licence: string; consent: string; provenance: string; identities: Identity[] }

const args = process.argv.slice(2)
const datasetDir = args.find((a) => !a.startsWith('--'))
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const THRESHOLD = Number(opt('threshold') ?? 0.5)

interface Described { identity: string; lighting: string; device: string; demographics: Record<string, string>; d: Float32Array }

function rates(genuine: number[], impostor: number[], t: number) {
  return {
    far: impostor.length ? impostor.filter((x) => x <= t).length / impostor.length : null,
    frr: genuine.length ? genuine.filter((x) => x > t).length / genuine.length : null,
    genuinePairs: genuine.length,
    impostorPairs: impostor.length,
  }
}

async function main() {
  if (!datasetDir) throw new Error('usage: faceEval.ts <dataset-dir> [--threshold 0.5] [--out report.json]')
  const manifest: Manifest = JSON.parse(fs.readFileSync(path.join(datasetDir, 'manifest.json'), 'utf8'))
  for (const k of ['name', 'purpose', 'licence', 'consent', 'provenance'] as const) {
    if (!manifest[k] || String(manifest[k]).trim().length < 3) throw new Error(`manifest.json must say ${k}`)
  }

  const described: Described[] = []
  const notAcquired: string[] = []
  for (const who of manifest.identities) {
    for (const img of who.images) {
      const buf = fs.readFileSync(path.join(datasetDir, img.file))
      try {
        const { faces } = await analyzeFrame(buf)
        if (!faces.length) {
          notAcquired.push(img.file)
          continue
        }
        described.push({
          identity: who.id, lighting: img.lighting ?? 'unknown', device: img.device ?? 'unknown',
          demographics: who.demographics ?? {}, d: faces[0].descriptor,
        })
      } catch {
        notAcquired.push(img.file)
      }
    }
  }

  type Pair = { same: boolean; dist: number; a: Described; b: Described }
  const pairs: Pair[] = []
  for (let i = 0; i < described.length; i++) {
    for (let j = i + 1; j < described.length; j++) {
      const a = described[i]
      const b = described[j]
      pairs.push({ same: a.identity === b.identity, dist: distance(a.d, b.d), a, b })
    }
  }
  const of = (ps: Pair[]) => ({ genuine: ps.filter((p) => p.same).map((p) => p.dist), impostor: ps.filter((p) => !p.same).map((p) => p.dist) })
  const all = of(pairs)
  // A face never found is a genuine comparison that could not be made: it is
  // counted as a false rejection for each image of the same person.
  const missedGenuine = notAcquired.length
  const at = rates(all.genuine, all.impostor, THRESHOLD)
  const frrWithFta = all.genuine.length + missedGenuine
    ? (all.genuine.filter((x) => x > THRESHOLD).length + missedGenuine) / (all.genuine.length + missedGenuine)
    : null

  const roc = []
  for (let t = 0.3; t <= 0.8001; t += 0.02) {
    const r = rates(all.genuine, all.impostor, t)
    roc.push({ threshold: Math.round(t * 100) / 100, far: r.far, frr: r.frr })
  }
  const by = (key: (d: Described) => string) => {
    const groups = new Map<string, Pair[]>()
    for (const p of pairs) {
      const ka = key(p.a)
      if (ka !== key(p.b)) continue
      groups.set(ka, [...(groups.get(ka) ?? []), p])
    }
    return Object.fromEntries([...groups].map(([k, ps]) => {
      const g = of(ps)
      return [k, rates(g.genuine, g.impostor, THRESHOLD)]
    }))
  }
  const demographicKeys = [...new Set(manifest.identities.flatMap((i) => Object.keys(i.demographics ?? {})))]

  const report = {
    generatedAt: new Date().toISOString(),
    model: MODEL_ID,
    dataset: {
      name: manifest.name, purpose: manifest.purpose, licence: manifest.licence, consent: manifest.consent,
      provenance: manifest.provenance, identities: manifest.identities.length,
      images: manifest.identities.reduce((n, i) => n + i.images.length, 0), described: described.length,
      notAcquired: notAcquired.length,
    },
    threshold: THRESHOLD,
    atThreshold: { ...at, frrIncludingFailureToAcquire: frrWithFta },
    roc,
    byLighting: by((d) => d.lighting),
    byDevice: by((d) => d.device),
    demographics: Object.fromEntries(demographicKeys.map((k) => [k, by((d) => d.demographics[k] ?? 'unrecorded')])),
    limits: [
      `${manifest.identities.length} identities and ${described.length} described images: rates below 1 in ${Math.max(1, all.impostor.length)} impostor pairs cannot be measured.`,
      'Groups with few identities give unstable rates; read the pair counts beside each.',
      'The rates are for this dataset and this engine at this threshold, not for any other population.',
    ],
  }
  const out = opt('out')
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n')
    console.error(`report written to ${out}`)
  } else {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  }
}

main().then(() => process.exit(0), (e) => {
  console.error(e?.message ?? e)
  process.exit(1)
})
