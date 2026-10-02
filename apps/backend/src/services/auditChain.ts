/**
 * Verifying the audit hash chain (migration 079).
 *
 * Walks a chain in order and recomputes every row's hash in the database
 * (audit_row_canonical, the same function the insert trigger uses), so the
 * verifier and the writer cannot disagree about what a row's text is.
 * Reports every break, each with its position:
 *
 *   gap        a position is missing (a row was deleted) or repeated
 *   link       a row's prev_hash is not the previous row's hash
 *   content    a row's hash does not match its content (it was edited)
 *   head       the stored head is not the last row (rows removed from the end
 *              with the head left alone, or the head moved)
 *   unchained  rows with no position (written with the trigger switched off)
 *
 * Removing the last rows and rewinding the head to match leaves a chain that
 * is consistent; that is caught by comparing with a checkpoint taken earlier
 * (checkCheckpoint), an export, or the stream.
 */
type Runner = { query: (text: string, params?: any[]) => Promise<any> }

export const NIL = '00000000-0000-0000-0000-000000000000'
const GENESIS = '0'.repeat(64)
const BATCH = 5000

export interface ChainProblem {
  kind: 'gap' | 'link' | 'content' | 'head' | 'unchained'
  seq: number | null
  detail: string
}

export interface ChainReport {
  chain: string
  ok: boolean
  rows: number
  head: { seq: number; hash: string } | null
  last: { seq: number; hash: string } | null
  problems: ChainProblem[]
}

// A chain is named by its key: the tenant's id, or NIL for the platform's.
// COALESCE(tenant_id, NIL) is the expression the unique position index
// (migration 079) is on, so every query below uses it, with the key bound.
const IN_CHAIN = `COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid) = $1`
const BATCH_SQL =
  `SELECT chain_seq, prev_hash, row_hash, encode(digest(audit_row_canonical(a), 'sha256'), 'hex') AS recomputed
     FROM audit_logs a WHERE ${IN_CHAIN} AND chain_seq > $2 ORDER BY chain_seq LIMIT ${BATCH}`
const UNCHAINED_SQL = `SELECT count(*)::int AS n FROM audit_logs WHERE ${IN_CHAIN} AND chain_seq IS NULL`
const AT_SQL = `SELECT row_hash FROM audit_logs WHERE ${IN_CHAIN} AND chain_seq = $2`

export async function verifyChain(q: Runner, tenantId: string | null, maxProblems = 50): Promise<ChainReport> {
  const chain = tenantId ?? NIL
  const problems: ChainProblem[] = []
  const add = (p: ChainProblem) => { if (problems.length < maxProblems) problems.push(p) }

  let expected = 1
  let prev = GENESIS
  let rows = 0
  let last: ChainReport['last'] = null
  for (;;) {
    const r = await q.query(BATCH_SQL, [chain, last?.seq ?? 0])
    for (const row of r.rows) {
      const seq = Number(row.chain_seq)
      if (seq !== expected) {
        add({ kind: 'gap', seq: expected, detail: seq > expected
          ? `positions ${expected}–${seq - 1} are missing` : `position ${seq} appears again` })
      }
      if (row.prev_hash !== prev) add({ kind: 'link', seq, detail: 'does not follow from the row before it' })
      if (row.recomputed !== row.row_hash) add({ kind: 'content', seq, detail: 'its content does not match its hash' })
      prev = row.row_hash
      expected = seq + 1
      last = { seq, hash: row.row_hash }
      rows++
    }
    if (r.rows.length < BATCH) break
  }

  const h = await q.query(`SELECT seq, head_hash FROM audit_chain_heads WHERE chain = $1`, [chain])
  const head = h.rows.length ? { seq: Number(h.rows[0].seq), hash: h.rows[0].head_hash as string } : null
  const lastSeen = last as ChainReport['last']
  if (head && (head.seq !== (lastSeen?.seq ?? 0) || (lastSeen && head.hash !== lastSeen.hash))) {
    add({ kind: 'head', seq: head.seq, detail: `the head says position ${head.seq}, the last row is ${lastSeen?.seq ?? 'none'}` })
  }
  if (!head && lastSeen) add({ kind: 'head', seq: null, detail: 'the chain has rows but no head' })

  const un = await q.query(UNCHAINED_SQL, [chain])
  if (un.rows[0].n > 0) add({ kind: 'unchained', seq: null, detail: `${un.rows[0].n} rows were written outside the chain` })

  return { chain, ok: problems.length === 0, rows, head, last: lastSeen, problems }
}

/**
 * A checkpoint is a chain's head as last seen. If the row at that position
 * no longer has that hash, or is gone, history before the current head was
 * rewritten, even if the chain is now consistent with itself.
 */
export async function checkCheckpoint(q: Runner, tenantId: string | null, cp: { seq: number; hash: string }): Promise<ChainProblem | null> {
  const r = await q.query(AT_SQL, [tenantId ?? NIL, cp.seq])
  if (!r.rows.length) return { kind: 'head', seq: cp.seq, detail: `position ${cp.seq}, seen before, is gone (rows were removed from the end)` }
  if (r.rows[0].row_hash !== cp.hash) return { kind: 'content', seq: cp.seq, detail: `position ${cp.seq} is not the row seen before` }
  return null
}
