'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { refreshTrackerCache } from '@/app/upload/actions'

interface IngestResult {
  status: string
  report_type?: string
  table?: string
  rows_received?: number
  rows_stored?: number
  rows_rejected?: number
  parse_errors?: string[]
  error?: string
  granularity_detected?: string
}

export function UploadArea({ defaultBrandId }: { defaultBrandId: string }) {
  const router = useRouter()
  const [brandId, setBrandId] = useState(defaultBrandId)
  const [dateStart, setDateStart] = useState('')
  const [dateEnd, setDateEnd] = useState('')
  const [subcategory, setSubcategory] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<IngestResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const dropped = e.dataTransfer.files?.[0]
    if (dropped) setFile(dropped)
  }, [])

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
    if (subcategory) body.append('subcategory', subcategory)

    try {
      const res = await fetch('/api/ingest', { method: 'POST', body })
      const json: IngestResult = await res.json()
      setResult(json)
      if (json.status === 'ok') {
        await refreshTrackerCache()
        router.refresh()
      }
    } catch (err) {
      setResult({ status: 'error', error: String(err) })
    } finally {
      setLoading(false)
    }
  }

  const success = result?.status === 'ok'
  const partial = success && (result.rows_rejected ?? 0) > 0

  return (
    <div id="upload-area" className="border-t border-[#1e1e2e] pt-5 mt-8">
      <div className="text-[10px] tracking-[0.1em] text-[#3b82f6] mb-4">UPLOAD · INGEST</div>

      <form onSubmit={handleSubmit} className="bg-[#16161a] border border-[#1e1e2e] rounded-[6px] p-5 space-y-4 max-w-2xl">
        {/* Brand ID */}
        <div>
          <label className="block text-[9px] text-[#64748b] mb-1 tracking-[0.08em] uppercase">
            Brand ID (UUID)
          </label>
          <input
            type="text"
            value={brandId}
            onChange={e => setBrandId(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            required
            className="w-full bg-[#111113] border border-[#1e1e2e] rounded-[3px] px-3 py-1.5 text-[11px] text-[#e2e8f0] font-mono focus:outline-none focus:border-[#3b82f6]"
          />
        </div>

        {/* Date range */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[9px] text-[#64748b] mb-1 tracking-[0.08em] uppercase">
              Date Range Start
            </label>
            <input
              type="date"
              value={dateStart}
              onChange={e => setDateStart(e.target.value)}
              className="w-full bg-[#111113] border border-[#1e1e2e] rounded-[3px] px-3 py-1.5 text-[11px] text-[#e2e8f0] font-mono focus:outline-none focus:border-[#3b82f6]"
            />
          </div>
          <div>
            <label className="block text-[9px] text-[#64748b] mb-1 tracking-[0.08em] uppercase">
              Date Range End
            </label>
            <input
              type="date"
              value={dateEnd}
              onChange={e => setDateEnd(e.target.value)}
              className="w-full bg-[#111113] border border-[#1e1e2e] rounded-[3px] px-3 py-1.5 text-[11px] text-[#e2e8f0] font-mono focus:outline-none focus:border-[#3b82f6]"
            />
          </div>
        </div>

        {/* Subcategory — required for SmartScout Subcategory Brands reports */}
        <div>
          <label className="block text-[9px] text-[#64748b] mb-1 tracking-[0.08em] uppercase">
            Subcategory{' '}
            <span className="text-[#475569] normal-case tracking-normal">(SmartScout Subcategory Brands only)</span>
          </label>
          <select
            value={subcategory}
            onChange={e => setSubcategory(e.target.value)}
            className="w-full bg-[#111113] border border-[#1e1e2e] rounded-[3px] px-3 py-1.5 text-[11px] text-[#e2e8f0] font-mono focus:outline-none focus:border-[#3b82f6]"
          >
            <option value="">— not applicable —</option>
            <option value="dishwasher_detergent">Dishwasher Detergent</option>
            <option value="laundry_detergent">Laundry Detergent</option>
            <option value="laundry_stain_remover">Laundry Stain Remover</option>
            <option value="toilet_bowl_cleaner">Toilet Bowl Cleaner</option>
          </select>
        </div>

        {/* File — drag-drop + click */}
        <div>
          <label className="block text-[9px] text-[#64748b] mb-1 tracking-[0.08em] uppercase">
            CSV File
          </label>
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{ borderColor: isDragging ? '#3b82f6' : '#1e1e2e' }}
            className="border-2 border-dashed rounded-[3px] p-5 text-center cursor-pointer transition-colors"
          >
            {file ? (
              <div>
                <p className="text-[11px] text-[#e2e8f0]">{file.name}</p>
                <p className="text-[9px] text-[#64748b] mt-1">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
            ) : (
              <div>
                <p className="text-[11px] text-[#94a3b8]">Drop CSV here or click to select</p>
                <p className="text-[9px] text-[#475569] mt-1">All report types supported</p>
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
          className="w-full bg-[#3b82f6] text-[#0f0f0f] rounded-[3px] py-2 text-[11px] font-medium tracking-[0.06em] disabled:opacity-40 hover:bg-[#60a5fa] transition-colors"
        >
          {loading ? 'UPLOADING…' : 'UPLOAD & INGEST'}
        </button>

        {loading && (
          <div className="flex items-center gap-2 text-[10px] text-[#64748b]">
            <div className="w-3 h-3 border border-[#475569] border-t-[#3b82f6] rounded-full animate-spin" />
            Parsing and inserting rows — this may take a moment for large files…
          </div>
        )}
      </form>

      {result && (
        <div
          className="mt-4 rounded-[6px] border p-4 max-w-2xl"
          style={{
            borderColor: result.error ? '#ef444430' : partial ? '#f59e0b30' : '#10b98130',
            backgroundColor: result.error ? '#ef44440d' : partial ? '#f59e0b0d' : '#10b9810d',
          }}
        >
          <p
            className="text-[10px] font-medium mb-3 tracking-[0.05em]"
            style={{ color: result.error ? '#ef4444' : partial ? '#f59e0b' : '#10b981' }}
          >
            {result.error ? 'INGEST FAILED' : partial ? 'PARTIAL SUCCESS' : 'INGEST COMPLETE'}
          </p>

          {result.error ? (
            <p className="text-[10px] text-[#ef4444]">{result.error}</p>
          ) : (
            <dl className="space-y-1.5 text-[10px]">
              <ResultRow label="Report type" value={result.report_type ?? '—'} />
              {result.granularity_detected && (
                <ResultRow
                  label="Detected as"
                  value={result.granularity_detected}
                  highlight={result.granularity_detected === 'monthly' ? 'green' : undefined}
                />
              )}
              <ResultRow label="Target table" value={result.table ?? '—'} />
              <ResultRow label="Rows received" value={String(result.rows_received ?? 0)} />
              <ResultRow
                label="Rows stored"
                value={String(result.rows_stored ?? 0)}
                highlight={success && !partial ? 'green' : undefined}
              />
              {(result.rows_rejected ?? 0) > 0 && (
                <ResultRow
                  label="Rows rejected"
                  value={String(result.rows_rejected)}
                  highlight="red"
                />
              )}
            </dl>
          )}

          {result.parse_errors && result.parse_errors.length > 0 && (
            <div className="mt-3">
              <p className="text-[9px] text-[#64748b] mb-1">Errors</p>
              <ul className="text-[9px] text-[#475569] space-y-0.5 max-h-24 overflow-y-auto">
                {result.parse_errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ResultRow({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: 'green' | 'red'
}) {
  return (
    <div className="flex justify-between">
      <dt className="text-[#64748b]">{label}</dt>
      <dd
        style={{
          color: highlight === 'green' ? '#10b981' : highlight === 'red' ? '#ef4444' : '#e2e8f0',
        }}
      >
        {value}
      </dd>
    </div>
  )
}
