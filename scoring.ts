export type Category = "C1" | "C2" | "C3" | "C4" | "C5";

import { FieldObservationAdjustment } from "./src/types";
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
  scoringMethod?: "empirical_percentile" | "raw_observation" | "not_scored";
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
}

export interface AssessmentScores {
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
}

export interface C2PoiMetrics {
  supermarketDist?: number;
  convenienceDist?: number;
  clinicDist?: number;
  schoolDist?: number;
  bankPostDist?: number;
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

function empiricalPercentileScore(value: number | undefined, referenceValues: number[] | undefined, direction: "higher_is_better" | "lower_is_better" = "higher_is_better"): number | null {
  if (!Number.isFinite(value) || !referenceValues) return null;
  const sorted = referenceValues.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length < 20) return null;
  const rank = sorted.filter((candidate) => candidate <= Number(value)).length;
  const percentile = (rank / sorted.length) * 100;
  return clampScore(direction === "lower_is_better" ? 100 - percentile : percentile);
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
  const adjustedCls = normalizedBaseline == null
    ? null
    : clampScore(normalizedBaseline + rawAdjustment);

  return {
    baselineCls: normalizedBaseline,
    adjustedCls,
    adjustment: adjustedCls == null || normalizedBaseline == null ? 0 : adjustedCls - normalizedBaseline,
    categoryAdjustments,
    itemAdjustments,
    ratedItemCount,
  };
}

function confidenceRank(value: "high" | "medium" | "low"): number {
  return value === "high" ? 3 : value === "medium" ? 2 : 1;
}

function overallConfidence(factors: ScoreFactor[]): "high" | "medium" | "low" {
  if (!factors.length) return "low";
  const avg = average(factors.map((factor) => confidenceRank(factor.confidence)));
  return avg >= 2.6 ? "high" : avg >= 1.8 ? "medium" : "low";
}

