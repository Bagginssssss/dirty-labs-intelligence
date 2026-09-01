// INB-160 — reason → fault-bucket mirror of the return_reason_map seed (migration 052).
//
// The DB table return_reason_map is the RUNTIME source of truth (the sku_return_rates view joins
// it live, so re-bucketing a code there updates the view immediately). This code mirror drives the
// LOADER's ingest-time fault_class snapshot on each fba_customer_returns row + the unmapped-code
// warning. tests/fba-customer-returns.test.ts pins this mirror against the 22-code seed — editing a
// bucket means editing BOTH here and the migration/table (then re-uploading to refresh snapshots).

export type FaultClass = 'product_fault' | 'logistics_fault' | 'customer_choice' | 'fraud'

// SWITCHEROO → fraud (buyer-swap abuse is not a product-quality signal). UNDELIVERABLE_REFUSED /
// NO_REASON_GIVEN / NOT_COMPATIBLE → customer_choice (per INB-160 sign-off).
export const RETURN_REASON_BUCKETS: Record<string, FaultClass> = {
  DEFECTIVE:                 'product_fault',
  NOT_AS_DESCRIBED:          'product_fault',
  QUALITY_UNACCEPTABLE:      'product_fault',
  MISSING_PARTS:             'product_fault',
  RECALL:                    'product_fault', // INB-177 — a product recall is a defect/safety issue

  DAMAGED_BY_FC:             'logistics_fault',
  DAMAGED_BY_CARRIER:        'logistics_fault',
  MISSED_ESTIMATED_DELIVERY: 'logistics_fault',
  NEVER_ARRIVED:             'logistics_fault',
  UNDELIVERABLE_UNKNOWN:     'logistics_fault',
  UNWANTED_ITEM:             'customer_choice',
  ORDERED_WRONG_ITEM:        'customer_choice',
  FOUND_BETTER_PRICE:        'customer_choice',
  NO_REASON_GIVEN:           'customer_choice',
  NOT_COMPATIBLE:            'customer_choice',
  UNDELIVERABLE_REFUSED:     'customer_choice',
  APPAREL_TOO_SMALL:         'customer_choice',
  APPAREL_TOO_LARGE:         'customer_choice',
  POOR_FIT:                  'customer_choice',
  MISORDERED:                'customer_choice',
  EXTRA_ITEM:                'customer_choice',
  UNAUTHORIZED_PURCHASE:     'fraud',
  SWITCHEROO:                'fraud',
}

// 'unmapped' for a reason code absent from the map — the loader stores it as-is and warns
// (never fails), so a new Amazon code is surfaced at QC rather than silently dropped.
export function faultClassFor(reasonCode: string): FaultClass | 'unmapped' {
  return RETURN_REASON_BUCKETS[reasonCode] ?? 'unmapped'
}
