import { t, displayPlace } from '../i18n';
import { DockButton } from './DockButton';
import { ProfileSettings } from './ProfileSettings';
import { useTheme, setTheme } from '../utils/theme';
import { useState, useRef, useEffect, useMemo } from 'react';
import {
  Search,
  Footprints,
  X,
  MapPin,
  Loader2,
  Check,
  ClipboardList,
  NotebookPen,
  Library,
  ChevronRight,
  Key,
  ShieldCheck,
  AlertCircle,
  LocateFixed,
  Copy,
  ExternalLink,
  Database,
  UserRound,
  Layers,
  Sun,
  Moon,
  BarChart3,
  Star,
  Settings,
  Store,
  Train,
  Trees,
  Users,
  Activity,
} from 'lucide-react';
import { LocationCoord } from '../types';
import { PRESET_EXPLORATION_LOCATIONS } from '../data/indicators';
import { CARTO_STORAGE_KEY, getActiveCartoKey } from './ScoutMap';

interface FloatingControlsProps {
  activeDock: 'walk' | 'report' | 'field' | 'settings' | null;
  currentStreetName: string;
  district: string;
  city: string;
  isLoadingScore: boolean;
  scoreStatus: string;
  onRetryScore: () => void;
  clsScore: number | null;
  isLocatingGPS: boolean;
  onLocateMe: () => void;
  onSelectCoordinate: (coord: LocationCoord, streetName: string, district?: string, city?: string) => void;
  onOpenReport: () => void;
  onOpenField: () => void;
  onOpenWalk: () => void;
  isSheetOpen: boolean;
  onOpenSaved: () => void;
  onOpenSettings: () => void;
  currentLocation: LocationCoord;
  targetLocation: LocationCoord;
  accuracyRadius?: number;
  activeLayers?: {
    c1Safety: boolean;
    c2Amenity: boolean;
    c3Transit: boolean;
    c4Green: boolean;
    c5Vitality: boolean;
    streetScores: boolean;
    walkingRadius: boolean;
  };
  onToggleLayer?: (layerKey: any) => void;
}

// Helper to parse coordinate string (e.g. "25.033, 121.564" or "25.033 121.564")
function parseCoordinateInput(text: string): LocationCoord | null {
  if (!text) return null;
  const clean = text.replace(/[^\d.,\s+-]/g, ' ').trim();
  const parts = clean.split(/[,\s]+/).map((p) => parseFloat(p)).filter((n) => !isNaN(n));
  if (parts.length >= 2) {
    let lat = parts[0];
    let lng = parts[1];
    // If entered in reverse (lng, lat) e.g. Taiwan lng ~ 121, lat ~ 25
    if (lat > 90 && lng <= 90) {
      lat = parts[1];
      lng = parts[0];
    }
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { lat, lng };
    }
  }
  return null;
}

