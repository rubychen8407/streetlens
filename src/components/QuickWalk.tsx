import { t, bilingual, displayPlace, errorText } from '../i18n';
import { LanguageSwitch } from './LanguageSwitch';
import { useEffect, useRef, useState } from 'react';
import { Camera, Heart, Loader2, LocateFixed, ThumbsDown, X } from 'lucide-react';
import { usePanelFocus } from '../hooks/usePanelFocus';
import type { LocationCoord, SavedLocation } from '../types';
import { deleteEvidencePhoto, storeEvidencePhoto } from '../utils/evidenceStore';
import { createWalkMoment, distanceMeters, usableFix, type WalkFeeling, type WalkFix } from '../utils/walkMoments';
import { captureCameraFrame } from '../utils/cameraFrame';

interface Props {
  source: 'walk' | 'shortcut';
  onOpenDetailed: (location: LocationCoord) => void;
  onPreview: (coords: LocationCoord) => void;
  onSave: (saved: SavedLocation, favorite: boolean) => void;
  onClose: () => void;
}

export function QuickWalk({ onOpenDetailed, source, onPreview, onSave, onClose }: Props) {
  const [fix, setFix] = useState<WalkFix | null>(null);
  const [anchor, setAnchor] = useState<WalkFix | null>(null);
  const [now, setNow] = useState(Date.now());
  const [locateAttempt, setLocateAttempt] = useState(0);
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const [gpsError, setGpsError] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState({ streetName: '', district: '', city: '' });
  const addressAnchor = useRef<WalkFix | null>(null);
  const panelRef = usePanelFocus(true, onClose, !busy);
  const videoRef = useRef<HTMLVideoElement>(null);
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
      setFix(next); setNow(Date.now()); setGpsError('');
      if (usableFix(next)) preview.current(next);
    }, failure => {
      if (stopped) return;
      setFix(null);
      setGpsError(failure.code === 1 ? '請允許位置存取，再重試定位。' : '暫時無法定位，請移到戶外後重試。');
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 });
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { stopped = true; navigator.geolocation.clearWatch(watch); window.clearInterval(clock); };
  }, [locateAttempt]);

  useEffect(() => {
    let disposed = false, generation = 0;
    let stream: MediaStream | null = null;
    const stop = () => {
      generation++;
      stream?.getTracks().forEach(track => track.stop()); stream = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      if (!disposed) setCameraReady(false);
    };
    const start = async () => {
      stop();
      if (disposed || document.hidden) return;
      const request = generation;
      setCameraError('');
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
        const next = await navigator.mediaDevices.getUserMedia({ audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
        if (disposed || document.hidden || request !== generation) { next.getTracks().forEach(track => track.stop()); return; }
        stream = next;
        next.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
          if (disposed || request !== generation) return;
          setCameraReady(false); setCameraError('相機已中斷，請重新開啟。');
        }));
        const video = videoRef.current;
        if (!video) { stop(); return; }
        video.srcObject = next;
        await video.play();
      } catch (cause) {
        if (disposed || request !== generation) return;
        stop();
        setCameraError(cause instanceof DOMException && cause.name === 'NotAllowedError'
          ? '請允許相機存取，才能顯示實勘畫面。' : '目前無法開啟相機，請確認使用 HTTPS、相機可用且未被其他程式佔用。');
      }
    };
    const visibility = () => { if (document.hidden) stop(); else void start(); };
    document.addEventListener('visibilitychange', visibility);
    void start();
    return () => { disposed = true; stop(); document.removeEventListener('visibilitychange', visibility); };
  }, [cameraAttempt]);

  useEffect(() => {
    if (usableFix(fix) && (!anchor || distanceMeters(fix, anchor) > 35)) setAnchor(fix);
  }, [fix, anchor]);
  useEffect(() => {
    if (!anchor) return;
    const controller = new AbortController();
    addressAnchor.current = anchor;
    setAddress({ streetName: `實勘位置 (${anchor.lat.toFixed(5)}, ${anchor.lng.toFixed(5)})`, district: '', city: '' });
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

  const ready = usableFix(fix, now) && !gpsError;
  function makeRecord(feeling: WalkFeeling) {
    const capturedAt = Date.now();
    if (gpsError || !usableFix(fix, capturedAt)) throw new Error('正在等待有效定位，請稍後再試。');
    const matchedAddress = addressAnchor.current && distanceMeters(fix, addressAnchor.current) <= 35 && address.streetName ? address
      : { streetName: `實勘位置 (${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)})`, district: '', city: '' };
    return createWalkMoment(fix, fix, capturedAt, feeling, matchedAddress, source, capturedAt);
  }
  function saveFeeling(feeling: 'good' | 'bad') {
    if (lock.current || Date.now() - lastSavedAt.current < 1000) return;
    lock.current = true; setError('');
    try {
      onSave(makeRecord(feeling), feeling === 'good'); lastSavedAt.current = Date.now();
      setNotice(feeling === 'good' ? '已記下喜歡，並加入最愛。' : '已記下不喜歡。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '尚未儲存，請重試。'); }
    finally { lock.current = false; }
  }
  async function saveFrame() {
    if (lock.current || !cameraReady || cameraError) return;
    lock.current = true; setBusy(true); setError('');
    const storageKey = 'walk_' + crypto.randomUUID();
    try {
      const record = makeRecord('photo');
      if (!videoRef.current) throw new Error('相機尚未就緒。');
      // Freeze the visible frame and GPS at the tap, before async storage.
      const photo = await captureCameraFrame(videoRef.current);
      await storeEvidencePhoto(storageKey, photo.blob);
      onSave({ ...record, evidence: [{ id: storageKey, storageKey, type: 'photo', capturedAt: record.timestamp,
        location: record.coords, mimeType: 'image/jpeg', width: photo.width, height: photo.height,
        note: '實勘相機畫面' }] }, false);
      setNotice('目前畫面與位置已儲存。');
    } catch (cause) {
      await deleteEvidencePhoto(storageKey).catch(() => {});
      setError(cause instanceof Error ? cause.message : '畫面未儲存，請重試。');
    } finally { lock.current = false; setBusy(false); }
  }
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || target?.closest('input, textarea, select, [contenteditable="true"]') || !ready || busy) return;
      if (event.key === '1') { event.preventDefault(); saveFeeling('good'); }
      if (event.key === '2') { event.preventDefault(); saveFeeling('bad'); }
      if (event.key.toLowerCase() === 'c') { event.preventDefault(); void saveFrame(); }
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  });

  return <section ref={panelRef} data-ready={ready} aria-label={t("步行感受")} className="walk-panel fixed inset-0 z-[650] bg-[#0E131A] text-white overflow-hidden">
    <video ref={videoRef} aria-label={t("後鏡頭即時畫面")} autoPlay muted playsInline className="absolute inset-0 w-full h-full object-cover"
      onPlaying={() => setCameraReady(true)} onWaiting={() => setCameraReady(false)} />
    {!cameraReady && <div className="absolute inset-0 flex items-center justify-center px-8 pb-32">
      <div className="text-center max-w-sm">{cameraError ? <><Camera className="mx-auto mb-3 w-8 h-8 text-slate-400" /><p role="alert" className="text-sm leading-relaxed">{t(cameraError)}</p><button type="button" onClick={() => setCameraAttempt(value => value + 1)} className="mt-4 min-h-11 px-5 rounded-xl border border-white/15 bg-white/10">{t("重新開啟相機")}</button></> : <><Loader2 className="mx-auto mb-3 animate-spin" /><p className="text-sm">{t("正在開啟後鏡頭…")}</p></>}</div>
    </div>}
    <header className="absolute top-0 left-0 right-0 p-4 pt-[max(16px,env(safe-area-inset-top))] bg-gradient-to-b from-black/60 to-transparent flex items-start justify-between gap-3">
      <div className="min-w-0 rounded-2xl border border-white/10 bg-[#141A23]/40 backdrop-blur-md p-3">
        <h1 className="text-xs text-slate-300">{t("實勘模式")}</h1><p className="text-sm font-semibold mt-1 truncate">{displayPlace(address.streetName) || t("正在定位…")}</p>
        <p className="text-[11px] text-slate-300 mt-1">{gpsError ? t(gpsError) : (fix ? `${bilingual('定位誤差', 'GPS accuracy')} ±${Math.round(fix.accuracy)} m${ready ? '' : t(" · 等待有效定位")}` : t("正在取得 GPS 位置…"))}</p>
        {!ready && <button type="button" onClick={() => { setFix(null); setLocateAttempt(value => value + 1); }} className="min-h-11 mt-1 flex items-center gap-2 text-xs"><LocateFixed size={16} />{t("重新定位")}</button>}
      </div>
      <div className="flex items-center gap-2"><LanguageSwitch /><button type="button" onClick={onClose} disabled={busy} title={t("結束步行")} aria-label={t("結束步行")} className="w-11 h-11 shrink-0 rounded-full border border-white/10 bg-[#141A23]/50 backdrop-blur-md grid place-items-center disabled:opacity-40"><X size={22} /></button></div>
    </header>
    <footer className="absolute bottom-0 left-0 right-0 px-3 pt-10 pb-[max(12px,env(safe-area-inset-bottom))] bg-gradient-to-t from-black/70 to-transparent">
      <div className="max-w-lg mx-auto">
        {notice && <p role="status" className="mb-3 rounded-xl border border-white/10 bg-[#141A23]/60 backdrop-blur-md p-3 text-center text-sm">{t(notice)}</p>}
        {error && <p role="alert" className="mb-3 rounded-xl bg-rose-950/80 backdrop-blur-md p-3 text-sm">{errorText(error, '尚未儲存，請重試。')}</p>}
        <div className="grid grid-cols-3 gap-2 rounded-[20px] border border-white/15 bg-[#141A23]/45 backdrop-blur-xl p-2 shadow-2xl">
          <button type="button" disabled={!ready || busy} onClick={() => saveFeeling('good')} aria-keyshortcuts="1" title={t("喜歡並自動儲存（1）")} className="min-h-16 rounded-2xl flex flex-col items-center justify-center gap-1 text-sm disabled:opacity-35 hover:bg-white/10"><Heart size={23} />{t("喜歡這裡")}</button>
          <button type="button" disabled={!ready || busy} onClick={() => saveFeeling('bad')} aria-keyshortcuts="2" title={t("不喜歡並自動儲存（2）")} className="min-h-16 rounded-2xl flex flex-col items-center justify-center gap-1 text-sm disabled:opacity-35 hover:bg-white/10"><ThumbsDown size={23} />{t("不喜歡")}</button>
          <button type="button" disabled={!ready || !cameraReady || !!cameraError || busy} onClick={() => void saveFrame()} aria-keyshortcuts="C" title={t("擷取目前畫面並自動儲存（C）")} className="min-h-16 rounded-2xl hud-primary flex flex-col items-center justify-center gap-1 text-sm font-semibold disabled:opacity-35">{busy ? <Loader2 size={23} className="animate-spin" /> : <Camera size={23} />}{busy ? t("儲存中…") : t("拍下畫面")}</button>
        </div>
        <button type="button" disabled={!ready || busy} onClick={() => { if (ready && fix) onOpenDetailed(fix); }} className="block min-h-11 mx-auto text-xs text-white/70 disabled:opacity-35">{t("詳細環境觀察")}</button>
      </div>
    </footer>
  </section>;
}
