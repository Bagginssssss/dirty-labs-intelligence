export const HARVEST_READY_THRESHOLDS = {
  minRoas: 3.33,
  minOrders: 2,
  minClicks: 10,
} as const;

export const HARVEST_INVESTIGATION_THRESHOLDS = {
  minRoas: 2.5,
  maxRoasExclusive: 3.33,
  minOrders: 2,
  minClicks: 10,
} as const;
