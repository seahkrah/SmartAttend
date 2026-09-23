/**
 * What a file actually is, established by reading it.
 *
 * The Content-Type on an upload is a claim by the client, and the client is
 * whoever is uploading. Storing a file as the type it says it is means an
 * HTML page can arrive labelled image/png, and anything that later serves it
 * by its recorded type serves the page. So the bytes are read and the claim
 * is kept only as a record of what was claimed.
 *
 * The allowlist is deliberately short. SVG and HTML are absent: both execute
 * script in a browser, and serving either from the application's own origin
 * is stored cross-site scripting. There is no safe way to serve attacker
 * SVG inline from a first-party origin, so it is not accepted at all rather
 * than accepted and handled carefully somewhere downstream.
 */

export type AllowedType =
  | 'application/pdf'
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/gif'
  | 'text/plain'
  | 'text/csv'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  | 'application/msword'
  | 'application/vnd.ms-excel'

export interface TypeRule {
  type: AllowedType
  extensions: string[]
  /** Human label for error messages. */
  label: string
  /** Whether a browser can be allowed to render it inline. */
  inlineSafe: boolean
}

export const ALLOWED: TypeRule[] = [
  { type: 'application/pdf', extensions: ['pdf'], label: 'PDF', inlineSafe: true },
  { type: 'image/jpeg', extensions: ['jpg', 'jpeg'], label: 'JPEG image', inlineSafe: true },
  { type: 'image/png', extensions: ['png'], label: 'PNG image', inlineSafe: true },
  { type: 'image/webp', extensions: ['webp'], label: 'WebP image', inlineSafe: true },
  { type: 'image/gif', extensions: ['gif'], label: 'GIF image', inlineSafe: true },
  { type: 'text/plain', extensions: ['txt'], label: 'plain text', inlineSafe: false },
  { type: 'text/csv', extensions: ['csv'], label: 'CSV', inlineSafe: false },
  {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extensions: ['docx'], label: 'Word document', inlineSafe: false,
  },
  {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extensions: ['xlsx'], label: 'Excel workbook', inlineSafe: false,
  },
  { type: 'application/msword', extensions: ['doc'], label: 'Word document', inlineSafe: false },
  { type: 'application/vnd.ms-excel', extensions: ['xls'], label: 'Excel workbook', inlineSafe: false },
]

const BY_TYPE = new Map(ALLOWED.map((r) => [r.type as string, r]))

export function ruleFor(type: string): TypeRule | null {
  return BY_TYPE.get(type) ?? null
}

export function isAllowed(type: string): type is AllowedType {
  return BY_TYPE.has(type)
}

/** The extension a file of this type should be stored with. */
export function extensionFor(type: string): string {
  return BY_TYPE.get(type)?.extensions[0] ?? 'bin'
}

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false
  return bytes.every((b, i) => buf[offset + i] === b)
}

/**
 * Whether a buffer of mostly-text looks like something a browser would run.
 *
 * A .txt or .csv upload is the one case where the bytes do not identify the
 * format, so the content has to be inspected for the thing that makes serving
 * it dangerous. This is not a general-purpose HTML detector and does not need
 * to be: anything matching is refused, and a genuine text file containing the
 * word "<script" is a price worth paying.
 */
function looksExecutable(text: string): boolean {
  const head = text.slice(0, 4096).toLowerCase()
  return /<\s*(script|iframe|object|embed|svg|html|!doctype\s+html)\b/.test(head)
    || /^\s*<\?php/.test(head)
    || /javascript:/.test(head)
}

export interface SniffResult {
  type: AllowedType | null
  /** Why a buffer was refused, when it was. */
  reason?: string
}

/**
 * Identifies a buffer by its leading bytes.
 *
 * ZIP-based office formats (docx, xlsx) share a container signature with
 * every other zip, so they are distinguished by looking for the part names
 * their packages always contain. A zip that is neither is refused rather than
 * stored as one of them — an arbitrary archive is not something this system
 * has any reason to accept.
 */
export function sniff(buf: Buffer, declaredType?: string, filename?: string): SniffResult {
  if (buf.length === 0) return { type: null, reason: 'The file is empty' }

  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46])) return { type: 'application/pdf' }
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { type: 'image/jpeg' }
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { type: 'image/png' }
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return { type: 'image/gif' }
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46])
      && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) return { type: 'image/webp' }

  // The legacy Office compound-document container. doc and xls share it, so
  // the declared type and the extension are the only way to tell them apart —
  // acceptable because neither is inline-safe and both are served as
  // downloads regardless.
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    const ext = (filename ?? '').toLowerCase().split('.').pop()
    if (ext === 'xls' || declaredType === 'application/vnd.ms-excel') {
      return { type: 'application/vnd.ms-excel' }
    }
    return { type: 'application/msword' }
  }

  // ZIP container: docx and xlsx, or something else entirely.
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])
      || startsWith(buf, [0x50, 0x4b, 0x05, 0x06])
      || startsWith(buf, [0x50, 0x4b, 0x07, 0x08])) {
    const head = buf.slice(0, Math.min(buf.length, 8192)).toString('latin1')
    if (head.includes('word/')) {
      return {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }
    }
    if (head.includes('xl/')) {
      return { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
    }
    return {
      type: null,
      reason: 'This looks like a zip archive rather than a document',
    }
  }

  // Nothing matched a signature. It may still be text, which has none.
  const sample = buf.slice(0, Math.min(buf.length, 8192))
  // A NUL byte in the first few kilobytes means it is not text.
  if (sample.includes(0)) {
    return { type: null, reason: 'This file type is not accepted' }
  }

  const text = sample.toString('utf8')
  // A lone replacement character means the bytes were not valid UTF-8.
  if (text.includes('�')) {
    return { type: null, reason: 'This file type is not accepted' }
  }
  if (looksExecutable(text)) {
    return {
      type: null,
      reason: 'This file contains markup or script and cannot be stored as a document',
    }
  }

  const ext = (filename ?? '').toLowerCase().split('.').pop()
  if (ext === 'csv' || declaredType === 'text/csv') return { type: 'text/csv' }
  return { type: 'text/plain' }
}

/**
 * A filename safe to put in a Content-Disposition header.
 *
 * Control characters, quotes and path separators are removed; a header is a
 * line-oriented format and a newline in a filename is header injection. The
 * extension is forced to match what the bytes actually are, so a file that
 * claimed to be report.pdf and turned out to be a PNG downloads as a PNG.
 */
export function safeDownloadName(originalName: string, contentType: string): string {
  const base = String(originalName)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\.+$/, '')
    .trim()
    .slice(0, 180)

  const stem = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base
  const wanted = extensionFor(contentType)
  const safeStem = stem.length > 0 ? stem : 'download'
  return `${safeStem}.${wanted}`
}
