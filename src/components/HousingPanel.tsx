import { useEffect, useRef, useState } from 'react';
import { Home, ChevronDown, ExternalLink, Loader2 } from 'lucide-react';
import { t, bilingual } from '../i18n';
import { formatNumber } from '../utils/formatNumber';
import { HOUSING_TYPES, housingStreet, parseHousingFilters, type HousingResult } from '../utils/housing';

const results = new Map<string, { expires: number; result: HousingResult }>();
const inputStyle = 'w-full rounded-lg border border-white/15 bg-[#0E131A] px-2 py-2 text-sm text-white min-h-11';
export function HousingPanel({ city, district, streetName }: { city: string; district: string; streetName: string }) {
  const [openKey, setOpenKey] = useState(''), [data, setData] = useState<HousingResult | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState('years=3'), [page, setPage] = useState(0);
  const form = useRef<HTMLFormElement>(null), requestId = useRef(0);
  const street = housingStreet(streetName, city, district);
  const scopeKey = city + '|' + district + '|' + streetName;
  const open = openKey === scopeKey;
  useEffect(() => { setOpenKey(''); setData(null); setError(''); setPage(0); setQuery('years=3'); form.current?.reset(); }, [scopeKey]);
  useEffect(() => {
    const id = ++requestId.current;
    if (!open || !city || !district || !street) return;
    const controller = new AbortController();
    const params = new URLSearchParams(query);
    params.set('city', city); params.set('district', district); params.set('street', street); params.set('page', String(page));
    const key = params.toString(), cached = results.get(key);
    setData(null); setError('');
    if (cached && cached.expires > Date.now()) { setData(cached.result); setLoading(false); return; }
    setLoading(true);
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    void fetch('/api/housing?' + key, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Housing read failed');
      const body = await response.json() as HousingResult;
      if (!['available', 'not_imported'].includes(body.status) || !Array.isArray(body.records) || !body.stats || !body.coverage) throw new Error('Invalid housing response');
      if (id !== requestId.current) return;
      if (results.size >= 32) results.delete(results.keys().next().value!);
      results.set(key, { result: body, expires: Date.now() + 5 * 60 * 1000 }); setData(body);
    }).catch(() => { if (id === requestId.current) setError(t('住宅資料暫時無法讀取，請稍後重試。')); })
      .finally(() => { clearTimeout(timeout); if (id === requestId.current) setLoading(false); });
    return () => { ++requestId.current; controller.abort(); clearTimeout(timeout); };
  }, [open, city, district, street, query, page, retry]);
  const numberField = (name: string, label: string, max: number) => <label className="text-sm text-slate-300">{t(label)}<input className={inputStyle + ' mt-1'} name={name} type="number" min="0" max={max} step="any" /></label>;
  const booleanField = (name: string, label: string) => <label className="text-sm text-slate-300">{t(label)}<select className={inputStyle + ' mt-1'} name={name}><option value="">{t('不限')}</option><option value="true">{t('有')}</option><option value="false">{t('無')}</option></select></label>;
  return <section className="rounded-2xl border border-white/10 bg-white/[0.03] mb-4" data-testid="housing-panel">
    <button type="button" aria-expanded={open} onClick={() => setOpenKey(open ? '' : scopeKey)} className="flex w-full items-center justify-between gap-2 px-4 py-3 min-h-11 text-left text-base font-semibold">
      <span className="flex items-center gap-2"><Home size={18} />{t('住宅行情')}</span><ChevronDown size={18} className={open ? 'rotate-180' : ''} />
    </button>
    {open && <div className="border-t border-white/10 p-3 space-y-3">
      {!street || !city || !district ? <p className="text-sm text-slate-300">{t('請先選擇有街道名稱及行政區的地點。')}</p> : <>
        <div className="flex items-center justify-between gap-2 text-sm"><span>{city} · {district} · {street}</span><span className="text-[#D4F971] shrink-0">{t('純住宅成交')}</span></div>
        <form key={scopeKey} ref={form} onSubmit={event => {
          event.preventDefault(); const fields = new FormData(event.currentTarget), params = new URLSearchParams();
          fields.forEach((value, key) => { if (String(value)) params.set(key, String(value)); });
          try { parseHousingFilters({ ...Object.fromEntries(params), city, district, street: street || '' }); }
          catch { setError(t('請確認最小值不大於最大值，且篩選條件有效。')); return; }
          setPage(0); setQuery(params.toString());
        }} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {numberField('minPrice', '最低總價（萬）', 1e6)}{numberField('maxPrice', '最高總價（萬）', 1e6)}
            <label className="text-sm text-slate-300">{t('成交期間')}<select className={inputStyle + ' mt-1'} name="years" defaultValue="3">{[1, 3, 5].map(n => <option key={n} value={n}>{bilingual(`近 ${n} 年`, `Last ${n} years`)}</option>)}</select></label>
            <label className="text-sm text-slate-300">{t('房屋型態')}<select className={inputStyle + ' mt-1'} name="buildingType"><option value="">{t('不限')}</option>{HOUSING_TYPES.map(type => <option key={type} value={type}>{t(type)}</option>)}</select></label>
          </div>
          <details><summary className="text-sm text-slate-300 cursor-pointer py-2 min-h-11">{t('更多房屋條件')}</summary><div className="grid grid-cols-2 gap-2">
            {numberField('minArea', '最低建物坪數', 1e4)}{numberField('maxArea', '最高建物坪數', 1e4)}
            {numberField('rooms', '房數', 20)}{numberField('maxAge', '最高屋齡（成交時）', 200)}
            {numberField('minFloor', '最低樓層', 100)}{numberField('maxFloor', '最高樓層', 100)}
            {booleanField('elevator', '電梯')}{booleanField('parking', '車位')}
          </div></details>
          <label className="flex items-center gap-2 text-sm text-slate-300 min-h-11"><input type="checkbox" name="includeSpecial" value="true" />{t('包含特殊交易')}</label>
          <button className="w-full rounded-xl bg-[#D4F971] text-[#0E131A] text-sm font-semibold min-h-11" type="submit">{t('套用住宅篩選')}</button>
        </form>
        <div aria-live="polite" className="space-y-3">
          {loading && <p className="flex items-center gap-2 text-sm text-slate-300"><Loader2 className="animate-spin" size={16} />{t('讀取住宅成交資料')}</p>}
          {error && <div className="text-sm text-slate-300">{error}<button type="button" className="ml-2 underline min-h-11" onClick={() => { setRetry(r => r + 1); }}>{t('重試')}</button></div>}
          {data?.status === 'not_imported' && <p className="text-sm text-slate-300">{t('此縣市住宅資料尚未匯入，尚無法提供成交行情。')}</p>}
          {data?.status === 'available' && <>
            <div className="grid grid-cols-2 gap-2" data-testid="housing-stats">
              <div className="rounded-xl bg-black/20 p-3"><div className="text-sm text-slate-300">{t('平均成交總價')}</div><strong className="text-lg tabular-nums">{formatNumber(data.stats.averageTotalTwd == null ? null : data.stats.averageTotalTwd / 10000)} {t('萬')}</strong></div>
              <div className="rounded-xl bg-black/20 p-3"><div className="text-sm text-slate-300">{t('平均成交單價')}</div><strong className="text-lg tabular-nums">{formatNumber(data.stats.averageUnitTwdPing == null ? null : data.stats.averageUnitTwdPing / 10000)} {t('萬／坪')}</strong></div>
            </div>
            <p className="text-sm text-slate-300">{t('符合條件')} {data.stats.count} {t('筆')} · {t('單價樣本')} {data.stats.unitSampleCount} {t('筆')} · {t('總價中位數')} {formatNumber(data.stats.medianTotalTwd == null ? null : data.stats.medianTotalTwd / 10000)} {t('萬')}</p>
            {data.latest && <p className="text-sm">{t('最近符合篩選成交')} · {data.latest.tradedOn} · {formatNumber(data.latest.totalTwd / 10000)} {t('萬')}</p>}
            {!data.stats.count && <p className="text-sm text-slate-300">{t('已匯入資料中沒有符合條件的住宅成交；不代表街道沒有交易。')}</p>}
            <div className="divide-y divide-white/10">{data.records.map(record => <article key={record.id} className="py-3 space-y-1 text-sm">
              <div className="flex justify-between gap-2"><span className="break-all">{record.address}</span><strong className="shrink-0 tabular-nums">{formatNumber(record.totalTwd / 10000)} {t('萬')}</strong></div>
              <p className="text-slate-300">{record.tradedOn} · {t(record.buildingType)} · {formatNumber(record.areaPing)} {t('坪')}{!record.parkingSeparated ? t('（含車位）') : ''} · {record.rooms == null ? '—' : record.rooms} {t('房')}</p>
              <p className="text-slate-300">{t('成交時屋齡')} {formatNumber(record.ageYears)} {t('年')} · {record.floor ?? '—'}/{record.floors ?? '—'} {t('樓')} · {formatNumber(record.unitTwdPing == null ? null : record.unitTwdPing / 10000)} {t('萬／坪')}</p>
              {record.special && <p className="text-amber-200">{t('特殊交易')} · {record.notes}</p>}
            </article>)}</div>
            {(page > 0 || data.hasMore) && <div className="flex justify-between"><button type="button" disabled={!page} onClick={() => setPage(p => p - 1)} className="min-h-11 text-sm disabled:opacity-40">{t('上一頁')}</button><button type="button" disabled={!data.hasMore} onClick={() => setPage(p => p + 1)} className="min-h-11 text-sm disabled:opacity-40">{t('下一頁')}</button></div>}
            <p className="text-sm text-slate-300">{t('縣市已匯入交易日期')} {data.coverage.oldestTransaction || '—'} — {data.coverage.newestTransaction || '—'}<br />{t('資料擷取日期')} {data.coverage.importedAt?.slice(0, 10) || '—'}</p>
          </>}
        </div>
        <p className="text-sm text-slate-300">{t('以整條道路及段別比對，非 CLS 的 250 公尺路段。總價含車位；單價僅採可拆車位資料。坪數含公設；屋齡為成交時。')}</p>
        <p className="text-sm text-slate-300">{t('在售房源尚未接入；以下開啟外部網站，需在原站設定住宅及價格條件。')}</p>
        <div className="flex flex-wrap gap-2">{[['樂居', 'https://www.leju.com.tw/'], ['591', 'https://sale.591.com.tw/'], ['樂屋', 'https://www.rakuya.com.tw/']].map(([name, url]) => <a key={name} href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 rounded-lg border border-white/15 px-3 min-h-11 text-sm">{name}<ExternalLink size={14} /></a>)}</div>
        <a href="https://data.gov.tw/dataset/25119" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 min-h-11 text-sm text-slate-300">{t('來源：內政部實價登錄開放資料')}<ExternalLink size={14} /></a>
      </>}
    </div>}
  </section>;
}