function medianValue(values: number[] | undefined): number | null {
  if (!values) return null;
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function referenceRelativeScore(
  value: number | undefined,
  referenceValues: number[] | undefined,
  direction: "higher_is_better" | "lower_is_better",
): number | null {
  if (!Number.isFinite(value)) return null;
  const median = medianValue(referenceValues);
  if (median == null) return null;

  const numericValue = Number(value);
  if (median <= 0) {
    if (direction === "lower_is_better") return numericValue <= 0 ? 100 : 0;
    return numericValue > 0 ? 100 : 0;
  }

  const ratioScore = direction === "lower_is_better"
    ? (100 * median) / (median + Math.max(0, numericValue))
    : (100 * Math.max(0, numericValue)) / (Math.max(0, numericValue) + median);
  return clampScore(ratioScore);
}

function regionalPriorScore(candidates: Array<number | null>): number | null {
  const valid = candidates.filter((value): value is number => Number.isFinite(value));
  return valid.length ? clampScore(average(valid)) : null;
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

  if (assessment.overall !== null && categories.some((category) => category.score === null)) {
    errors.push("overall must be null when any category score is unavailable");
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
    c2Distances?: Partial<Record<"supermarketDist" | "convenienceDist" | "clinicDist" | "schoolDist" | "bankPostDist", number[]>>;
    c3RailDistances?: number[];
    c3BusDistances?: number[];
    c3YouBikeDistances?: number[];
    c4Aqi?: number[];
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

  // C1 uses only source-backed accident and official flood-hazard observations.
  const c1AccidentCount = c1SafetyMetrics?.accidentCount500m;
  const c1FatalCount = c1SafetyMetrics?.fatalAccidentCount500m;
  const c1InjuryCount = c1SafetyMetrics?.injuryAccidentCount500m;
  const c1Source = c1SafetyMetrics?.source || "unavailable";
  const c1Factors: ScoreFactor[] = [
    {
      category: "C1",
      indicator: "trafficAccidentCount500m",
      value: Number.isFinite(Number(c1AccidentCount)) ? Number(c1AccidentCount) : null,
      unit: "accidents",
      direction: "lower_is_better",
      source: Number.isFinite(Number(c1AccidentCount)) ? c1Source : "unavailable",
      method: Number.isFinite(Number(c1AccidentCount)) ? c1SafetyMetrics?.method || "official" : "calculated",
      confidence: Number.isFinite(Number(c1AccidentCount)) ? c1SafetyMetrics?.confidence || "low" : "low",
      status: Number.isFinite(Number(c1AccidentCount)) ? "available" : "unavailable",
      retrievedAt: c1SafetyMetrics?.retrievedAt,
      referenceSampleSize: c1SafetyMetrics?.accidentCountReference?.filter(Number.isFinite).length ?? 0,
      scoringMethod: "raw_observation",
    },
    {
      category: "C1",
      indicator: "fatalTrafficAccidentCount500m",
      value: Number.isFinite(Number(c1FatalCount)) ? Number(c1FatalCount) : null,
      unit: "accidents",
      direction: "lower_is_better",
      source: Number.isFinite(Number(c1FatalCount)) ? c1Source : "unavailable",
      method: Number.isFinite(Number(c1FatalCount)) ? c1SafetyMetrics?.method || "official" : "calculated",
      confidence: Number.isFinite(Number(c1FatalCount)) ? c1SafetyMetrics?.confidence || "low" : "low",
      status: Number.isFinite(Number(c1FatalCount)) ? "available" : "unavailable",
      retrievedAt: c1SafetyMetrics?.retrievedAt,
      referenceSampleSize: c1SafetyMetrics?.accidentCountReference?.filter(Number.isFinite).length ?? 0,
      scoringMethod: "raw_observation",
    },
    {
      category: "C1",
      indicator: "injuryTrafficAccidentCount500m",
      value: Number.isFinite(Number(c1InjuryCount)) ? Number(c1InjuryCount) : null,
      unit: "accidents",
      direction: "lower_is_better",
      source: Number.isFinite(Number(c1InjuryCount)) ? c1Source : "unavailable",
      method: Number.isFinite(Number(c1InjuryCount)) ? c1SafetyMetrics?.method || "official" : "calculated",
      confidence: Number.isFinite(Number(c1InjuryCount)) ? c1SafetyMetrics?.confidence || "low" : "low",
      status: Number.isFinite(Number(c1InjuryCount)) ? "available" : "unavailable",
      retrievedAt: c1SafetyMetrics?.retrievedAt,
      referenceSampleSize: c1SafetyMetrics?.accidentCountReference?.filter(Number.isFinite).length ?? 0,
      scoringMethod: "raw_observation",
    },
  ];
  const floodCells = c1SafetyMetrics?.floodHazard || [];
  const floodDepths = floodCells.map((cell) => Number(cell.depthCm)).filter(Number.isFinite);
  const maxFloodDepth = floodDepths.length ? Math.max(...floodDepths) : undefined;
  const accidentScore = empiricalPercentileScore(c1AccidentCount, c1SafetyMetrics?.accidentCountReference, "lower_is_better")
    ?? referenceRelativeScore(c1AccidentCount, c1SafetyMetrics?.accidentCountReference, "lower_is_better");
  const floodScore = empiricalPercentileScore(maxFloodDepth, c1SafetyMetrics?.floodDepthReference, "lower_is_better")
    ?? referenceRelativeScore(maxFloodDepth, c1SafetyMetrics?.floodDepthReference, "lower_is_better");
  for (const cell of floodCells) {
    c1Factors.push({
      category: "C1",
      indicator: `floodHazard_${cell.scenarioMmPerHour}mmh`,
      value: cell.depthCm,
      unit: "cm",
      direction: "lower_is_better",
      source: cell.source,
      method: "official",
      confidence: "high",
      status: cell.depthCm != null ? "available" : "unavailable",
      retrievedAt: cell.retrievedAt,
      referenceSampleSize: c1SafetyMetrics?.floodDepthReference?.filter(Number.isFinite).length ?? 0,
      scoringMethod: (c1SafetyMetrics?.floodDepthReference?.filter(Number.isFinite).length ?? 0) >= 20
        ? "empirical_percentile"
        : "not_scored",
      availabilityReason: cell.depthCm == null
        ? "no_observation"
        : ((c1SafetyMetrics?.floodDepthReference?.filter(Number.isFinite).length ?? 0) < 20
          ? "insufficient_reference_data"
          : undefined),
    });
  }

  const streetLightCount = c1SafetyMetrics?.streetLightCount300m;
  const streetLightReference = c1SafetyMetrics?.streetLightCountReference;
  const streetLightReferenceSize = streetLightReference?.filter(Number.isFinite).length ?? 0;
  const streetLightScore = Number.isFinite(Number(streetLightCount))
    ? (empiricalPercentileScore(Number(streetLightCount), streetLightReference, "higher_is_better")
      ?? referenceRelativeScore(Number(streetLightCount), streetLightReference, "higher_is_better"))
    : null;
  c1Factors.push({
    category: "C1",
    indicator: "streetLightCount300m",
    value: Number.isFinite(Number(streetLightCount)) ? Number(streetLightCount) : null,
    unit: "lights",
    direction: "higher_is_better",
    source: Number.isFinite(Number(streetLightCount))
      ? (c1SafetyMetrics?.source || "unavailable")
      : "unavailable",
    method: Number.isFinite(Number(streetLightCount))
      ? (c1SafetyMetrics?.method || "calculated")
      : "calculated",
    confidence: streetLightScore != null ? "medium" : (Number.isFinite(Number(streetLightCount)) ? "low" : "low"),
    status: Number.isFinite(Number(streetLightCount)) ? "available" : "unavailable",
    retrievedAt: c1SafetyMetrics?.retrievedAt,
    referenceSampleSize: streetLightReferenceSize,
    scoringMethod: streetLightScore != null && streetLightReferenceSize >= 20 ? "empirical_percentile" : "not_scored",
    availabilityReason: Number.isFinite(Number(streetLightCount)) ? (streetLightScore == null ? "insufficient_reference_data" : undefined) : "no_observation",
  });

  const c1ComponentScores = [accidentScore, floodScore, streetLightScore]
    .filter((value): value is number => value !== null);
  const c1Observed: number | null = c1ComponentScores.length
    ? clampScore(average(c1ComponentScores))
    : null;


  // C2 is calculated only from source-backed POI distances/counts. Missing POI types
  // remain unavailable; they are never replaced by regional benchmark distances.
  const c2Definitions = [
    ["supermarketDist", c2PoiMetrics?.supermarketDist],
    ["convenienceDist", c2PoiMetrics?.convenienceDist],
    ["clinicDist", c2PoiMetrics?.clinicDist],
    ["schoolDist", c2PoiMetrics?.schoolDist],
    ["bankPostDist", c2PoiMetrics?.bankPostDist],
  ] as const;
  const c2Source = c2PoiMetrics?.source || "unavailable";
  const c2Method = c2PoiMetrics?.method || "calculated";
  const c2Confidence = c2PoiMetrics?.confidence || "low";

  const c2Factors: ScoreFactor[] = c2Definitions.map(([indicator, raw]) => ({
    category: "C2" as Category,
    indicator,
    value: Number.isFinite(Number(raw)) ? Number(raw) : null,
    unit: "m",
    direction: "lower_is_better" as const,
    source: Number.isFinite(Number(raw)) ? c2Source : "unavailable",
    method: Number.isFinite(Number(raw)) ? c2Method : "calculated",
    confidence: Number.isFinite(Number(raw)) ? c2Confidence : "low",
    status: Number.isFinite(Number(raw)) ? "available" : "unavailable",
  }));

  const poiDensity = c2PoiMetrics?.poiDensityCount;
  c2Factors.push({
    category: "C2",
    indicator: "poiDensityCount",
    value: Number.isFinite(Number(poiDensity)) ? Number(poiDensity) : null,
    unit: "POIs",
    direction: "higher_is_better",
    source: Number.isFinite(Number(poiDensity)) ? c2Source : "unavailable",
    method: Number.isFinite(Number(poiDensity)) ? c2Method : "calculated",
    confidence: Number.isFinite(Number(poiDensity)) ? c2Confidence : "low",
    status: Number.isFinite(Number(poiDensity)) ? "available" : "unavailable",
    retrievedAt: c2PoiMetrics?.retrievedAt,
    referenceSampleSize: c2PoiDensityReference?.filter(Number.isFinite).length ?? 0,
    scoringMethod: "not_scored",
    availabilityReason: Number.isFinite(Number(poiDensity)) ? "insufficient_reference_data" : "no_observation",
  });

  for (const factor of c2Factors) {
    const reference = normalization?.c2Distances?.[factor.indicator as keyof NonNullable<typeof normalization.c2Distances>];
    factor.referenceSampleSize = reference?.filter(Number.isFinite).length ?? 0;
    factor.retrievedAt = c2PoiMetrics?.retrievedAt;
    factor.scoringMethod = factor.value != null
      ? (factor.referenceSampleSize >= 20 ? "empirical_percentile" : "raw_observation")
      : "not_scored";
    if (factor.value != null && factor.referenceSampleSize < 20) {
      factor.availabilityReason = undefined;
    }
  }

  const poiDensityScore = empiricalPercentileScore(poiDensity, c2PoiDensityReference);
  const c2ComponentScores = c2Definitions
    .map(([indicator, value]) => {
      if (!Number.isFinite(Number(value))) return null;
      const percentile = empiricalPercentileScore(
        Number(value),
        normalization?.c2Distances?.[indicator],
        "lower_is_better",
      );
      return percentile
        ?? referenceRelativeScore(
          Number(value),
          normalization?.c2Distances?.[indicator],
          "lower_is_better",
        )
        ?? inverseDistanceScore(Number(value), 500);
    }).filter((value): value is number => value !== null);
  c2Factors.forEach((factor) => {
    if (factor.value == null) factor.availabilityReason = "no_observation";
  });
  if (poiDensityScore !== null) {
    c2ComponentScores.push(poiDensityScore);
  }
  const c2Observed: number | null = c2ComponentScores.length
    ? clampScore(average(c2ComponentScores))
    : null;

  // C3 uses only actual transit POIs. Frequency, walkability and bike-lane scores
  // are intentionally omitted until backed by real transit/infrastructure datasets.
  const c3Factors: ScoreFactor[] = [
    {
      category: "C3",
      indicator: "mrtOrRailDist",
      value: Number.isFinite(Number(c3TransitMetrics?.mrtOrRailDist)) ? Number(c3TransitMetrics?.mrtOrRailDist) : null,
      unit: "m",
      direction: "lower_is_better",
      source: Number.isFinite(Number(c3TransitMetrics?.mrtOrRailDist)) ? (c3TransitMetrics?.source || "unavailable") : "unavailable",
      method: Number.isFinite(Number(c3TransitMetrics?.mrtOrRailDist)) ? (c3TransitMetrics?.method || "calculated") : "calculated",
      confidence: Number.isFinite(Number(c3TransitMetrics?.mrtOrRailDist)) ? (c3TransitMetrics?.confidence || "low") : "low",
      status: Number.isFinite(Number(c3TransitMetrics?.mrtOrRailDist)) ? "available" : "unavailable",
      retrievedAt: c3TransitMetrics?.retrievedAt,
      referenceSampleSize: normalization?.c3RailDistances?.filter(Number.isFinite).length ?? 0,
      scoringMethod: Number.isFinite(Number(c3TransitMetrics?.mrtOrRailDist))
        ? ((normalization?.c3RailDistances?.filter(Number.isFinite).length ?? 0) >= 20 ? "empirical_percentile" : "raw_observation")
        : "not_scored",
      availabilityReason: Number.isFinite(Number(c3TransitMetrics?.mrtOrRailDist)) ? undefined : "no_observation",
    },
    {
      category: "C3",
      indicator: "busStopDist",
      value: Number.isFinite(Number(c3TransitMetrics?.busStopDist)) ? Number(c3TransitMetrics?.busStopDist) : null,
      unit: "m",
      direction: "lower_is_better",
      source: Number.isFinite(Number(c3TransitMetrics?.busStopDist)) ? (c3TransitMetrics?.source || "unavailable") : "unavailable",
      method: Number.isFinite(Number(c3TransitMetrics?.busStopDist)) ? (c3TransitMetrics?.method || "calculated") : "calculated",
      confidence: Number.isFinite(Number(c3TransitMetrics?.busStopDist)) ? (c3TransitMetrics?.confidence || "low") : "low",
      status: Number.isFinite(Number(c3TransitMetrics?.busStopDist)) ? "available" : "unavailable",
      retrievedAt: c3TransitMetrics?.retrievedAt,
      referenceSampleSize: normalization?.c3BusDistances?.filter(Number.isFinite).length ?? 0,
      scoringMethod: Number.isFinite(Number(c3TransitMetrics?.busStopDist))
        ? ((normalization?.c3BusDistances?.filter(Number.isFinite).length ?? 0) >= 20 ? "empirical_percentile" : "raw_observation")
        : "not_scored",
      availabilityReason: Number.isFinite(Number(c3TransitMetrics?.busStopDist)) ? undefined : "no_observation",
    },
    {
      category: "C3",
      indicator: "youBikeNearestDist",
      value: Number.isFinite(Number(c3TransitMetrics?.youBikeNearestDist)) ? Number(c3TransitMetrics?.youBikeNearestDist) : null,
      unit: "m",
      direction: "lower_is_better",
      source: Number.isFinite(Number(c3TransitMetrics?.youBikeNearestDist))
        ? (c3TransitMetrics?.source || "unavailable")
        : "unavailable",
      method: Number.isFinite(Number(c3TransitMetrics?.youBikeNearestDist))
        ? (c3TransitMetrics?.method || "calculated")
        : "calculated",
      confidence: Number.isFinite(Number(c3TransitMetrics?.youBikeNearestDist))
        ? (c3TransitMetrics?.confidence || "low")
        : "low",
      status: Number.isFinite(Number(c3TransitMetrics?.youBikeNearestDist)) ? "available" : "unavailable",
      retrievedAt: c3TransitMetrics?.retrievedAt,
      scoringMethod: "raw_observation",
      availabilityReason: Number.isFinite(Number(c3TransitMetrics?.youBikeNearestDist)) ? undefined : "no_observation",
    },
    {
      category: "C3",
      indicator: "youBikeAvailableBikes",
      value: Number.isFinite(Number(c3TransitMetrics?.youBikeAvailableBikes)) ? Number(c3TransitMetrics?.youBikeAvailableBikes) : null,
      unit: "bikes",
      direction: "higher_is_better",
      source: Number.isFinite(Number(c3TransitMetrics?.youBikeAvailableBikes))
        ? (c3TransitMetrics?.source || "unavailable")
        : "unavailable",
      method: Number.isFinite(Number(c3TransitMetrics?.youBikeAvailableBikes))
        ? (c3TransitMetrics?.method || "calculated")
        : "calculated",
      confidence: Number.isFinite(Number(c3TransitMetrics?.youBikeAvailableBikes))
        ? (c3TransitMetrics?.confidence || "low")
        : "low",
      status: Number.isFinite(Number(c3TransitMetrics?.youBikeAvailableBikes)) ? "available" : "unavailable",
      retrievedAt: c3TransitMetrics?.retrievedAt,
      scoringMethod: "not_scored",
      availabilityReason: Number.isFinite(Number(c3TransitMetrics?.youBikeAvailableBikes)) ? undefined : "no_observation",
    },
    {
      category: "C3",
      indicator: "youBikeAvailableDocks",
      value: Number.isFinite(Number(c3TransitMetrics?.youBikeAvailableDocks)) ? Number(c3TransitMetrics?.youBikeAvailableDocks) : null,
      unit: "docks",
      direction: "higher_is_better",
      source: Number.isFinite(Number(c3TransitMetrics?.youBikeAvailableDocks))
        ? (c3TransitMetrics?.source || "unavailable")
        : "unavailable",
      method: Number.isFinite(Number(c3TransitMetrics?.youBikeAvailableDocks))
        ? (c3TransitMetrics?.method || "calculated")
        : "calculated",
      confidence: Number.isFinite(Number(c3TransitMetrics?.youBikeAvailableDocks))
        ? (c3TransitMetrics?.confidence || "low")
        : "low",
      status: Number.isFinite(Number(c3TransitMetrics?.youBikeAvailableDocks)) ? "available" : "unavailable",
      retrievedAt: c3TransitMetrics?.retrievedAt,
      scoringMethod: "not_scored",
      availabilityReason: Number.isFinite(Number(c3TransitMetrics?.youBikeAvailableDocks)) ? undefined : "no_observation",
    },
    {
      category: "C3",
      indicator: "bikeLaneLength500m",
      value: Number.isFinite(Number(c3TransitMetrics?.bikeLaneLength500m)) ? Number(c3TransitMetrics?.bikeLaneLength500m) : null,
      unit: "m",
      direction: "higher_is_better",
      source: Number.isFinite(Number(c3TransitMetrics?.bikeLaneLength500m))
        ? (c3TransitMetrics?.source || "unavailable")
        : "unavailable",
      method: Number.isFinite(Number(c3TransitMetrics?.bikeLaneLength500m))
        ? (c3TransitMetrics?.method || "calculated")
        : "calculated",
      confidence: Number.isFinite(Number(c3TransitMetrics?.bikeLaneLength500m))
        ? (c3TransitMetrics?.confidence || "low")
        : "low",
      status: Number.isFinite(Number(c3TransitMetrics?.bikeLaneLength500m)) ? "available" : "unavailable",
      retrievedAt: c3TransitMetrics?.retrievedAt,
      referenceSampleSize: normalization?.c3BikeLaneLengths?.filter(Number.isFinite).length ?? 0,
      scoringMethod: Number.isFinite(Number(c3TransitMetrics?.bikeLaneLength500m))
        ? ((normalization?.c3BikeLaneLengths?.filter(Number.isFinite).length ?? 0) >= 20 ? "empirical_percentile" : "raw_observation")
        : "not_scored",
      availabilityReason: Number.isFinite(Number(c3TransitMetrics?.bikeLaneLength500m)) ? undefined : "no_observation",
    },
  ];
  const c3ComponentScores = c3Factors
.filter((factor) => ["mrtOrRailDist", "busStopDist", "youBikeNearestDist", "bikeLaneLength500m"].includes(factor.indicator))
    .map((factor) => {
      if (factor.value == null) return null;
      const reference = factor.indicator === "busStopDist"
        ? normalization?.c3BusDistances
        : factor.indicator === "mrtOrRailDist"
          ? normalization?.c3RailDistances
          : factor.indicator === "youBikeNearestDist"
            ? normalization?.c3YouBikeDistances
            : factor.indicator === "bikeLaneLength500m"
              ? normalization?.c3BikeLaneLengths
              : undefined;
      const direction = factor.indicator === "bikeLaneLength500m" ? "higher_is_better" : "lower_is_better";
      const percentile = empiricalPercentileScore(factor.value, reference, direction);
      return percentile
        ?? referenceRelativeScore(factor.value, reference, direction)
        ?? inverseDistanceScore(factor.value, 500);
    })
    .filter((value): value is number => value !== null);
  const c3Observed: number | null = c3ComponentScores.length
    ? clampScore(average(c3ComponentScores))
    : null;

  // C4 combines only source-backed air quality and official green inventory metrics.
  const airScore = weather?.aqi != null
    ? (empiricalPercentileScore(weather.aqi, normalization?.c4Aqi, "lower_is_better")
      ?? referenceRelativeScore(weather.aqi, normalization?.c4Aqi, "lower_is_better"))
    : null;
  const c4Factors: ScoreFactor[] = [{
    category: "C4",
    indicator: "airQualityScore",
    value: airScore,
    unit: "score",
    direction: "higher_is_better",
    source: airScore != null ? (weather?.source || "Open-Meteo Air Quality") : "unavailable",
    method: airScore != null ? "api" : "calculated",
    confidence: airScore != null ? "medium" : "low",
    status: airScore != null ? "available" : "unavailable",
    retrievedAt: weather?.retrievedAt,
    referenceSampleSize: normalization?.c4Aqi?.filter(Number.isFinite).length ?? 0,
    scoringMethod: airScore != null ? "empirical_percentile" : (weather?.aqi != null ? "not_scored" : "not_scored"),
    availabilityReason: weather?.aqi == null ? "no_observation" : (airScore == null ? "insufficient_reference_data" : undefined),
  }];
  const streetTreeCount = c4GreenMetrics?.streetTreeCount800m;
  const parkTreeCount = c4GreenMetrics?.parkTreeCount800m;
  const nearestParkDist = c4GreenMetrics?.nearestParkDist;
  const parkCount800m = c4GreenMetrics?.parkCount800m;
  const streetTreeDensityPerKm2 = c4GreenMetrics?.streetTreeDensityPerKm2;
  const parkTreeDensityPerKm2 = c4GreenMetrics?.parkTreeDensityPerKm2;
  c4Factors.push(
    {
      category: "C4", indicator: "streetTreeCount800m", value: Number.isFinite(Number(streetTreeCount)) ? Number(streetTreeCount) : null,
      unit: "trees", direction: "higher_is_better", source: Number.isFinite(Number(streetTreeCount)) ? c4GreenMetrics?.source || "unavailable" : "unavailable",
      method: Number.isFinite(Number(streetTreeCount)) ? c4GreenMetrics?.method || "calculated" : "calculated", confidence: Number.isFinite(Number(streetTreeCount)) ? c4GreenMetrics?.confidence || "low" : "low", status: Number.isFinite(Number(streetTreeCount)) ? "available" : "unavailable", retrievedAt: c4GreenMetrics?.retrievedAt,
    },
    {
      category: "C4", indicator: "parkTreeCount800m", value: Number.isFinite(Number(parkTreeCount)) ? Number(parkTreeCount) : null,
      unit: "trees", direction: "higher_is_better", source: Number.isFinite(Number(parkTreeCount)) ? c4GreenMetrics?.source || "unavailable" : "unavailable",
      method: Number.isFinite(Number(parkTreeCount)) ? c4GreenMetrics?.method || "calculated" : "calculated", confidence: Number.isFinite(Number(parkTreeCount)) ? c4GreenMetrics?.confidence || "low" : "low", status: Number.isFinite(Number(parkTreeCount)) ? "available" : "unavailable", retrievedAt: c4GreenMetrics?.retrievedAt,
    },
  );
  const streetTreeDensityScore = empiricalPercentileScore(streetTreeDensityPerKm2, c4GreenMetrics?.streetTreeDensityReference)
    ?? referenceRelativeScore(streetTreeDensityPerKm2, c4GreenMetrics?.streetTreeDensityReference, "higher_is_better");
  const parkTreeDensityScore = empiricalPercentileScore(parkTreeDensityPerKm2, c4GreenMetrics?.parkTreeDensityReference)
    ?? referenceRelativeScore(parkTreeDensityPerKm2, c4GreenMetrics?.parkTreeDensityReference, "higher_is_better");
  c4Factors.push(
    {
      category: "C4", indicator: "streetTreeDensityPerKm2", value: Number.isFinite(Number(streetTreeDensityPerKm2)) ? Number(streetTreeDensityPerKm2) : null,
      unit: "trees/km²", direction: "higher_is_better", source: Number.isFinite(Number(streetTreeDensityPerKm2)) ? c4GreenMetrics?.source || "unavailable" : "unavailable",
      method: "calculated", confidence: streetTreeDensityScore != null ? "medium" : "low", status: Number.isFinite(Number(streetTreeDensityPerKm2)) ? "available" : "unavailable", retrievedAt: c4GreenMetrics?.retrievedAt,
      referenceSampleSize: c4GreenMetrics?.streetTreeDensityReference?.filter(Number.isFinite).length ?? 0,
      scoringMethod: streetTreeDensityScore != null ? "empirical_percentile" : "not_scored",
      availabilityReason: Number.isFinite(Number(streetTreeDensityPerKm2)) ? (streetTreeDensityScore == null ? "insufficient_reference_data" : undefined) : "no_observation",
    },
    {
      category: "C4", indicator: "parkTreeDensityPerKm2", value: Number.isFinite(Number(parkTreeDensityPerKm2)) ? Number(parkTreeDensityPerKm2) : null,
      unit: "trees/km²", direction: "higher_is_better", source: Number.isFinite(Number(parkTreeDensityPerKm2)) ? c4GreenMetrics?.source || "unavailable" : "unavailable",
      method: "calculated", confidence: parkTreeDensityScore != null ? "medium" : "low", status: Number.isFinite(Number(parkTreeDensityPerKm2)) ? "available" : "unavailable", retrievedAt: c4GreenMetrics?.retrievedAt,
      referenceSampleSize: c4GreenMetrics?.parkTreeDensityReference?.filter(Number.isFinite).length ?? 0,
      scoringMethod: parkTreeDensityScore != null ? "empirical_percentile" : "not_scored",
      availabilityReason: Number.isFinite(Number(parkTreeDensityPerKm2)) ? (parkTreeDensityScore == null ? "insufficient_reference_data" : undefined) : "no_observation",
    },
    {
      category: "C4", indicator: "nearestParkDist", value: Number.isFinite(Number(nearestParkDist)) ? Number(nearestParkDist) : null,
      unit: "m", direction: "lower_is_better", source: Number.isFinite(Number(nearestParkDist)) ? provenance?.c4NearestParkSource || c4GreenMetrics?.source || "unavailable" : "unavailable",
      method: "calculated", confidence: Number.isFinite(Number(nearestParkDist)) ? "medium" : "low", status: Number.isFinite(Number(nearestParkDist)) ? "available" : "unavailable", retrievedAt: provenance?.c4NearestParkRetrievedAt || c4GreenMetrics?.retrievedAt,
      referenceSampleSize: normalization?.c4NearestParkDistances?.filter(Number.isFinite).length ?? 0,
      scoringMethod: Number.isFinite(Number(nearestParkDist)) && (normalization?.c4NearestParkDistances?.filter(Number.isFinite).length ?? 0) >= 20 ? "empirical_percentile" : "not_scored",
      availabilityReason: Number.isFinite(Number(nearestParkDist)) ? ((normalization?.c4NearestParkDistances?.filter(Number.isFinite).length ?? 0) < 20 ? "insufficient_reference_data" : undefined) : "no_observation",
    },
    {
      category: "C4", indicator: "parkCount800m", value: Number.isFinite(Number(parkCount800m)) ? Number(parkCount800m) : null,
      unit: "parks", direction: "higher_is_better",
      source: Number.isFinite(Number(parkCount800m)) ? (provenance?.c4ParkSource || "unavailable") : "unavailable",
      method: Number.isFinite(Number(parkCount800m)) ? "osm" : "calculated",
      confidence: Number.isFinite(Number(parkCount800m)) ? "medium" : "low",
      status: Number.isFinite(Number(parkCount800m)) ? "available" : "unavailable",
      retrievedAt: provenance?.c4ParkRetrievedAt,
      scoringMethod: "raw_observation",
      availabilityReason: Number.isFinite(Number(parkCount800m)) ? undefined : "no_observation",
    },
  );
  // Raw counts are preserved as facts. Density is calculated from the fixed 800m
  // observation radius (2.0106 km²). Nearest-park distance is scored only when
  // a real reference distribution contains at least 20 observations.
  const nearestParkScore = nearestParkDist == null
    ? null
    : (empiricalPercentileScore(nearestParkDist, normalization?.c4NearestParkDistances, "lower_is_better")
      ?? referenceRelativeScore(nearestParkDist, normalization?.c4NearestParkDistances, "lower_is_better"));
  if (nearestParkScore !== null) {
    c4Factors.push({
      category: "C4",
      indicator: "nearestParkDistanceScore",
      value: nearestParkScore,
      unit: "score",
      direction: "higher_is_better",
      source: provenance?.c4NearestParkSource || c4GreenMetrics?.source || "unavailable",
      method: "calculated",
      confidence: "medium",
      status: "available",
      retrievedAt: provenance?.c4NearestParkRetrievedAt || c4GreenMetrics?.retrievedAt,
      referenceSampleSize: normalization?.c4NearestParkDistances?.filter(Number.isFinite).length ?? 0,
      scoringMethod: "empirical_percentile",
    });
  }
  const greenScores = [streetTreeDensityScore, parkTreeDensityScore, nearestParkScore].filter((value): value is number => value !== null);
  const c4Components = [airScore, ...greenScores].filter((value): value is number => value !== null);
  const c4Observed: number | null = c4Components.length ? clampScore(average(c4Components)) : null;

  // C5 measures source-backed community/cultural access only. It does not
  // claim to measure subjective social trust or civic participation.
  const communityScore = empiricalPercentileScore(c5CommunityCount, c5CommunityReference)
    ?? referenceRelativeScore(c5CommunityCount, c5CommunityReference, "higher_is_better");
  const communityReferenceSize = c5CommunityReference?.filter(Number.isFinite).length ?? 0;
  const c5NearestDistanceReferenceSize = normalization?.c5NearestCommunityDistances?.filter(Number.isFinite).length ?? 0;
  const c5NearestDistanceScore = c5NearestCommunityDistance == null
    ? null
    : (empiricalPercentileScore(
      c5NearestCommunityDistance,
      normalization?.c5NearestCommunityDistances,
      "lower_is_better",
    ) ?? referenceRelativeScore(
      c5NearestCommunityDistance,
      normalization?.c5NearestCommunityDistances,
      "lower_is_better",
    ));
  const c5Factors: ScoreFactor[] = [{
    category: "C5",
    indicator: "communityCulturalPoiCount800m",
    value: Number.isFinite(Number(c5CommunityCount)) ? Number(c5CommunityCount) : null,
    unit: "POIs",
    direction: "higher_is_better",
    source: Number.isFinite(Number(c5CommunityCount))
      ? (provenance?.c5Source || "unavailable")
      : "unavailable",
    method: "calculated",
    confidence: communityScore != null ? "medium" : "low",
    status: Number.isFinite(Number(c5CommunityCount)) ? "available" : "unavailable",
    retrievedAt: provenance?.c5RetrievedAt,
    referenceSampleSize: communityReferenceSize,
    scoringMethod: communityScore != null ? "empirical_percentile" : "not_scored",
    availabilityReason: Number.isFinite(Number(c5CommunityCount)) ? (communityScore == null ? "insufficient_reference_data" : undefined) : "no_observation",
  }];
  const c5Components = [communityScore, c5NearestDistanceScore].filter((value): value is number => value !== null);
  if (c5NearestDistanceScore !== null) {
    c5Factors.push({
      category: "C5",
      indicator: "nearestCommunityCulturalFacilityDistanceScore",
      value: c5NearestDistanceScore,
      unit: "score",
      direction: "higher_is_better",
      source: provenance?.c5Source || "unavailable",
      method: "calculated",
      confidence: "medium",
      status: "available",
      retrievedAt: provenance?.c5RetrievedAt,
      referenceSampleSize: c5NearestDistanceReferenceSize,
      scoringMethod: "empirical_percentile",
    });
  }
  const c5Observed: number | null = c5Components.length ? clampScore(average(c5Components)) : null;

  const regionalPriors: Record<Category, { score: number | null; sampleSize: number }> = {
    C1: {
      score: regionalPriorScore([
        referenceRelativeScore(
          medianValue(c1SafetyMetrics?.accidentCountReference) ?? undefined,
          c1SafetyMetrics?.accidentCountReference,
          "lower_is_better",
        ),
        referenceRelativeScore(
          medianValue(c1SafetyMetrics?.floodDepthReference) ?? undefined,
          c1SafetyMetrics?.floodDepthReference,
          "lower_is_better",
        ),
      ]),
      sampleSize: Math.max(
        c1SafetyMetrics?.accidentCountReference?.filter(Number.isFinite).length ?? 0,
        c1SafetyMetrics?.floodDepthReference?.filter(Number.isFinite).length ?? 0,
      ),
    },
    C2: {
      score: regionalPriorScore([
        ...c2Definitions.map(([indicator]) =>
          referenceRelativeScore(
            medianValue(normalization?.c2Distances?.[indicator]) ?? undefined,
            normalization?.c2Distances?.[indicator],
            "lower_is_better",
          ),
        ),
        referenceRelativeScore(
          medianValue(c2PoiDensityReference) ?? undefined,
          c2PoiDensityReference,
          "higher_is_better",
        ),
      ]),
      sampleSize: Math.max(
        ...c2Definitions.map(([indicator]) => normalization?.c2Distances?.[indicator]?.filter(Number.isFinite).length ?? 0),
        c2PoiDensityReference?.filter(Number.isFinite).length ?? 0,
      ),
    },
    C3: {
      score: regionalPriorScore([
        referenceRelativeScore(
          medianValue(normalization?.c3RailDistances) ?? undefined,
          normalization?.c3RailDistances,
          "lower_is_better",
        ),
        referenceRelativeScore(
          medianValue(normalization?.c3BusDistances) ?? undefined,
          normalization?.c3BusDistances,
          "lower_is_better",
        ),
        referenceRelativeScore(
          medianValue(normalization?.c3YouBikeDistances) ?? undefined,
          normalization?.c3YouBikeDistances,
          "lower_is_better",
        ),
        referenceRelativeScore(
          medianValue(normalization?.c3BikeLaneLengths) ?? undefined,
          normalization?.c3BikeLaneLengths,
          "higher_is_better",
        ),
      ]),
      sampleSize: Math.max(
        normalization?.c3RailDistances?.filter(Number.isFinite).length ?? 0,
        normalization?.c3BusDistances?.filter(Number.isFinite).length ?? 0,
        normalization?.c3YouBikeDistances?.filter(Number.isFinite).length ?? 0,
        normalization?.c3BikeLaneLengths?.filter(Number.isFinite).length ?? 0,
      ),
    },
    C4: {
      score: regionalPriorScore([
        referenceRelativeScore(
          medianValue(normalization?.c4Aqi) ?? undefined,
          normalization?.c4Aqi,
          "lower_is_better",
        ),
        referenceRelativeScore(
          medianValue(c4GreenMetrics?.streetTreeDensityReference) ?? undefined,
          c4GreenMetrics?.streetTreeDensityReference,
          "higher_is_better",
        ),
        referenceRelativeScore(
          medianValue(c4GreenMetrics?.parkTreeDensityReference) ?? undefined,
          c4GreenMetrics?.parkTreeDensityReference,
          "higher_is_better",
        ),
        referenceRelativeScore(
          medianValue(normalization?.c4NearestParkDistances) ?? undefined,
          normalization?.c4NearestParkDistances,
          "lower_is_better",
        ),
      ]),
      sampleSize: Math.max(
        normalization?.c4Aqi?.filter(Number.isFinite).length ?? 0,
        c4GreenMetrics?.streetTreeDensityReference?.filter(Number.isFinite).length ?? 0,
        c4GreenMetrics?.parkTreeDensityReference?.filter(Number.isFinite).length ?? 0,
        normalization?.c4NearestParkDistances?.filter(Number.isFinite).length ?? 0,
      ),
    },
    C5: {
      score: regionalPriorScore([
        referenceRelativeScore(
          medianValue(c5CommunityReference) ?? undefined,
          c5CommunityReference,
          "higher_is_better",
        ),
        referenceRelativeScore(
          medianValue(normalization?.c5NearestCommunityDistances) ?? undefined,
          normalization?.c5NearestCommunityDistances,
          "lower_is_better",
        ),
      ]),
      sampleSize: Math.max(
        c5CommunityReference?.filter(Number.isFinite).length ?? 0,
        normalization?.c5NearestCommunityDistances?.filter(Number.isFinite).length ?? 0,
      ),
    },
  };

  const observedScores: Record<Category, number | null> = {
    C1: c1Observed,
    C2: c2Observed,
    C3: c3Observed,
    C4: c4Observed,
    C5: c5Observed,
  };

  const factorSets: Record<Category, ScoreFactor[]> = {
    C1: c1Factors,
    C2: c2Factors,
    C3: c3Factors,
    C4: c4Factors,
    C5: c5Factors,
  };

  const categories: Record<Category, CategoryScore> = {} as Record<Category, CategoryScore>;
  for (const category of Object.keys(observedScores) as Category[]) {
    const observed = observedScores[category];
    const prior = regionalPriors[category];

    if (observed != null) {
      categories[category] = {
        score: observed,
        factors: factorSets[category],
        mode: "observed",
      };
      continue;
    }

    if (prior.score != null) {
      factorSets[category].push({
        category,
        indicator: "regionalReferencePrior",
        value: prior.score,
        unit: "score",
        direction: "higher_is_better",
        source: "StreetLens persisted real reference observations",
        method: "estimated",
        confidence: "low",
        status: "available",
        referenceSampleSize: prior.sampleSize,
        scoringMethod: "not_scored",
        estimationMethod: "regional_real_data_prior",
      });
    }

    categories[category] = {
      score: prior.score,
      factors: factorSets[category],
      mode: prior.score != null ? "estimated" : "observed",
      estimationMethod: prior.score != null ? "regional_real_data_prior" : undefined,
      estimationReferenceSampleSize: prior.score != null ? prior.sampleSize : undefined,
    };
  }

  const allFactors = Object.values(categories).flatMap((category) => category.factors);
  const scoredCategories = Object.values(categories)
    .map((category) => category.score)
    .filter((score): score is number => score !== null);
  const estimatedCategoryCount = Object.values(categories)
    .filter((category) => category.mode === "estimated")
    .length;
  const overall: number | null = scoredCategories.length
    ? clampScore(average(scoredCategories))
    : null;
  const overallMode: ScoreMode = estimatedCategoryCount > 0 ? "estimated" : "observed";
  const baseConfidence = overallConfidence(allFactors);
  const confidence = estimatedCategoryCount > 0 && baseConfidence === "high"
    ? "medium"
    : baseConfidence;

  return {
    c1: categories.C1,
    c2: categories.C2,
    c3: categories.C3,
    c4: categories.C4,
    c5: categories.C5,
    overall,
    overallMode,
    estimatedCategoryCount,
    weights: DEFAULT_WEIGHTS,
    confidence,
  };
}
