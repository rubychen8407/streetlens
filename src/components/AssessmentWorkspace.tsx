import { useMemo, useState } from 'react';
import { Check, ChevronRight, MapPin, Save, Database, Star, Trash2, ArrowLeft, Loader2 } from 'lucide-react';
import { FieldObservationAdjustment, LocationCoord, SavedLocation, StreetAssessmentResponse } from '../types';
import { FIELD_OBSERVATION_DEFINITIONS } from '../data/fieldIndicators';

type View = 'assessment' | 'saved' | 'settings';

interface AssessmentWorkspaceProps {
  view: View;
  onViewChange: (view: View) => void;
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
  onDeleteSaved: (id: string) => void;
  onOpenDataLogs: () => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  favoriteLocationKeys: string[];
  isSaving: boolean;
}

function formatFreshness(timestamp?: string) {
  if (!timestamp) return 'Not retrieved';
  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time)) return 'Unknown freshness';
  const ageHours = Math.max(0, (Date.now() - time) / 3600000);
  if (ageHours < 1) return 'Updated <1h ago';
  if (ageHours < 24) return `Updated ${Math.floor(ageHours)}h ago`;
  const ageDays = Math.floor(ageHours / 24);
  return ageDays === 1 ? 'Updated 1d ago' : `Updated ${ageDays}d ago`;
}

function gradeClass(grade: AssessmentWorkspaceProps['grade']) {
  if (grade === 'S' || grade === 'A') return 'text-emerald-300 bg-emerald-400/15 border-emerald-400/30';
  if (grade === 'B') return 'text-sky-300 bg-sky-400/15 border-sky-400/30';
  if (grade === 'C') return 'text-amber-300 bg-amber-400/15 border-amber-400/30';
  return 'text-rose-300 bg-rose-400/15 border-rose-400/30';
}

