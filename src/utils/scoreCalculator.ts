import {
  C1Data,
  C2Data,
  C3Data,
  C4Data,
  C5Data,
  CLSWeights,
  FieldCheckItem,
  CommunityLivabilityAssessment,
  LocationCoord,
  StreetSegmentScore,
} from '../types';

/**
 * C1: 安全與風險指數 (Safety & Risk Index, SRI)
 * SRI = 100 * (1 - (w1*Crime + w2*Accident + w3*Hazard) / maxScore)
 */
export function calculateC1Score(
  data: C1Data,
  fieldChecks: FieldCheckItem[]
): number {
  const sumWeights = data.wCrime + data.wAccident + data.wHazard || 1.0;
  const weightedRisk =
    (data.wCrime * data.crimeRate +
      data.wAccident * data.accidentRate +
      data.wHazard * data.hazardLevel) /
    sumWeights;

  const rawSRI = 100 * (1 - weightedRisk / 100);

  // 加上實地勾選加扣分
  const c1Checks = fieldChecks.filter((c) => c.category === 'C1' && c.checked);
  const bonus = c1Checks.reduce((acc, curr) => acc + (curr.scoreImpact ?? 0), 0);

  return Math.min(100, Math.max(0, Math.round(rawSRI + bonus)));
}

/**
 * C2: 便利與機能指數 (Amenity Accessibility Index, AAI)
 * AAI_i = sum( S_j / (d_ij ^ beta) )
 * 標準化至 0~100
 */
export function calculateC2Score(
  data: C2Data,
  fieldChecks: FieldCheckItem[]
): number {
  const beta = data.decayBeta || 1.5;

  // 設施規模權重 S_j
  const amenities = [
    { scale: 12, dist: Math.max(50, data.supermarketDist) }, // 超市
    { scale: 10, dist: Math.max(30, data.convenienceDist) }, // 便利超商
    { scale: 9, dist: Math.max(50, data.clinicDist) },       // 診所/藥局
    { scale: 8, dist: Math.max(100, data.schoolDist) },      // 學校
    { scale: 6, dist: Math.max(50, data.bankPostDist) },     // 郵局金融
  ];

  // 計算 AAI_i = sum( S_j / (d_ij ^ beta) )
  let sumDecay = 0;
  for (const item of amenities) {
    // 距離衰減計算 (換算為以 100m 為基準的衰減比例)
    const normalizedDist = item.dist / 100;
    sumDecay += item.scale / Math.pow(normalizedDist, beta);
  }

  // 基準對照：市中心理想情況 sumDecay 約 35~45，偏鄉約 2~5
  // 線性映射至 0~100
  const minAAI = 2.0;
  const maxAAI = 36.0;
  const normalizedRaw = Math.min(
    100,
    Math.max(0, ((sumDecay - minAAI) / (maxAAI - minAAI)) * 100)
  );

  const c2Checks = fieldChecks.filter((c) => c.category === 'C2' && c.checked);
  const bonus = c2Checks.reduce((acc, curr) => acc + (curr.scoreImpact ?? 0), 0);

  return Math.min(100, Math.max(0, Math.round(normalizedRaw + bonus)));
}

/**
 * C3: 移動與連結指數 (Mobility & Connectivity Index, MCI)
 * MCI = w1*Transit + w2*Walk + w3*Bike
 * Transit = (1/K) * sum( (班次_k / max班次) * (1 / (1 + d_k/500)) ) * 100
 */
export function calculateC3Score(
  data: C3Data,
  fieldChecks: FieldCheckItem[]
): number {
  const sumWeights = data.wTransit + data.wWalk + data.wBike || 1.0;

  // 大眾運輸計算 (公車班次頻率與軌道距離綜合)
  const railDecay = 1 / (1 + Math.max(0, data.mrtOrRailDist) / 500);
  const busDecay = 1 / (1 + Math.max(0, data.busStopDist) / 300);
  const compositeTransit = Math.min(
    100,
    data.busFrequencyScore * 0.5 * busDecay + 100 * 0.5 * railDecay
  );

  const rawMCI =
    (data.wTransit * compositeTransit +
      data.wWalk * data.walkabilityScore +
      data.wBike * data.bikeLaneScore) /
    sumWeights;

  const c3Checks = fieldChecks.filter((c) => c.category === 'C3' && c.checked);
  const bonus = c3Checks.reduce((acc, curr) => acc + (curr.scoreImpact ?? 0), 0);

  return Math.min(100, Math.max(0, Math.round(rawMCI + bonus)));
}

