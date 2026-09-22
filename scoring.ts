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
  status?: "available" | "unavailable";
  retrievedAt?: string;
  referenceSampleSize?: number;
  scoringMethod?: "empirical_percentile" | "raw_observation" | "not_scored";
  availabilityReason?: "insufficient_reference_data" | "source_unavailable" | "no_observation";
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
  const accidentScore = empiricalPercentileScore(c1AccidentCount, c1SafetyMetrics?.accidentCountReference, "lower_is_better");
  const floodScore = empiricalPercentileScore(maxFloodDepth, c1SafetyMetrics?.floodDepthReference, "lower_is_better");
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

  const c1ComponentScores = [accidentScore, floodScore]
    .filter((value): value is number => value !== null);
  const c1: number | null = c1ComponentScores.length
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
    factor.scoringMethod = factor.value != null && factor.referenceSampleSize >= 20
      ? "empirical_percentile"
      : "not_scored";
    if (factor.value != null && factor.referenceSampleSize < 20) {
      factor.availabilityReason = "insufficient_reference_data";
    }
  }

  const poiDensityScore = empiricalPercentileScore(poiDensity, c2PoiDensityReference);
  const c2ComponentScores = c2Definitions
    .map(([indicator, value]) => Number.isFinite(Number(value))
      ? empiricalPercentileScore(Number(value), normalization?.c2Distances?.[indicator], "lower_is_better")
      : null)
    .filter((value): value is number => value !== null);
  c2Factors.forEach((factor) => {
    if (factor.value == null) factor.availabilityReason = "no_observation";
  });
  if (poiDensityScore !== null) {
    c2ComponentScores.push(poiDensityScore);
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
      status: Number.isFinite(Number(c3TransitMetrics?.mrtOrRailDist)) ? "available" : "unavailable",
      retrievedAt: c3TransitMetrics?.retrievedAt,
      referenceSampleSize: normalization?.c3RailDistances?.filter(Number.isFinite).length ?? 0,
      scoringMethod: Number.isFinite(Number(c3TransitMetrics?.mrtOrRailDist)) && (normalization?.c3RailDistances?.filter(Number.isFinite).length ?? 0) >= 20 ? "empirical_percentile" : "not_scored",
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
      scoringMethod: Number.isFinite(Number(c3TransitMetrics?.busStopDist)) && (normalization?.c3BusDistances?.filter(Number.isFinite).length ?? 0) >= 20 ? "empirical_percentile" : "not_scored",
      availabilityReason: Number.isFinite(Number(c3TransitMetrics?.busStopDist)) ? undefined : "no_observation",
    },
  ];
  const c3ComponentScores = c3Factors
    .map((factor) => factor.value == null ? null : empiricalPercentileScore(
      factor.value,
      factor.indicator === "busStopDist" ? normalization?.c3BusDistances : normalization?.c3RailDistances,
      "lower_is_better",
    ))
    .filter((value): value is number => value !== null);
  const c3: number | null = c3ComponentScores.length
    ? clampScore(average(c3ComponentScores))
    : null;

  // C4 combines only source-backed air quality and official green inventory metrics.
  const airScore = weather?.aqi != null ? empiricalPercentileScore(weather.aqi, normalization?.c4Aqi, "lower_is_better") : null;
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
  const streetTreeDensityScore = empiricalPercentileScore(streetTreeDensityPerKm2, c4GreenMetrics?.streetTreeDensityReference);
  const parkTreeDensityScore = empiricalPercentileScore(parkTreeDensityPerKm2, c4GreenMetrics?.parkTreeDensityReference);
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
  const nearestParkScore = empiricalPercentileScore(nearestParkDist, normalization?.c4NearestParkDistances, "lower_is_better");
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
  const c4: number | null = c4Components.length ? clampScore(average(c4Components)) : null;

  // C5 measures source-backed community/cultural access only. It does not
  // claim to measure subjective social trust or civic participation.
  const communityScore = empiricalPercentileScore(c5CommunityCount, c5CommunityReference);
  const communityReferenceSize = c5CommunityReference?.filter(Number.isFinite).length ?? 0;
  const c5NearestDistanceReferenceSize = normalization?.c5NearestCommunityDistances?.filter(Number.isFinite).length ?? 0;
  const c5NearestDistanceScore = empiricalPercentileScore(
    c5NearestCommunityDistance,
    normalization?.c5NearestCommunityDistances,
    "lower_is_better",
  );
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
  const c5: number | null = c5Components.length ? clampScore(average(c5Components)) : null;

  const categories: Record<Category, CategoryScore> = {
    C1: { score: c1, factors: c1Factors },
    C2: { score: c2, factors: c2Factors },
    C3: { score: c3, factors: c3Factors },
    C4: { score: c4, factors: c4Factors },
    C5: { score: c5, factors: c5Factors },
  };

  const allFactors = Object.values(categories).flatMap((category) => category.factors);
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
