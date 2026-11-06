#!/usr/bin/env node
/**
 * Holds the face-matching evaluation to the gate (rubric `face-eval`):
 * FAR at or below 0.1% and FRR at or below 5% at the default threshold, on
 * an evaluation set, with the report committed.
 *
 * The report is docs/scorecard/evidence/face-eval-report.json, from
 * apps/backend/src/scripts/faceEval.ts (see scripts/face-eval/README.md).
 * This fails, saying why, when:
 *   - there is no report (the licensed, consented dataset is owner action
 *     OA-10);
 *   - the dataset is not declared an evaluation set (a smoke run on the
 *     test fixtures never passes), or does not state its licence, consent
 *     and provenance;
 *   - it is too small to measure 0.1% FAR (fewer than 3,000 impostor pairs)
 *     or 5% FRR (fewer than 300 genuine pairs);
 *   - it has no demographic breakdown;
 *   - the rates are over the limits, counting faces never found as
 *     rejections.
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const REPORT = path.join(ROOT, 'docs', 'scorecard', 'evidence', 'face-eval-report.json')
const LIMITS = { far: 0.001, frr: 0.05, minImpostorPairs: 3000, minGenuinePairs: 300, defaultThreshold: 0.5 }

const problems = []
if (!fs.existsSync(REPORT)) {
  console.error('face-eval: no report at docs/scorecard/evidence/face-eval-report.json')
  console.error('  The evaluation needs a licensed, consented face dataset: owner action OA-10.')
  console.error(
    '  Then: cd apps/backend && npx tsx src/scripts/faceEval.ts <dataset> --out ../../docs/scorecard/evidence/face-eval-report.json',
  )
  process.exit(1)
}
const r = JSON.parse(fs.readFileSync(REPORT, 'utf8'))
const d = r.dataset ?? {}
if (d.purpose !== 'evaluation') problems.push(`the dataset is declared "${d.purpose}", not "evaluation"`)
for (const k of ['licence', 'consent', 'provenance']) {
  if (!d[k] || String(d[k]).trim().length < 3) problems.push(`the dataset does not state its ${k}`)
}
if (r.threshold !== LIMITS.defaultThreshold)
  problems.push(`measured at ${r.threshold}, not the default threshold ${LIMITS.defaultThreshold}`)
const at = r.atThreshold ?? {}
if ((at.impostorPairs ?? 0) < LIMITS.minImpostorPairs) {
  problems.push(`${at.impostorPairs ?? 0} impostor pairs: too few to measure ${LIMITS.far * 100}% FAR`)
}
if ((at.genuinePairs ?? 0) < LIMITS.minGenuinePairs) {
  problems.push(`${at.genuinePairs ?? 0} genuine pairs: too few to measure ${LIMITS.frr * 100}% FRR`)
}
if (!r.demographics || Object.keys(r.demographics).length === 0) problems.push('no demographic breakdown')
if (!(typeof at.far === 'number' && at.far <= LIMITS.far)) problems.push(`FAR ${at.far} over ${LIMITS.far}`)
const frr = at.frrIncludingFailureToAcquire ?? at.frr
if (!(typeof frr === 'number' && frr <= LIMITS.frr))
  problems.push(`FRR ${frr} over ${LIMITS.frr} (faces never found count as rejections)`)

if (problems.length) {
  console.error(`face-eval: the report does not meet the gate`)
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}
console.log(
  `face-eval: ok (${d.name}: FAR ${at.far}, FRR ${frr} at ${r.threshold}; ${at.impostorPairs} impostor and ${at.genuinePairs} genuine pairs)`,
)
