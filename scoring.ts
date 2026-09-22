export type Category = "C1" | "C2" | "C3" | "C4" | "C5";

export interface ScoreFactor {
  category: Category;
  indicator: string;
  value: number | null;
  unit: string;
  direction: "higher_is_better" | "lower_is_better";
  source: string;
  method: "official" | "api" | "osm" | "calculated" | "survey" | "estimated";
  confidence: "high" | "medium" | "low";
}

export interface CategoryScore {
  score: number | null;
  factors: ScoreFactor[];
}

export interface AssessmentScores {
  c1: CategoryScore;
  c2: CategoryScore;
  c3: CategoryScore;
  c4: CategoryScore;
  c5: CategoryScore;
  overall: number | null;
  weights: Record<Category, number>;
  confidence: "high" | "medium" | "low";
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
}

export interface C3TransitMetrics {
  mrtOrRailDist?: number;
  busStopDist?: number;
  source: string;
  method: "api" | "osm" | "calculated";
  confidence: "high" | "medium" | "low";
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

function confidenceRank(value: "high" | "medium" | "low"): number {
  return value === "high" ? 3 : value === "medium" ? 2 : 1;
}

function overallConfidence(factors: ScoreFactor[]): "high" | "medium" | "low" {
  if (!factors.length) return "low";
  const avg = average(factors.map((factor) => confidenceRank(factor.confidence)));
  return avg >= 2.6 ? "high" : avg >= 1.8 ? "medium" : "low";
}

export function calculateAssessment(
  baseline: any,
  poiCounts: Partial<Record<Category, number>>,
  weather?: { aqi: number | null; pm25: number | null; source?: string; sourceType?: string },
  c2PoiMetrics?: C2PoiMetrics,
  c3TransitMetrics?: C3TransitMetrics,
): AssessmentScores {
  const source = baseline?.source || "regional_benchmark_estimate";
  const baselineMethod = source === "regional_benchmark_estimate" ? "estimated" : "calculated";
  const baselineConfidence: "high" | "medium" | "low" =
    baselineMethod === "estimated" ? "low" : "medium";

  // Do not derive safety from regional estimates. Until a real safety source is wired in,
  // C1 remains explicitly unavailable rather than presenting synthetic numbers.
  const c1Factors: ScoreFactor[] = [];
  const c1: number | null = null;

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
  });

  const c2ComponentScores = c2Definitions
    .map(([indicator, value]) => Number.isFinite(Number(value))
      ? inverseDistanceScore(Number(value), indicator === "clinicDist" || indicator === "schoolDist" ? 500 : 400)
      : null)
    .filter((value): value is number => value !== null);
  if (Number.isFinite(Number(poiDensity))) {
    c2ComponentScores.push(clampScore(Number(poiDensity) * 2));
  }
  const c2: number | null = c2ComponentScores.length
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
    },
  ];
  const c3ComponentScores = c3Factors
    .map((factor) => factor.value == null ? null : inverseDistanceScore(
      factor.value,
      factor.indicator === "busStopDist" ? 180 : 700,
    ))
    .filter((value): value is number => value !== null);
  const c3: number | null = c3ComponentScores.length
    ? clampScore(average(c3ComponentScores))
    : null;

  // C4 currently has one source-backed indicator: live/model AQI.
  // Noise, green coverage and park distance stay unavailable until source-backed.
  const airScore = weather?.aqi != null ? clampScore(100 - weather.aqi / 2) : null;
  const c4Factors: ScoreFactor[] = [{
    category: "C4",
    indicator: "airQualityScore",
    value: airScore,
    unit: "score",
    direction: "higher_is_better",
    source: airScore != null ? (weather?.source || "Open-Meteo Air Quality") : "unavailable",
    method: airScore != null ? "api" : "calculated",
    confidence: airScore != null ? "medium" : "low",
  }];
  const c4: number | null = airScore;

  // C5 is intentionally unavailable. Social trust/governance/activity must not be
  // inferred from POIs or generated estimates.
  const c5Factors: ScoreFactor[] = [];
  const c5: number | null = null;

  const categories: Record<Category, CategoryScore> = {
    C1: { score: c1, factors: c1Factors },
    C2: { score: c2, factors: c2Factors },
    C3: { score: c3, factors: c3Factors },
    C4: { score: c4, factors: c4Factors },
    C5: { score: c5, factors: c5Factors },
  };

  const scoredCategories = Object.values(categories)
    .map((category) => category.score)
    .filter((score): score is number => score !== null);
  const overall: number | null =
    scoredCategories.length === Object.keys(categories).length
      ? clampScore(average(scoredCategories))
      : null;

  return {
    c1: categories.C1,
    c2: categories.C2,
    c3: categories.C3,
    c4: categories.C4,
    c5: categories.C5,
    overall,
    weights: DEFAULT_WEIGHTS,
    confidence: overallConfidence(allFactors),
  };
}
