import { ArrowUpRight, MapPin } from 'lucide-react';
import type { LocationCoord, StreetAssessmentResponse } from '../types';

interface Props {
  streetName: string;
  district: string;
  city: string;
  location: LocationCoord;
  score: number | null;
  grade: string | null;
  assessment?: StreetAssessmentResponse | null;
  onOpen: () => void;
}

/** An overview of the same persisted assessment shown in the review panel. */
export function StreetTelemetry({ streetName, district, city, location, score, grade, assessment, onOpen }: Props) {
  const categories = ['安全', '機能', '移動', '綠意', '活力'];
  const scores = assessment?.scores;
  const values = scores ? [scores.c1, scores.c2, scores.c3, scores.c4, scores.c5] : [];
  const progress = score == null ? 0 : Math.max(0, Math.min(100, score));
  return (
    <section className="street-telemetry" aria-label="街道數據總覽">
      <div className="hud-card telemetry-summary">
        <div className="hud-eyebrow">STREET INTELLIGENCE <span>01 / OVERVIEW</span></div>
        <div className="telemetry-title"><MapPin size={16} /><h1>{streetName || '選擇街道'}</h1></div>
        <p className="telemetry-place">{[district, city].filter(Boolean).join(' · ')}</p>
        <div className="telemetry-score">
          <div className="score-gauge" aria-label={score == null ? 'CLS 待補' : `CLS ${score.toFixed(0)}`}>
            <svg viewBox="0 0 112 112" aria-hidden="true"><circle className="gauge-track" cx="56" cy="56" r="48" /><circle className="gauge-value" cx="56" cy="56" r="48" pathLength="100" strokeDasharray={`${progress} 100`} /></svg>
            <div><strong>{score == null ? '—' : score.toFixed(0)}</strong><span>CLS / 100</span></div>
          </div>
          <div className="telemetry-grade"><span>街道宜居指數</span><strong>{grade || '待補'}</strong><small>{score == null ? '等待資料更新' : scores?.overallMode === 'estimated' ? '含推估 · 查看依據' : '目前評估結果'}</small></div>
        </div>
        <button type="button" className="telemetry-link" onClick={onOpen}>查看評估與資料來源 <ArrowUpRight size={16} /></button>
      </div>
      <div className="hud-card telemetry-breakdown">
        <div className="hud-eyebrow">五大面向 <span>CLS BASELINE</span></div>
        <div className="telemetry-categories">{categories.map((label, index) => <div key={label}><span>{label}</span><strong>{values[index]?.score == null ? '—' : Math.round(values[index]!.score!)}</strong><small>{values[index]?.mode === 'estimated' ? '推估' : `C${index + 1}`}</small></div>)}</div>
        <div className="telemetry-coordinates"><MapPin size={12} /><span>{location.lat.toFixed(5)}, {location.lng.toFixed(5)}</span></div>
      </div>
      <p className="map-hint">點選地圖探索街道 · 開啟步行記下感受</p>
    </section>
  );
}
