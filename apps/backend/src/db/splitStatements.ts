/**
 * Split a SQL script into individual statements.
 *
 * Splitting on ';' is not safe: a semicolon inside a dollar-quoted body
 * (`DO $$ ... END $$`, `CREATE FUNCTION ... $$ ... $$`), a string literal, a
 * quoted identifier or a comment is not a statement terminator. Doing it
 * naively truncates every function and DO block in the migrations.
 *
 * This scanner tracks the four contexts a semicolon can hide in and only
 * splits at top level.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let i = 0

  while (i < sql.length) {
    const rest = sql.slice(i)

    // Line comment — runs to end of line.
    if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', i)
      const stop = end === -1 ? sql.length : end + 1
      current += sql.slice(i, stop)
      i = stop
      continue
    }

    // Block comment. Postgres nests these, so track depth.
    if (rest.startsWith('/*')) {
      let depth = 1
      let j = i + 2
      while (j < sql.length && depth > 0) {
        if (sql.startsWith('/*', j)) {
          depth++
          j += 2
        } else if (sql.startsWith('*/', j)) {
          depth--
          j += 2
        } else {
          j++
        }
      }
      current += sql.slice(i, j)
      i = j
      continue
    }

    // Single-quoted string. '' is an escaped quote, not a terminator.
    if (rest[0] === "'") {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2
        } else if (sql[j] === "'") {
          j++
          break
        } else {
          j++
        }
      }
      current += sql.slice(i, j)
      i = j
      continue
    }

    // Double-quoted identifier. "" is an escaped quote.
    if (rest[0] === '"') {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === '"' && sql[j + 1] === '"') {
          j += 2
        } else if (sql[j] === '"') {
          j++
          break
        } else {
          j++
        }
      }
      current += sql.slice(i, j)
      i = j
      continue
    }

    // Dollar quote: $$ or $tag$. The closing delimiter must match the tag.
    // A '$' can also be part of a parameter placeholder ($1) or an identifier,
    // so only treat it as a quote when a valid tag closes with '$'.
    if (rest[0] === '$') {
      const tagMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest)
      if (tagMatch) {
        const delim = tagMatch[0]
        const close = sql.indexOf(delim, i + delim.length)
        const end = close === -1 ? sql.length : close + delim.length
        current += sql.slice(i, end)
        i = end
        continue
      }
    }

    // Top-level terminator.
    if (rest[0] === ';') {
      const trimmed = current.trim()
      if (trimmed) statements.push(trimmed)
      current = ''
      i++
      continue
    }

    current += sql[i]
    i++
  }

  // A trailing statement without a terminating semicolon still counts.
  const tail = current.trim()
  if (tail) statements.push(tail)

  // Drop fragments that are only comments or whitespace — they are not
  // executable and Postgres rejects an empty query.
  return statements.filter(s => {
    const withoutComments = s
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/--[^\n]*/g, '')
      .trim()
    return withoutComments.length > 0
  })
}
