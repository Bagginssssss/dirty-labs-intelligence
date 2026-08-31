// INB-174 — the upload result card's tone, extracted as a pure, unit-testable function.
//
// Three tones map to the card's colour + heading:
//   'failed'   → red   'INGEST FAILED'    (a 400 / thrown error — nothing to trust)
//   'partial'  → amber 'PARTIAL SUCCESS'  (stored, but something needs the operator's eye)
//   'complete' → green 'INGEST COMPLETE'  (clean)
//
// The point of extraction (INB-174 item 3): a zeroed-balance S&S upload STORES every row and
// rejects none (rows_rejected = 0) but NULLs the balance column — a data-quality event the operator
// must notice. Keying 'partial' on rows_rejected alone rendered it green, burying the warning. So a
// surfaced warning also makes the card amber.
//
// Severity split — parse_errors messages are convention-tagged:
//   '[info] …'    purely explanatory (e.g. amazon_reviews star-filtered-run notes) → stays green.
//   '[warning] …' a real data-quality flag (sku_economics net-proceeds, fba_customer_returns unmapped
//                 reason codes, the S&S balance repair) → amber.
// Untagged messages default to the warning side (amber) — the safe direction: a message worth
// surfacing at all should not be silently downgraded to green. Only an explicit '[info]' prefix is
// treated as benign. This keeps amber meaningful instead of "anything in parse_errors lights up".
export type BannerTone = 'failed' | 'partial' | 'complete'

export interface BannerResult {
  status?: string
  error?: unknown
  rows_rejected?: number
  parse_errors?: string[]
}

export function deriveBannerTone(result: BannerResult): BannerTone {
  if (result.error != null || result.status !== 'ok') return 'failed'
  const rejected = (result.rows_rejected ?? 0) > 0
  const warned = (result.parse_errors ?? []).some(e => !e.startsWith('[info]'))
  return rejected || warned ? 'partial' : 'complete'
}
