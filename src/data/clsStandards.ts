// Product settings, not scientific/medical standards. Version changes require
// a baseline version bump and batch recomputation. All distances are straight-line.
export const CLS_STANDARD_VERSION = 'fixed-standard-v1';
export type ClsCategory = 'C1' | 'C2' | 'C3' | 'C4' | 'C5';
export type ScoreCurve = { kind: 'linear'; knots: readonly (readonly [number, number])[] }
  | { kind: 'saturation'; half: number };
export interface IndicatorStandard {
  category: ClsCategory;
  weight: number;
  unit: string;
  direction: 'higher_is_better' | 'lower_is_better';
  curve: ScoreCurve;
  maxValue?: number;
}
const local: ScoreCurve = { kind: 'linear', knots: [[0, 100], [300, 100], [500, 85], [800, 60], [1200, 30], [2000, 0]] };
const near: ScoreCurve = { kind: 'linear', knots: [[0, 100], [200, 100], [300, 85], [500, 60], [800, 30], [1200, 0]] };
const distance = (category: ClsCategory, weight: number, curve = local): IndicatorStandard =>
  ({ category, weight, unit: 'm', direction: 'lower_is_better', curve });
const quantity = (category: ClsCategory, weight: number, unit: string, half: number): IndicatorStandard =>
  ({ category, weight, unit, direction: 'higher_is_better', curve: { kind: 'saturation', half } });
export const CLS_STANDARDS: Record<string, IndicatorStandard> = {
  trafficAccidentCount500m: { category: 'C1', weight: .45, unit: 'accidents', direction: 'lower_is_better', curve: { kind: 'linear', knots: [[0, 100], [2, 80], [5, 60], [10, 35], [20, 0]] } },
  maxFloodDepthCm: { category: 'C1', weight: .45, unit: 'cm', direction: 'lower_is_better', curve: { kind: 'linear', knots: [[0, 100], [10, 80], [30, 60], [50, 30], [100, 0]] } },
  streetLightCount300m: quantity('C1', .05, 'lights', 10),
  fireHydrantCount500m: quantity('C1', .05, 'hydrants', 5),
  supermarketDist: distance('C2', .15),
  convenienceDist: distance('C2', .15, near),
  clinicDist: distance('C2', .15),
  schoolDist: distance('C2', .15),
  bankPostDist: distance('C2', .15),
  marketDist: distance('C2', .15),
  poiDensityCount: quantity('C2', .10, 'POIs', 10),
  mrtOrRailDist: distance('C3', .25, { kind: 'linear', knots: [[0, 100], [500, 100], [800, 85], [1200, 60], [1600, 30], [2400, 0]] }),
  busStopDist: distance('C3', .20, { kind: 'linear', knots: [[0, 100], [200, 100], [400, 85], [600, 60], [800, 30], [1200, 0]] }),
  youBikeNearestDist: distance('C3', .15, near),
  bikeLaneLength500m: quantity('C3', .20, 'm', 500),
  // Area fraction of the 500m disk, NOT fraction of walkable streets.
  sidewalkCoverage500mPct: { ...quantity('C3', .20, '%', 1), maxValue: 100 },
  aqi: { category: 'C4', weight: .25, unit: 'AQI', direction: 'lower_is_better', curve: { kind: 'linear', knots: [[0, 100], [50, 100], [100, 70], [150, 35], [200, 10], [300, 0]] } },
  streetTreeDensityPerKm2: quantity('C4', .20, 'trees/km²', 100),
  parkTreeDensityPerKm2: quantity('C4', .15, 'trees/km²', 100),
  nearestParkDist: distance('C4', .30),
  coolingPointCount1200m: quantity('C4', .10, 'places', 2),
  communityCulturalPoiCount800m: quantity('C5', .40, 'POIs', 3),
  nearestCommunityCulturalFacilityDist: distance('C5', .60),
};
