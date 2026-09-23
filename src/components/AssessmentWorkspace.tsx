import { useMemo, useState } from 'react';
import { Check, ChevronRight, MapPin, Save, X, ClipboardCheck, Database, Star, Trash2, ArrowLeft } from 'lucide-react';
import { FieldCheckItem, LocationCoord, SavedLocation, StreetAssessmentResponse } from '../types';

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
  fieldChecks: FieldCheckItem[];
  onToggleFieldCheck: (id: string) => void;
  fieldNotes: string;
  onUpdateNotes: (notes: string) => void;
  onSave: (name: string, observationRatings: Record<string, number>, notes: string) => void;
  onSelectSaved: (saved: SavedLocation) => void;
  savedLocations: SavedLocation[];
  onDeleteSaved: (id: string) => void;
  onOpenDataLogs: () => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
}

const ratingLabels = ['Poor', 'Fair', 'Good', 'Great'];

function gradeClass(grade: AssessmentWorkspaceProps['grade']) {
  if (grade === 'S' || grade === 'A') return 'text-emerald-300 bg-emerald-400/15 border-emerald-400/30';
  if (grade === 'B') return 'text-sky-300 bg-sky-400/15 border-sky-400/30';
  if (grade === 'C') return 'text-amber-300 bg-amber-400/15 border-amber-400/30';
  return 'text-rose-300 bg-rose-400/15 border-rose-400/30';
}

export function AssessmentWorkspace({
  view, onViewChange, isOpen, onClose, streetName, district, city, targetLocation,
  clsScore, grade, assessment, fieldChecks, onToggleFieldCheck, fieldNotes,
  onUpdateNotes, onSave, onSelectSaved, savedLocations, onDeleteSaved, onOpenDataLogs, isFavorite, onToggleFavorite,
}: AssessmentWorkspaceProps) {
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [name, setName] = useState('');
  const [savedNotice, setSavedNotice] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const grouped = useMemo(() => {
    return ['C1','C2','C3','C4','C5'].map(category => ({
      category,
      items: fieldChecks.filter(item => item.category === category),
    }));
  }, [fieldChecks]);

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

  const handleSave = () => {
    onSave(name.trim() || `${district ? district + ' ' : ''}${streetName || 'Street assessment'}`, ratings, fieldNotes);
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
            <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10"><ArrowLeft className="w-4 h-4" /></button>
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
              <div className="grid grid-cols-2 gap-2">
                {dataCards.map(([label, item, category]) => (
                  <div key={label} className="rounded-2xl bg-white/[0.045] border border-white/5 p-3">
                    <div className="text-[11px] text-slate-400">{label} · {category}</div>
                    <div className="mt-1 text-sm font-bold">{item?.value != null ? `${item.value} ${item.unit}` : 'N/A'}</div>
                    <div className={`mt-1 text-[10px] ${item?.status === 'available' ? 'text-emerald-400' : 'text-slate-500'}`}>{item?.status === 'available' ? 'Source data available' : 'No observation for this location'}</div>
                  </div>
                ))}
              </div>
            </section>}
            {step === 2 && <section>
              <div className="mb-2">
                <h3 className="text-xs uppercase tracking-wider text-slate-400 font-bold">Your observation</h3>
                <p className="text-[11px] text-slate-500 mt-1">Use what you see on site to record the street conditions. This is separate from external source data.</p>
              </div>
              <div className="space-y-3">
                {grouped.map(group => (
                  <div key={group.category} className="rounded-2xl bg-white/[0.035] border border-white/5 p-3">
                    <div className="text-[11px] font-bold text-slate-300 mb-2">{group.category}</div>
                    {group.items.map(item => {
                      const value = ratings[item.id] ?? (item.checked ? 3 : 0);
                      return (
                        <div key={item.id} className="py-2.5 border-t first:border-t-0 border-white/5">
                          <div className="flex items-start gap-2">
                            <button onClick={() => onToggleFieldCheck(item.id)} className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${item.checked ? 'bg-sky-500 border-sky-400' : 'border-white/20'}`}>
                              {item.checked && <Check className="w-3.5 h-3.5" />}
                            </button>
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-semibold">{item.title}</div>
                              <div className="text-[10px] text-slate-500 mt-0.5">{item.description}</div>
                              <div className="flex gap-1 mt-2">
                                {ratingLabels.map((label, index) => (
                                  <button key={label} onClick={() => setRatings(prev => ({ ...prev, [item.id]: index + 1 }))} className={`flex-1 py-1.5 rounded-lg text-[10px] font-semibold border ${value === index + 1 ? 'bg-sky-500/20 border-sky-400/40 text-sky-200' : 'bg-white/5 border-white/5 text-slate-500 hover:text-slate-300'}`}>{label}</button>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </section>}
            {step === 3 && <>
              <section>
                <label className="text-xs uppercase tracking-wider text-slate-400 font-bold">Review & save</label>
              <div className="mt-3 rounded-2xl bg-white/[0.04] border border-white/5 p-3 text-xs text-slate-300">Your observation is ready to be added to the CLS assessment.</div>
                <textarea value={fieldNotes} onChange={e => onUpdateNotes(e.target.value)} rows={3} placeholder="What did you observe? e.g. sidewalk blocked, good shade, heavy traffic..." className="mt-2 w-full rounded-2xl bg-white/5 border border-white/10 p-3 text-xs outline-none focus:border-sky-400/50 resize-none placeholder:text-slate-600" />
              </section>

              <section className="rounded-2xl border border-sky-400/20 bg-sky-400/[0.06] p-3">
              <div className="flex items-center gap-2 text-xs font-bold"><MapPin className="w-4 h-4 text-sky-300" /> {targetLocation.lat.toFixed(5)}, {targetLocation.lng.toFixed(5)}</div>
              <div className="text-[10px] text-slate-500 mt-1">Observation will be stored with this location and assessment timestamp.</div>
              </section>
            </>}
          </div>
        )}

        {view === 'saved' && (
          <div className="space-y-3">
            <div className="mb-4">
              <h2 className="text-xl font-bold">Saved streets</h2>
              <p className="text-xs text-slate-500 mt-1">Your saved assessments are kept separately from the live assessment panel.</p>
            </div>
            {savedLocations.length === 0 && <div className="py-16 text-center text-sm text-slate-500">No saved assessments yet.</div>}
            {savedLocations.map(saved => (
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
                  <button onClick={() => onDeleteSaved(saved.id)} className="w-8 h-8 rounded-lg text-slate-500 hover:text-rose-300 hover:bg-rose-400/10 flex items-center justify-center"><Trash2 className="w-4 h-4" /></button>
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
            <button onClick={onOpenDataLogs} className="w-full p-4 rounded-2xl border border-white/10 bg-white/[0.04] flex items-center gap-3 text-left hover:bg-white/[0.07]">
              <Database className="w-5 h-5 text-sky-300" />
              <div className="flex-1"><div className="text-sm font-semibold">Data sources & system status</div><div className="text-[11px] text-slate-500 mt-1">Connection, snapshot freshness, source provenance and Cloud SQL status.</div></div>
              <ChevronRight className="w-4 h-4 text-slate-500" />
            </button>
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
              <button onClick={handleSave} className="px-5 py-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-bold flex items-center gap-2"><Save className="w-4 h-4" /> Save</button>
            </div>
          )}
          {savedNotice && <div className="text-[10px] text-emerald-400 text-center mt-2">Assessment saved.</div>}
        </footer>
      )}
    </aside>
  );
}
