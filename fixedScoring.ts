import { CLS_STANDARDS, CLS_STANDARD_VERSION, type IndicatorStandard, type ClsCategory } from './src/data/clsStandards';
import type { AssessmentScores, CategoryScore, ScoreFactor } from './scoring';

export const CATEGORY_WEIGHTS = { C1: .2, C2: .2, C3: .2, C4: .2, C5: .2 };
const categories = Object.keys(CATEGORY_WEIGHTS) as ClsCategory[];
const round = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
export function validObservation(value: unknown, standard?: IndicatorStandard): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    && (standard?.maxValue == null || value <= standard.maxValue);
}
export function fixedIndicatorScore(value: unknown, standard: IndicatorStandard): number | null {
  if (!validObservation(value, standard)) return null;
  const curve = standard.curve;
  if (curve.kind === 'saturation') return 100 * (1 - Math.pow(2, -value / curve.half));
  const points = curve.knots;
  if (value <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i];
    const [previousX, previousY] = points[i - 1];
    if (value <= x) return previousY + (y - previousY) * (value - previousX) / (x - previousX);
  }
  return points[points.length - 1][1];
}

export interface FixedInput {
  value?: unknown;
  reference?: number[];
  source?: string;
  retrievedAt?: string;
  method?: ScoreFactor['method'];
  confidence?: ScoreFactor['confidence'];
}

// An estimate is separate from the raw observation. No invented values are
// written into factor.value, and estimated data never increase completeness.
export function calculateFixedScores(inputs: Record<string, FixedInput>, evidence: ScoreFactor[] = []): AssessmentScores {
  const factors: ScoreFactor[] = Object.entries(CLS_STANDARDS).map(([indicator, standard]) => {
    const input = inputs[indicator] || {};
    const value = validObservation(input.value, standard) ? input.value : null;
    const reference = (input.reference || []).filter(v => validObservation(v, standard)).sort((a, b) => a - b);
    const estimated = value == null && reference.length >= 5;
    const middle = Math.floor(reference.length / 2);
    const estimate = estimated ? (reference.length % 2 ? reference[middle] : (reference[middle - 1] + reference[middle]) / 2) : null;
    const score = fixedIndicatorScore(value ?? estimate, standard);
    // Midrank treats ties symmetrically; a cohort of equal observations ranks 50.
    const midrank = value != null && reference.length >= 20
      ? 100 * (reference.filter(v => v < value).length + reference.filter(v => v === value).length / 2) / reference.length : null;
    return {
      category: standard.category, indicator, value, unit: standard.unit,
      direction: standard.direction, source: value != null ? input.source || 'unavailable' : 'unavailable',
      method: value != null ? input.method || 'calculated' : 'calculated',
      confidence: value != null ? input.confidence || 'medium' : 'low',
      status: value != null ? 'available' : 'unavailable', retrievedAt: value != null ? input.retrievedAt : undefined,
      referenceSampleSize: reference.length, scoringMethod: score != null ? 'fixed_standard' : 'not_scored',
      availabilityReason: value == null ? 'no_observation' : undefined,
      normalizedScore: score == null ? null : Math.round(score * 100) / 100,
      indicatorWeight: standard.weight, estimatedValue: estimate,
      estimationMethod: estimated ? 'regional_real_data_prior' : undefined,
      referencePercentile: midrank == null ? undefined : round(standard.direction === 'higher_is_better' ? midrank : 100 - midrank),
    };
  });

  const results = {} as Record<ClsCategory, CategoryScore>;
  for (const category of categories) {
    const components = factors.filter(f => f.category === category);
    const observedWeight = components.reduce((sum, f) => sum + (f.value != null ? f.indicatorWeight! : 0), 0);
    const scored = components.filter(f => f.normalizedScore != null);
    const availableWeight = scored.reduce((sum, f) => sum + f.indicatorWeight!, 0);
    let score = availableWeight ? scored.reduce((sum, f) => sum + f.normalizedScore! * f.indicatorWeight!, 0) / availableWeight : null;
    if (category === 'C1') {
      const risks = scored.filter(f => ['trafficAccidentCount500m', 'maxFloodDepthCm'].includes(f.indicator));
      // Infrastructure cannot create a safety score alone or erase a severe risk.
      score = risks.length && score != null ? Math.min(score, Math.min(...risks.map(f => f.normalizedScore!)) + 10) : null;
    }
    const estimated = scored.filter(f => f.estimationMethod);
    results[category] = {
      score: score == null ? null : round(score), factors: [...components, ...evidence.filter(f => f.category === category)],
      mode: score != null && estimated.length ? 'estimated' : 'observed',
      estimationMethod: score != null && estimated.length ? 'regional_real_data_prior' : undefined,
      estimationReferenceSampleSize: score != null && estimated.length ? Math.min(...estimated.map(f => f.referenceSampleSize!)) : undefined,
      completeness: round(observedWeight * 100),
      provisional: availableWeight < 1 - 1e-9 || score == null,
    };
  }
  const available = categories.filter(c => results[c].score != null);
  const estimatedCategoryCount = categories.filter(c => results[c].mode === 'estimated').length;
  const completeness = round(categories.reduce((sum, c) => sum + CATEGORY_WEIGHTS[c] * results[c].completeness!, 0));
  const provisional = categories.some(c => results[c].provisional);
  const observed = factors.filter(f => f.value != null);
  const quality = observed.length ? observed.reduce((sum, f) => sum + ({ high: 3, medium: 2, low: 1 }[f.confidence]), 0) / observed.length : 0;
  const overall = available.length ? round(available.reduce((sum, c) => sum + CATEGORY_WEIGHTS[c] * results[c].score!, 0)
    / available.reduce((sum, c) => sum + CATEGORY_WEIGHTS[c], 0)) : null;
  return {
    c1: results.C1, c2: results.C2, c3: results.C3, c4: results.C4, c5: results.C5,
    overall, weights: { ...CATEGORY_WEIGHTS }, overallMode: estimatedCategoryCount ? 'estimated' : 'observed', estimatedCategoryCount,
    confidence: completeness >= 90 && quality >= 2.6 && !estimatedCategoryCount && !provisional ? 'high' : completeness >= 60 && quality >= 1.8 ? 'medium' : 'low',
    completeness, provisional, scoringStandard: CLS_STANDARD_VERSION,
  };
}
