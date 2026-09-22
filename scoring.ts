export type Category = "C1" | "C2" | "C3" | "C4" | "C5";

export interface ScoreFactor {
  category: Category;
  indicator: string;
  value: number;
  unit: string;
  direction: "higher_is_better" | "lower_is_better";
  source: string;
  method: "official" | "api" | "osm" | "calculated" | "survey" | "estimated";
  confidence: "high" | "medium" | "low";
}

export interface CategoryScore {
  score: number;
  factors: ScoreFactor[];
}

export interface AssessmentScores {
  c1: CategoryScore;
  c2: CategoryScore;
  c3: CategoryScore;
  c4: CategoryScore;
  c5: CategoryScore;
  overall: number;
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
): AssessmentScores {
  const source = baseline?.source || "regional_benchmark_estimate";
  const baselineMethod = source === "regional_benchmark_estimate" ? "estimated" : "calculated";
  const baselineConfidence: "high" | "medium" | "low" =
    baselineMethod === "estimated" ? "low" : "medium";

  const c1Factors: ScoreFactor[] = [
    {
      category: "C1",
      indicator: "crimeRate",
      value: Number(baseline?.c1?.crimeRate ?? 0),
      unit: "normalized",
      direction: "lower_is_better",
      source,
      method: baselineMethod,
      confidence: baselineConfidence,
    },
    {
      category: "C1",
      indicator: "accidentRate",
      value: Number(baseline?.c1?.accidentRate ?? 0),
      unit: "normalized",
      direction: "lower_is_better",
      source,
      method: baselineMethod,
      confidence: baselineConfidence,
    },
    {
      category: "C1",
      indicator: "hazardLevel",
      value: Number(baseline?.c1?.hazardLevel ?? 0),
      unit: "normalized",
      direction: "lower_is_better",
      source,
      method: baselineMethod,
      confidence: baselineConfidence,
    },
  ];

  const c1 = clampScore(100 - average(c1Factors.map((f) => f.value)));

  const c2Definitions = [
    ["supermarketDist", c2PoiMetrics?.supermarketDist ?? baseline?.c2?.supermarketDist],
    ["convenienceDist", c2PoiMetrics?.convenienceDist ?? baseline?.c2?.convenienceDist],
    ["clinicDist", c2PoiMetrics?.clinicDist ?? baseline?.c2?.clinicDist],
    ["schoolDist", c2PoiMetrics?.schoolDist ?? baseline?.c2?.schoolDist],
    ["bankPostDist", c2PoiMetrics?.bankPostDist ?? baseline?.c2?.bankPostDist],
  ] as const;

  const c2UsesPoiData = Boolean(c2PoiMetrics);
  const c2Source = c2PoiMetrics?.source || source;
  const c2Method = c2PoiMetrics?.method || baselineMethod;
  const c2Confidence = c2PoiMetrics?.confidence || baselineConfidence;

  const c2Factors: ScoreFactor[] = c2Definitions.map(([indicator, raw]) => {
    const hasPoiValue = c2UsesPoiData && Number.isFinite(Number(
      c2PoiMetrics?.[indicator as keyof C2PoiMetrics],
    ));
    return {
      category: "C2" as Category,
      indicator,
      value: Number(raw ?? 0),
      unit: "m",
      direction: "lower_is_better" as const,
      source: hasPoiValue ? c2Source : source,
      method: hasPoiValue ? c2Method : baselineMethod,
      confidence: hasPoiValue ? c2Confidence : baselineConfidence,
    };
  });

  const poiDensity = Number(
    c2PoiMetrics?.poiDensityCount ??
    baseline?.c2?.poiDensityCount ??
    poiCounts.C2 ??
    0,
  );
  const hasRealPoiDensity = c2PoiMetrics?.poiDensityCount != null;
  c2Factors.push({
    category: "C2",
    indicator: "poiDensityCount",
    value: poiDensity,
    unit: "POIs",
    direction: "higher_is_better",
    source: hasRealPoiDensity ? c2Source : source,
    method: hasRealPoiDensity ? c2Method : baselineMethod,
    confidence: hasRealPoiDensity ? c2Confidence : baselineConfidence,
  });

  const c2 = clampScore(
    average(c2Definitions.map(([indicator, value]) => {
      const hasPoiValue = c2UsesPoiData && Number.isFinite(Number(
        c2PoiMetrics?.[indicator as keyof C2PoiMetrics],
      ));
      return inverseDistanceScore(
        Number(value),
        indicator === "clinicDist" || indicator === "schoolDist" ? 500 : 400,
      );
    }).concat(clampScore(poiDensity * 2))),
  );

  const c3Factors: ScoreFactor[] = [
    ["mrtOrRailDist", baseline?.c3?.mrtOrRailDist, "m"],
    ["busStopDist", baseline?.c3?.busStopDist, "m"],
    ["busFrequencyScore", baseline?.c3?.busFrequencyScore, "score"],
    ["walkabilityScore", baseline?.c3?.walkabilityScore, "score"],
    ["bikeLaneScore", baseline?.c3?.bikeLaneScore, "score"],
  ].map(([indicator, value, unit]) => ({
    category: "C3",
    indicator: String(indicator),
    value: Number(value ?? 0),
    unit: String(unit),
    direction: String(indicator).endsWith("Dist") ? "lower_is_better" : "higher_is_better",
    source,
    method: baselineMethod,
    confidence: baselineConfidence,
  }));
  const c3 = clampScore(
    average([
      inverseDistanceScore(Number(baseline?.c3?.mrtOrRailDist), 700),
      inverseDistanceScore(Number(baseline?.c3?.busStopDist), 180),
      Number(baseline?.c3?.busFrequencyScore ?? 0),
      Number(baseline?.c3?.walkabilityScore ?? 0),
      Number(baseline?.c3?.bikeLaneScore ?? 0),
    ]),
  );

  const airScore = weather?.aqi != null
    ? clampScore(100 - weather.aqi / 2)
    : Number(baseline?.c4?.airQualityScore ?? 0);
  const c4Factors: ScoreFactor[] = [
    {
      category: "C4",
      indicator: "airQualityScore",
      value: airScore,
      unit: "score",
      direction: "higher_is_better",
      source: weather?.aqi != null ? (weather.source || "Open-Meteo Air Quality") : source,
      method: weather?.aqi != null ? "api" : baselineMethod,
      confidence: weather?.aqi != null ? "medium" : baselineConfidence,
    },
    ...[
      ["noiseScore", baseline?.c4?.noiseScore],
      ["greenCoveragePct", baseline?.c4?.greenCoveragePct],
      ["parkDistance", baseline?.c4?.parkDistance],
    ].map(([indicator, value]) => ({
      category: "C4" as Category,
      indicator: String(indicator),
      value: Number(value ?? 0),
      unit: indicator === "parkDistance" ? "m" : "score",
      direction: indicator === "parkDistance" ? "lower_is_better" as const : "higher_is_better" as const,
      source,
      method: baselineMethod,
      confidence: baselineConfidence,
    })),
  ];
  const c4 = clampScore(
    average([
      airScore,
      Number(baseline?.c4?.noiseScore ?? 0),
      Math.min(100, Number(baseline?.c4?.greenCoveragePct ?? 0) * 2),
      inverseDistanceScore(Number(baseline?.c4?.parkDistance), 400),
    ]),
  );

  const c5Factors: ScoreFactor[] = [
    ["activityFrequency", baseline?.c5?.activityFrequency],
    ["neighborhoodTrust", baseline?.c5?.neighborhoodTrust],
    ["jobCommercialDensity", baseline?.c5?.jobCommercialDensity],
    ["governanceParticipation", baseline?.c5?.governanceParticipation],
  ].map(([indicator, value]) => ({
    category: "C5",
    indicator: String(indicator),
    value: Number(value ?? 0),
    unit: "score",
    direction: "higher_is_better",
    source,
    method: baselineMethod,
    confidence: baselineConfidence,
  }));
  const c5 = clampScore(average(c5Factors.map((factor) => factor.value)));

  const categories: Record<Category, CategoryScore> = {
    C1: { score: c1, factors: c1Factors },
    C2: { score: c2, factors: c2Factors },
    C3: { score: c3, factors: c3Factors },
    C4: { score: c4, factors: c4Factors },
    C5: { score: c5, factors: c5Factors },
  };

  const overall = clampScore(
    (c1 * DEFAULT_WEIGHTS.C1) +
    (c2 * DEFAULT_WEIGHTS.C2) +
    (c3 * DEFAULT_WEIGHTS.C3) +
    (c4 * DEFAULT_WEIGHTS.C4) +
    (c5 * DEFAULT_WEIGHTS.C5),
  );

  const allFactors = Object.values(categories).flatMap((category) => category.factors);
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
