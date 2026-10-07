export type Category = "C1" | "C2" | "C3" | "C4" | "C5";

import { FieldObservationAdjustment } from "./src/types";
import { calculateFixedScores, validObservation, type FixedInput } from './fixedScoring';
import { FIELD_OBSERVATION_DEFINITIONS } from "./src/data/fieldIndicators";

export interface ScoreFactor {
  category: Category;
  indicator: string;
  value: number | null;
  unit: string;
  direction: "higher_is_better" | "lower_is_better";
  source: string;
  method: "official" | "api" | "osm" | "calculated" | "survey" | "estimated";
  confidence: "high" | "medium" | "low";
  status?: "available" | "unavailable";
  retrievedAt?: string;
  referenceSampleSize?: number;
  scoringMethod?: "empirical_percentile" | "raw_observation" | "not_scored" | "fixed_standard";
  normalizedScore?: number | null;
  indicatorWeight?: number;
  estimatedValue?: number | null;
  referencePercentile?: number;
  availabilityReason?: "insufficient_reference_data" | "source_unavailable" | "no_observation";
  estimationMethod?: "regional_real_data_prior";
}

export type ScoreMode = "observed" | "estimated";

export interface CategoryScore {
  score: number | null;
  factors: ScoreFactor[];
  mode: ScoreMode;
  estimationMethod?: "regional_real_data_prior";
  estimationReferenceSampleSize?: number;
  completeness?: number;
  provisional?: boolean;
}

export interface AssessmentScores {
  completeness?: number;
  provisional?: boolean;
  scoringStandard?: string;
  c1: CategoryScore;
  c2: CategoryScore;
  c3: CategoryScore;
  c4: CategoryScore;
  c5: CategoryScore;
  overall: number | null;
  overallMode: ScoreMode;
  estimatedCategoryCount: number;
  weights: Record<Category, number>;
  confidence: "high" | "medium" | "low";
}

export interface C1SafetyMetrics {
  accidentCount500m?: number;
  fatalAccidentCount500m?: number;
  injuryAccidentCount500m?: number;
  source: string;
  method: "official" | "calculated";
  confidence: "high" | "medium" | "low";
  status?: "available" | "empty" | "timeout" | "error" | "unavailable";
  retrievedAt?: string;
  floodHazard?: Array<{
    scenarioMmPerHour: 78.8 | 100 | 130;
    depthCm: number | null;
    distanceMeters: number;
    source: string;
    sourceType: "official_model";
    retrievedAt: string;
  }>;
  floodSource?: string | null;
  accidentCountReference?: number[];
  floodDepthReference?: number[];
  streetLightCount300m?: number;
  streetLightCountReference?: number[];
  /** Legacy payload compatibility only; ignored by the current calculator. */
  aedCount500m?: number;
  aedCountReference?: number[];
  fireHydrantCount500m?: number;
  fireHydrantCountReference?: number[];
}

export interface C2PoiMetrics {
  supermarketDist?: number;
  convenienceDist?: number;
  clinicDist?: number;
  schoolDist?: number;
  bankPostDist?: number;
  marketDist?: number;
  poiDensityCount?: number;
  source: string;
  method: "api" | "osm" | "calculated";
  confidence: "high" | "medium" | "low";
  status?: "available" | "empty" | "timeout" | "error" | "unavailable";
  retrievedAt?: string;
}

export interface C3TransitMetrics {
  mrtOrRailDist?: number;
  busStopDist?: number;
  youBikeNearestDist?: number;
  youBikeAvailableBikes?: number;
  youBikeAvailableDocks?: number;
  bikeLaneLength500m?: number;
  sidewalkCoverage500mPct?: number;
  sidewalkFeatureCount500m?: number;
  source: string;
  method: "api" | "osm" | "calculated";
  confidence: "high" | "medium" | "low";
  status?: "available" | "empty" | "timeout" | "error" | "unavailable";
  retrievedAt?: string;
}


