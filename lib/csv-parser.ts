import Papa from 'papaparse'

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
