/** Display precision only: preserve coordinates and raw evidence for calculations. */
export function formatNumber(value: number | null | undefined, fallback = '—'): string {
  return value == null || !Number.isFinite(value) ? fallback : String(Number(value.toFixed(2)));
}

export function visibleFactors<T extends { indicator: string }>(factors: T[]): T[] {
  return factors.filter(factor => !['youBikeAvailableBikes', 'youBikeAvailableDocks', 'aedCount500m', 'publicToiletCount800m'].includes(factor.indicator));
}
