# Fixed-standard CLS v1

This version replaces percentile-based primary scores. Product curves and weights
live in `src/data/clsStandards.ts` and are shown in the report's collapsed formula
section. They are initial, reviewable product settings, not validated scientific,
medical, or official livability thresholds. A higher result is not guaranteed.

## Calculation

- Distance and risk: linear interpolation between the configured (raw value,
  score) points, constant outside the endpoints. Distances remain straight-line
  distances. No route or walking-time API was introduced.
- Quantities: `100 * (1 - 2 ** (-x / half))`, equivalent to an exponential
  saturation curve with `k = half / ln(2)`. The configured half-saturation is the
  raw value yielding 50 points. Counts do not grow scores without bound.
- Within each category, multiply indicator scores by their fixed weights.
  Observed indicators always use the same curve regardless of reference samples.
- A missing indicator may use the median of at least 5 valid persisted reference
  values, scored by the same fixed curve. The raw factor value remains null;
  `estimatedValue`, `estimationMethod`, and sample size expose the estimate.
- Unresolved indicators are excluded from the denominator and the result is
  explicitly provisional. There is no default 50, fabricated zero, or silent
  imputation. A partial average is not claimed to be a complete category.
- C1 needs accident or modeled flood evidence (observed or explicitly estimated).
  Its weighted result is capped at the lower available risk score plus 10. Thus
  lights/hydrants cannot erase a poor risk result or generate safety by themselves.
- Each category contributes 20%. If a whole category cannot be scored, use the
  available category weights and mark overall provisional. Round categories and
  overall to integers, bounded to 0–100. Existing bounded field adjustment remains
  separate and unchanged (up to ±10 overall).

## Completeness and rank

Completeness is the percentage of fixed indicator weight supported by actual
observations, averaged across the five categories. Estimates count as zero
observed coverage. Missing categories retain their share in this calculation.
Completeness does not multiply or deduct from CLS. A sparse score may be high,
but has a visible provisional label and low completeness.

At least 20 valid reference values enable an optional **indicator** percentile,
using midrank ties (`count(< x) + count(= x)/2`). Reverse for lower-is-better.
It does not affect primary scores, and is not a district-wide overall ranking.
Current reference cohorts contain persisted sampled locations, not every street.

## Data limitations

Sidewalk coverage is area within the 500m disk, not the percentage of walkable
streets. Bicycle lane length does not establish continuity or access. Community
counts do not establish facility diversity or social trust. Accident counts are
not exposure-adjusted and retain the source's observation period. The maximum
available modeled flood depth combines rainfall scenarios; it is not a flood
probability. These proxies are disclosed rather than inventing new measurements.

No new external requests or data collection are needed. Existing persisted
reference reads are reused. Payloads add bounded per-indicator metadata, not raw
reference arrays. The baseline version changes to
`street-anchor-v3-fixed-standard-v1`; old algorithm baselines cannot overlay new
history views. Normal reads can recompute from persisted sources, and scheduled
`backfill:scores` updates saved scores while retaining each visit's field points,
notes, photos, timestamps, and coordinates. Missing official sources still need
the existing Data refresh workflow.

## Verification

`test:fixed-scoring` checks monotonicity for every curve, interpolation, invalid
values versus real zero, completeness, median minimum sample size, transparent
estimates, cohort invariance, tie ranks, safety caps, and null flood depth.
Existing score integrity and history/baseline preservation gates remain intact.
Browser coverage checks formula disclosure and mobile widths in both languages.
