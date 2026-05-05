/**
 * Official ASIN → product short name mapping.
 * Source of truth: Architecture Reference doc + <issue id="...">INB-26</issue>.
 *
 * Use SHORT_NAMES wherever ASINs are surfaced in the UI.
 */

export const ASIN_NAMES: Record<string, string> = {
  B09B7YS1VK: 'Signature 80',
  B09B7Z4GPZ: 'Free & Clear 80',
  B09B83NFKQ: 'Murasaki 80',
  B09B85NVG9: 'Signature 32',
  B09B85YVMD: 'Free & Clear 32',
  B0BL8ZSV5X: 'Murasaki 32',
  B0BL8MWLM5: 'Delicates 32',
  B09MSP7M5Y: 'Booster 48',
  B0DHF1MMNC: 'Booster 96',
  B09B8LKQGR: 'Dryer Balls',
  B0CZFQ5GLV: 'Enzyme Balls',
  B09B85NGBT: 'Dish Free & Clear 48',
  B09B7WLWW3: 'Dish Aestival 48',
  B0CCCBQ7ZM: 'Signature Oil',
  B0CZ7NXY7S: 'Murasaki Oil',
  B0C34XDGFG: 'Erlenmeyer',
  B0DC21PZ1C: 'Canister',
  B0GFBPHBQ1: 'Dish Free & Clear 96',
  B0GFBGMFY7: 'Dish Aestival 96',
  B0FQPMNJ6Z: 'Toilet',
};

/** Lookup helper that falls back to the ASIN itself when not found. */
export function shortName(asin: string): string {
  return ASIN_NAMES[asin] ?? asin;
}