export interface C4GreenMetrics {
  streetTreeCount800m?: number;
  parkTreeCount800m?: number;
  streetTreeDensityPerKm2?: number;
  parkTreeDensityPerKm2?: number;
  streetTreeDensityScore?: number;
  parkTreeDensityScore?: number;
  streetTreeDensityReference?: number[];
  parkTreeDensityReference?: number[];
  nearestParkDist?: number;
  parkCount800m?: number;
  coolingPointCount1200m?: number;
  coolingPointCountReference?: number[];
  source: string;
  method: "official" | "calculated";
  confidence: "high" | "medium" | "low";
  status?: "available" | "empty" | "timeout" | "error" | "unavailable";
  retrievedAt?: string;
}

const DEFAULT_WEIGHTS: Record<Category, number> = {
  C1: 0.2,
  C2: 0.2,
  C3: 0.2,
  C4: 0.2,
  C5: 0.2,
};

export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function inverseDistanceScore(distanceMeters: number, scaleMeters = 500): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters < 0) return 0;
  return clampScore(100 / (1 + distanceMeters / scaleMeters));
}

export function average(values: number[]): number {
  const valid = values.filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

const OBSERVATION_CATEGORY_CAP = 10;
const OBSERVATION_WEIGHTS: Record<Category, number> = DEFAULT_WEIGHTS;
const FIELD_OBSERVATION_IMPACTS: Record<string, { category: Category; scoreImpact: number }> =
  Object.fromEntries(
    FIELD_OBSERVATION_DEFINITIONS.map((item) => [
      item.id,
      { category: item.category, scoreImpact: item.scoreImpact },
    ]),
  ) as Record<string, { category: Category; scoreImpact: number }>;

export function applyFieldObservationAdjustment(
  baselineCls: number | null,
  ratings: Record<string, number>,
): FieldObservationAdjustment {
  const categoryAdjustments: Record<Category, number> = { C1: 0, C2: 0, C3: 0, C4: 0, C5: 0 };
  const itemAdjustments: Record<string, number> = {};
  let ratedItemCount = 0;

  for (const [id, rawRating] of Object.entries(ratings || {})) {
    const definition = FIELD_OBSERVATION_IMPACTS[id];
    const rating = Number(rawRating);
    if (!definition || !Number.isFinite(rating) || rating < 1 || rating > 4) continue;
    const centeredRating = (rating - 2.5) / 1.5;
    const itemAdjustment = definition.scoreImpact * centeredRating;
    categoryAdjustments[definition.category] += itemAdjustment;
    itemAdjustments[id] = Math.round(itemAdjustment * 100) / 100;
    ratedItemCount += 1;
  }

  for (const category of Object.keys(categoryAdjustments) as Category[]) {
    categoryAdjustments[category] = Math.max(
      -OBSERVATION_CATEGORY_CAP,
      Math.min(OBSERVATION_CATEGORY_CAP, categoryAdjustments[category]),
    );
  }

  const rawAdjustment = Object.entries(categoryAdjustments).reduce(
    (sum, [category, value]) => sum + OBSERVATION_WEIGHTS[category as Category] * value,
    0,
  );

  const normalizedBaseline = baselineCls == null ? null : clampScore(Number(baselineCls));
  const observationPoints = Math.round(rawAdjustment) || 0;
  const adjustedCls = normalizedBaseline == null
    ? null
    : clampScore(normalizedBaseline + observationPoints);

  return {
    baselineCls: normalizedBaseline,
    adjustedCls,
    // Record observation points independently of the external baseline. Clamp
    // the final score only; otherwise a baseline near 0/100 erases the points.
    adjustment: normalizedBaseline == null ? 0 : observationPoints,
    categoryAdjustments,
    itemAdjustments,
    ratedItemCount,
  };
}

export function validateAssessmentIntegrity(assessment: AssessmentScores): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const categories = [assessment.c1, assessment.c2, assessment.c3, assessment.c4, assessment.c5];

  for (const category of categories) {
    if (category.score !== null && (!Number.isFinite(category.score) || category.score < 0 || category.score > 100)) {
      errors.push(`${category.factors[0]?.category ?? "unknown"} score must be null or within 0-100`);
    }
    for (const factor of category.factors) {
      if (factor.value !== null && !Number.isFinite(factor.value)) {
        errors.push(`${factor.category}/${factor.indicator} value must be null or finite`);
      }
      if (factor.scoringMethod === "empirical_percentile" && (factor.referenceSampleSize ?? 0) < 20) {
        errors.push(`${factor.category}/${factor.indicator} percentile requires at least 20 reference samples`);
      }
      if (factor.status === "unavailable" && factor.value !== null) {
        errors.push(`${factor.category}/${factor.indicator} cannot have a value when unavailable`);
      }
    }
  }

  if (assessment.overall !== null && categories.every((category) => category.score === null)) {
    errors.push("overall must be null when all category scores are unavailable");
  }
  if (assessment.overall !== null && (!Number.isFinite(assessment.overall) || assessment.overall < 0 || assessment.overall > 100)) {
    errors.push("overall must be null or within 0-100");
  }

  return { valid: errors.length === 0, errors };
}
export function calculateAssessment(
  baseline: any,
  poiCounts: Partial<Record<Category, number>>,
  weather?: { aqi: number | null; pm25: number | null; source?: string; sourceType?: string; retrievedAt?: string },
  c1SafetyMetrics?: C1SafetyMetrics,
  c2PoiMetrics?: C2PoiMetrics,
  c3TransitMetrics?: C3TransitMetrics,
  c4GreenMetrics?: C4GreenMetrics,
  c2PoiDensityReference?: number[],
  c5CommunityCount?: number,
  c5CommunityReference?: number[],
  c5NearestCommunityDistance?: number,
  normalization?: {
    c2Distances?: Partial<Record<"supermarketDist" | "convenienceDist" | "clinicDist" | "schoolDist" | "bankPostDist" | "marketDist", number[]>>;
    c3RailDistances?: number[];
    c3BusDistances?: number[];
    c3YouBikeDistances?: number[];
    c3BikeLaneLengths?: number[];
    c3SidewalkCoveragePcts?: number[];
    c4Aqi?: number[];
    c4CoolingPointCounts?: number[];
    c4NearestParkDistances?: number[];
    c5NearestCommunityDistances?: number[];
  },
  provenance?: {
    c4NearestParkSource?: string;
    c4NearestParkRetrievedAt?: string;
    c4ParkSource?: string;
    c4ParkRetrievedAt?: string;
    c5Source?: string;
    c5RetrievedAt?: string;
  },
): AssessmentScores {

  const inputs: Record<string, FixedInput> = {};
  const add = (indicator: string, value: unknown, reference: number[] | undefined, metadata: Partial<FixedInput> = {}) => {
    inputs[indicator] = { ...metadata, value, reference };
  };
  const safety = { source: c1SafetyMetrics?.source, method: c1SafetyMetrics?.method, confidence: c1SafetyMetrics?.confidence, retrievedAt: c1SafetyMetrics?.retrievedAt };
  add('trafficAccidentCount500m', c1SafetyMetrics?.accidentCount500m, c1SafetyMetrics?.accidentCountReference, safety);
  const floodCells = c1SafetyMetrics?.floodHazard || [];
  const validFloods = floodCells.filter(cell => validObservation(cell.depthCm));
  const maxFlood = validFloods.reduce<(typeof floodCells)[number] | undefined>((max, cell) => !max || cell.depthCm! > max.depthCm! ? cell : max, undefined);
  add('maxFloodDepthCm', maxFlood?.depthCm, c1SafetyMetrics?.floodDepthReference, { source: maxFlood?.source, retrievedAt: maxFlood?.retrievedAt, method: 'official' });
  add('streetLightCount300m', c1SafetyMetrics?.streetLightCount300m, c1SafetyMetrics?.streetLightCountReference, safety);
  add('fireHydrantCount500m', c1SafetyMetrics?.fireHydrantCount500m, c1SafetyMetrics?.fireHydrantCountReference, safety);

  const poi = { source: c2PoiMetrics?.source, method: c2PoiMetrics?.method, confidence: c2PoiMetrics?.confidence, retrievedAt: c2PoiMetrics?.retrievedAt };
  for (const key of ['supermarketDist', 'convenienceDist', 'clinicDist', 'schoolDist', 'bankPostDist', 'marketDist'] as const) {
    add(key, c2PoiMetrics?.[key], normalization?.c2Distances?.[key], poi);
  }
  add('poiDensityCount', c2PoiMetrics?.poiDensityCount, c2PoiDensityReference, poi);

  const transit = { source: c3TransitMetrics?.source, method: c3TransitMetrics?.method, confidence: c3TransitMetrics?.confidence, retrievedAt: c3TransitMetrics?.retrievedAt };
  add('mrtOrRailDist', c3TransitMetrics?.mrtOrRailDist, normalization?.c3RailDistances, transit);
  add('busStopDist', c3TransitMetrics?.busStopDist, normalization?.c3BusDistances, transit);
  add('youBikeNearestDist', c3TransitMetrics?.youBikeNearestDist, normalization?.c3YouBikeDistances, transit);
  add('bikeLaneLength500m', c3TransitMetrics?.bikeLaneLength500m, normalization?.c3BikeLaneLengths, transit);
  add('sidewalkCoverage500mPct', c3TransitMetrics?.sidewalkCoverage500mPct, normalization?.c3SidewalkCoveragePcts, transit);

  const green = { source: c4GreenMetrics?.source, method: c4GreenMetrics?.method, confidence: c4GreenMetrics?.confidence, retrievedAt: c4GreenMetrics?.retrievedAt };
  add('aqi', weather?.aqi, normalization?.c4Aqi, { source: weather?.source, retrievedAt: weather?.retrievedAt, method: 'api' });
  add('streetTreeDensityPerKm2', c4GreenMetrics?.streetTreeDensityPerKm2, c4GreenMetrics?.streetTreeDensityReference, green);
  add('parkTreeDensityPerKm2', c4GreenMetrics?.parkTreeDensityPerKm2, c4GreenMetrics?.parkTreeDensityReference, green);
  add('nearestParkDist', c4GreenMetrics?.nearestParkDist, normalization?.c4NearestParkDistances, {
    ...green, source: provenance?.c4NearestParkSource || green.source, retrievedAt: provenance?.c4NearestParkRetrievedAt || green.retrievedAt,
  });
  add('coolingPointCount1200m', c4GreenMetrics?.coolingPointCount1200m, c4GreenMetrics?.coolingPointCountReference || normalization?.c4CoolingPointCounts, green);
  const community = { source: provenance?.c5Source, retrievedAt: provenance?.c5RetrievedAt };
  add('communityCulturalPoiCount800m', c5CommunityCount, c5CommunityReference, community);
  add('nearestCommunityCulturalFacilityDist', c5NearestCommunityDistance, normalization?.c5NearestCommunityDistances, community);

  const evidence: ScoreFactor[] = [];
  const raw = (category: Category, indicator: string, value: unknown, unit: string, metadata: Partial<FixedInput>, direction: ScoreFactor['direction'] = 'higher_is_better') => {
    const valid = validObservation(value);
    evidence.push({ category, indicator, value: valid ? value : null, unit, direction,
      source: valid ? metadata.source || 'unavailable' : 'unavailable', method: metadata.method || 'calculated',
      confidence: valid ? metadata.confidence || 'medium' : 'low', status: valid ? 'available' : 'unavailable',
      retrievedAt: valid ? metadata.retrievedAt : undefined, scoringMethod: 'raw_observation' });
  };
  raw('C1', 'fatalTrafficAccidentCount500m', c1SafetyMetrics?.fatalAccidentCount500m, 'accidents', safety, 'lower_is_better');
  raw('C1', 'injuryTrafficAccidentCount500m', c1SafetyMetrics?.injuryAccidentCount500m, 'accidents', safety, 'lower_is_better');
  for (const cell of floodCells) raw('C1', `floodHazard_${cell.scenarioMmPerHour}mmh`, cell.depthCm, 'cm', { source: cell.source, retrievedAt: cell.retrievedAt, method: 'official' }, 'lower_is_better');
  raw('C4', 'streetTreeCount800m', c4GreenMetrics?.streetTreeCount800m, 'trees', green);
  raw('C4', 'parkTreeCount800m', c4GreenMetrics?.parkTreeCount800m, 'trees', green);
  raw('C4', 'parkCount800m', c4GreenMetrics?.parkCount800m, 'parks', { ...green, source: provenance?.c4ParkSource || green.source, retrievedAt: provenance?.c4ParkRetrievedAt || green.retrievedAt });
  return calculateFixedScores(inputs, evidence);
}
