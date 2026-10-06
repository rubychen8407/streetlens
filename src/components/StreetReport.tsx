import { formatNumber, visibleFactors } from '../utils/formatNumber';
import { t, dateLocale, displayPlace } from '../i18n';
import {
  Sparkles,
  MapPin,
  Camera,
  Star,
  ShieldCheck,
  Store,
  Train,
  Trees,
  Users,
  TrendingUp,
  TrendingDown,
  ThumbsUp,
  ThumbsDown,
  Activity,
  Award,
} from 'lucide-react';
import type { AssessmentEvidence, AssessmentExplanation, FieldObservationAdjustment, SavedLocation, StreetAssessmentResponse } from '../types';
import { FIELD_OBSERVATION_DEFINITIONS } from '../data/fieldIndicators';

interface Props {
  saved: SavedLocation | null; streetName: string; district: string; city: string;
  score: number | null; grade: string | null; assessment: StreetAssessmentResponse | null;
  fieldNotes: string; ratings: Record<string, number>; adjustment: FieldObservationAdjustment | null;
  evidence: AssessmentEvidence[]; evidenceUrls: Record<string, string>;
  aiExplanation: AssessmentExplanation | null; aiExplanationError: string | null;
  isGeneratingAiExplanation: boolean; canExplain: boolean; onExplain: () => void;
  isFavorite: boolean; onToggleFavorite: () => void;
}

