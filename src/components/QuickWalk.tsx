import { useEffect, useRef, useState } from 'react';
import { Camera, Check, Copy, Footprints, Heart, Loader2, LocateFixed, Smartphone, ThumbsDown, X } from 'lucide-react';
import type { LocationCoord, SavedLocation } from '../types';
import { deleteEvidencePhoto, prepareEvidencePhoto, storeEvidencePhoto } from '../utils/evidenceStore';
import { canRecordWalk, createWalkMoment, distanceMeters, usableFix, walkShortcutUrl, type WalkFeeling, type WalkFix } from '../utils/walkMoments';

interface Props {
  source: 'walk' | 'shortcut';
  onPreview: (coords: LocationCoord) => void;
  onSave: (saved: SavedLocation, favorite: boolean) => void;
  onClose: () => void;
}

export function QuickWalk({ source, onPreview, onSave, onClose }: Props) {
  const [fix, setFix] = useState<WalkFix | null>(null);
  const [anchor, setAnchor] = useState<WalkFix | null>(null);
  const [confirmed, setConfirmed] = useState<WalkFix | null>(null);
  const [confirmedAt, setConfirmedAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [locateAttempt, setLocateAttempt] = useState(0);
  const [gpsError, setGpsError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [showShortcut, setShowShortcut] = useState(false);
  const [address, setAddress] = useState({ streetName: '', district: '', city: '' });
  const photoInput = useRef<HTMLInputElement>(null);
  const pendingPhoto = useRef<SavedLocation | null>(null);
  const lock = useRef(false);
  const lastSavedAt = useRef(0);
  const preview = useRef(onPreview); preview.current = onPreview;

  useEffect(() => {
    if (!navigator.geolocation) { setGpsError('此瀏覽器不支援定位。'); return; }
    let stopped = false;
    setGpsError('');
    const watch = navigator.geolocation.watchPosition(position => {
      if (stopped) return;
      const next = { lat: position.coords.latitude, lng: position.coords.longitude,
        accuracy: position.coords.accuracy, timestamp: position.timestamp };
      setFix(next); setGpsError('');
      if (usableFix(next)) preview.current(next);
    }, failure => {
      if (stopped) return;
      setFix(null); setConfirmed(null);
      setGpsError(failure.code === 1 ? '請在瀏覽器設定允許位置存取，再重試。' : '暫時無法定位，請移到戶外後重試。');
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 });
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const resume = () => { if (document.hidden) setConfirmed(null); else setNow(Date.now()); };
    document.addEventListener('visibilitychange', resume);
    return () => { stopped = true; navigator.geolocation.clearWatch(watch); window.clearInterval(clock); document.removeEventListener('visibilitychange', resume); };
  }, [locateAttempt]);

  useEffect(() => {
    if (usableFix(fix) && (!anchor || distanceMeters(fix, anchor) > 35)) {
      setAnchor(fix); setConfirmed(null);
    }
  }, [fix, anchor]);

  useEffect(() => {
    if (!anchor) return;
    const controller = new AbortController();
    setAddress({ streetName: `步行位置 (${anchor.lat.toFixed(5)}, ${anchor.lng.toFixed(5)})`, district: '', city: '' });
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    void fetch(`/api/reverse-geocode?lat=${anchor.lat}&lon=${anchor.lng}`, { signal: controller.signal })
      .then(async response => response.ok ? response.json() : null).then(data => {
        if (controller.signal.aborted || !data?.address) return;
        const a = data.address;
        if (a.road || a.pedestrian) setAddress({ streetName: a.road || a.pedestrian,
          district: a.district || a.suburb || a.town || '', city: a.city || a.county || '' });
      }).catch(() => {}).finally(() => window.clearTimeout(timeout));
    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [anchor]);

  const ready = canRecordWalk(fix, confirmed, now) && !gpsError;
  const fresh = usableFix(fix, now) && !gpsError;
  const locationName = address.streetName || '正在確認位置…';
  const shortcutUrl = walkShortcutUrl(window.location.href);

  function makeRecord(feeling: WalkFeeling) {
    if (gpsError || !fix || !address.streetName) throw new Error('請先確認目前位置。');
    return createWalkMoment(fix, confirmed, confirmedAt, feeling, address, source);
  }

  function saveFeeling(feeling: 'good' | 'bad') {
    if (lock.current || Date.now() - lastSavedAt.current < 1000) return;
    lock.current = true; setError('');
    try {
      onSave(makeRecord(feeling), feeling === 'good');
      lastSavedAt.current = Date.now();
      setNotice(feeling === 'good' ? '已記下喜歡，並加入最愛。' : '已記下不喜歡。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '尚未儲存，請重試。'); }
    finally { lock.current = false; }
  }

  function openCamera() {
    if (lock.current) return;
    setError('');
    try {
      // Freeze the confirmed location when opening the camera, not after returning.
      pendingPhoto.current = makeRecord('photo');
      photoInput.current?.click();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '請重新確認位置。'); }
  }

  async function savePhoto(file?: File) {
    const record = pendingPhoto.current; pendingPhoto.current = null;
    if (!file || !record || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    const storageKey = 'walk_' + crypto.randomUUID();
    try {
      const photo = await prepareEvidencePhoto(file, { maxDimension: 1280, quality: 0.72, alwaysCompress: true });
      if (photo.blob.size > 2 * 1024 * 1024) throw new Error('照片超過 2 MB，請選擇較小的照片或重新拍攝。');
      await storeEvidencePhoto(storageKey, photo.blob);
      onSave({ ...record, evidence: [{ id: storageKey, storageKey, type: 'photo', capturedAt: record.timestamp,
        location: record.coords, mimeType: photo.mimeType, width: photo.width, height: photo.height }] }, false);
      setNotice('照片與拍照起始位置已儲存。');
    } catch (cause) {
      await deleteEvidencePhoto(storageKey).catch(() => {});
      setError(cause instanceof Error ? cause.message : '照片未儲存，請重試。');
    } finally { lock.current = false; setBusy(false); }
  }

  return (
    <section aria-label="步行感受" className="absolute z-[650] bottom-3 left-3 right-3 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-[420px] max-h-[85dvh] overflow-y-auto rounded-[28px] border border-white/15 bg-[#111113]/95 backdrop-blur-2xl shadow-2xl text-white p-5 pb-[max(20px,env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between gap-3 mb-4">
        <h1 className="flex items-center gap-2 text-lg font-bold"><Footprints className="w-5 h-5 text-sky-300" />步行感受</h1>
        <button type="button" onClick={onClose} disabled={busy} title="結束步行" aria-label="結束步行" className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center disabled:opacity-40"><X className="w-5 h-5" /></button>
      </header>

      <div className="rounded-2xl bg-white/5 border border-white/10 p-3 mb-4">
        <div className="font-semibold text-base break-words">{locationName}</div>
        <div className="mt-1 text-sm text-slate-400">{address.district} {address.city}</div>
        <div className="mt-2 text-sm text-slate-300 flex gap-2 items-center">
          {ready ? <Check className="w-4 h-4 text-emerald-300 shrink-0" /> : <LocateFixed className="w-4 h-4 text-sky-300 shrink-0" />}
          {gpsError || (fix ? `定位誤差 ±${Math.round(fix.accuracy)} m${fresh ? (ready ? ' · 已確認' : ' · 請確認地圖位置') : ' · 等待更新定位'}` : '正在取得 GPS 位置…')}
        </div>
        {fix && <div className="mt-1 text-xs text-slate-500 tabular-nums">{fix.lat.toFixed(5)}, {fix.lng.toFixed(5)}</div>}
        {!ready && <div className="mt-3 flex gap-2">
          <button type="button" disabled={!fresh || !address.streetName} onClick={() => { setConfirmed(fix); setConfirmedAt(Date.now()); setError(''); }} className="min-h-11 flex-1 rounded-xl bg-sky-500 font-semibold text-sm disabled:opacity-40">位置正確，開始</button>
          <button type="button" onClick={() => { setFix(null); setConfirmed(null); setLocateAttempt(value => value + 1); }} title="重新定位" aria-label="重新定位" className="w-11 h-11 flex items-center justify-center rounded-xl bg-white/10"><LocateFixed className="w-5 h-5" /></button>
        </div>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button type="button" disabled={!ready || busy} onClick={() => saveFeeling('good')} className="min-h-24 rounded-2xl border border-emerald-300/30 bg-emerald-400/15 text-emerald-100 flex flex-col items-center justify-center gap-2 font-semibold text-base active:scale-[0.98] disabled:opacity-35" title="記下喜歡並加入最愛"><Heart className="w-7 h-7" />喜歡這裡</button>
        <button type="button" disabled={!ready || busy} onClick={() => saveFeeling('bad')} className="min-h-24 rounded-2xl border border-rose-300/25 bg-rose-400/10 text-rose-100 flex flex-col items-center justify-center gap-2 font-semibold text-base active:scale-[0.98] disabled:opacity-35" title="記下不喜歡"><ThumbsDown className="w-7 h-7" />不喜歡</button>
      </div>
      <button type="button" disabled={!ready || busy} onClick={openCamera} className="w-full min-h-12 mt-3 rounded-xl bg-white/10 flex items-center justify-center gap-2 text-sm font-semibold disabled:opacity-35" title="拍照留存">
        {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}{busy ? '儲存照片中…' : '拍照留存'}
      </button>
      <input ref={photoInput} aria-label="步行照片" className="hidden" type="file" accept="image/*" capture="environment" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void savePhoto(file); }} />
      <p className="text-sm text-slate-400 mt-3">喜歡會加入最愛；感受與 CLS 分開顯示。</p>
      {notice && <p role="status" className="mt-3 rounded-xl bg-emerald-400/10 p-3 text-sm text-emerald-200">{notice}</p>}
      {error && <p role="alert" className="mt-3 rounded-xl bg-rose-400/10 p-3 text-sm text-rose-200">{error}</p>}

      <button type="button" onClick={() => setShowShortcut(value => !value)} aria-expanded={showShortcut} className="mt-3 min-h-11 flex items-center gap-2 text-sm text-sky-300"><Smartphone className="w-4 h-4" />iPhone 快捷入口</button>
      {showShortcut && <div className="text-sm text-slate-300 space-y-3 rounded-xl bg-white/5 p-3">
        <p>在「捷徑」新增「打開 URL」，貼上下方網址，再將捷徑指定給動作按鈕或「輔助使用 → 觸控 → 背面輕點」。</p>
        <div className="flex gap-2"><input readOnly aria-label="步行模式網址" value={shortcutUrl} onFocus={event => event.target.select()} className="w-full min-w-0 bg-black/20 rounded-lg px-2 py-2 text-xs select-text" /><button type="button" title="複製網址" aria-label="複製網址" onClick={() => { void navigator.clipboard?.writeText(shortcutUrl).then(() => setNotice('已複製步行模式網址。')).catch(() => setError('請選取並複製上方網址。')); }} className="w-11 shrink-0 rounded-lg bg-white/10 flex items-center justify-center"><Copy className="w-4 h-4" /></button></div>
        <p>開啟後確認位置，再點一下感受或拍照。相機需手動啟動。</p>
      </div>}
    </section>
  );
}
