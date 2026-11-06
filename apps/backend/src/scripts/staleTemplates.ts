/**
 * Face templates due for re-enrolment (brief 5.3), across every tenant.
 *
 *   npx tsx src/scripts/staleTemplates.ts [--json]
 *
 * A template is stale when it was made by another model version than the
 * one in use (src/biometrics/matching.ts MODEL_ID), or is older than its
 * tenant's re-enrolment interval (biometrics.reenrol_months, default 24).
 * Run it on a schedule. Each tenant's administrators see the same flag per
 * person in GET /api/biometrics/subjects. Nothing is deleted: a stale
 * template still matches, and re-enrolment replaces it.
 */
import pool, { query } from '../db/connection.js'
import { runAsSystem } from '../db/dbContext.js'
import { MODEL_ID } from '../biometrics/matching.js'

async function main() {
  const r = await runAsSystem('report: face templates due for re-enrolment, every tenant', () => query(
    `SELECT t.tenant_id, tn.name AS tenant, t.subject_type,
            count(*) FILTER (WHERE t.model <> $1)::int AS other_model,
            count(*) FILTER (WHERE t.model = $1 AND t.enrolled_at < CURRENT_TIMESTAMP - make_interval(months =>
              COALESCE((SELECT NULLIF(setting_value, '')::int FROM tenant_settings s
                         WHERE s.tenant_id = t.tenant_id AND s.setting_key = 'biometrics.reenrol_months'), 24)))::int AS too_old,
            count(*)::int AS templates
       FROM face_templates t JOIN tenants tn ON tn.id = t.tenant_id
      GROUP BY 1, 2, 3
      ORDER BY 2, 3`,
    [MODEL_ID]
  ))
  const due = r.rows.filter((x: any) => x.other_model + x.too_old > 0)
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ model: MODEL_ID, tenants: r.rows }, null, 2))
  } else {
    console.log(`model in use: ${MODEL_ID}`)
    for (const x of r.rows) {
      console.log(`${x.tenant} (${x.subject_type}): ${x.templates} templates, ${x.other_model} from another model, ${x.too_old} past the interval`)
    }
    console.log(due.length ? `${due.length} tenant group(s) have templates due for re-enrolment` : 'none due')
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => pool.end().catch(() => undefined))