function LivabilityRadar({ scores }: { scores?: { c1?: number | null; c2?: number | null; c3?: number | null; c4?: number | null; c5?: number | null } }) {
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

export function StreetReport(props: Props) {
  const { saved, streetName, district, city, score, grade, assessment, fieldNotes, ratings,
    adjustment, evidence, evidenceUrls, aiExplanation, aiExplanationError,
    isGeneratingAiExplanation, canExplain, onExplain, isFavorite, onToggleFavorite } = props;

  const categories = [
    { key: 'c1', label: 'C1 安全', score: assessment?.scores.c1, icon: ShieldCheck, color: '#f87171', barColor: 'bg-rose-400' },
    { key: 'c2', label: 'C2 生活機能', score: assessment?.scores.c2, icon: Store, color: '#fbbf24', barColor: 'bg-amber-400' },
    { key: 'c3', label: 'C3 交通', score: assessment?.scores.c3, icon: Train, color: '#60a5fa', barColor: 'bg-sky-400' },
    { key: 'c4', label: 'C4 綠意環境', score: assessment?.scores.c4, icon: Trees, color: '#34d399', barColor: 'bg-emerald-400' },
    { key: 'c5', label: 'C5 社區', score: assessment?.scores.c5, icon: Users, color: '#c084fc', barColor: 'bg-purple-400' },
  ] as const;

  const photos = evidence.filter(item => item.type === 'photo');
  const feeling = saved?.walkMoment?.feeling;
  const savedAdjustment = saved?.fieldAdjustment ?? adjustment?.adjustment ?? null;

  const gradeColors: Record<string, string> = {
    S: 'bg-gradient-to-r from-emerald-400 to-lime-300 text-slate-950 font-black shadow-lg shadow-lime-500/20',
    A: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
    B: 'bg-sky-500/20 text-sky-300 border border-sky-500/30',
    C: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
    D: 'bg-rose-500/20 text-rose-300 border border-rose-500/30',
  };

  return (
    <div className="street-report space-y-4" data-testid="street-result-report">
      {/* Top Hero Card */}
      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.05] p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-lg font-bold truncate">
              <MapPin className="w-5 h-5 shrink-0 text-[#d4f971]" />
              {displayPlace(saved?.name || streetName)}
            </div>
            <div className="text-sm text-slate-300 mt-1">{saved?.district || district} · {saved?.city || city}</div>
            <div className="text-sm text-slate-300 mt-1">{saved ? new Date(saved.timestamp).toLocaleString(dateLocale()) : t("目前選取地點")}</div>
          </div>
          {/* Visual Score Lockup */}
          <div className="flex flex-col items-end shrink-0">
            <div className="text-sm uppercase tracking-wider font-semibold text-slate-300">CLS 綜合評分</div>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-3xl font-extrabold font-mono tracking-tight text-white">{formatNumber(score)}</span>
              {grade && (
                <span className={`px-2.5 py-1 rounded-md text-sm font-bold uppercase tracking-wider ${gradeColors[grade] || 'bg-white/10 text-white'}`}>
                  {grade}
                </span>
              )}
            </div>
            <div className="text-sm text-slate-300 mt-0.5">
              {score == null ? t("待補") : assessment?.scores.overallMode === 'estimated' ? t("推估數據") : t("實測綜合")}
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-2 mt-4">
          <div className="rounded-xl bg-black/20 border border-white/[0.06] p-3">
            <div className="text-sm text-slate-300">{t("外部資料 CLS")}</div>
            <div className="text-lg font-bold font-mono text-white mt-0.5">
              {formatNumber(saved?.baselineClsScore ?? assessment?.scores.overall)}
            </div>
          </div>
          <div className="rounded-xl bg-black/20 border border-white/[0.06] p-3">
            <div className="text-sm text-slate-300">{t("現場調整")}</div>
            <div className="text-lg font-bold font-mono text-white mt-0.5 flex items-center gap-1">
              {savedAdjustment != null && savedAdjustment !== 0 && (
                savedAdjustment > 0 ? (
                  <TrendingUp className="w-4 h-4 text-emerald-400 inline" />
                ) : (
                  <TrendingDown className="w-4 h-4 text-rose-400 inline" />
                )
              )}
              {savedAdjustment == null ? '—' : (savedAdjustment > 0 ? '+' : '') + savedAdjustment}
            </div>
          </div>
          <button
            type="button"
            onClick={onToggleFavorite}
            aria-label={isFavorite ? t("取消最愛") : t("加入最愛")}
            title={isFavorite ? t("取消最愛") : t("加入最愛")}
            className={'rounded-xl border p-3 flex items-center justify-center gap-2 text-sm font-semibold transition-colors ' + (isFavorite ? 'border-amber-300/30 bg-amber-300/10 text-amber-200 shadow-sm' : 'border-white/10 text-slate-300 hover:bg-white/5')}
          >
            <Star className={'w-4 h-4 ' + (isFavorite ? 'fill-current text-amber-300' : '')} />
            {isFavorite ? t("已收藏") : t("收藏街道")}
          </button>
        </div>

        {/* Visual Walk Feeling Badge */}
        {feeling && (
          <div className="mt-3 rounded-xl bg-white/[0.04] border border-white/[0.06] p-3 flex items-start gap-2.5">
            <div className="p-2 rounded-lg bg-white/10 shrink-0 mt-0.5">
              {feeling === 'good' ? (
                <ThumbsUp className="w-4 h-4 text-emerald-400" />
              ) : feeling === 'bad' ? (
                <ThumbsDown className="w-4 h-4 text-rose-400" />
              ) : (
                <Camera className="w-4 h-4 text-sky-400" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm uppercase tracking-wider text-slate-300">{t("使用者現場感受")}</div>
              <div className="text-base font-semibold text-white mt-0.5">
                <span>{feeling === 'good' ? t("喜歡") : feeling === 'bad' ? t("不喜歡") : t("拍照紀錄")}</span>
              </div>
              <div className="text-sm text-slate-300 mt-0.5">
                {saved?.walkMoment?.accuracyMeters != null ? t("定位精度 ±") + saved.walkMoment.accuracyMeters + ' m · ' : ''}
                {saved ? new Date(saved.timestamp).toLocaleString(dateLocale()) : ''}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Visualized Category Scores with Radar Chart & Graphical Progress Bars */}
      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4 space-y-4 shadow-xl">
        <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
          <h3 className="text-base font-bold text-slate-200 flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#d4f971]" />
            {t("CLS 分類結果")}
          </h3>
          <span className="text-sm text-slate-300">{t("五大宜居指標維度")}</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
          <LivabilityRadar
            scores={{
              c1: assessment?.scores.c1?.score,
              c2: assessment?.scores.c2?.score,
              c3: assessment?.scores.c3?.score,
              c4: assessment?.scores.c4?.score,
              c5: assessment?.scores.c5?.score,
            }}
          />

          <div className="space-y-2.5">
            {categories.map((item) => {
              const val = item.score?.score;
              const pct = val != null ? Math.min(100, Math.max(0, val)) : 0;
              return (
                <div key={t(item.label)} className="rounded-xl bg-white/[0.025] border border-white/[0.05] p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <item.icon className="w-4 h-4 shrink-0" style={{ color: item.color }} />
                      <span className="text-sm font-semibold text-slate-200">{t(item.label)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold font-mono text-white">{formatNumber(val)}</span>
                      {item.score?.mode === 'estimated' && (
                        <span className="text-sm px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-300 border border-amber-400/30">
                          {t("推估")}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Progress bar visualizer */}
                  <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${item.barColor}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {assessment?.factors && assessment.factors.length > 0 && (
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-slate-300 hover:text-white py-1 transition-colors">
              {t("查看指標來源與資料時間")}
            </summary>
            <div className="mt-2 space-y-2 bg-black/20 rounded-xl p-3 border border-white/[0.05]">
              {visibleFactors(assessment.factors).map((factor, index) => (
                <div key={factor.indicator + '-' + index} className="flex justify-between gap-3 text-sm py-1 border-b border-white/[0.03] last:border-0">
                  <span className="text-slate-300">{factor.category} · {t(factor.indicator)}</span>
                  <span className="text-right text-slate-200 font-mono">{formatNumber(factor.value)} {t(factor.unit)} · {t(factor.source)}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </section>

      {/* Field Observations with Visual Step Badges */}
      {Object.keys(ratings).length > 0 && (
        <section className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 space-y-2.5">
          <h3 className="text-base font-bold text-slate-200">{t("現場環境觀察")}</h3>
          <div className="space-y-2">
            {FIELD_OBSERVATION_DEFINITIONS.filter(item => ratings[item.id] != null).map(item => {
              const rating = ratings[item.id];
              return (
                <div key={item.id} className="flex items-center justify-between gap-3 text-sm p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                  <span className="text-slate-300">{item.category} · {t(item.title)}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4].map(step => (
                        <span
                          key={step}
                          className={`w-2 h-3.5 rounded-xs ${
                            step <= rating ? 'bg-[#d4f971]' : 'bg-white/10'
                          }`}
                        />
                      ))}
                    </div>
                    <span className="font-semibold text-slate-200">{t(item.ratingLabels[rating - 1])}</span>
                  </div>
                </div>
              );
            })}
          </div>
          {fieldNotes.trim() && (
            <p className="mt-2 pt-2 border-t border-white/5 text-sm leading-relaxed text-slate-300 whitespace-pre-wrap">
              {fieldNotes}
            </p>
          )}
        </section>
      )}

      {fieldNotes.trim() && Object.keys(ratings).length === 0 && (
        <section className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
          <h3 className="text-base font-bold text-slate-200">{t("觀察筆記")}</h3>
          <p className="text-sm leading-relaxed text-slate-300 whitespace-pre-wrap mt-2">{fieldNotes}</p>
        </section>
      )}

      {/* Photos & Evidence */}
      {(photos.length > 0 || !saved) && (
        <section className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 space-y-3">
          <h3 className="text-base font-bold text-slate-200 flex items-center gap-2">
            <Camera className="w-5 h-5 text-sky-400" />
            {t("照片與佐證")}
          </h3>
          {photos.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 mt-2">
              {photos.map(item => {
                const url = evidenceUrls[item.id] || (item.storageKey ? evidenceUrls[item.storageKey] : undefined);
                return (
                  <figure key={item.id} className="overflow-hidden rounded-xl bg-black/20 border border-white/[0.06]">
                    <div className="aspect-square">
                      {url ? (
                        <img src={url} alt={item.note || t("街道紀錄照片")} className="w-full h-full object-cover" />
                      ) : (
                        <div className="h-full flex items-center justify-center text-sm text-slate-300">
                          {t("照片目前無法載入")}
                        </div>
                      )}
                    </div>
                    <figcaption className="p-2.5 text-sm text-slate-300">
                      {item.note || t("未提供照片說明")}
                      <div className="text-slate-300 mt-1">{new Date(item.capturedAt).toLocaleString(dateLocale())}</div>
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-slate-300">{t("這筆紀錄沒有照片。")}</p>
          )}
          {evidence.filter(item => item.type === 'note' && item.note).map(item => (
            <p key={item.id} className="mt-2 rounded-lg bg-white/[0.03] p-2.5 text-sm text-slate-300">
              {item.note}
            </p>
          ))}
        </section>
      )}

      {/* AI Explanation Card */}
      <section className="rounded-2xl border border-violet-400/20 bg-violet-400/[0.05] p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-base font-bold text-violet-100 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-violet-300" />
            {t("AI 解說")}
          </div>
          <button
            type="button"
            onClick={onExplain}
            disabled={!canExplain || isGeneratingAiExplanation}
            className="px-3 py-1.5 rounded-lg bg-violet-500/15 border border-violet-400/20 text-sm font-bold text-violet-200 hover:bg-violet-500/25 transition-all disabled:opacity-40"
          >
            {isGeneratingAiExplanation ? t("分析中…") : aiExplanation ? t("重新產生") : t("產生 AI 解說")}
          </button>
        </div>
        {!canExplain && (
          <p className="text-sm text-slate-300">
            {t("先將此評估儲存至 Street Library，即可產生以該筆報告資料為依據的解說。")}
          </p>
        )}
        {aiExplanationError && <p role="alert" className="text-sm text-rose-300">{t(aiExplanationError)}</p>}
        {aiExplanation && (
          <div className="mt-2 space-y-2 text-sm leading-relaxed text-slate-300">
            <p className="bg-black/20 p-3 rounded-xl border border-violet-400/10">{aiExplanation.summary}</p>
            {([[t("優點"), aiExplanation.strengths], [t("資料限制"), aiExplanation.limitations], [t("現場觀察"), aiExplanation.fieldObservations], [t("後續確認"), aiExplanation.followUpChecks]] as const).map(([label, items]) => items.length > 0 && (
              <div key={t(label)} className="bg-black/15 p-2.5 rounded-lg border border-white/[0.04]">
                <div className="font-semibold text-slate-200 mb-1">{t(label)}</div>
                {items.map(item => (
                  <p key={item} className="text-slate-300 mt-1 pl-2 border-l border-violet-400/30">{item}</p>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
