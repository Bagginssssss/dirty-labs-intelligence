// Regression tests for the SQP ingest data-integrity fix (INB-117).
//
// Bug: one SQP row with an empty Search Query maps to null, violating the table's
// NOT NULL constraint, which fails the entire ~500-row upsert batch — losing every
// good row alongside the one bad one. These tests exercise the real parse → validate
// path (the DB write is out of scope) and assert that the good rows survive while the
// empty-query row is counted as exactly one reject.
//
// Note: we feed parseCSV output into the validation helper directly rather than
// importing the row mapper. An empty Search Query cell arrives from parseCSV as ''
// (and the mapper would turn it into null) — partitionRequiredNotNull treats both as
// empty, so the validation behaviour is identical either way. (Importing the mapper
// here is avoided only because Node's bare TS type-stripping can't elide its
// type-only named imports.)
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseCSV, decodeFileContent } from '../lib/csv-parser.ts'
import { partitionRequiredNotNull } from '../lib/ingest-validation.ts'

const BRAND = '47a96175-ed58-4104-a2ff-c925d6143309'

// Projects raw parsed rows onto the validated SQP shape (the columns the NOT NULL
// check cares about), mirroring what the mapper stores for search_query/report_date.
function toMappedRows(rows: Record<string, string>[]) {
  return rows.map(r => ({
    brand_id: BRAND,
    report_date: r['Reporting Date'] || null,
    search_query: r['Search Query'] || null,
  }))
}

// Amazon Brand Analytics SQP export: a "key=value" metadata line, then the header
// row, then data. Row 2 carries U+FFFC (￼) — Amazon's legitimate placeholder glyph,
// which must be preserved. Row 3 has an empty Search Query — the bad row.
const SQP_CSV = [
  'Brand=Dirty Labs,StartDate=2026-03-01,EndDate=2026-03-07',
  'Reporting Date,Search Query,Search Query Volume,Impressions: Total Count',
  '2026-03-01,laundry detergent,1000,5000',
  '2026-03-01,￼,800,4000',
  '2026-03-01,,500,2000',
  '2026-03-01,stain remover,300,1500',
].join('\n')

function mapRows(csv: string) {
  return toMappedRows(parseCSV(csv).rows)
}

// A minimal stand-in for the Web File API surface decodeFileContent consumes.
function fileFromBytes(bytes: Uint8Array) {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return {
    arrayBuffer: async () => ab,
    text: async () => new TextDecoder('utf-8').decode(bytes),
  }
}

function utf8WithBom(s: string): Uint8Array {
  const body = new TextEncoder().encode(s)
  return new Uint8Array([0xef, 0xbb, 0xbf, ...body])
}

function utf16leWithBom(s: string): Uint8Array {
  const out: number[] = [0xff, 0xfe]
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    out.push(code & 0xff, (code >> 8) & 0xff)
  }
  return new Uint8Array(out)
}

test('SQP validation: one empty-query row is rejected exactly once, good rows kept', () => {
  const mapped = mapRows(SQP_CSV)
  assert.equal(mapped.length, 4, 'all four data rows are mapped')

  const { kept, rejected } = partitionRequiredNotNull(mapped, 'search_query_performance')

  // The empty-query row is the only reject — NOT a whole-batch failure.
  assert.equal(rejected.length, 1, 'exactly one row rejected')
  assert.equal(rejected[0].reason, 'empty required field: search_query')

  // The three rows with a real search_query survive...
  assert.equal(kept.length, 3, 'three good rows kept')

  // ...including the U+FFFC placeholder row, which must NOT be stripped.
  const queries = kept.map(r => r.search_query)
  assert.deepEqual(queries.sort(), ['laundry detergent', 'stain remover', '￼'].sort())
  assert.ok(queries.includes('￼'), 'U+FFFC placeholder preserved as a distinct key')
})

test('SQP validation: a clean batch rejects nothing', () => {
  const cleanCsv = [
    'Reporting Date,Search Query,Search Query Volume',
    '2026-03-01,laundry detergent,1000',
    '2026-03-01,stain remover,300',
  ].join('\n')
  const { kept, rejected } = partitionRequiredNotNull(mapRows(cleanCsv), 'search_query_performance')
  assert.equal(rejected.length, 0)
  assert.equal(kept.length, 2)
})

test('decodeFileContent strips a UTF-8 BOM', async () => {
  const csv = 'Reporting Date,Search Query\n2026-03-01,laundry detergent'
  const decoded = await decodeFileContent(fileFromBytes(utf8WithBom(csv)))
  assert.equal(decoded, csv, 'BOM removed, body intact')
  assert.ok(!decoded.startsWith('﻿'), 'no leading BOM character remains')
})

test('decodeFileContent decodes a UTF-16 LE (BOM) file end-to-end through the mapper', async () => {
  const decoded = await decodeFileContent(fileFromBytes(utf16leWithBom(SQP_CSV)))
  assert.equal(decoded, SQP_CSV, 'UTF-16 decoded back to the original text')

  // And the decoded text still flows through parse → map → validate identically.
  const { kept, rejected } = partitionRequiredNotNull(mapRows(decoded), 'search_query_performance')
  assert.equal(kept.length, 3)
  assert.equal(rejected.length, 1)
})
