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
/**
 * Legacy browser scoring is intentionally disabled.
 * StreetLens scores are calculated only by the source-backed backend pipeline.
 */
export function calculateC1Score(_data: C1Data, _fieldChecks: FieldCheckItem[]): null { return null; }
export function calculateC2Score(_data: C2Data, _fieldChecks: FieldCheckItem[]): null { return null; }
export function calculateC3Score(_data: C3Data, _fieldChecks: FieldCheckItem[]): null { return null; }
export function calculateC4Score(_data: C4Data, _fieldChecks: FieldCheckItem[]): null { return null; }
export function calculateC5Score(_data: C5Data, _fieldChecks: FieldCheckItem[]): null { return null; }
export function calculateOverallCLS(_c1: number | null, _c2: number | null, _c3: number | null, _c4: number | null, _c5: number | null, _weights: CLSWeights): null { return null; }
export function getCLSGrade(score: number | null): 'S' | 'A' | 'B' | 'C' | 'D' | null {
  if (score == null) return null;
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

