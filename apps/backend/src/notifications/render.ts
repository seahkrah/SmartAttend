/**
 * Template rendering.
 *
 * Deliberately not a template language. Substitution of {{ name }} and
 * nothing else — no conditionals, no loops, no expression evaluation — because
 * the bodies are edited by school administrators through a web form and every
 * feature beyond substitution is a way for that form to become a way of
 * running code on the server.
 */

export interface RenderResult {
  text: string
  /** Variables the template asked for that were not supplied. */
  missing: string[]
}

const PLACEHOLDER = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

/** The variables a template refers to. */
export function variablesIn(template: string): string[] {
  const found = new Set<string>()
  for (const match of String(template).matchAll(PLACEHOLDER)) found.add(match[1])
  return [...found]
}

export function render(template: string, data: Record<string, unknown>): RenderResult {
  const missing: string[] = []

  const text = String(template).replace(PLACEHOLDER, (_whole, name: string) => {
    const value = data[name]
    if (value === undefined || value === null || value === '') {
      missing.push(name)
      return ''
    }
    return String(value)
  })

  return { text, missing: [...new Set(missing)] }
}

/**
 * Tidies a rendered body.
 *
 * An optional variable that rendered empty leaves a dangling blank line or a
 * double space where the sentence used to be. Neither is a correctness
 * problem, and both look like a system that does not care.
 */
export function tidy(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}
