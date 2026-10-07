import { CLS_STANDARDS } from '../data/clsStandards';
import { t } from '../i18n';
import { formatNumber } from '../utils/formatNumber';
import type { StreetAssessmentScores } from '../types';

export function ClsMethod({ scores }: { scores: StreetAssessmentScores }) {
  if (!scores.scoringStandard) return null;
  return <div className="mt-3 text-sm text-slate-300" data-testid="cls-method">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>{t('資料完整度')} <strong className="text-white tabular-nums">{scores.completeness}%</strong></span>
      {scores.provisional && <span className="text-amber-300">{t('暫定分數')}</span>}
      {scores.estimatedCategoryCount > 0 && <span>{t('含區域估計')}</span>}
    </div>
    <details className="mt-2" data-testid="cls-formula">
      <summary className="cursor-pointer py-1 hover:text-white">{t('計分公式與限制')}</summary>
      <div className="mt-2 space-y-2 leading-relaxed">
        <p>{t('五類各占 20%；類內依固定指標權重加總。最後加上實勘調整，限制在 0–100 分。')}</p>
        <p>{t('缺資料時，至少 5 筆有效參考觀測才用中位數估計；估計不算入完整度。仍有缺項時，以可計分權重計算暫定分數。')}</p>
        <p>{t('安全分數最高為較低的風險分數加 10；只有路燈、消防栓時不產生安全分數。')}</p>
        <p>{t('門檻是待校準的產品設定，不是官方宜居標準。距離為直線距離；人行道為範圍面積占比，尚不代表連續性或實際步行時間。事故數未按交通量校正。')}</p>
        <p>{t('數量分數 = 100 × (1 − 2^(−觀測值 / 半飽和值))；距離與風險依下列節點線性插值。')}</p>
        <p>{t('指標參考排名僅比較現有樣本，不影響 CLS，也不代表整區街道排名。')}</p>
        <div className="space-y-2 border-t border-white/10 pt-2">
          {Object.entries(CLS_STANDARDS).map(([id, standard]) => <div key={id} className="break-words">
            <div className="font-medium text-slate-100">{standard.category} · {t(id)} · {formatNumber(standard.weight * 100)}%</div>
            <div>{standard.curve.kind === 'saturation'
              ? <>{t('半飽和值')} {standard.curve.half} {t(standard.unit)} → 50</>
              : standard.curve.knots.map(([x, y]) => `${x} ${t(standard.unit)} → ${y}`).join(' / ')}</div>
          </div>)}
        </div>
      </div>
    </details>
  </div>;
}
