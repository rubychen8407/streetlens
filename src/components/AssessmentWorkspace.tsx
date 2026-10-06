import { t, bilingual, dateLocale, displayPlace } from '../i18n';
import { usePanelFocus } from '../hooks/usePanelFocus';
import { useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronRight,
  MapPin,
  Save,
  Database,
  Star,
  Trash2,
  ArrowLeft,
  Loader2,
  Camera,
  Images,
  Sparkles,
  X,
  ShieldCheck,
  Store,
  Train,
  Trees,
  Users,
  Activity,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { AssessmentEvidence, AssessmentExplanation, EvidencePhotoDraft, FieldObservationAdjustment, LocationCoord, SavedLocation, StreetAssessmentResponse } from '../types';
import { FIELD_OBSERVATION_DEFINITIONS } from '../data/fieldIndicators';
import { favoriteKey, groupSavedStreets } from '../utils/savedLocations';
import { StreetReport } from './StreetReport';

type View = 'assessment' | 'report' | 'field' | 'saved' | 'settings';

function LivabilityRadarChart({ scores }: { scores?: { c1?: number | null; c2?: number | null; c3?: number | null; c4?: number | null; c5?: number | null } }) {
  const cx = 110;
  const cy = 100;
  const radius = 68;
  const axes = [
    { key: 'c1' as const, label: t('安全 C1'), angle: -Math.PI / 2 },
    { key: 'c2' as const, label: t('機能 C2'), angle: -Math.PI / 2 + (2 * Math.PI) / 5 },
    { key: 'c3' as const, label: t('交通 C3'), angle: -Math.PI / 2 + (4 * Math.PI) / 5 },
    { key: 'c4' as const, label: t('綠意 C4'), angle: -Math.PI / 2 + (6 * Math.PI) / 5 },
    { key: 'c5' as const, label: t('社區 C5'), angle: -Math.PI / 2 + (8 * Math.PI) / 5 },
  ];

  const points = axes.map(axis => {
    const val = Math.min(100, Math.max(10, scores?.[axis.key] ?? 50));
    const r = (val / 100) * radius;
    const x = cx + r * Math.cos(axis.angle);
    const y = cy + r * Math.sin(axis.angle);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return (
    <div className="flex justify-center py-2">
      <svg width="220" height="200" viewBox="0 0 220 200" className="overflow-visible select-none">
        {[0.25, 0.5, 0.75, 1].map((scale) => {
          const ringPoints = axes.map(axis => {
            const x = cx + radius * scale * Math.cos(axis.angle);
            const y = cy + radius * scale * Math.sin(axis.angle);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          }).join(' ');
          return (
            <polygon
              key={scale}
              points={ringPoints}
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="1"
            />
          );
        })}
        {axes.map(axis => (
          <line
            key={axis.key}
            x1={cx}
            y1={cy}
            x2={cx + radius * Math.cos(axis.angle)}
            y2={cy + radius * Math.sin(axis.angle)}
            stroke="rgba(255,255,255,0.12)"
            strokeWidth="1"
          />
        ))}
        <polygon
          points={points}
          fill="rgba(212, 249, 113, 0.22)"
          stroke="#d4f971"
          strokeWidth="2.5"
        />
        {axes.map(axis => {
          const val = Math.min(100, Math.max(10, scores?.[axis.key] ?? 50));
          const r = (val / 100) * radius;
          const x = cx + r * Math.cos(axis.angle);
          const y = cy + r * Math.sin(axis.angle);
          return (
            <circle
              key={axis.key}
              cx={x}
              cy={y}
              r="3.5"
              fill="#d4f971"
              stroke="#0e131a"
              strokeWidth="1.5"
            />
          );
        })}
        {axes.map(axis => {
          const x = cx + (radius + 20) * Math.cos(axis.angle);
          const y = cy + (radius + 14) * Math.sin(axis.angle);
          return (
            <text
              key={axis.key}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="text-sm font-bold fill-slate-200"
              style={{ fontSize: '14px' }}
            >
              {axis.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

interface AssessmentWorkspaceProps {
  view: View;
  onOpenField: () => void;
  onBack: () => void;
  backLabel: string | null;
  isOpen: boolean;
  onClose: () => void;
  streetName: string;
  district: string;
  city: string;
  targetLocation: LocationCoord;
  clsScore: number | null;
  grade: 'S' | 'A' | 'B' | 'C' | 'D' | null;
  assessment: StreetAssessmentResponse | null;
  observationRatings: Record<string, number>;
  onRatingChange: (id: string, rating: number) => void;
  fieldAdjustment: FieldObservationAdjustment | null;
  isPreviewingFieldAdjustment: boolean;
  fieldNotes: string;
  onUpdateNotes: (notes: string) => void;
  onSave: (name: string, notes: string) => Promise<boolean>;
  onSelectSaved: (saved: SavedLocation) => void;
  savedLocations: SavedLocation[];
  hasMoreSaved?: boolean;
  historyLoading?: boolean;
  historyError?: boolean;
  onLoadMoreSaved?: () => void;
  onDeleteSaved: (id: string) => void;
  onOpenDataLogs: () => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  favoriteLocationKeys: string[];
  isSaving: boolean;
  evidenceDrafts: EvidencePhotoDraft[];
  onAddEvidencePhotos: (files: FileList | null) => void;
  onRemoveEvidencePhoto: (id: string) => void;
  onUpdateEvidenceNote: (id: string, note: string) => void;
  selectedSavedEvidence: AssessmentEvidence[];
  savedEvidenceUrls: Record<string, string>;
  evidenceError: string | null;
  activeSavedAssessmentId: string | null;
  aiExplanation: AssessmentExplanation | null;
  isGeneratingAiExplanation: boolean;
  aiExplanationError: string | null;
  onGenerateAiExplanation: () => void;
  pendingAssessmentSources: string[];
  baselineSummary: string;
}

function formatFreshness(timestamp?: string) {
  if (!timestamp) return t('Not retrieved');
  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time)) return t('Unknown freshness');
  const ageHours = Math.max(0, (Date.now() - time) / 3600000);
  if (ageHours < 1) return t('Updated <1h ago');
  if (ageHours < 24) return bilingual(`${Math.floor(ageHours)} 小時前更新`, `Updated ${Math.floor(ageHours)}h ago`);
  const ageDays = Math.floor(ageHours / 24);
  return bilingual(`${ageDays} 天前更新`, `Updated ${ageDays}d ago`);
}

function gradeClass(grade: AssessmentWorkspaceProps['grade']) {
  if (grade == null) return 'text-slate-300 bg-white/5 border-white/[0.08]';
  if (grade === 'S' || grade === 'A') return 'text-emerald-300 bg-emerald-400/15 border-emerald-400/30';
  if (grade === 'B') return 'text-slate-300 bg-white/10 border-white/[0.08]';
  if (grade === 'C') return 'text-amber-300 bg-amber-400/15 border-amber-400/30';
  return 'text-rose-300 bg-rose-400/15 border-rose-400/30';
}

export function AssessmentWorkspace({
  onOpenField, view, onBack, backLabel, isOpen, onClose, streetName, district, city, targetLocation,
  clsScore, grade, assessment, observationRatings, onRatingChange, fieldAdjustment, isPreviewingFieldAdjustment, fieldNotes,
  onUpdateNotes, onSave, onSelectSaved, savedLocations, onDeleteSaved, onOpenDataLogs, isFavorite, onToggleFavorite, favoriteLocationKeys, isSaving,
  hasMoreSaved, historyLoading, historyError, onLoadMoreSaved,
  evidenceDrafts, onAddEvidencePhotos, onRemoveEvidencePhoto, onUpdateEvidenceNote, selectedSavedEvidence, savedEvidenceUrls, evidenceError,
  activeSavedAssessmentId, aiExplanation, isGeneratingAiExplanation, aiExplanationError, onGenerateAiExplanation,
  pendingAssessmentSources, baselineSummary,
}: AssessmentWorkspaceProps) {
  const panelRef = usePanelFocus(isOpen, onClose);
  const [name, setName] = useState('');
  const [savedNotice, setSavedNotice] = useState(false);
  const [step, setStep] = useState<2 | 3>(2);
  const [savedFilter, setSavedFilter] = useState<'all' | 'favorites'>('all');
  const [savedSort, setSavedSort] = useState<'recent' | 'score' | 'grade'>('recent');
  const [showScoreDetails, setShowScoreDetails] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const evidenceCameraInputRef = useRef<HTMLInputElement | null>(null);
  const evidenceLibraryInputRef = useRef<HTMLInputElement | null>(null);

  const factor = (indicator: string) => assessment?.factors.find(item => item.indicator === indicator);

  const floodFactor = factor('floodHazard_100mmh') || factor('floodHazard_78.8mmh') || factor('floodHazard_130mmh');
  const floodSourceStatus = assessment?.sourceStatus?.find(item => item.source === 'taipei_flood');
  const dataCards = [
    ['Safety', factor('trafficAccidentCount500m'), 'C1'],
    ['Flood risk', factor('floodHazard_100mmh') || factor('floodHazard_78.8mmh') || factor('floodHazard_130mmh'), 'C1'],
    ['Amenities', factor('poiDensityCount'), 'C2'],
    ['Transit', factor('mrtOrRailDist'), 'C3'],
    ['Air quality', factor('airQualityScore'), 'C4'],
    ['Green space', factor('nearestParkDist') || factor('parkCount800m'), 'C4'],
    ['Community', factor('communityCulturalPoiCount800m'), 'C5'],
  ] as const;

  const locationGroups = useMemo(() => groupSavedStreets(savedLocations), [savedLocations]);

  const savedList = useMemo(() => {
    const gradeRank: Record<string, number> = { S: 5, A: 4, B: 3, C: 2, D: 1 };
    const favoriteKeyFor = (saved: SavedLocation) =>
      saved.coords.lat.toFixed(5) + ':' + saved.coords.lng.toFixed(5) + ':' + saved.streetName.trim().toLowerCase();
    const filtered = locationGroups
      .filter(visits => savedFilter !== 'favorites' || visits.some(saved => favoriteLocationKeys.includes(favoriteKeyFor(saved))))
      .map(visits => visits.find(saved => saved.clsScore != null) || visits[0]);
    return [...filtered].sort((a, b) => {
      if (savedSort === 'score') return (b.clsScore ?? -1) - (a.clsScore ?? -1);
      if (savedSort === 'grade') return (gradeRank[b.grade ?? ''] ?? 0) - (gradeRank[a.grade ?? ''] ?? 0);
      return b.timestamp - a.timestamp;
    });
  }, [locationGroups, savedFilter, savedSort, favoriteLocationKeys]);

  const currentReport = savedLocations.find(item => item.id === activeSavedAssessmentId) ?? null;

  const handleSave = async () => {
    const ok = await onSave(name.trim() || `${district ? district + ' ' : ''}${streetName || 'Street assessment'}`, fieldNotes);
    if (!ok) return;
    setSavedNotice(true);
    setName('');
    window.setTimeout(() => setSavedNotice(false), 2200);
  };

  if (!isOpen) return null;

  const categoryScores = assessment?.scores
    ? [assessment.scores.c1, assessment.scores.c2, assessment.scores.c3, assessment.scores.c4, assessment.scores.c5]
    : [];
  const observedCategoryCount = categoryScores.filter((category) => category.mode === 'observed' && category.score !== null).length;
  const estimatedCategoryCount = categoryScores.filter((category) => category.mode === 'estimated' && category.score !== null).length;
  const unavailableCategoryCount = categoryScores.filter((category) => category.score === null).length;

  return (
    <aside ref={panelRef} tabIndex={-1} aria-label={view === 'report' ? t("街道結果報告") : view === 'saved' ? t("Street Library") : view === 'settings' ? t("資料狀態") : t("街道評估面板")} className="assessment-panel absolute z-[600] top-3 right-3 bottom-3 flex flex-col overflow-hidden rounded-[20px] border border-white/[0.08] bg-[#141A23]/95 backdrop-blur-md shadow-2xl text-white">
      <header className="shrink-0 px-5 pt-4 pb-3 border-b border-white/[0.08]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {backLabel && <button onClick={onBack} className="w-11 h-11 shrink-0 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10" title={backLabel} aria-label={backLabel}><ArrowLeft className="w-5 h-5" /></button>}
            <div><div className="text-sm font-bold">{view === 'field' ? t("環境觀察") : view === 'report' ? t("街道結果報告") : view === 'saved' ? t("Street Library") : view === 'settings' ? t("資料狀態") : t("CLS 街道報告")}</div><div className="text-sm text-slate-300">{view === 'field' ? t("1–4 級環境評分、筆記與佐證") : view === 'report' || view === 'settings' ? displayPlace(streetName) + ' · ' + district + ' ' + city : view === 'saved' ? t("收藏、街道與歷次評估") : t('CLS · 資料來源 · 歷史比較')}</div></div>
          </div>
          {(view === 'assessment' || view === 'report') && <button onClick={onToggleFavorite} title={isFavorite ? t("取消最愛") : t("加入最愛")} aria-label={isFavorite ? t("取消最愛") : t("加入最愛")} className={`w-9 h-9 rounded-full border flex items-center justify-center ${isFavorite ? 'bg-amber-400/15 border-amber-300/40 text-amber-300' : 'bg-white/5 border-white/[0.08] text-slate-300'}`}><Star className={`w-4 h-4 ${isFavorite ? 'fill-current' : ''}`} /></button>}
        </div>

        {(view === 'assessment' || view === 'report') && (
          <>
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <div className="text-lg font-bold truncate">{displayPlace(streetName) || t("Selected street")}</div>
                <div className="text-sm text-slate-300 mt-0.5">{district} · {city}</div>
              </div>
              <div className={`shrink-0 flex items-center gap-2 px-2.5 py-1.5 rounded-xl border ${gradeClass(grade)}`}>
                <span className="text-[32px] leading-none font-mono tabular-nums font-bold">{clsScore ?? '—'}</span>
                <span className="text-sm font-bold">{grade ?? 'N/A'}</span>
                {assessment?.scores.overallMode === 'estimated' && (
                  <span className="text-sm font-semibold text-amber-300">{t("推估")}</span>
                )}
              </div>
            </div>
          </>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {(view === 'assessment' || view === 'field') && (
          <div className="space-y-4 pb-4">
            {view === 'field' && <div className="grid grid-cols-2 gap-1.5">
              {[t("觀察"), t("儲存")].map((label, index) => <button key={t(label)} onClick={() => setStep((index + 2) as 2|3)} aria-current={step === index + 2 ? 'step' : undefined} className="rounded-xl py-2 text-sm border border-white/10">{t(label)}</button>)}
            </div>}
            {view === 'assessment' && (
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base uppercase tracking-wider text-slate-200 font-bold flex items-center gap-2">
                    <Activity className="w-4 h-4 text-[#d4f971]" />
                    {t("Objective data")}
                  </h3>
                  <button onClick={onOpenDataLogs} className="text-sm text-slate-300 hover:text-white flex items-center gap-1">
                    {t("Data status")} <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Dashboard Card 1: 5-Dimension Radar Chart & Category Scores Matrix */}
                {assessment?.scores && (
                  <div className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4 space-y-4 shadow-xl">
                    <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
                      <span className="text-sm font-bold text-white flex items-center gap-2">
                        <Activity className="w-4 h-4 text-[#d4f971]" />
                        {t("宜居面向雷達看板")}
                      </span>
                      <span className="text-sm text-slate-300">
                        {observedCategoryCount} {t("observed ·")} {estimatedCategoryCount} {t("estimated ·")} {unavailableCategoryCount} {t("unavailable")}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                      <LivabilityRadarChart
                        scores={{
                          c1: assessment.scores.c1?.score,
                          c2: assessment.scores.c2?.score,
                          c3: assessment.scores.c3?.score,
                          c4: assessment.scores.c4?.score,
                          c5: assessment.scores.c5?.score,
                        }}
                      />

                      {/* 5 Dimensions Progress Matrix */}
                      <div className="space-y-2.5">
                        {[
                          { key: 'c1', label: 'C1 安全', score: assessment.scores.c1, icon: ShieldCheck, color: '#f87171', barColor: 'bg-rose-400' },
                          { key: 'c2', label: 'C2 生活機能', score: assessment.scores.c2, icon: Store, color: '#fbbf24', barColor: 'bg-amber-400' },
                          { key: 'c3', label: 'C3 大眾交通', score: assessment.scores.c3, icon: Train, color: '#60a5fa', barColor: 'bg-sky-400' },
                          { key: 'c4', label: 'C4 綠意環境', score: assessment.scores.c4, icon: Trees, color: '#34d399', barColor: 'bg-emerald-400' },
                          { key: 'c5', label: 'C5 社區活力', score: assessment.scores.c5, icon: Users, color: '#c084fc', barColor: 'bg-purple-400' },
                        ].map((cat) => {
                          const val = cat.score?.score;
                          const pct = val != null ? Math.min(100, Math.max(0, val)) : 0;
                          return (
                            <div key={cat.key} className="rounded-xl bg-white/[0.025] border border-white/[0.05] p-2.5 space-y-1.5">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <cat.icon className="w-4 h-4 shrink-0" style={{ color: cat.color }} />
                                  <span className="text-sm font-semibold text-slate-200">{cat.label}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  {cat.score?.mode === 'estimated' && (
                                    <span className="text-sm px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-300 border border-amber-400/30">
                                      {t("推估")}
                                    </span>
                                  )}
                                  <span className="text-sm font-mono font-bold text-white">{val ?? '—'}</span>
                                </div>
                              </div>
                              <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all duration-500 ${cat.barColor}`} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {assessment.scores.estimatedCategoryCount > 0 ? (
                      <div className="text-sm leading-relaxed text-amber-200/80 pt-1">
                        {t("Estimated categories use persisted real reference observations, not fabricated street-level values.")}
                      </div>
                    ) : (
                      <div className="text-sm leading-relaxed text-slate-300 pt-1">
                        {t("All five categories currently use local source-backed observations.")}
                      </div>
                    )}
                  </div>
                )}

                {/* Dashboard Card 2: Interactive Accordion for Factor Provenance (Required by tests) */}
                <button
                  type="button"
                  onClick={() => setShowScoreDetails(v => !v)}
                  className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 text-left hover:bg-white/[0.06] transition-colors"
                  aria-expanded={showScoreDetails}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-200">{t("Why this score?")}</span>
                    <ChevronRight className={`w-4 h-4 text-slate-300 transition-transform ${showScoreDetails ? 'rotate-90' : ''}`} />
                  </div>
                  <div className="text-sm text-slate-300 mt-1">{t("See the source-backed category scores and factor provenance.")}</div>
                </button>

                {showScoreDetails && (
                  <div className="rounded-2xl border border-white/[0.08] bg-black/20 p-3.5 space-y-3">
                    {(['C1','C2','C3','C4','C5'] as const).map(category => {
                      const categoryKey = category.toLowerCase() as 'c1' | 'c2' | 'c3' | 'c4' | 'c5';
                      const score = assessment?.scores[categoryKey]?.score ?? null;
                      const factors = assessment?.scores[categoryKey]?.factors || [];
                      return (
                        <div key={category} className="rounded-xl bg-white/[0.03] border border-white/5 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-bold text-slate-200">{category}</span>
                            <div className="flex items-center gap-1.5">
                              {assessment?.scores[categoryKey]?.mode === 'estimated' && (
                                <span className="text-sm font-semibold text-amber-300">{t("推估")}</span>
                              )}
                              <span className="text-sm font-mono font-bold text-white">{score ?? '—'}</span>
                            </div>
                          </div>
                          <div className="mt-2 space-y-1.5">
                            {factors.slice(0, 4).map(item => (
                              <div key={t(item.indicator)} className="rounded-lg bg-black/20 px-3 py-2 text-sm">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate text-slate-200 font-medium">{t(item.indicator)}</span>
                                  <span className={item.status === 'available' ? 'text-white font-mono' : 'text-slate-300 font-mono'}>
                                    {item.value ?? 'N/A'}{item.unit ? ' ' + t(item.unit) : ''}
                                  </span>
                                </div>
                                <div className="mt-1 flex items-center justify-between gap-2 text-sm text-slate-300">
                                  <span className="truncate">{t(item.source || 'Source unavailable')}</span>
                                  <span className="shrink-0">
                                    {t(item.method)} · {t(item.confidence || 'low')} · {formatFreshness(item.retrievedAt)}
                                  </span>
                                </div>
                              </div>
                            ))}
                            {factors.length === 0 && <div className="text-sm text-slate-300">{t("No factor details available.")}</div>}
                          </div>
                        </div>
                      );
                    })}
                    <div className="text-sm leading-relaxed text-slate-300">
                      {t("CLS is calculated from the source-backed assessment model. Field observations are recorded separately and are not silently added to the external-data score.")}
                    </div>
                  </div>
                )}

                {!assessment && (pendingAssessmentSources.length > 0 || baselineSummary) && (
                  <div className="mb-3 rounded-2xl border border-amber-400/20 bg-amber-400/[0.05] p-3.5">
                    <div className="text-sm font-bold text-amber-100">{t("External data status")}</div>
                    <div className="mt-1 text-sm leading-relaxed text-slate-300">{t(baselineSummary)}</div>
                    {pendingAssessmentSources.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {pendingAssessmentSources.map(source => (
                          <span key={t(source)} className="rounded-lg border border-white/5 bg-white/[0.03] px-2.5 py-1 text-sm text-slate-300">{t(source)}</span>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 text-sm leading-relaxed text-slate-300">{t("Scoring data is read from persisted source snapshots only. No placeholder values are shown while background refresh is pending.")}</div>
                  </div>
                )}

                {/* Dashboard Card 3: Seven Primary Factor KPI Cards Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {dataCards.map(([label, item, category]) => (
                    <div key={t(label)} className="rounded-2xl bg-white/[0.045] border border-white/[0.06] p-3.5 space-y-1">
                      <div className="text-sm text-slate-300 font-medium">{t(label)} · {category}</div>
                      <div className="text-base font-bold text-white">
                        {item?.value != null
                          ? item.value + ' ' + t(item.unit)
                          : label === 'Flood risk' && floodSourceStatus?.status === 'empty'
                            ? t("No mapped inundation")
                            : 'N/A'}
                      </div>
                      <div className={`text-sm ${item?.status === 'available' ? 'text-emerald-400' : 'text-slate-300'}`}>
                        {item?.status === 'available'
                          ? t("Source data available")
                          : label === 'Flood risk' && floodSourceStatus?.status === 'empty'
                            ? t("Official model has no mapped area here")
                            : t("Data unavailable")}
                      </div>
                      {item && (
                        <div className="text-sm text-slate-300 truncate" title={`${t(item.source || 'Unknown source')} · ${item.retrievedAt || t("not retrieved")}`}>
                          {t(item.source || 'Unknown source')} · {formatFreshness(item.retrievedAt)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Dashboard Card 4: Official City Infrastructure Services */}
                {assessment?.officialServiceMetrics && (
                  <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.04] p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-bold text-emerald-100 flex items-center gap-2">
                        <Store className="w-4 h-4 text-emerald-300" />
                        {t("Official local services")}
                      </div>
                      <span className="text-sm text-emerald-300/80">{t("官方公開實體設施")}</span>
                    </div>
                    <div className="text-sm leading-relaxed text-slate-300">
                      {t("Persisted official inventories near this location. These values are source evidence; only metrics defined by the scoring model affect CLS.")}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
                      {[
                        ['YouBike', assessment.officialServiceMetrics.youBikeNearestDistance == null ? '—' : Math.round(assessment.officialServiceMetrics.youBikeNearestDistance) + ' m'],
                        [t("YouBike bikes"), assessment.officialServiceMetrics.youBikeAvailableBikes == null ? '—' : String(assessment.officialServiceMetrics.youBikeAvailableBikes)],
                        [t("Bike lane · 500m"), Math.round(assessment.officialServiceMetrics.bikeLaneLength500m) + ' m'],
                        [t("Sidewalk coverage · 500m"), assessment.officialServiceMetrics.sidewalkCoverage500mPct == null ? '—' : assessment.officialServiceMetrics.sidewalkCoverage500mPct.toFixed(1) + '%'],
                        [t("Medical"), assessment.officialServiceMetrics.medicalFacilityNearestDistance == null ? '—' : Math.round(assessment.officialServiceMetrics.medicalFacilityNearestDistance) + ' m'],
                        [t("Bus stop"), assessment.officialServiceMetrics.busStopNearestDistance == null ? '—' : Math.round(assessment.officialServiceMetrics.busStopNearestDistance) + ' m'],
                        [t("MRT station"), assessment.officialServiceMetrics.mrtStationNearestDistance == null ? '—' : Math.round(assessment.officialServiceMetrics.mrtStationNearestDistance) + ' m'],
                        [t("Libraries · 800m"), String(assessment.officialServiceMetrics.libraryCount800m)],
                        [t("Public toilets · 800m"), String(assessment.officialServiceMetrics.publicToiletCount800m)],
                        [t("Street lights · 300m"), assessment.officialServiceMetrics.streetLightCount300m == null ? '—' : String(assessment.officialServiceMetrics.streetLightCount300m)],
                        [t("Parks · 800m"), String(assessment.officialServiceMetrics.officialParkCount800m)],
                      ].map(([label, value]) => (
                        <div key={t(label)} className="rounded-xl bg-white/[0.035] border border-white/5 p-2.5">
                          <div className="text-sm text-slate-300">{t(label)}</div>
                          <div className="mt-1 text-sm font-semibold font-mono text-white">{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Dashboard Card 5: Historical Flood Resilience */}
                {assessment?.historicalFloodEvents && (
                  <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4 space-y-2">
                    <div className="text-sm font-bold text-slate-200 flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-sky-400" />
                      {t("Historical flood records")}
                    </div>
                    <div className="text-sm leading-relaxed text-slate-300">
                      {t("Official historical inundation records near this location. These records are shown as evidence and do not directly change CLS.")}
                    </div>
                    {assessment.historicalFloodEvents.length > 0 ? (
                      <div className="space-y-2 pt-1">
                        {assessment.historicalFloodEvents.slice(0, 5).map((event, index) => (
                          <div key={event.eventDate + '|' + event.address + '|' + index} className="rounded-xl bg-white/[0.03] p-2.5">
                            <div className="flex items-center justify-between gap-2 text-sm">
                              <span className="font-semibold text-slate-200">{event.eventDate || t("Date unavailable")}</span>
                              <span className="shrink-0 text-amber-300 font-mono">
                                {event.depthCm != null ? event.depthCm + ' cm' : t("Depth unavailable")}
                              </span>
                            </div>
                            <div className="mt-1 text-sm text-slate-300">
                              {(event.address || event.townName || t("Location unavailable")) + ' · ' + Math.round(event.distanceMeters) + ' m'}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 p-2.5 rounded-xl">
                        {t("No historical inundation polygon was recorded within 500 m.")}
                      </div>
                    )}
                    <div className="text-sm text-slate-300">
                      {t("Source: Taipei City Water Resources Department · historical inundation records")}
                    </div>
                  </div>
                )}
              </section>
            )}
            {view === 'field' && step === 2 && <section>
              <div className="mb-3">
                <h3 className="text-sm uppercase tracking-wider text-slate-300 font-bold">{t("Your observation")}</h3>
                <p className="text-sm text-slate-300 mt-1">{t("Rate only conditions you actually observed. Unrated items do not affect CLS. Notes are recommended when an observation meaningfully changes the assessment.")}</p>
              </div>
              <div className="rounded-2xl border border-white/[0.08] bg-white/10 p-3 mb-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm uppercase tracking-wider text-slate-300/80 font-bold">{t("CLS adjustment preview")}</div>
                  {isPreviewingFieldAdjustment && <Loader2 className="w-3.5 h-3.5 text-slate-300 animate-spin" />}
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <div>
                    <div className="text-sm text-slate-300">{t("External baseline")}</div>
                    <div className="text-sm font-black text-white">{fieldAdjustment?.baselineCls ?? assessment?.scores.overall ?? '—'}</div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-300">{t("Field adjustment")}</div>
                    <div className="text-sm font-black text-slate-300">{isPreviewingFieldAdjustment ? '…' : fieldAdjustment ? (fieldAdjustment.adjustment >= 0 ? '+' : '') + fieldAdjustment.adjustment : '—'}</div>
                  </div>
                  <div>
                    <div className="text-sm text-slate-300">{t("Adjusted CLS")}</div>
                    <div className="text-sm font-black text-white">{fieldAdjustment?.adjustedCls ?? assessment?.scores.overall ?? '—'}</div>
                  </div>
                </div>
                <div className="text-sm leading-relaxed text-slate-300 mt-2">
                   {t("The baseline uses source-backed observations when available. When a category has no local observation, StreetLens may use a clearly marked estimate derived from persisted real reference data; it does not fabricate street-level facts. Field observations are a separate bounded adjustment.")} </div>
                {fieldAdjustment && fieldAdjustment.ratedItemCount > 0 && (
                  <div className="mt-3 pt-3 border-t border-white/[0.08] space-y-2">
                    {FIELD_OBSERVATION_DEFINITIONS.filter(item => observationRatings[item.id] != null).map(item => {
                      const rating = observationRatings[item.id];
                      const itemImpact = fieldAdjustment.itemAdjustments[item.id] ?? 0;
                      const categoryImpact = fieldAdjustment.categoryAdjustments[item.category] ?? 0;
                      return (
                        <div key={item.id} className="flex items-start justify-between gap-2 text-sm">
                          <div className="min-w-0">
                            <div className="text-slate-300 font-semibold">{item.category} · {t(item.title)}</div>
                            <div className="text-slate-300">{t(item.ratingLabels[rating - 1])}  {t("· item impact")} {itemImpact >= 0 ? '+' : ''}{itemImpact}</div>
                          </div>
                          <span className="shrink-0 text-slate-300 font-mono font-bold">{categoryImpact >= 0 ? '+' : ''}{Math.round(categoryImpact * 10) / 10}</span>
                        </div>
                      );
                    })}
                    <div className="text-sm leading-relaxed text-slate-300">{t("Each category is capped at ±10. Category adjustments are then equally weighted across C1–C5, so a +8 C3 category adjustment contributes +1.6 to overall CLS.")}</div>
                  </div>
                )}
              </div>
              <div className="space-y-3">
                {['C1','C2','C3','C4','C5'].map(category => (
                  <div key={category} className="rounded-2xl bg-white/[0.035] border border-white/5 p-3">
                    <div className="text-sm font-bold text-slate-300 mb-2">{category}</div>
                    {FIELD_OBSERVATION_DEFINITIONS.filter(item => item.category === category).map(item => {
                      const value = observationRatings[item.id];
                      return (
                        <div key={item.id} className="py-2.5 border-t first:border-t-0 border-white/5">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold">{t(item.title)}</div>
                            <div className="text-sm text-slate-300 mt-0.5">{t(item.description)}</div>
                            <div className="flex gap-1 mt-2">
                              {item.ratingScale.map((rating, index) => (
                                <button
                                  type="button"
                                  key={rating}
                                  onClick={() => onRatingChange(item.id, rating)}
                                  className={`flex-1 py-1.5 rounded-lg text-sm font-semibold border ${value === rating ? 'bg-white/10 border-white/[0.08] text-slate-300' : 'bg-white/5 border-white/5 text-slate-300 hover:text-slate-300'}`}
                                >
                                  {t(item.ratingLabels[index])}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </section>}            {view === 'field' && step === 3 && <>
              <section>
                <label className="text-sm uppercase tracking-wider text-slate-300 font-bold">{t("Review & save")}</label>
              <div className="mt-3 rounded-2xl bg-white/[0.04] border border-white/5 p-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
                    <Check className="w-4 h-4 text-emerald-400" />
                     {t("Observation ready to save")} </div>
                  <div className="text-sm text-slate-300 mt-1">
                     {t("Your observations are stored separately and applied as a bounded adjustment when saved.")} </div>
                </div>
                <textarea value={fieldNotes} onChange={e => onUpdateNotes(e.target.value)} rows={3} placeholder={t("What did you observe? e.g. sidewalk blocked, good shade, heavy traffic...")} className="mt-2 w-full rounded-2xl bg-white/5 border border-white/[0.08] p-3 text-sm outline-none focus:border-white/[0.08] resize-none placeholder:text-slate-300" />
              </section>

              <section className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-slate-200">{t("Evidence")}</div>
                    <div className="text-sm text-slate-300 mt-1">{t("Photos are stored as evidence only. They never change CLS.")}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => evidenceCameraInputRef.current?.click()}
                      disabled={evidenceDrafts.length >= 6}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/10 border border-white/[0.08] text-sm font-bold text-slate-300 disabled:opacity-40"
                      title={t("Take a photo with your device camera")}
                    >
                      <Camera className="w-3.5 h-3.5" />
                       {t("Take photo")} </button>
                    <button
                      type="button"
                      onClick={() => evidenceLibraryInputRef.current?.click()}
                      disabled={evidenceDrafts.length >= 6}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/[0.08] text-sm font-bold text-slate-300 disabled:opacity-40"
                    >
                      <Images className="w-3.5 h-3.5" />
                       {t("Library")} </button>
                  </div>
                  <input
                    ref={evidenceCameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={event => {
                      onAddEvidencePhotos(event.target.files);
                      event.currentTarget.value = '';
                    }}
                  />
                  <input
                    ref={evidenceLibraryInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={event => {
                      onAddEvidencePhotos(event.target.files);
                      event.currentTarget.value = '';
                    }}
                  />
                </div>

                {evidenceDrafts.length > 0 && (
                  <div className="mt-3 space-y-2.5">
                    {evidenceDrafts.map(photo => (
                      <div key={photo.id} className="rounded-xl border border-white/5 bg-black/10 p-2">
                        <div className="flex gap-2.5">
                          <div className="relative w-20 h-20 shrink-0 overflow-hidden rounded-lg bg-black/20">
                            <img src={photo.previewUrl} alt={photo.fileName} className="w-full h-full object-cover" />
                            <button
                              type="button"
                              onClick={() => onRemoveEvidencePhoto(photo.id)}
                              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 flex items-center justify-center text-white"
                              aria-label={t("Remove photo")}
                              title={t("Remove photo")}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm text-slate-300 truncate">{photo.fileName}</div>
                            <div className="text-sm text-slate-300 mt-0.5">{t("Captured")} {new Date(photo.capturedAt).toLocaleString(dateLocale())}  {t("· selected street location")}</div>
                            <input
                              type="text"
                              value={photo.note}
                              onChange={event => onUpdateEvidenceNote(photo.id, event.target.value)}
                              placeholder={t("Add a note for this photo")}
                              className="mt-2 w-full rounded-lg bg-white/5 border border-white/[0.08] px-2.5 py-2 text-sm text-white placeholder:text-slate-300 outline-none focus:border-white/[0.08]"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {selectedSavedEvidence.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-white/[0.08]">
                    <div className="text-sm uppercase tracking-wider text-slate-300 font-bold">{t("Saved with this session")}</div>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {selectedSavedEvidence.filter(item => item.type === 'photo').map(item => {
                        const savedEvidenceUrl = savedEvidenceUrls[item.id]
                          || (item.storageKey ? savedEvidenceUrls[item.storageKey] : undefined);
                        return (
                          <div key={item.id} className="relative aspect-square overflow-hidden rounded-lg bg-black/20 border border-white/5">
                            {savedEvidenceUrl ? (
                              <img src={savedEvidenceUrl} alt={t("Saved assessment evidence")} className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-sm text-slate-300">{t("Photo unavailable")}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {selectedSavedEvidence.filter(item => item.type === 'note' && item.note).map(item => (
                      <div key={item.id} className="mt-2 rounded-lg bg-white/[0.03] px-2.5 py-2 text-sm text-slate-300">
                        {item.note}
                      </div>
                    ))}
                  </div>
                )}

                {evidenceError && <div className="mt-2 text-sm text-rose-300">{t(evidenceError)}</div>}
                {evidenceDrafts.length >= 6 && <div className="mt-2 text-sm text-slate-300">{t("Maximum 6 photos per assessment.")}</div>}
              </section>

              <section className="rounded-2xl border border-violet-400/20 bg-violet-400/[0.05] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-bold text-violet-100">
                      <Sparkles className="w-4 h-4 text-violet-300" />
                       {t("Gemini explanation")} </div>
                    <div className="text-sm text-slate-300 mt-1">
                       {t("Generated from the saved session only. It does not recalculate CLS or add missing data.")} </div>
                  </div>
                  <button
                    type="button"
                    onClick={onGenerateAiExplanation}
                    disabled={!activeSavedAssessmentId || isGeneratingAiExplanation}
                    className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-violet-500/15 border border-violet-400/20 text-sm font-bold text-violet-200 disabled:opacity-40"
                  >
                    {isGeneratingAiExplanation ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {isGeneratingAiExplanation ? t("Explaining…") : t("Explain with Gemini")}
                  </button>
                </div>

                {!activeSavedAssessmentId && (
                  <div className="mt-2 text-sm text-slate-300">
                     {t("Save this assessment to PostgreSQL before generating a grounded explanation.")} </div>
                )}

                {aiExplanationError && (
                  <div className="mt-2 rounded-lg bg-rose-400/10 border border-rose-400/15 px-2.5 py-2 text-sm text-rose-300">
                    {t(aiExplanationError)}
                  </div>
                )}

                {aiExplanation && (
                  <div className="mt-3 space-y-2.5">
                    <div className="rounded-xl bg-white/[0.03] border border-white/5 p-2.5">
                      <div className="text-sm uppercase tracking-wider text-violet-300/80 font-bold">{t("Summary")}</div>
                      <div className="text-sm leading-relaxed text-slate-300 mt-1">{aiExplanation.summary}</div>
                    </div>
                    {([
                      [t("Strengths"), aiExplanation.strengths],
                      [t("Limitations"), aiExplanation.limitations],
                      [t("Field observations"), aiExplanation.fieldObservations],
                      [t("Follow-up checks"), aiExplanation.followUpChecks],
                    ] as const).map(([label, items]) => items.length > 0 && (
                      <div key={t(label)}>
                        <div className="text-sm uppercase tracking-wider text-slate-300 font-bold mb-1">{t(label)}</div>
                        <div className="space-y-1">
                          {items.map((item, index) => (
                            <div key={label + index} className="rounded-lg bg-black/10 px-2.5 py-2 text-sm text-slate-300">
                              {item}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-white/[0.08] bg-white/10 p-3">
                <div className="flex items-center gap-2 text-sm font-bold">
                  <MapPin className="w-4 h-4 text-slate-300" />
                  <span className="truncate">{displayPlace(streetName) || t("Selected street")}</span>
                </div>
                <div className="text-sm text-slate-300 mt-1">
                  {district} · {city}  {t("· Saved with the assessment timestamp")} </div>
              </section>
            </>}
          </div>
        )}

        {view === 'report' && <StreetReport saved={currentReport} streetName={streetName} district={district} city={city} score={clsScore} grade={grade} assessment={assessment} fieldNotes={fieldNotes} ratings={observationRatings} adjustment={fieldAdjustment} evidence={selectedSavedEvidence} evidenceUrls={savedEvidenceUrls} aiExplanation={aiExplanation} aiExplanationError={aiExplanationError} isGeneratingAiExplanation={isGeneratingAiExplanation} canExplain={Boolean(activeSavedAssessmentId)} onExplain={onGenerateAiExplanation} isFavorite={isFavorite} onToggleFavorite={onToggleFavorite} />}

        {view === 'report' && currentReport?.historySummary && <div className="rounded-xl border border-white/10 p-3 text-sm text-slate-300">
          {bilingual('完整歷史報告尚未載入；已儲存的評分與紀錄不會被改寫。', 'Full history report has not loaded; saved scores and records remain unchanged.')}
          <button type="button" onClick={() => onSelectSaved(currentReport)} className="block mt-2 underline">
            {bilingual('重試載入完整報告', 'Retry full report')}
          </button>
        </div>}

        {view === 'saved' && (
          <div className="space-y-3">
            <div className="mb-4">
              <h2 className="text-xl font-bold">{t("Street library")}</h2>
              <p className="text-sm text-slate-300 mt-1">{t("最愛可追蹤街道；地點紀錄保留實勘感受、照片與環境觀察。")}</p>
            </div>
            <div className="flex gap-1.5 mb-3">
              {([['all',t("All")],['favorites',t("Favorites")]] as const).map(([value, label]) => (
                <button key={value} onClick={() => setSavedFilter(value)} className={`px-3 py-1.5 rounded-lg text-sm font-bold border ${savedFilter === value ? 'bg-amber-400/15 border-amber-300/30 text-amber-200' : 'bg-white/[0.03] border-white/5 text-slate-300'}`}>{t(label)}</button>
              ))}
              <select value={savedSort} onChange={e => setSavedSort(e.target.value as typeof savedSort)} className="ml-auto px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/[0.08] text-sm text-slate-300 outline-none">
                <option value="recent">{t("Recent")}</option>
                <option value="score">{t("CLS high → low")}</option>
                <option value="grade">{t("Grade high → low")}</option>
              </select>
            </div>
            {compareIds.length > 0 && (
              <section className="rounded-2xl border border-white/[0.08] bg-white/10 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-sm font-bold text-slate-300">{t("Compare assessments")}</div>
                    <div className="text-sm text-slate-300">{t("Side-by-side records; no ranking is applied.")}</div>
                  </div>
                  <button type="button" onClick={() => setCompareIds([])} className="text-sm text-slate-300 hover:text-white">{t("Clear")}</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {[
                        [t("Street"), (saved: SavedLocation) => saved.streetName],
                        [t("External baseline"), (saved: SavedLocation) => saved.baselineClsScore ?? '—'],
                        [t("Field adjustment"), (saved: SavedLocation) => saved.fieldAdjustment == null ? '—' : (saved.fieldAdjustment >= 0 ? '+' : '') + saved.fieldAdjustment],
                        [t("Adjusted CLS"), (saved: SavedLocation) => saved.clsScore ?? '—'],
                        [t("C1 Safety"), (saved: SavedLocation) => saved.scores.c1 ?? '—'],
                        [t("C2 Amenities"), (saved: SavedLocation) => saved.scores.c2 ?? '—'],
                        [t("C3 Transit"), (saved: SavedLocation) => saved.scores.c3 ?? '—'],
                        [t('C4 Green'), (saved: SavedLocation) => saved.scores.c4 ?? '—'],
                        [t("C5 Community"), (saved: SavedLocation) => saved.scores.c5 ?? '—'],
                      ].map(([label, getter]) => (
                        <tr key={String(label)} className="border-t border-white/5">
                          <td className="py-1.5 pr-2 text-slate-300 whitespace-nowrap">{String(label)}</td>
                          {compareIds.map(id => {
                            const saved = savedLocations.find(item => item.id === id);
                            return <td key={id} className="py-1.5 px-2 text-slate-200 font-semibold">{saved ? String((getter as (item: SavedLocation) => string | number)(saved)) : '—'}</td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            {savedList.length === 0 && <div className="py-16 text-center text-sm text-slate-300">{savedFilter === 'favorites' ? t("No favorite streets yet.") : t("No saved assessments yet.")}</div>}
            {savedList.map(saved => (
              <div key={saved.id} className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4">
                <div className="flex items-start justify-between gap-3">
                  <button onClick={() => onSelectSaved(saved)} className="text-left min-w-0 flex-1">
                    <div className="font-bold truncate">{saved.name}</div>
                    <div className="text-sm text-slate-300 mt-1">{saved.district} · {saved.city}</div>
                    {saved.walkMoment && <div className={`text-sm mt-2 ${saved.walkMoment.feeling === 'good' ? 'text-emerald-300' : saved.walkMoment.feeling === 'bad' ? 'text-rose-300' : 'text-slate-300'}`}>{saved.walkMoment.feeling === 'good' ? t("喜歡這裡") : saved.walkMoment.feeling === 'bad' ? t("不喜歡") : t("拍照留存")}{favoriteLocationKeys.includes(favoriteKey(saved.coords, saved.streetName)) ? t(t(' · 最愛')) : ''}</div>}
                    <div className="mt-3 flex items-center gap-2">
                      <span className={`px-2 py-1 rounded-lg border text-sm font-bold ${gradeClass(saved.grade)}`}>{saved.clsScore == null ? t("CLS 待補") : `CLS ${saved.clsScore}`} {saved.grade ?? ''}{saved.assessmentSnapshot?.scores.overallMode === 'estimated' ? t(" · 推估") : ''}</span>
                      <span className="text-sm text-slate-300">{new Date(saved.timestamp).toLocaleString(dateLocale())}</span>
                    </div>
                    {saved.clsScore == null && <div className="mt-2 text-sm text-slate-300">{t("開啟網站時每 30 秒重試；有來源資料後自動補上")}</div>}
                    {saved.syncStatus === 'local' && <div className="mt-1 text-sm text-slate-300">{t("已存於此裝置，等待同步")}</div>}
                  </button>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setCompareIds(prev => prev.includes(saved.id) ? prev.filter(id => id !== saved.id) : prev.length < 2 ? [...prev, saved.id] : prev)}
                      className={`px-2 py-1.5 rounded-lg text-sm border ${compareIds.includes(saved.id) ? 'bg-white/10 border-white/[0.08] text-slate-300' : 'bg-white/[0.03] border-white/5 text-slate-300'}`}
                      title={compareIds.length >= 2 && !compareIds.includes(saved.id) ? t("Compare up to two assessments") : t("Compare")}
                    >
                      {compareIds.includes(saved.id) ? t("Selected") : t("Compare")}
                    </button>
                    <button onClick={() => onDeleteSaved(saved.id)} className="w-8 h-8 rounded-lg text-slate-300 hover:text-rose-300 hover:bg-rose-400/10 flex items-center justify-center" title={t("Delete assessment")}><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
                {(locationGroups.find(visits => visits.some(visit => visit.id === saved.id))?.length || 0) > 1 && <details className="mt-3 border-t border-white/10 pt-3">
                  <summary className="text-sm text-slate-300 cursor-pointer">{t("查看此地全部紀錄（照片、筆記與感受保留）")}</summary>
                  {locationGroups.find(visits => visits.some(visit => visit.id === saved.id))?.map(visit => <button key={visit.id} type="button" onClick={() => onSelectSaved(visit)} className="block w-full text-left text-sm text-slate-300 py-3">
                    {new Date(visit.timestamp).toLocaleString(dateLocale())} · CLS {visit.clsScore ?? t("待補")} · {visit.walkMoment?.feeling === 'good' ? t("喜歡") : visit.walkMoment?.feeling === 'bad' ? t("不喜歡") : t("環境觀察")}  {t("· 照片")} {(visit.evidence || []).filter(item => item.type === 'photo').length}
                  </button>)}
                </details>}
              </div>
            ))}
          </div>
        )}

        {view === 'saved' && (hasMoreSaved || historyError || historyLoading) && <button type="button"
          disabled={historyLoading} onClick={onLoadMoreSaved} className="w-full rounded-xl border border-white/10 p-3 text-sm text-slate-300 disabled:opacity-50">
          {historyLoading ? bilingual('正在載入紀錄…', 'Loading history…') : historyError
            ? bilingual('重試載入歷史紀錄', 'Retry loading history') : bilingual('載入更多歷史紀錄', 'Load more history')}
        </button>}

        {view === 'settings' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-bold">{t("目前地點資料")}</h2>
              <p className="text-sm text-slate-300 mt-1">{t("查看此地點的資料來源、可用性與更新時間。")}</p>
            </div>
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-4">
              <div className="flex items-center gap-3">
                <Database className="w-5 h-5 text-slate-300" />
                <div>
                  <div className="text-sm font-semibold">{t("資料來源與可用性")}</div>
                  <div className="text-sm text-slate-300 mt-1">{t("目前地點已載入的評估資料。")}</div>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {(assessment?.sourceStatus || []).map(source => (
                  <div key={t(source.source)} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-slate-300 truncate">{t(source.source)}</span>
                    <span className={source.status === 'available' ? 'text-emerald-400' : 'text-slate-300'}>
                      {t(source.status)} · {formatFreshness(source.retrievedAt || undefined)}
                    </span>
                  </div>
                ))}
                {(!assessment?.sourceStatus || assessment.sourceStatus.length === 0) && (
                  <div className="text-sm text-slate-300">{t("此地點尚無可顯示的資料來源狀態。")}</div>
                )}
              </div>
            </div>
            <div className="p-4 rounded-2xl border border-white/[0.08] bg-white/[0.04]">
              <div className="text-sm font-bold text-slate-300">{t("評估依據")}</div>
              <div className="text-sm text-slate-300 mt-1">{t("CLS 以已儲存的外部資料計算；環境觀察另記為觀察調整。")}</div>
            </div>
          </div>
        )}
      </div>

      {view === 'assessment' && <footer className="assessment-footer shrink-0 p-4 border-t border-white/10"><button type="button" className="hud-primary w-full rounded-xl min-h-11 text-sm font-semibold" onClick={onOpenField}>{t("開始環境觀察")}</button></footer>}
      {view === 'field' && (
        <footer className="assessment-footer shrink-0 p-4 border-t border-white/[0.08] bg-[#141A23]">
          {step < 3 ? (
            <button onClick={() => setStep((step + 1) as 2|3)} className="w-full py-3 rounded-xl hud-primary text-white text-sm font-bold flex items-center justify-center gap-2">{t("Continue")} <ChevronRight className="w-4 h-4" /></button>
          ) : (
            <div className="flex gap-2">
              <input value={name} onChange={e => setName(e.target.value)} placeholder={t("Assessment name")} className="flex-1 min-w-0 px-3 py-3 rounded-xl bg-white/5 border border-white/[0.08] text-sm outline-none" />
              <button onClick={handleSave} disabled={isSaving} className="px-5 py-3 rounded-xl hud-primary disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-bold flex items-center gap-2">
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {isSaving ? t("Saving…") : t("Save")}
              </button>
            </div>
          )}
          {savedNotice && <div className="text-sm text-emerald-400 text-center mt-2">{t("Assessment saved.")}</div>}
        </footer>
      )}
    </aside>
  );
}