export function AssessmentWorkspace({
  view, onViewChange, isOpen, onClose, streetName, district, city, targetLocation,
  clsScore, grade, assessment, observationRatings, onRatingChange, fieldAdjustment, isPreviewingFieldAdjustment, fieldNotes,
  onUpdateNotes, onSave, onSelectSaved, savedLocations, onDeleteSaved, onOpenDataLogs, isFavorite, onToggleFavorite, favoriteLocationKeys, isSaving,
}: AssessmentWorkspaceProps) {
  const [name, setName] = useState('');
  const [savedNotice, setSavedNotice] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [savedFilter, setSavedFilter] = useState<'all' | 'favorites'>('all');
  const [savedSort, setSavedSort] = useState<'recent' | 'score' | 'grade'>('recent');
  const [showScoreDetails, setShowScoreDetails] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);

  const factor = (indicator: string) => assessment?.factors.find(item => item.indicator === indicator);

  const dataCards = [
    ['Safety', factor('trafficAccidentCount500m'), 'C1'],
    ['Flood risk', factor('floodHazard_100mmh') || factor('floodHazard_78.8mmh') || factor('floodHazard_130mmh'), 'C1'],
    ['Amenities', factor('poiDensityCount'), 'C2'],
    ['Transit', factor('mrtOrRailDist'), 'C3'],
    ['Air quality', factor('airQualityScore'), 'C4'],
    ['Green space', factor('nearestParkDist') || factor('parkCount800m'), 'C4'],
    ['Community', factor('communityCulturalPoiCount800m'), 'C5'],
  ] as const;

  const historyGroups = useMemo(() => {
    const groups = new Map<string, SavedLocation[]>();
    for (const saved of savedLocations) {
      const key = saved.coords.lat.toFixed(5) + ':' + saved.coords.lng.toFixed(5) + ':' + saved.streetName.trim().toLowerCase();
      groups.set(key, [...(groups.get(key) || []), saved]);
    }
    return [...groups.values()]
      .filter(group => group.length > 1)
      .map(group => [...group].sort((a, b) => b.timestamp - a.timestamp));
  }, [savedLocations]);

  const savedList = useMemo(() => {
    const gradeRank: Record<string, number> = { S: 5, A: 4, B: 3, C: 2, D: 1 };
    const favoriteKeyFor = (saved: SavedLocation) =>
      saved.coords.lat.toFixed(5) + ':' + saved.coords.lng.toFixed(5) + ':' + saved.streetName.trim().toLowerCase();
    const filtered = savedFilter === 'favorites'
      ? savedLocations.filter(saved => favoriteLocationKeys.includes(favoriteKeyFor(saved)))
      : savedLocations;
    return [...filtered].sort((a, b) => {
      if (savedSort === 'score') return (b.clsScore ?? -1) - (a.clsScore ?? -1);
      if (savedSort === 'grade') return (gradeRank[b.grade ?? ''] ?? 0) - (gradeRank[a.grade ?? ''] ?? 0);
      return b.timestamp - a.timestamp;
    });
  }, [savedLocations, savedFilter, savedSort, favoriteLocationKeys]);

  const handleSave = async () => {
    const ok = await onSave(name.trim() || `${district ? district + ' ' : ''}${streetName || 'Street assessment'}`, fieldNotes);
    if (!ok) return;
    setSavedNotice(true);
    setName('');
    window.setTimeout(() => setSavedNotice(false), 2200);
  };

  if (!isOpen) return null;

  return (
    <aside className="absolute z-[600] top-3 right-3 bottom-3 w-[min(440px,calc(100vw-24px))] flex flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#111113]/95 backdrop-blur-2xl shadow-2xl text-white">
      <header className="shrink-0 px-5 pt-4 pb-3 border-b border-white/10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <button onClick={() => view === 'assessment' ? onClose() : onViewChange('assessment')} className="w-9 h-9 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10" title={view === 'assessment' ? 'Close assessment' : 'Back to assessment'}><ArrowLeft className="w-4 h-4" /></button>
            <div><div className="text-sm font-bold">Street assessment</div><div className="text-[10px] text-slate-500">Review → Observe → Save</div></div>
          </div>
          <button onClick={onToggleFavorite} className={`w-9 h-9 rounded-full border flex items-center justify-center ${isFavorite ? 'bg-amber-400/15 border-amber-300/40 text-amber-300' : 'bg-white/5 border-white/10 text-slate-400'}`}><Star className={`w-4 h-4 ${isFavorite ? 'fill-current' : ''}`} /></button>
        </div>

        {view === 'assessment' && (
          <>
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <div className="text-lg font-bold truncate">{streetName || 'Selected street'}</div>
                <div className="text-xs text-slate-400 mt-0.5">{district} · {city}</div>
              </div>
              <div className={`shrink-0 flex items-center gap-2 px-2.5 py-1.5 rounded-xl border ${gradeClass(grade)}`}>
                <span className="text-2xl leading-none font-black">{clsScore ?? '—'}</span>
                <span className="text-xs font-bold">{grade ?? 'N/A'}</span>
              </div>
            </div>
          </>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {view === 'assessment' && (
          <div className="space-y-4 pb-4">
            <div className="grid grid-cols-3 gap-1.5">
              {['Review','Observe','Save'].map((label, index) => <button key={label} onClick={() => setStep((index + 1) as 1|2|3)} className={`rounded-xl py-2 text-[10px] font-bold border ${step === index + 1 ? 'bg-sky-500/15 border-sky-400/30 text-sky-200' : 'bg-white/[0.03] border-white/5 text-slate-500'}`}><span className="mr-1">{index + 1}</span>{label}</button>)}
            </div>
            {step === 1 && <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs uppercase tracking-wider text-slate-400 font-bold">Objective data</h3>
                <button onClick={onOpenDataLogs} className="text-[11px] text-sky-300 hover:text-sky-200 flex items-center gap-1">Data status <ChevronRight className="w-3 h-3" /></button>
              </div>
              <button
                type="button"
                onClick={() => setShowScoreDetails(v => !v)}
                className="mt-3 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left hover:bg-white/[0.06]"
                aria-expanded={showScoreDetails}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-200">Why this score?</span>
                  <ChevronRight className={`w-4 h-4 text-slate-500 transition-transform ${showScoreDetails ? 'rotate-90' : ''}`} />
                </div>
                <div className="text-[10px] text-slate-500 mt-1">See the source-backed category scores and factor provenance.</div>
              </button>
              {showScoreDetails && (
                <div className="mt-2 rounded-2xl border border-white/10 bg-black/10 p-3 space-y-2">
                  {(['C1','C2','C3','C4','C5'] as const).map(category => {
                    const categoryKey = category.toLowerCase() as 'c1' | 'c2' | 'c3' | 'c4' | 'c5';
                    const score = assessment?.scores[categoryKey]?.score ?? null;
                    const factors = assessment?.scores[categoryKey]?.factors || [];
                    return (
                      <div key={category} className="rounded-xl bg-white/[0.03] border border-white/5 p-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-bold text-slate-300">{category}</span>
                          <span className="text-xs font-mono font-bold text-white">{score ?? '—'}</span>
                        </div>
                        <div className="mt-1.5 space-y-1">
                          {factors.slice(0, 4).map(item => (
                            <div key={item.indicator} className="flex items-center justify-between gap-2 text-[10px]">
                              <span className="truncate text-slate-500">{item.indicator}</span>
                              <span className={item.status === 'available' ? 'text-slate-400' : 'text-slate-600'}>
                                {item.value ?? 'N/A'} · {item.method}
                              </span>
                            </div>
                          ))}
                          {factors.length === 0 && <div className="text-[10px] text-slate-600">No factor details available.</div>}
                        </div>
                      </div>
                    );
                  })}
                  <div className="text-[10px] leading-relaxed text-slate-600">
                    CLS is calculated from the source-backed assessment model. Field observations are recorded separately and are not silently added to the external-data score.
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                {dataCards.map(([label, item, category]) => (
                  <div key={label} className="rounded-2xl bg-white/[0.045] border border-white/5 p-3">
                    <div className="text-[11px] text-slate-400">{label} · {category}</div>
                    <div className="mt-1 text-sm font-bold">{item?.value != null ? `${item.value} ${item.unit}` : 'N/A'}</div>
                    <div className={`mt-1 text-[10px] ${item?.status === 'available' ? 'text-emerald-400' : 'text-slate-500'}`}>
                      {item?.status === 'available' ? 'Source data available' : 'Data unavailable'}
                    </div>
                    {item && (
                      <div className="mt-1 text-[10px] text-slate-600 truncate" title={`${item.source || 'Unknown source'} · ${item.retrievedAt || 'not retrieved'}`}>
                        {item.source || 'Unknown source'} · {formatFreshness(item.retrievedAt)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>}
            {step === 2 && <section>
              <div className="mb-3">
                <h3 className="text-xs uppercase tracking-wider text-slate-400 font-bold">Your observation</h3>
                <p className="text-[11px] text-slate-500 mt-1">Rate only conditions you actually observed. Unrated items do not affect CLS. Notes are recommended when an observation meaningfully changes the assessment.</p>
              </div>
              <div className="rounded-2xl border border-sky-400/20 bg-sky-400/[0.06] p-3 mb-3">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-wider text-sky-200/80 font-bold">CLS adjustment preview</div>
                  {isPreviewingFieldAdjustment && <Loader2 className="w-3.5 h-3.5 text-sky-300 animate-spin" />}
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <div>
                    <div className="text-[9px] text-slate-500">External baseline</div>
                    <div className="text-sm font-black text-white">{fieldAdjustment?.baselineCls ?? assessment?.scores.overall ?? '—'}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-500">Field adjustment</div>
                    <div className="text-sm font-black text-sky-200">{isPreviewingFieldAdjustment ? '…' : fieldAdjustment ? (fieldAdjustment.adjustment >= 0 ? '+' : '') + fieldAdjustment.adjustment : '—'}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-500">Adjusted CLS</div>
                    <div className="text-sm font-black text-white">{fieldAdjustment?.adjustedCls ?? assessment?.scores.overall ?? '—'}</div>
                  </div>
                </div>
                <div className="text-[10px] leading-relaxed text-slate-500 mt-2">
                  The baseline is calculated from source-backed external data. Field observations are a separate bounded adjustment; they do not rewrite the external-data score.
                </div>
                {fieldAdjustment && fieldAdjustment.ratedItemCount > 0 && (
                  <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
                    {FIELD_OBSERVATION_DEFINITIONS.filter(item => observationRatings[item.id] != null).map(item => {
                      const rating = observationRatings[item.id];
                      const itemImpact = fieldAdjustment.itemAdjustments[item.id] ?? 0;
                      const categoryImpact = fieldAdjustment.categoryAdjustments[item.category] ?? 0;
                      return (
                        <div key={item.id} className="flex items-start justify-between gap-2 text-[10px]">
                          <div className="min-w-0">
                            <div className="text-slate-300 font-semibold">{item.category} · {item.title}</div>
                            <div className="text-slate-500">{item.ratingLabels[rating - 1]} · item impact {itemImpact >= 0 ? '+' : ''}{itemImpact}</div>
                          </div>
                          <span className="shrink-0 text-sky-200 font-mono font-bold">{categoryImpact >= 0 ? '+' : ''}{Math.round(categoryImpact * 10) / 10}</span>
                        </div>
                      );
                    })}
                    <div className="text-[9px] leading-relaxed text-slate-600">Each category is capped at ±10. Category adjustments are then equally weighted across C1–C5, so a +8 C3 category adjustment contributes +1.6 to overall CLS.</div>
                  </div>
                )}
              </div>
              <div className="space-y-3">
                {['C1','C2','C3','C4','C5'].map(category => (
                  <div key={category} className="rounded-2xl bg-white/[0.035] border border-white/5 p-3">
                    <div className="text-[11px] font-bold text-slate-300 mb-2">{category}</div>
                    {FIELD_OBSERVATION_DEFINITIONS.filter(item => item.category === category).map(item => {
                      const value = observationRatings[item.id];
                      return (
                        <div key={item.id} className="py-2.5 border-t first:border-t-0 border-white/5">
                          <div className="min-w-0">
                            <div className="text-xs font-semibold">{item.title}</div>
                            <div className="text-[10px] text-slate-500 mt-0.5">{item.description}</div>
                            <div className="flex gap-1 mt-2">
                              {item.ratingScale.map((rating, index) => (
                                <button
                                  type="button"
                                  key={rating}
                                  onClick={() => onRatingChange(item.id, rating)}
                                  className={`flex-1 py-1.5 rounded-lg text-[10px] font-semibold border ${value === rating ? 'bg-sky-500/20 border-sky-400/40 text-sky-200' : 'bg-white/5 border-white/5 text-slate-500 hover:text-slate-300'}`}
                                >
                                  {item.ratingLabels[index]}
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
            </section>}            {step === 3 && <>
              <section>
                <label className="text-xs uppercase tracking-wider text-slate-400 font-bold">Review & save</label>
              <div className="mt-3 rounded-2xl bg-white/[0.04] border border-white/5 p-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                    <Check className="w-4 h-4 text-emerald-400" />
                    Observation ready to save
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    Your observations are stored separately and applied as a bounded adjustment when saved.
                  </div>
                </div>
                <textarea value={fieldNotes} onChange={e => onUpdateNotes(e.target.value)} rows={3} placeholder="What did you observe? e.g. sidewalk blocked, good shade, heavy traffic..." className="mt-2 w-full rounded-2xl bg-white/5 border border-white/10 p-3 text-xs outline-none focus:border-sky-400/50 resize-none placeholder:text-slate-600" />
              </section>

              <section className="rounded-2xl border border-sky-400/20 bg-sky-400/[0.06] p-3">
                <div className="flex items-center gap-2 text-xs font-bold">
                  <MapPin className="w-4 h-4 text-sky-300" />
                  <span className="truncate">{streetName || 'Selected street'}</span>
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  {district} · {city} · Saved with the assessment timestamp
                </div>
              </section>
            </>}
          </div>
        )}

        {view === 'saved' && (
          <div className="space-y-3">
            <div className="mb-4">
              <h2 className="text-xl font-bold">Street library</h2>
              <p className="text-xs text-slate-500 mt-1">Favorites help you track streets; saved assessments preserve individual field sessions.</p>
            </div>
            <div className="flex gap-1.5 mb-3">
              {([['all','All'],['favorites','Favorites']] as const).map(([value, label]) => (
                <button key={value} onClick={() => setSavedFilter(value)} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border ${savedFilter === value ? 'bg-amber-400/15 border-amber-300/30 text-amber-200' : 'bg-white/[0.03] border-white/5 text-slate-500'}`}>{label}</button>
              ))}
              <select value={savedSort} onChange={e => setSavedSort(e.target.value as typeof savedSort)} className="ml-auto px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[10px] text-slate-300 outline-none">
                <option value="recent">Recent</option>
                <option value="score">CLS high → low</option>
                <option value="grade">Grade high → low</option>
              </select>
            </div>
            {compareIds.length > 0 && (
              <section className="rounded-2xl border border-sky-400/20 bg-sky-400/[0.05] p-3">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-xs font-bold text-sky-200">Compare assessments</div>
                    <div className="text-[10px] text-slate-500">Side-by-side records; no ranking is applied.</div>
                  </div>
                  <button type="button" onClick={() => setCompareIds([])} className="text-[10px] text-slate-500 hover:text-white">Clear</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px]">
                    <tbody>
                      {[
                        ['Street', (saved: SavedLocation) => saved.streetName],
                        ['CLS', (saved: SavedLocation) => saved.clsScore ?? '—'],
                        ['C1 Safety', (saved: SavedLocation) => saved.scores.c1 ?? '—'],
                        ['C2 Amenities', (saved: SavedLocation) => saved.scores.c2 ?? '—'],
                        ['C3 Transit', (saved: SavedLocation) => saved.scores.c3 ?? '—'],
                        ['C4 Green', (saved: SavedLocation) => saved.scores.c4 ?? '—'],
                        ['C5 Community', (saved: SavedLocation) => saved.scores.c5 ?? '—'],
                      ].map(([label, getter]) => (
                        <tr key={String(label)} className="border-t border-white/5">
                          <td className="py-1.5 pr-2 text-slate-500 whitespace-nowrap">{String(label)}</td>
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
            {historyGroups.length > 0 && (
              <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-xs font-bold text-slate-200">Assessment history</div>
                    <div className="text-[10px] text-slate-500">Repeated assessments for the same street are kept as separate field sessions.</div>
                  </div>
                  <span className="text-[10px] text-slate-500">{historyGroups.length} streets</span>
                </div>
                <div className="space-y-2">
                  {historyGroups.slice(0, 4).map(group => (
                    <div key={group[0].id} className="rounded-xl border border-white/5 bg-white/[0.02] p-2.5">
                      <div className="text-[11px] font-semibold text-slate-300 truncate">{group[0].streetName}</div>
                      <div className="mt-1.5 space-y-1">
                        {group.slice(0, 5).map(saved => (
                          <button key={saved.id} type="button" onClick={() => onSelectSaved(saved)} className="w-full flex items-center justify-between gap-2 text-left hover:bg-white/5 rounded-lg px-1 py-1">
                            <span className="text-[10px] text-slate-500">{new Date(saved.timestamp).toLocaleString('zh-TW')}</span>
                            <span className="text-[10px] font-mono font-bold text-slate-200">
                              {saved.clsScore ?? '—'}
                              {saved.fieldAdjustment != null && saved.baselineClsScore != null && (
                                <span className="ml-1 text-sky-300">{saved.fieldAdjustment >= 0 ? '+' : ''}{saved.fieldAdjustment}</span>
                              )}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {savedList.length === 0 && <div className="py-16 text-center text-sm text-slate-500">{savedFilter === 'favorites' ? 'No favorite streets yet.' : 'No saved assessments yet.'}</div>}
            {savedList.map(saved => (
              <div key={saved.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-start justify-between gap-3">
                  <button onClick={() => onSelectSaved(saved)} className="text-left min-w-0 flex-1">
                    <div className="font-bold truncate">{saved.name}</div>
                    <div className="text-[11px] text-slate-500 mt-1">{saved.district} · {saved.city}</div>
                    <div className="mt-3 flex items-center gap-2">
                      <span className={`px-2 py-1 rounded-lg border text-xs font-bold ${gradeClass(saved.grade)}`}>{saved.clsScore ?? '—'} {saved.grade ?? ''}</span>
                      <span className="text-[10px] text-slate-500">{new Date(saved.timestamp).toLocaleString('zh-TW')}</span>
                    </div>
                  </button>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setCompareIds(prev => prev.includes(saved.id) ? prev.filter(id => id !== saved.id) : prev.length < 2 ? [...prev, saved.id] : prev)}
                      className={`px-2 py-1.5 rounded-lg text-[9px] border ${compareIds.includes(saved.id) ? 'bg-sky-400/15 border-sky-400/30 text-sky-200' : 'bg-white/[0.03] border-white/5 text-slate-500'}`}
                      title={compareIds.length >= 2 && !compareIds.includes(saved.id) ? 'Compare up to two assessments' : 'Compare'}
                    >
                      {compareIds.includes(saved.id) ? 'Selected' : 'Compare'}
                    </button>
                    <button onClick={() => onDeleteSaved(saved.id)} className="w-8 h-8 rounded-lg text-slate-500 hover:text-rose-300 hover:bg-rose-400/10 flex items-center justify-center" title="Delete assessment"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {view === 'settings' && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-bold">Settings</h2>
              <p className="text-xs text-slate-500 mt-1">System and data-source diagnostics live here, away from the assessment workflow.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="flex items-center gap-3">
                <Database className="w-5 h-5 text-sky-300" />
                <div>
                  <div className="text-sm font-semibold">Data sources & system status</div>
                  <div className="text-[11px] text-slate-500 mt-1">Read-only diagnostics for the currently loaded assessment.</div>
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {(assessment?.sourceStatus || []).map(source => (
                  <div key={source.source} className="flex items-center justify-between gap-3 text-[10px]">
                    <span className="text-slate-400 truncate">{source.source}</span>
                    <span className={source.status === 'available' ? 'text-emerald-400' : 'text-slate-500'}>
                      {source.status} · {formatFreshness(source.retrievedAt || undefined)}
                    </span>
                  </div>
                ))}
                {(!assessment?.sourceStatus || assessment.sourceStatus.length === 0) && (
                  <div className="text-[10px] text-slate-500">No source status is available for this assessment yet.</div>
                )}
              </div>
            </div>
            <div className="p-4 rounded-2xl border border-white/10 bg-white/[0.04]">
              <div className="text-xs font-bold text-slate-300">Assessment model</div>
              <div className="text-[11px] text-slate-500 mt-1">External data and field observations remain distinct. Score changes should be persisted as explicit observation adjustments.</div>
            </div>
          </div>
        )}
      </div>

      {view === 'assessment' && (
        <footer className="shrink-0 p-4 border-t border-white/10 bg-[#111113]">
          {step < 3 ? (
            <button onClick={() => setStep((step + 1) as 1|2|3)} className="w-full py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-bold flex items-center justify-center gap-2">Continue <ChevronRight className="w-4 h-4" /></button>
          ) : (
            <div className="flex gap-2">
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Assessment name" className="flex-1 min-w-0 px-3 py-3 rounded-xl bg-white/5 border border-white/10 text-xs outline-none" />
              <button onClick={handleSave} disabled={isSaving} className="px-5 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-bold flex items-center gap-2">
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {isSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
          {savedNotice && <div className="text-[10px] text-emerald-400 text-center mt-2">Assessment saved.</div>}
        </footer>
      )}
    </aside>
  );
}
