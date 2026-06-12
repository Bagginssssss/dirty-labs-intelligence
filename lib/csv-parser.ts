import Papa from 'papaparse'

// Minimal shape of the bits of the Web File API we depend on. Keeping it
// structural (rather than referencing the DOM `File` type) lets unit tests
// pass a plain stub with arrayBuffer()/text() without pulling in DOM globals.
interface DecodableFile {
  arrayBuffer(): Promise<ArrayBuffer>
  text(): Promise<string>
}

// Reads a file's raw bytes and decodes them to a UTF-8 JS string, robust to the
// encodings Amazon exports actually use in the wild:
//   • UTF-8 with BOM (EF BB BF)  → BOM stripped, decoded as UTF-8 (today's case)
//   • UTF-16 LE / BE with BOM    → decoded from UTF-16 (FF FE / FE FF)
//   • BOM-less UTF-16            → detected via pervasive interleaved null bytes
//   • anything else              → falls back to file.text() (UTF-8)
// Note: this does NOT touch U+FFFC (￼) object-replacement characters — those are
// Amazon's own legitimate placeholder glyphs and part of the row's unique key.
export async function decodeFileContent(file: DecodableFile): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer())

  // UTF-8 BOM
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buf.subarray(3))
  }
  // UTF-16 LE BOM
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buf.subarray(2))
  }
  // UTF-16 BE BOM
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buf.subarray(2))
  }

  // BOM-less UTF-16: ASCII-range text encoded as UTF-16 produces a null byte for
  // every other byte. Sample the head and, if null bytes dominate, pick the
  // endianness from which offset (even/odd) the nulls cluster on.
  const sample = buf.subarray(0, Math.min(buf.length, 1024))
  let evenNulls = 0
  let oddNulls = 0
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0x00) {
      if (i % 2 === 0) evenNulls++
      else oddNulls++
    }
  }
  const nullRatio = (evenNulls + oddNulls) / Math.max(sample.length, 1)
  if (nullRatio > 0.25) {
    // LE → ASCII byte on even offset, null on odd. BE → the reverse.
    const encoding = oddNulls >= evenNulls ? 'utf-16le' : 'utf-16be'
    return new TextDecoder(encoding).decode(buf)
  }

  return file.text()
}

export interface ParseResult {
  rows: Record<string, string>[]
  rowCount: number
  headers: string[]
  errors: string[]
}

// Normalises date strings to ISO YYYY-MM-DD.
// Handles: "Mar 01, 2026", "2026-03-01", "03/01/2026", "01/03/2026" (ambiguous — treated as MM/DD/YYYY).
export function parseDate(value: string): string | null {
  if (!value || value.trim() === '') return null
  const trimmed = value.trim()

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed

  // Amazon long-form: "Mar 01, 2026"
  if (/^[A-Za-z]{3}\s+\d{1,2},\s*\d{4}$/.test(trimmed)) {
    const d = new Date(trimmed)
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]
  }

  // MM/DD/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed)) {
    const [m, day, y] = trimmed.split('/')
    const d = new Date(`${y}-${m.padStart(2, '0')}-${day.padStart(2, '0')}`)
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]
  }

  // M/D/YY or MM/DD/YY — Amazon "Sales and Traffic by Date" short-year format.
  // Explicit construction avoids timezone-dependent new Date() parsing.
  // Assumes 2000–2099 for 2-digit years.
  if (/^\d{1,2}\/\d{1,2}\/\d{2}$/.test(trimmed)) {
    const [m, day, y] = trimmed.split('/')
    const fullYear = 2000 + parseInt(y, 10)
    const d = new Date(`${fullYear}-${m.padStart(2, '0')}-${day.padStart(2, '0')}`)
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]
  }

  // Last resort
  const d = new Date(trimmed)
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]

  return null
}

// Strips $, %, commas and whitespace then returns a float or null.
export function parseNumeric(value: string): number | null {
  if (!value || value.trim() === '' || value.trim() === '-') return null
  const cleaned = value.replace(/[$%,\s]/g, '')
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : n
}

export function parseInteger(value: string): number | null {
  const n = parseNumeric(value)
  return n === null ? null : Math.round(n)
}

// Strips a leading metadata row when the first line contains key=value pairs
// (e.g. Amazon Brand Analytics SQP exports start with "Brand=...,StartDate=...").
// The second row is then the real header row.
function preprocessContent(content: string): string {
  const firstNewline = content.indexOf('\n')
  if (firstNewline === -1) return content
  const firstLine = content.slice(0, firstNewline).replace(/\r$/, '').trim()
  if (firstLine.includes('=')) return content.slice(firstNewline + 1)
  return content
}

export function parseCSV(content: string): ParseResult {
  const errors: string[] = []
  const processedContent = preprocessContent(content)

  const result = Papa.parse<Record<string, string>>(processedContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.replace(/^﻿/, '').trim(),
    transform: (v: string) => v.trim(),
  })

  if (result.errors.length > 0) {
    for (const e of result.errors) {
      errors.push(`Row ${e.row ?? '?'}: ${e.message}`)
    }
  }

  const headers = result.meta.fields ?? []
  const rows = result.data as Record<string, string>[]

  return { rows, rowCount: rows.length, headers, errors }
}