export function FloatingControls({
  activeDock,
  currentStreetName,
  district,
  city,
  clsScore,
  isLoadingScore, scoreStatus, onRetryScore,
  isLocatingGPS,
  onLocateMe,
  onSelectCoordinate,
  onOpenReport,
  onOpenField, onOpenWalk,
  isSheetOpen,
  currentLocation,
  targetLocation,
  accuracyRadius,
  onOpenSaved,
  onOpenSettings,
  activeLayers,
  onToggleLayer,
}: FloatingControlsProps) {
  const theme = useTheme();
  const [profileOpen, setProfileOpen] = useState(false);
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const layerButtonRef = useRef<HTMLDivElement>(null);
  const [statusDismissed, setStatusDismissed] = useState(false);

  useEffect(() => {
    setStatusDismissed(false);
    const timer = window.setTimeout(() => setStatusDismissed(true), 6000);
    return () => window.clearTimeout(timer);
  }, [targetLocation.lat, targetLocation.lng]);

  // Click outside to close layer popover
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (layerButtonRef.current && !layerButtonRef.current.contains(e.target as Node)) {
        setShowLayerMenu(false);
      }
    };
    if (showLayerMenu) {
      document.addEventListener('pointerdown', handleOutside);
      return () => document.removeEventListener('pointerdown', handleOutside);
    }
  }, [showLayerMenu]);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [showCoordModal, setShowCoordModal] = useState(false);

  // Custom coordinate input in modal
  const [customLat, setCustomLat] = useState(currentLocation.lat.toFixed(6));
  const [customLng, setCustomLng] = useState(currentLocation.lng.toFixed(6));
  const [copyFeedback, setCopyFeedback] = useState(false);

  // Key Manager state
  const [currentKey, setCurrentKey] = useState('');
  const [inputKey, setInputKey] = useState('');
  const [keyTesting, setKeyTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; msg: string } | null>(null);

  // Check if search query matches coordinates
  const matchedCoord = useMemo(() => {
    return parseCoordinateInput(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    const key = getActiveCartoKey();
    setCurrentKey(key);
    setInputKey(key);
  }, [showKeyModal]);

  const testAndSaveCartoKey = async (keyToTest: string) => {
    const trimmed = keyToTest.trim();
    if (!trimmed) {
      localStorage.removeItem(CARTO_STORAGE_KEY);
      setCurrentKey('');
      setTestResult({ success: true, msg: '已清除自訂金鑰，系統將改用免金鑰 OSM Apple Maps 風格底圖' });
      window.dispatchEvent(new Event('carto_key_updated'));
      return;
    }

    setKeyTesting(true);
    setTestResult(null);

    // Test a sample tile URL from CARTO Dark Matter with ?key= param
    const testUrl = `https://a.basemaps.cartocdn.com/dark_all/12/3432/1792.png?key=${encodeURIComponent(trimmed)}`;

    // Test image load via Image object
    const img = new Image();
    img.onload = () => {
      setKeyTesting(false);
      localStorage.setItem(CARTO_STORAGE_KEY, trimmed);
      setCurrentKey(trimmed);
      setTestResult({ success: true, msg: '驗證成功！CARTO 金鑰有效，深色夜間底圖已立即套用！' });
      window.dispatchEvent(new Event('carto_key_updated'));
    };
    img.onerror = () => {
      setKeyTesting(false);
      setTestResult({
        success: false,
        msg: 'CARTO 伺服器拒絕載入此圖磚（金鑰格式有誤、已失效或非 basemaps 權限金鑰）。系統已自動保護並切換至免金鑰高清底圖，防止黑屏破圖。',
      });
    };
    img.src = testUrl;
  };

  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Close search/layers on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setIsSearchOpen(false);
      }

    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsSearchOpen(false);
      setShowKeyModal(false); setShowCoordModal(false);
    };
    document.addEventListener('keydown', dismiss);
    return () => document.removeEventListener('keydown', dismiss);
  }, []);

  // Debounced search
  useEffect(() => {
    if (!searchQuery || searchQuery.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setIsSearching(true);
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(searchQuery.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setSuggestions(Array.isArray(data) ? data : []);
          setIsSearchOpen(true);
        }
      } catch (err) {
        console.error('Search failed', err);
      } finally {
        setIsSearching(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSelectSuggestion = (item: any) => {
    const lat = parseFloat(item.lat);
    const lng = parseFloat(item.lon);
    const name = item.name || item.display_name.split(',')[0];
    const c = item.address?.city || item.address?.county || '';
    const dist =
      item.address?.suburb ||
      item.address?.town ||
      item.address?.city_district ||
      '';

    onSelectCoordinate({ lat, lng }, name, dist, c);
    setSearchQuery('');
    setIsSearchOpen(false);
  };

  const handleSelectPreset = (preset: (typeof PRESET_EXPLORATION_LOCATIONS)[0]) => {
    onSelectCoordinate(
      { lat: preset.lat, lng: preset.lng },
      preset.name.split('（')[0],
      preset.district,
      preset.city
    );
    setSearchQuery('');
    setIsSearchOpen(false);
  };

  return (
    <div data-panel-open={isSheetOpen} className="tactical-controls pointer-events-none absolute inset-0 z-[500] flex flex-col justify-between p-3 sm:p-4 select-none">
      <nav className="tactical-dock hud-card" aria-label={t("地點功能")}>
        <DockButton
          label={t('個人設定')}
          active={profileOpen}
          expanded={profileOpen}
          onClick={() => setProfileOpen(true)}
        >
          <UserRound size={21} />
        </DockButton>

        <DockButton
          label={t('實勘')}
          active={!profileOpen && activeDock === 'walk'}
          onClick={onOpenWalk}
        >
          <Footprints size={21} />
        </DockButton>

        <DockButton
          label={t('CLS 結果報告')}
          active={!profileOpen && activeDock === 'report'}
          onClick={onOpenReport}
        >
          <BarChart3 size={21} />
        </DockButton>

        <div className="dock-divider" />

        <DockButton
          label={t('環境觀察')}
          active={!profileOpen && activeDock === 'field'}
          onClick={onOpenField}
        >
          <NotebookPen size={21} />
        </DockButton>

        <DockButton
          label={t('資料狀態')}
          active={!profileOpen && activeDock === 'settings'}
          onClick={onOpenSettings}
        >
          <Database size={21} />
        </DockButton>
      </nav>
      <ProfileSettings open={profileOpen} onClose={() => setProfileOpen(false)} />
      {/* LOCATION SELECTOR */}
      <div className="search-toolbar pointer-events-auto">
        <div className="location-selector w-full max-w-3xl flex items-center gap-2">
          <div className="relative flex-1 min-w-0" ref={searchContainerRef}>
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none">
              {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
            </div>
            <input
              type="text"
              value={searchQuery || displayPlace(currentStreetName)}
              onChange={event => { setSearchQuery(event.target.value); setIsSearchOpen(true); }}
              onFocus={() => setIsSearchOpen(true)}
              placeholder={t("搜尋地點或輸入座標")}
              className="w-full h-12 pl-11 pr-10 bg-[#1A212B]/92 backdrop-blur-md border border-white/[0.08] rounded-2xl text-sm sm:text-sm font-medium text-white placeholder:text-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-400 shadow-2xl transition-all"
              aria-label={t("搜尋地點")}
            />
            {searchQuery && <button type="button" onClick={() => { setSearchQuery(''); setSuggestions([]); }} className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 rounded-full text-slate-300 hover:text-white" aria-label={t("清除搜尋")} title={t("清除")}><X className="w-4 h-4" /></button>}
            {isSearchOpen && <div className="search-results absolute top-full left-0 right-0 mt-2 bg-[#1A212B]/98 backdrop-blur-md border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden max-h-72 overflow-y-auto drawer-scrollbar">
              {suggestions.length > 0 ? <div className="p-1">{suggestions.map((item, index) => <button key={index} type="button" onClick={() => handleSelectSuggestion(item)} className="w-full px-3 py-2.5 text-left text-sm hover:bg-white/10 rounded-2xl flex items-start gap-2.5 text-slate-200 transition-colors"><MapPin className="w-4 h-4 text-slate-300 mt-0.5 flex-shrink-0" /><div className="min-w-0"><div className="font-bold text-white truncate">{item.name || item.display_name.split(',')[0]}</div><div className="text-sm text-slate-300 truncate">{item.display_name}</div></div></button>)}</div> : <div className="p-4 text-center text-sm text-slate-300">{t("輸入地址、街道名稱或經緯度")}</div>}
              {matchedCoord && <button type="button" onClick={() => { onSelectCoordinate(matchedCoord, `${matchedCoord.lat.toFixed(5)}, ${matchedCoord.lng.toFixed(5)}`); setSearchQuery(''); setIsSearchOpen(false); }} className="w-full px-3 py-2.5 border-t border-white/[0.08] text-left text-sm text-slate-300 hover:bg-white/10">{t("使用座標")} {matchedCoord.lat.toFixed(5)}, {matchedCoord.lng.toFixed(5)}</button>}
              {PRESET_EXPLORATION_LOCATIONS.filter(preset => searchQuery && preset.name.toLowerCase().includes(searchQuery.toLowerCase())).map(preset => <button key={preset.name} type="button" onClick={() => handleSelectPreset(preset)} className="w-full px-3 py-2.5 border-t border-white/[0.08] text-left text-sm text-slate-300 hover:bg-white/10">{preset.name}</button>)}
            </div>}
          </div>
          <button type="button" onClick={onLocateMe} disabled={isLocatingGPS} aria-label={t("定位到目前位置")} title={t("定位到目前位置")} className="location-action h-12 w-12 shrink-0 rounded-2xl bg-[#1A212B]/92 backdrop-blur-md border border-white/[0.08] text-slate-200 shadow-xl flex items-center justify-center disabled:opacity-50 hover:text-white transition-colors">
            {isLocatingGPS ? <Loader2 className="w-5 h-5 animate-spin" /> : <LocateFixed className="w-5 h-5" />}
          </button>
          <button type="button" onClick={onOpenSaved} aria-label={t("Street Library")} title={t("Street Library")} className="location-action h-12 w-12 shrink-0 rounded-2xl bg-[#1A212B]/70 backdrop-blur-md border border-white/[0.08] text-slate-200 shadow-xl flex items-center justify-center hover:text-white transition-colors">
            <Library className="w-5 h-5" />
          </button>
        </div>
      {clsScore == null && !isSheetOpen && !statusDismissed && (
        <section
          className="cls-read-status hud-card mt-2 flex items-center justify-between gap-3 p-3 rounded-2xl bg-[#1A212B]/95 backdrop-blur-md border border-white/[0.08] shadow-xl text-slate-200"
          aria-label={t("CLS 載入狀態")}
        >
          <div role="status" className="min-w-0 flex-1">
            <strong className="text-sm font-semibold text-white block">
              {isLoadingScore ? t("正在讀取 CLS…") : t("CLS 尚未就緒")}
            </strong>
            <p className="text-xs text-slate-300 truncate mt-0.5">
              {isLoadingScore ? t("正在查詢此地點的已儲存資料。") : t(scoreStatus)}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onRetryScore}
              disabled={isLoadingScore}
              aria-label={t("重試 CLS")}
              className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold text-white flex items-center gap-1.5 transition-all disabled:opacity-50"
            >
              {isLoadingScore ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("重試")}
            </button>
            <button
              type="button"
              aria-label={t("關閉 CLS 提示")}
              title={t("關閉")}
              onClick={() => setStatusDismissed(true)}
              className="p-1 rounded-lg text-slate-300 hover:text-white transition-colors"
            >
              <X size={15} />
            </button>
          </div>
        </section>
      )}
      </div>

      {/* CARTO Key Management & Test Modal */}
      {showKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm pointer-events-auto animate-in fade-in duration-200">
          <div className="relative w-full max-w-md bg-[#1A212B] border border-white/[0.08] rounded-2xl p-5 shadow-2xl space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-white/10 text-slate-300">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">{t("CARTO Basemaps 金鑰測試與設定")}</h3>
                  <p className="text-sm text-slate-300">{t("即時測試金鑰有效性並無縫切換底圖")}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowKeyModal(false)}
                className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-slate-300 flex items-center justify-center transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Input field */}
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-slate-300">{t("CARTO API Key")}</label>
              <input
                type="text"
                value={inputKey}
                onChange={(e) => {
                  setInputKey(e.target.value);
                  setTestResult(null);
                }}
                placeholder={t("貼上您的 CARTO API Key (例如：default_public 或自訂 Key)...")}
                className="w-full px-3.5 py-2.5 bg-black/40 border border-white/[0.08] rounded-xl text-sm font-mono text-white placeholder:text-slate-300 focus:outline-none focus:border-white/[0.08] focus:ring-1 focus:ring-indigo-500"
              />
              <p className="text-sm text-slate-300 leading-relaxed">
                 {t("說明：CARTO 官方規定自 2024 年底起請求 basemaps 圖磚時需附加")} <code className="text-slate-300 font-mono">?key=...</code>{t("。 若金鑰無效或權限未開通，本系統具備自動容錯保護，會自動切換至 Apple Maps 高清主題，絕不黑屏。")} </p>
            </div>

            {/* Test Result Message */}
            {testResult && (
              <div
                className={`p-3 rounded-xl border text-sm flex items-start gap-2.5 ${
                  testResult.success
                    ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                    : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                }`}
              >
                {testResult.success ? (
                  <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5 text-emerald-400" />
                ) : (
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-400" />
                )}
                <div className="leading-snug">{t(testResult.msg)}</div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                disabled={keyTesting}
                onClick={() => testAndSaveCartoKey(inputKey)}
                className="flex-1 py-2.5 rounded-xl bg-white/10 hover:bg-white/10 text-white font-semibold text-sm flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-50"
              >
                {keyTesting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>{t("即時連線測試中...")}</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>{t("測試並儲存套用")}</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setInputKey('');
                  testAndSaveCartoKey('');
                }}
                className="py-2.5 px-3 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 font-medium text-sm transition-colors"
                title={t("清除並切換回免金鑰高清地圖")}
              >
                 {t("使用免金鑰底圖")} </button>
            </div>
          </div>
        </div>
      )}

      {/* GPS Coordinates & Position Telemetry Modal */}
      {showCoordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm pointer-events-auto animate-in fade-in duration-200">
          <div className="relative w-full max-w-md bg-[#1A212B] border border-white/[0.08] rounded-2xl p-5 shadow-2xl space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-white/10 text-slate-300">
                  <LocateFixed className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">{t("GPS 經緯度座標與定位工具")}</h3>
                  <p className="text-sm text-slate-300">{t("即時監控所在座標，支援直接輸入經緯度跳轉")}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCoordModal(false)}
                className="p-1.5 rounded-full hover:bg-white/10 text-slate-300 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Current GPS Telemetry Block */}
            <div className="p-3.5 rounded-2xl bg-sky-950/20 border border-white/[0.08] space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white/10 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white/10"></span>
                  </span>
                  <span className="text-sm font-bold text-white">{t("目前裝置 GPS 經緯度")}</span>
                </div>
                <span className="text-sm px-2 py-0.5 rounded-full bg-white/10 text-slate-300 font-mono">
                   {t("誤差 ±")}{accuracyRadius ? Math.round(accuracyRadius) : 15}m
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm font-mono">
                <div className="p-2 rounded-xl bg-black/40 border border-white/[0.08]">
                  <div className="text-sm text-slate-300 font-sans">{t("緯度 (Latitude)")}</div>
                  <div className="text-sm font-bold text-slate-300">{currentLocation.lat.toFixed(6)}°</div>
                </div>
                <div className="p-2 rounded-xl bg-black/40 border border-white/[0.08]">
                  <div className="text-sm text-slate-300 font-sans">{t("經度 (Longitude)")}</div>
                  <div className="text-sm font-bold text-slate-300">{currentLocation.lng.toFixed(6)}°</div>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(`${currentLocation.lat.toFixed(6)}, ${currentLocation.lng.toFixed(6)}`);
                    setCopyFeedback(true);
                    setTimeout(() => setCopyFeedback(false), 2500);
                  }}
                  className="flex-1 py-1.5 px-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm font-medium flex items-center justify-center gap-1.5 transition-colors"
                >
                  {copyFeedback ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-300">{t("已複製座標")}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-300" />
                      <span>{t("複製經緯度")}</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onLocateMe();
                  }}
                  disabled={isLocatingGPS}
                  className="flex-1 py-1.5 px-2.5 rounded-xl bg-white/10 hover:bg-white/10 text-white text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  {isLocatingGPS ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>{t("定位中...")}</span>
                    </>
                  ) : (
                    <>
                      <LocateFixed className="w-3.5 h-3.5" />
                      <span>{t("重新偵測 GPS")}</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onSelectCoordinate(currentLocation, t("我的目前所在位置"));
                    setShowCoordModal(false);
                  }}
                  className="py-1.5 px-2.5 rounded-xl bg-rose-600/80 hover:bg-rose-500 text-white text-sm font-medium transition-colors"
                  title={t("將評估地點設在目前 GPS 位置")}
                >
                   {t("🎯 設為評估地點")} </button>
              </div>
            </div>

            {/* Direct Coordinate Input Jump */}
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-300">
                 {t("手動輸入自訂經緯度（坐標精確定位）")} </label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-sm text-slate-300 block mb-1">{t("緯度 (例如: 25.0339)")}</span>
                  <input
                    type="number"
                    step="0.000001"
                    value={customLat}
                    onChange={(e) => setCustomLat(e.target.value)}
                    className="w-full px-3 py-2 bg-black/40 border border-white/[0.08] rounded-xl text-sm font-mono text-white focus:outline-none focus:border-white/[0.08] focus:ring-1 focus:ring-sky-500"
                    placeholder="25.0339"
                  />
                </div>
                <div>
                  <span className="text-sm text-slate-300 block mb-1">{t("經度 (例如: 121.5645)")}</span>
                  <input
                    type="number"
                    step="0.000001"
                    value={customLng}
                    onChange={(e) => setCustomLng(e.target.value)}
                    className="w-full px-3 py-2 bg-black/40 border border-white/[0.08] rounded-xl text-sm font-mono text-white focus:outline-none focus:border-white/[0.08] focus:ring-1 focus:ring-sky-500"
                    placeholder="121.5645"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  const latNum = parseFloat(customLat);
                  const lngNum = parseFloat(customLng);
                  if (!isNaN(latNum) && !isNaN(lngNum) && latNum >= -90 && latNum <= 90 && lngNum >= -180 && lngNum <= 180) {
                    onSelectCoordinate({ lat: latNum, lng: lngNum }, `自訂座標 (${latNum.toFixed(4)}, ${lngNum.toFixed(4)})`);
                    setShowCoordModal(false);
                  }
                }}
                className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/10 text-white font-semibold text-sm flex items-center justify-center gap-1.5 shadow-lg shadow-sky-600/30 transition-all"
              >
                <LocateFixed className="w-3.5 h-3.5" />
                <span>{t("立即跳轉至此經緯度座標")}</span>
              </button>
            </div>

            {/* Quick Coordinate Presets */}
            <div className="pt-2 border-t border-white/[0.08] space-y-1.5">
              <div className="text-sm text-slate-300 font-semibold">{t("快速選取熱門評估地點：")}</div>
              <div className="grid grid-cols-3 gap-1.5 text-sm">
                <button
                  type="button"
                  onClick={() => {
                    onSelectCoordinate({ lat: 25.0339, lng: 121.5645 }, '信義商圈·台北101', '信義區', '台北市');
                    setShowCoordModal(false);
                  }}
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-center"
                >
                  <div className="font-bold text-white">台北 101</div>
                  <div className="text-sm font-mono text-slate-300">25.03, 121.56</div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSelectCoordinate({ lat: 25.0478, lng: 121.5170 }, '台北車站特區', '中正區', '台北市');
                    setShowCoordModal(false);
                  }}
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-center"
                >
                  <div className="font-bold text-white">台北車站</div>
                  <div className="text-sm font-mono text-slate-300">25.04, 121.51</div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSelectCoordinate({ lat: 24.1565, lng: 120.6402 }, '台中七期新市政', '西屯區', '台中市');
                    setShowCoordModal(false);
                  }}
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-center"
                >
                  <div className="font-bold text-white">台中七期</div>
                  <div className="text-sm font-mono text-slate-300">24.15, 120.64</div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