/**
 * C4: 環境與綠意指數 (Environment & Greenness Index, EGI)
 * EGI = w1*Air + w2*Noise + w3*Green + w4*ParkAccess
 */
export function calculateC4Score(
  data: C4Data,
  fieldChecks: FieldCheckItem[]
): number {
  const sumWeights = data.wAir + data.wNoise + data.wGreen + data.wPark || 1.0;

  // 公園可及性距離衰減
  const parkDecayAccess = Math.min(
    100,
    Math.round(100 * (1 / (1 + Math.max(0, data.parkDistance) / 400)))
  );

  const rawEGI =
    (data.wAir * data.airQualityScore +
      data.wNoise * data.noiseScore +
      data.wGreen * data.greenCoveragePct +
      data.wPark * parkDecayAccess) /
    sumWeights;

  const c4Checks = fieldChecks.filter((c) => c.category === 'C4' && c.checked);
  const bonus = c4Checks.reduce((acc, curr) => acc + (curr.scoreImpact ?? 0), 0);

  return Math.min(100, Math.max(0, Math.round(rawEGI + bonus)));
}

/**
 * C5: 社會與活力指數 (Social & Vitality Index, SVI)
 * SVI = w1*Activity + w2*Trust + w3*Jobs + w4*Governance
 */
export function calculateC5Score(
  data: C5Data,
  fieldChecks: FieldCheckItem[]
): number {
  const sumWeights =
    data.wActivity + data.wTrust + data.wJobs + data.wGovernance || 1.0;

  const rawSVI =
    (data.wActivity * data.activityFrequency +
      data.wTrust * data.neighborhoodTrust +
      data.wJobs * data.jobCommercialDensity +
      data.wGovernance * data.governanceParticipation) /
    sumWeights;

  const c5Checks = fieldChecks.filter((c) => c.category === 'C5' && c.checked);
  const bonus = c5Checks.reduce((acc, curr) => acc + (curr.scoreImpact ?? 0), 0);

  return Math.min(100, Math.max(0, Math.round(rawSVI + bonus)));
}

/**
 * 計算總合社區宜居指數 (Community Livability Score, CLS)
 * CLS = sum( W_k * C_k )
 */
export function calculateOverallCLS(
  c1: number,
  c2: number,
  c3: number,
  c4: number,
  c5: number,
  weights: CLSWeights
): number {
  const totalWeight =
    weights.wC1 + weights.wC2 + weights.wC3 + weights.wC4 + weights.wC5 || 1.0;

  const cls =
    (weights.wC1 * c1 +
      weights.wC2 * c2 +
      weights.wC3 * c3 +
      weights.wC4 * c4 +
      weights.wC5 * c5) /
    totalWeight;

  return Math.min(100, Math.max(0, Math.round(cls)));
}

export function getCLSGrade(score: number): 'S' | 'A' | 'B' | 'C' | 'D' {
  if (score >= 90) return 'S';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  return 'D';
}

/**
 * Legacy baseline generator intentionally disabled.
 *
 * StreetLens must never manufacture regional or coordinate-based values.
 * Real source-backed assessments are produced by the backend cache/scoring
 * pipeline; missing observations remain null/unavailable.
 */
export function generateDefaultBaselineData(
  _coords: LocationCoord,
  _district: string = '',
  _city: string = ''
): null {
  return null;
}

/**
 * 產生鄰近周邊主要街道的段落評分。
 * 真實路網幾何直接由後端 /api/street-network (Google Routes API + OSRM) 動態生成，
 * 確保道路標線 100% 貼齊在地真實路幅與街巷，絕不產生貫穿建物的粗劣直線。
 */
export function generateSurroundingStreetSegments(
  _center: LocationCoord,
  _baseScore: number,
  _streetName: string = ''
): StreetSegmentScore[] {
  return [];
}

