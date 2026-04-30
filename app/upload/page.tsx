'use client'

import { useState, useRef } from 'react'

interface IngestResult {
  status: string
  report_type?: string
  table?: string
  rows_received?: number
  rows_stored?: number
  rows_rejected?: number
  parse_errors?: string[]
  error?: string
}

export default function UploadPage() {
  const [brandId, setBrandId] = useState('')
  const [dateStart, setDateStart] = useState('')
  const [dateEnd, setDateEnd] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<IngestResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file || !brandId) return

    setLoading(true)
    setResult(null)

    const body = new FormData()
    body.append('file', file)
    body.append('brand_id', brandId)
    body.append('date_range_start', dateStart)
    body.append('date_range_end', dateEnd)

    try {
      const res = await fetch('/api/ingest', { method: 'POST', body })
      const json: IngestResult = await res.json()
      setResult(json)
    } catch (err) {
      setResult({ status: 'error', error: String(err) })
    } finally {
      setLoading(false)
    }
  }

  const success = result?.status === 'ok'
  const partial = success && (result.rows_rejected ?? 0) > 0

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-xl mx-auto">
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">Report Ingest</h1>
        <p className="text-sm text-gray-500 mb-8">
          Upload any Amazon Ads, Scale Insights, or SmartScout CSV report.
        </p>

        <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          {/* Brand ID */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Brand ID (UUID)</label>
            <input
              type="text"
              value={brandId}
              onChange={e => setBrandId(e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
          </div>

          {/* Date range */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date Range Start</label>
              <input
                type="date"
                value={dateStart}
                onChange={e => setDateStart(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date Range End</label>
              <input
                type="date"
                value={dateEnd}
                onChange={e => setDateEnd(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>
          </div>

          {/* File input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">CSV File</label>
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-gray-400 transition-colors"
            >
              {file ? (
                <div>
                  <p className="text-sm font-medium text-gray-900">{file.name}</p>
                  <p className="text-xs text-gray-500 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-gray-500">Click to select a CSV file</p>
                  <p className="text-xs text-gray-400 mt-1">All report types supported</p>
                </div>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading || !file || !brandId}
            className="w-full bg-gray-900 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40 hover:bg-gray-700 transition-colors"
          >
            {loading ? 'Uploading…' : 'Upload & Ingest'}
          </button>

          {/* Progress indicator */}
          {loading && (
            <div className="flex items-center gap-3 text-sm text-gray-500">
              <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
              Parsing and inserting rows — this may take a moment for large files…
            </div>
          )}
        </form>

        {/* Result card */}
        {result && (
          <div className={`mt-6 rounded-xl border p-6 ${
            result.error
              ? 'bg-red-50 border-red-200'
              : partial
              ? 'bg-yellow-50 border-yellow-200'
              : 'bg-green-50 border-green-200'
          }`}>
            <p className={`text-sm font-semibold mb-4 ${
              result.error ? 'text-red-700' : partial ? 'text-yellow-700' : 'text-green-700'
            }`}>
              {result.error ? 'Ingest failed' : partial ? 'Partial success' : 'Ingest complete'}
            </p>

            {result.error ? (
              <p className="text-sm text-red-600">{result.error}</p>
            ) : (
              <dl className="space-y-2 text-sm">
                <Row label="Report type" value={result.report_type ?? '—'} />
                <Row label="Target table" value={result.table ?? '—'} />
                <Row label="Rows received" value={String(result.rows_received ?? 0)} />
                <Row
                  label="Rows stored"
                  value={String(result.rows_stored ?? 0)}
                  highlight={success && !partial ? 'green' : undefined}
                />
                {(result.rows_rejected ?? 0) > 0 && (
                  <Row
                    label="Rows rejected"
                    value={String(result.rows_rejected)}
                    highlight="red"
                  />
                )}
              </dl>
            )}

            {result.parse_errors && result.parse_errors.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-medium text-gray-600 mb-1">Errors</p>
                <ul className="text-xs text-gray-500 space-y-0.5 max-h-32 overflow-y-auto">
                  {result.parse_errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: 'green' | 'red' }) {
  return (
    <div className="flex justify-between">
      <dt className="text-gray-500">{label}</dt>
      <dd className={`font-medium ${
        highlight === 'green' ? 'text-green-700' :
        highlight === 'red' ? 'text-red-600' :
        'text-gray-900'
      }`}>{value}</dd>
    </div>
  )
}
