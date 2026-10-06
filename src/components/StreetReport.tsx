import { t, dateLocale, displayPlace } from '../i18n';
import { Sparkles, MapPin, Camera, Star } from 'lucide-react';
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

export function StreetReport(props: Props) {
  const { saved, streetName, district, city, score, grade, assessment, fieldNotes, ratings,
    adjustment, evidence, evidenceUrls, aiExplanation, aiExplanationError,
    isGeneratingAiExplanation, canExplain, onExplain, isFavorite, onToggleFavorite } = props;
  const categories = [
    ['C1 安全', assessment?.scores.c1], ['C2 生活機能', assessment?.scores.c2],
    ['C3 交通', assessment?.scores.c3], ['C4 綠意環境', assessment?.scores.c4],
    ['C5 社區', assessment?.scores.c5],
  ] as const;
  const photos = evidence.filter(item => item.type === 'photo');
  const feeling = saved?.walkMoment?.feeling;
  const savedAdjustment = saved?.fieldAdjustment ?? adjustment?.adjustment ?? null;

  return (
    <div className="street-report space-y-3" data-testid="street-result-report">
      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.05] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-lg font-bold truncate"><MapPin className="w-4 h-4 shrink-0 text-slate-300" />{displayPlace(saved?.name || streetName)}</div>
            <div className="text-sm text-slate-300 mt-1">{saved?.district || district} · {saved?.city || city}</div>
            <div className="text-sm text-slate-300 mt-1">{saved ? new Date(saved.timestamp).toLocaleString(dateLocale()) : t("目前選取地點")}</div>
          </div>
          <div className="text-right shrink-0"><div className="text-sm uppercase tracking-wider text-slate-300">CLS</div><div className="text-3xl font-bold font-mono">{score ?? '—'}</div><div className="text-sm text-slate-300">{grade || (score == null ? t("待補") : '')}{assessment?.scores.overallMode === 'estimated' ? t(" · 推估") : ''}</div></div>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3">
          <div className="rounded-xl bg-black/10 p-2.5"><div className="text-sm text-slate-300">{t("外部資料 CLS")}</div><div className="text-sm font-bold mt-1">{saved?.baselineClsScore ?? assessment?.scores.overall ?? '—'}</div></div>
          <div className="rounded-xl bg-black/10 p-2.5"><div className="text-sm text-slate-300">{t("現場調整")}</div><div className="text-sm font-bold mt-1">{savedAdjustment == null ? '—' : (savedAdjustment > 0 ? '+' : '') + savedAdjustment}</div></div>
          <button type="button" onClick={onToggleFavorite} aria-label={isFavorite ? t("取消最愛") : t("加入最愛")} title={isFavorite ? t("取消最愛") : t("加入最愛")} className={'rounded-xl border p-2 flex items-center justify-center gap-1 text-sm ' + (isFavorite ? 'border-amber-300/30 bg-amber-300/10 text-amber-200' : 'border-white/10 text-slate-300')}><Star className={'w-4 h-4 ' + (isFavorite ? 'fill-current' : '')} />{isFavorite ? t("已收藏") : t("收藏街道")}</button>
        </div>
        {feeling && <div className="mt-3 rounded-xl bg-white/[0.04] p-3"><div className="text-sm uppercase tracking-wider text-slate-300">{t("使用者現場感受")}</div><div className="text-sm font-semibold mt-1">{feeling === 'good' ? t("喜歡") : feeling === 'bad' ? t("不喜歡") : t("拍照紀錄")}</div><div className="text-sm text-slate-300 mt-1">{saved?.walkMoment?.accuracyMeters != null ? t("定位精度 ±") + saved.walkMoment.accuracyMeters + ' m · ' : ''}{saved ? new Date(saved.timestamp).toLocaleString(dateLocale()) : ''}</div></div>}
      </section>

      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3">
        <h3 className="text-sm font-bold text-slate-200">{t("CLS 分類結果")}</h3>
        <div className="grid grid-cols-2 gap-2 mt-2">{categories.map(([label, category]) => <div key={t(label)} className="rounded-xl bg-white/[0.035] p-2.5"><div className="text-sm text-slate-300">{t(label)}</div><div className="text-lg font-bold font-mono mt-1">{category?.score ?? '—'}{category?.mode === 'estimated' && <span className="text-sm text-amber-300 ml-1">{t("推估")}</span>}</div></div>)}</div>
        {assessment?.factors && assessment.factors.length > 0 && <details className="mt-3"><summary className="cursor-pointer text-sm text-slate-300">{t("查看指標來源與資料時間")}</summary><div className="mt-2 space-y-2">{assessment.factors.map((factor, index) => <div key={factor.indicator + '-' + index} className="flex justify-between gap-3 text-sm"><span className="text-slate-300">{factor.category} · {t(factor.indicator)}</span><span className="text-right text-slate-300">{factor.value ?? '—'} {t(factor.unit)} · {t(factor.source)}</span></div>)}</div></details>}
      </section>

      {Object.keys(ratings).length > 0 && <section className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3"><h3 className="text-sm font-bold text-slate-200">{t("現場環境觀察")}</h3><div className="mt-2 space-y-2">{FIELD_OBSERVATION_DEFINITIONS.filter(item => ratings[item.id] != null).map(item => <div key={item.id} className="flex justify-between gap-3 text-sm"><span className="text-slate-300">{item.category} · {t(item.title)}</span><span className="shrink-0 text-slate-200">{t(item.ratingLabels[ratings[item.id] - 1])}</span></div>)}</div>{fieldNotes.trim() && <p className="mt-3 pt-3 border-t border-white/5 text-sm leading-relaxed text-slate-300 whitespace-pre-wrap">{fieldNotes}</p>}</section>}
      {fieldNotes.trim() && Object.keys(ratings).length === 0 && <section className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3"><h3 className="text-sm font-bold text-slate-200">{t("觀察筆記")}</h3><p className="text-sm leading-relaxed text-slate-300 whitespace-pre-wrap mt-2">{fieldNotes}</p></section>}
      {(photos.length > 0 || !saved) && <section className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3"><h3 className="text-sm font-bold text-slate-200 flex items-center gap-2"><Camera className="w-4 h-4" />{t("照片與佐證")}</h3>{photos.length > 0 ? <div className="grid grid-cols-2 gap-2 mt-3">{photos.map(item => { const url = evidenceUrls[item.id] || (item.storageKey ? evidenceUrls[item.storageKey] : undefined); return <figure key={item.id} className="overflow-hidden rounded-xl bg-black/20"><div className="aspect-square">{url ? <img src={url} alt={item.note || t("街道紀錄照片")} className="w-full h-full object-cover" /> : <div className="h-full flex items-center justify-center text-sm text-slate-300">{t("照片目前無法載入")}</div>}</div><figcaption className="p-2 text-sm text-slate-300">{item.note || t("未提供照片說明")}<div className="text-slate-300 mt-1">{new Date(item.capturedAt).toLocaleString(dateLocale())}</div></figcaption></figure>; })}</div> : <p className="text-sm text-slate-300 mt-2">{t("這筆紀錄沒有照片。")}</p>}{evidence.filter(item => item.type === 'note' && item.note).map(item => <p key={item.id} className="mt-2 rounded-lg bg-white/[0.03] p-2.5 text-sm text-slate-300">{item.note}</p>)}</section>}

      <section className="rounded-2xl border border-violet-400/20 bg-violet-400/[0.05] p-3">
        <div className="flex items-center justify-between gap-3"><div className="text-sm font-bold text-violet-100 flex items-center gap-2"><Sparkles className="w-4 h-4 text-violet-300" />{t("AI 解說")}</div><button type="button" onClick={onExplain} disabled={!canExplain || isGeneratingAiExplanation} className="px-2.5 py-2 rounded-lg bg-violet-500/15 border border-violet-400/20 text-sm font-bold text-violet-200 disabled:opacity-40">{isGeneratingAiExplanation ? t("分析中…") : aiExplanation ? t("重新產生") : t("產生 AI 解說")}</button></div>
        {!canExplain && <p className="text-sm text-slate-300 mt-2">{t("先將此評估儲存至 Street Library，即可產生以該筆報告資料為依據的解說。")}</p>}
        {aiExplanationError && <p role="alert" className="text-sm text-rose-300 mt-2">{t(aiExplanationError)}</p>}
        {aiExplanation && <div className="mt-3 space-y-2"><p className="text-sm leading-relaxed text-slate-300">{aiExplanation.summary}</p>{([[t("優點"), aiExplanation.strengths], [t("資料限制"), aiExplanation.limitations], [t("現場觀察"), aiExplanation.fieldObservations], [t("後續確認"), aiExplanation.followUpChecks]] as const).map(([label, items]) => items.length > 0 && <div key={t(label)}><div className="text-sm text-slate-300">{t(label)}</div>{items.map(item => <p key={item} className="text-sm text-slate-300 mt-1">{item}</p>)}</div>)}</div>}
      </section>
    </div>
  );
}
