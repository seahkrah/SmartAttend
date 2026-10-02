/**
 * Proves the audit trail has no gap and no edit (migration 079).
 *
 *   npm run audit:verify                         every chain
 *   npm run audit:verify -- --tenant <id>        one tenant's chain
 *   npm run audit:verify -- --platform           the platform chain
 *   npm run audit:verify -- --checkpoint <file>  also compare with the heads
 *                                                saved by the last run, then
 *                                                save the current ones
 *
 * Connects with DATABASE_URL (the owner: it reads every tenant's chain).
 * Exits 1 if any chain is broken, printing each break with its position.
 * Run it on a schedule with a checkpoint file kept somewhere the database's
 * owner cannot write, and a rewritten end of the trail shows too.
 */
import fs from 'fs'
import pg from 'pg'
import { checkCheckpoint, NIL, verifyChain, type ChainProblem } from '../services/auditChain.js'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const tenant = arg('--tenant')
    const cpFile = arg('--checkpoint')
    let chains: Array<string | null>
    if (tenant) chains = [tenant]
    else if (process.argv.includes('--platform')) chains = [null]
    else {
      const r = await client.query(`SELECT chain FROM audit_chain_heads ORDER BY chain`)
      chains = r.rows.map((x) => (x.chain === NIL ? null : x.chain))
    }

    const saved: Record<string, { seq: number; hash: string }> =
      cpFile && fs.existsSync(cpFile) ? JSON.parse(fs.readFileSync(cpFile, 'utf8')).chains ?? {} : {}
    const next: Record<string, { seq: number; hash: string }> = { ...saved }
    let broken = 0
    for (const t of chains) {
      const report = await verifyChain(client, t)
      const key = t ?? NIL
      const problems: ChainProblem[] = [...report.problems]
      if (saved[key]) {
        const p = await checkCheckpoint(client, t, saved[key])
        if (p) problems.push(p)
      }
      const label = t ? `tenant ${t}` : 'platform'
      if (problems.length) {
        broken++
        console.log(`BROKEN  ${label}: ${report.rows} rows`)
        for (const p of problems) console.log(`        ${p.kind}${p.seq !== null ? ` at ${p.seq}` : ''}: ${p.detail}`)
      } else {
        console.log(`ok      ${label}: ${report.rows} rows, head ${report.head?.seq ?? 0}`)
        // Only an intact chain moves its checkpoint forward.
        if (report.last) next[key] = report.last
      }
    }
    if (cpFile) fs.writeFileSync(cpFile, JSON.stringify({ at: new Date().toISOString(), chains: next }, null, 2))
    console.log(`\n${chains.length - broken} of ${chains.length} chains intact`)
    process.exitCode = broken ? 1 : 0
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 2
})
