import { useState, useRef, useEffect, useMemo } from 'react';
import {
  Search,
  Navigation,
  Layers,
  Sun,
  X,
  MapPin,
  Loader2,
  Check,
  Compass,
  ChevronRight,
  Key,
  ShieldCheck,
  AlertCircle,
  Crosshair,
  Copy,
  ExternalLink,
  UserCircle,
  Star,
  SlidersHorizontal,
} from 'lucide-react';
import { LocationCoord, WeatherData } from '../types';
import { PRESET_EXPLORATION_LOCATIONS } from '../data/indicators';
import { CARTO_STORAGE_KEY, getActiveCartoKey } from './ScoutMap';

interface FloatingControlsProps {
  currentStreetName: string;
  district: string;
  city: string;
  clsScore: number | null;
  grade: 'S' | 'A' | 'B' | 'C' | 'D' | null;
  isLocatingGPS: boolean;
  onLocateMe: () => void;
  onSelectCoordinate: (coord: LocationCoord, streetName: string, district?: string, city?: string) => void;
  onOpenSheet: () => void;
  isSheetOpen: boolean;
  onOpenSaved: () => void;
  onOpenSettings: () => void;
  activeLayers: {
    c1Safety: boolean;
    c2Amenity: boolean;
    c3Transit: boolean;
    c4Green: boolean;
    c5Vitality: boolean;
    streetScores: boolean;
    walkingRadius: boolean;
  };
  onToggleLayer: (layer: keyof FloatingControlsProps['activeLayers']) => void;
  mapTheme: 'dark' | 'light';
  onToggleMapTheme: () => void;
  currentLocation: LocationCoord;
  targetLocation: LocationCoord;
  accuracyRadius?: number;
  weatherData?: WeatherData | null;
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
  currentStreetName,
  district,
  city,
  clsScore,
  grade,
  isLocatingGPS,
  onLocateMe,
  onSelectCoordinate,
  onOpenSheet,
  isSheetOpen,
  activeLayers,
  onToggleLayer,
  mapTheme,
  onToggleMapTheme,
  currentLocation,
  targetLocation,
  accuracyRadius,
  weatherData,
  onOpenSaved,
  onOpenSettings,
}: FloatingControlsProps) {
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const [showWeatherDetail, setShowWeatherDetail] = useState(false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [showCoordModal, setShowCoordModal] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);

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
  const layerMenuRef = useRef<HTMLDivElement>(null);

  // Close search/layers on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setIsSearchOpen(false);
      }
      if (
        layerMenuRef.current &&
        !layerMenuRef.current.contains(e.target as Node)
      ) {
        setShowLayerMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
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
    <div className="pointer-events-none absolute inset-0 z-[500] flex flex-col justify-between p-3 sm:p-4 select-none">
      {/* TOP FLOATING ROW */}
      <div className="flex items-start justify-between gap-2 pointer-events-auto">
        {/* Top-Left Weather Pill (Apple Maps style: ☀️ 29°) */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowWeatherDetail((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#1c1c1e]/85 hover:bg-[#1c1c1e] backdrop-blur-xl text-white text-xs font-semibold shadow-lg border border-white/10 transition-transform active:scale-95"
            title="天氣、濕度與即時空品"
          >
            <Sun className="w-4 h-4 text-amber-400" />
            <span className="font-bold font-mono">{weatherData ? `${weatherData.temperature}°` : '26°'}</span>
            <span className="text-[11px] text-slate-400 hidden xs:inline">
              {weatherData?.stationDistrict || district || '台北'}
            </span>
          </button>

          {/* Mini Weather Popover */}
          {showWeatherDetail && (
            <div className="absolute top-full left-0 mt-2 w-56 p-3 rounded-2xl bg-[#1c1c1e]/95 backdrop-blur-xl text-white shadow-xl border border-white/10 text-xs space-y-2">
              <div className="flex justify-between items-center text-slate-300">
                <span className="font-medium">
                  {weatherData?.stationDistrict || `${city || '台北市'} ${district || '大安區'}`}
                </span>
                <span className="font-bold text-amber-400">
                  {weatherData?.condition || '晴朗'}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <div className="text-2xl font-bold font-mono">
                  {weatherData ? `${weatherData.temperature}°C` : '26°C'}
                </div>
                <div className="text-[11px] text-slate-400">
                  {weatherData?.stationName ? `環保署【${weatherData.stationName}】測站` : '即時監測中'}
                </div>
              </div>
              <div className="text-[11px] text-slate-300 space-y-1 border-t border-white/10 pt-1.5">
                <div className="flex justify-between items-center">
                  <span>空氣品質 AQI：</span>
                  <span className="font-mono font-semibold text-emerald-400">
                    {weatherData ? `${weatherData.aqi} (${weatherData.aqiStatus})` : '36 (良好)'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span>相對濕度：</span>
                  <span className="font-mono font-semibold text-sky-300">
                    {weatherData ? `${weatherData.humidity}%` : '65%'}
                  </span>
                </div>
                {weatherData?.pm25 !== undefined && (
                  <div className="flex justify-between items-center text-[10px] text-slate-400">
                    <span>細懸浮微粒 PM2.5：</span>
                    <span className="font-mono">{weatherData.pm25} µg/m³</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Top-Right account menu: navigation lives here, not inside assessment */}
        <div className="relative">
          <button type="button" onClick={() => setShowProfileMenu(v => !v)} className="w-10 h-10 rounded-full bg-[#1c1c1e]/90 backdrop-blur-xl border border-white/10 shadow-lg flex items-center justify-center text-slate-200 hover:text-white hover:bg-[#242426] transition-all" title="Account">
            <UserCircle className="w-5 h-5" />
          </button>
          {showProfileMenu && (
            <div className="absolute top-full right-0 mt-2 w-60 rounded-2xl bg-[#1c1c1e]/98 backdrop-blur-2xl border border-white/10 shadow-2xl p-2 text-white">
              <div className="px-3 py-2.5 border-b border-white/10 mb-1">
                <div className="text-sm font-bold">StreetLens</div>
                <div className="text-[10px] text-slate-500">Street assessment workspace</div>
              </div>
              <button onClick={() => { onOpenSaved(); setShowProfileMenu(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/10 text-left">
                <Star className="w-4 h-4 text-amber-300" /><div><div className="text-xs font-semibold">Favorites</div><div className="text-[10px] text-slate-500">Favorite streets & CLS list</div></div>
              </button>
              <button onClick={() => { onOpenSettings(); setShowProfileMenu(false); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/10 text-left">
                <SlidersHorizontal className="w-4 h-4 text-sky-300" /><div><div className="text-xs font-semibold">Settings</div><div className="text-[10px] text-slate-500">Data sources & system status</div></div>
              </button>
            </div>
          )}
        </div>

      </div>

      {/* BOTTOM FLOATING CONTROLS */}
      <div className="pointer-events-auto pb-1 w-full">
        <div className="w-full max-w-3xl mx-auto flex items-end gap-2 sm:gap-3">
          {/* Unified address search + field assessment entry */}
          <div className="relative flex-1 min-w-0" ref={searchContainerRef}>
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-rose-400 pointer-events-none">
                {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
              </div>
              <input
                type="text"
                value={searchQuery || currentStreetName}
                onChange={(e) => { setSearchQuery(e.target.value); setIsSearchOpen(true); }}
                onFocus={() => setIsSearchOpen(true)}
                placeholder="搜尋新的實勘點..."
                className="w-full pl-11 pr-10 py-3 bg-[#1c1c1e]/92 backdrop-blur-xl border border-white/15 rounded-2xl text-xs sm:text-sm font-medium text-white placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-400 shadow-2xl transition-all"
                aria-label="搜尋新的實勘點"
              />
              {searchQuery && (
                <button type="button" onClick={() => { setSearchQuery(''); setSuggestions([]); }} className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 rounded-full text-slate-400 hover:text-white" aria-label="清除搜尋">
                  <X className="w-4 h-4" />
                </button>
              )}
              {isSearchOpen && (
                <div className="absolute bottom-full left-0 right-0 mb-2 bg-[#1c1c1e]/98 backdrop-blur-2xl border border-white/15 rounded-3xl shadow-2xl overflow-hidden max-h-72 overflow-y-auto drawer-scrollbar">
                  {suggestions.length > 0 ? (
                    <div className="p-1">
                      {suggestions.map((item, idx) => (
                        <button key={idx} type="button" onClick={() => handleSelectSuggestion(item)} className="w-full px-3 py-2.5 text-left text-xs hover:bg-white/10 rounded-2xl flex items-start gap-2.5 text-slate-200 transition-colors">
                          <MapPin className="w-4 h-4 text-indigo-400 mt-0.5 flex-shrink-0" />
                          <div className="min-w-0">
                            <div className="font-bold text-white truncate">{item.name || item.display_name.split(',')[0]}</div>
                            <div className="text-[11px] text-slate-400 truncate">{item.display_name}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 text-center text-xs text-slate-500">輸入地址或街道名稱搜尋新的實勘點</div>
                  )}
                </div>
              )}
            </div>
            <button type="button" onClick={onOpenSheet} className="w-12 h-12 shrink-0 rounded-2xl bg-indigo-500/90 hover:bg-indigo-500 text-white shadow-2xl border border-indigo-300/30 flex items-center justify-center transition-all active:scale-90" title="開始實勘" aria-label="開始實勘">
              <Compass className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Map tools share the bottom row but keep a fixed footprint, so resizing
            never lets them overlap the search field or assessment button. */}
        <div
          className="relative shrink-0 flex flex-col bg-[#1c1c1e]/90 backdrop-blur-xl rounded-2xl shadow-xl border border-white/10 p-0.5"
          ref={layerMenuRef}
        >
            {/* Layer Button */}
            <button
              type="button"
              onClick={() => setShowLayerMenu((v) => !v)}
              className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${
                showLayerMenu ? 'text-indigo-400 bg-white/10' : 'text-slate-300 hover:text-white'
              }`}
              title="圖層與樣式切換"
            >
              <Layers className="w-5 h-5" />
            </button>

            <div className="w-6 h-px bg-white/10 mx-auto" />

            {/* Locate Me Button */}
            <button
              type="button"
              onClick={onLocateMe}
              disabled={isLocatingGPS}
              className={`w-11 h-11 rounded-xl flex items-center justify-center transition-colors ${
                isLocatingGPS
                  ? 'text-sky-400 bg-white/10'
                  : 'text-slate-300 hover:text-white active:scale-95'
              }`}
              title="定位我的目前位置"
            >
              {isLocatingGPS ? (
                <Loader2 className="w-5 h-5 animate-spin text-sky-400" />
              ) : (
                <Navigation className="w-5 h-5 -rotate-45 fill-current" />
              )}
            </button>

            {/* Layer Popover Menu */}
            {showLayerMenu && (
              <div className="absolute bottom-full right-0 mb-2 w-56 p-3 rounded-2xl bg-[#1c1c1e]/95 backdrop-blur-xl text-white shadow-2xl border border-white/10 text-xs space-y-2.5">
                <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
                  <span className="font-bold text-slate-200">地圖圖層設定</span>
                  <button
                    type="button"
                    onClick={() => setShowLayerMenu(false)}
                    className="text-slate-400 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Map Theme Toggle */}
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-300">地圖色彩模式</span>
                  <button
                    type="button"
                    onClick={onToggleMapTheme}
                    className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold"
                  >
                    {mapTheme === 'dark' ? '🌙 深色夜間' : '☀️ 淺色日間'}
                  </button>
                </div>

                {/* Walking Radius Toggle */}
                <div
                  onClick={() => onToggleLayer('walkingRadius')}
                  className="flex items-center justify-between cursor-pointer py-1 text-[11px] text-slate-300 hover:text-white"
                >
                  <span>300m / 500m 步行圈</span>
                  <div
                    className={`w-4 h-4 rounded flex items-center justify-center border ${
                      activeLayers.walkingRadius
                        ? 'bg-indigo-600 border-indigo-400 text-white'
                        : 'border-slate-500'
                    }`}
                  >
                    {activeLayers.walkingRadius && <Check className="w-3 h-3 stroke-[3]" />}
                  </div>
                </div>

                {/* Street heatmap scores */}
                <div
                  onClick={() => onToggleLayer('streetScores')}
                  className="flex items-center justify-between cursor-pointer py-1 text-[11px] text-slate-300 hover:text-white"
                >
                  <span>街道評分熱力標線</span>
                  <div
                    className={`w-4 h-4 rounded flex items-center justify-center border ${
                      activeLayers.streetScores
                        ? 'bg-indigo-600 border-indigo-400 text-white'
                        : 'border-slate-500'
                    }`}
                  >
                    {activeLayers.streetScores && <Check className="w-3 h-3 stroke-[3]" />}
                  </div>
                </div>

                {/* POIs Toggle */}
                <div
                  onClick={() => onToggleLayer('c2Amenity')}
                  className="flex items-center justify-between cursor-pointer py-1 text-[11px] text-slate-300 hover:text-white"
                >
                  <span>生活設施 POI 標記</span>
                  <div
                    className={`w-4 h-4 rounded flex items-center justify-center border ${
                      activeLayers.c2Amenity
                        ? 'bg-indigo-600 border-indigo-400 text-white'
                        : 'border-slate-500'
                    }`}
                  >
                    {activeLayers.c2Amenity && <Check className="w-3 h-3 stroke-[3]" />}
                  </div>
                </div>

                {/* Basemap Source Info & Key Config */}
                <div className="pt-2 border-t border-white/10 text-[10px] space-y-1.5">
                  <div className="flex justify-between items-center text-slate-400">
                    <span>底圖圖資</span>
                    <span className="font-mono font-bold text-indigo-300">
                      {getActiveCartoKey() ? 'CARTO (已授權)' : 'OSM (免金鑰)'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowLayerMenu(false);
                      setShowKeyModal(true);
                    }}
                    className="w-full flex items-center justify-center gap-1.5 py-1 px-2 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 transition-colors"
                  >
                    <Key className="w-3 h-3" />
                    <span>CARTO 金鑰管理與測試</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

      {/* CARTO Key Management & Test Modal */}
      {showKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm pointer-events-auto animate-in fade-in duration-200">
          <div className="relative w-full max-w-md bg-[#1c1c1e] border border-white/15 rounded-3xl p-5 shadow-2xl space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-indigo-500/20 text-indigo-400">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">CARTO Basemaps 金鑰測試與設定</h3>
                  <p className="text-[11px] text-slate-400">即時測試金鑰有效性並無縫切換底圖</p>
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
              <label className="text-xs font-semibold text-slate-300">CARTO API Key</label>
              <input
                type="text"
                value={inputKey}
                onChange={(e) => {
                  setInputKey(e.target.value);
                  setTestResult(null);
                }}
                placeholder="貼上您的 CARTO API Key (例如：default_public 或自訂 Key)..."
                className="w-full px-3.5 py-2.5 bg-black/40 border border-white/15 rounded-xl text-xs font-mono text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
              <p className="text-[10px] text-slate-400 leading-relaxed">
                說明：CARTO 官方規定自 2024 年底起請求 basemaps 圖磚時需附加 <code className="text-indigo-300 font-mono">?key=...</code>。
                若金鑰無效或權限未開通，本系統具備自動容錯保護，會自動切換至 Apple Maps 高清主題，絕不黑屏。
              </p>
            </div>

            {/* Test Result Message */}
            {testResult && (
              <div
                className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 ${
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
                <div className="leading-snug">{testResult.msg}</div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                disabled={keyTesting}
                onClick={() => testAndSaveCartoKey(inputKey)}
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-50"
              >
                {keyTesting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>即時連線測試中...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>測試並儲存套用</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setInputKey('');
                  testAndSaveCartoKey('');
                }}
                className="py-2.5 px-3 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 font-medium text-xs transition-colors"
                title="清除並切換回免金鑰高清地圖"
              >
                使用免金鑰底圖
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GPS Coordinates & Position Telemetry Modal */}
      {showCoordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm pointer-events-auto animate-in fade-in duration-200">
          <div className="relative w-full max-w-md bg-[#1c1c1e] border border-white/15 rounded-3xl p-5 shadow-2xl space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-sky-500/20 text-sky-400">
                  <Crosshair className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">GPS 經緯度座標與定位工具</h3>
                  <p className="text-[11px] text-slate-400">即時監控所在座標，支援直接輸入經緯度跳轉</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCoordModal(false)}
                className="p-1.5 rounded-full hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Current GPS Telemetry Block */}
            <div className="p-3.5 rounded-2xl bg-sky-950/20 border border-sky-400/30 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-sky-500"></span>
                  </span>
                  <span className="text-xs font-bold text-white">目前裝置 GPS 經緯度</span>
                </div>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 font-mono">
                  誤差 ±{accuracyRadius ? Math.round(accuracyRadius) : 15}m
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="p-2 rounded-xl bg-black/40 border border-white/10">
                  <div className="text-[10px] text-slate-400 font-sans">緯度 (Latitude)</div>
                  <div className="text-sm font-bold text-sky-300">{currentLocation.lat.toFixed(6)}°</div>
                </div>
                <div className="p-2 rounded-xl bg-black/40 border border-white/10">
                  <div className="text-[10px] text-slate-400 font-sans">經度 (Longitude)</div>
                  <div className="text-sm font-bold text-sky-300">{currentLocation.lng.toFixed(6)}°</div>
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
                  className="flex-1 py-1.5 px-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
                >
                  {copyFeedback ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-300">已複製座標</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-400" />
                      <span>複製經緯度</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onLocateMe();
                  }}
                  disabled={isLocatingGPS}
                  className="flex-1 py-1.5 px-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  {isLocatingGPS ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>定位中...</span>
                    </>
                  ) : (
                    <>
                      <Navigation className="w-3.5 h-3.5 -rotate-45" />
                      <span>重新偵測 GPS</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onSelectCoordinate(currentLocation, '我的目前所在位置');
                    setShowCoordModal(false);
                  }}
                  className="py-1.5 px-2.5 rounded-xl bg-rose-600/80 hover:bg-rose-500 text-white text-xs font-medium transition-colors"
                  title="將實勘點直接設在目前 GPS 位置"
                >
                  🎯 設為實勘點
                </button>
              </div>
            </div>

            {/* Direct Coordinate Input Jump */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-300">
                手動輸入自訂經緯度（坐標精確定位）
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[10px] text-slate-400 block mb-1">緯度 (例如: 25.0339)</span>
                  <input
                    type="number"
                    step="0.000001"
                    value={customLat}
                    onChange={(e) => setCustomLat(e.target.value)}
                    className="w-full px-3 py-2 bg-black/40 border border-white/15 rounded-xl text-xs font-mono text-white focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                    placeholder="25.0339"
                  />
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block mb-1">經度 (例如: 121.5645)</span>
                  <input
                    type="number"
                    step="0.000001"
                    value={customLng}
                    onChange={(e) => setCustomLng(e.target.value)}
                    className="w-full px-3 py-2 bg-black/40 border border-white/15 rounded-xl text-xs font-mono text-white focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
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
                className="w-full py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs flex items-center justify-center gap-1.5 shadow-lg shadow-sky-600/30 transition-all"
              >
                <Crosshair className="w-3.5 h-3.5" />
                <span>立即跳轉至此經緯度座標</span>
              </button>
            </div>

            {/* Quick Coordinate Presets */}
            <div className="pt-2 border-t border-white/10 space-y-1.5">
              <div className="text-[11px] text-slate-400 font-semibold">快速選取熱門實勘經緯度：</div>
              <div className="grid grid-cols-3 gap-1.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => {
                    onSelectCoordinate({ lat: 25.0339, lng: 121.5645 }, '信義商圈·台北101', '信義區', '台北市');
                    setShowCoordModal(false);
                  }}
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-center"
                >
                  <div className="font-bold text-white">台北 101</div>
                  <div className="text-[9px] font-mono text-slate-400">25.03, 121.56</div>
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
                  <div className="text-[9px] font-mono text-slate-400">25.04, 121.51</div>
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
                  <div className="text-[9px] font-mono text-slate-400">24.15, 120.64</div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
