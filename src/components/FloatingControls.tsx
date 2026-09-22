import { useState, useRef, useEffect, useMemo } from 'react';
import {
  Search,
  Navigation,
  Layers,
  Binoculars,
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
} from 'lucide-react';
import { LocationCoord } from '../types';
import { PRESET_EXPLORATION_LOCATIONS } from '../data/indicators';
import { CARTO_STORAGE_KEY, getActiveCartoKey } from './ScoutMap';

interface FloatingControlsProps {
  currentStreetName: string;
  district: string;
  city: string;
  clsScore: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  isLocatingGPS: boolean;
  onLocateMe: () => void;
  onSelectCoordinate: (coord: LocationCoord, streetName: string, district?: string, city?: string) => void;
  onOpenSheet: () => void;
  isSheetOpen: boolean;
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
            title="天氣與即時空品"
          >
            <Sun className="w-4 h-4 text-amber-400" />
            <span className="font-bold">29°</span>
            <span className="text-[11px] text-slate-400 hidden xs:inline">{district || '台北'}</span>
          </button>

          {/* Mini Weather Popover */}
          {showWeatherDetail && (
            <div className="absolute top-full left-0 mt-2 w-48 p-3 rounded-2xl bg-[#1c1c1e]/95 backdrop-blur-xl text-white shadow-xl border border-white/10 text-xs space-y-1.5">
              <div className="flex justify-between items-center text-slate-300">
                <span>{city || '台北市'} {district || '松山區'}</span>
                <span className="font-bold text-amber-400">晴朗</span>
              </div>
              <div className="text-xl font-bold font-mono">29°C</div>
              <div className="text-[10px] text-slate-400 flex justify-between border-t border-white/10 pt-1">
                <span>空品 AQI：38 (良好)</span>
                <span>濕度：62%</span>
              </div>
            </div>
          )}
        </div>

        {/* Top-Center GPS Coordinates Pill */}
        <button
          type="button"
          onClick={() => {
            setCustomLat(currentLocation.lat.toFixed(6));
            setCustomLng(currentLocation.lng.toFixed(6));
            setShowCoordModal(true);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#1c1c1e]/90 hover:bg-[#1c1c1e] backdrop-blur-xl text-white text-xs font-semibold shadow-lg border border-sky-400/30 transition-transform active:scale-95 group"
          title="查看目前位置經緯度或手動輸入座標定位"
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
          </span>
          <span className="font-mono text-[11px] text-sky-300 font-bold">
            {currentLocation.lat.toFixed(4)}, {currentLocation.lng.toFixed(4)}
          </span>
          <span className="text-[10px] text-sky-400/80 font-normal hidden sm:inline">經緯度</span>
        </button>

        {/* Top-Right Quick Score Pill (tap opens sheet) */}
        {!isSheetOpen && (
          <button
            type="button"
            onClick={onOpenSheet}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#1c1c1e]/90 hover:bg-[#1c1c1e] backdrop-blur-xl text-white text-xs shadow-lg border border-white/10 transition-all active:scale-95 group"
            title="查看完整社區宜居指數"
          >
            <span className="font-bold text-slate-200 truncate max-w-[110px] sm:max-w-[160px]">
              {currentStreetName}
            </span>
            <div className="flex items-center gap-1 pl-2 border-l border-white/15">
              <span className="font-mono font-black text-indigo-400 text-sm">
                {clsScore}
              </span>
              <span className="px-1.5 py-0.2 rounded bg-indigo-500/30 text-indigo-300 text-[10px] font-bold border border-indigo-500/40">
                {grade}級
              </span>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
          </button>
        )}
      </div>

      {/* BOTTOM FLOATING CONTROLS (Exactly matching Apple Maps layout) */}
      <div className="flex flex-col gap-3 pointer-events-auto pb-1">
        {/* Floating action buttons row (Binoculars on left, Capsule on right) */}
        <div className="flex items-end justify-between px-1">
          {/* Bottom-Left: Binoculars (Scout Look Around / Open Sheet button) */}
          <button
            type="button"
            onClick={onOpenSheet}
            className="w-12 h-12 rounded-full bg-[#1c1c1e]/90 hover:bg-[#1c1c1e] backdrop-blur-xl text-white shadow-xl border border-white/10 flex items-center justify-center transition-all active:scale-90"
            title="開啟實勘評分面板"
          >
            <Binoculars className="w-5 h-5 text-indigo-400" />
          </button>

          {/* Bottom-Right: Vertical Glass Capsule (Layers + Locate buttons) */}
          <div
            className="relative flex flex-col bg-[#1c1c1e]/90 backdrop-blur-xl rounded-2xl shadow-xl border border-white/10 p-0.5"
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

        {/* Bottom Search Capsule (Apple Maps Style Floating Search Bar) */}
        <div className="relative w-full max-w-lg mx-auto" ref={searchContainerRef}>
          <div className="relative flex items-center">
            <div className="absolute left-4 text-slate-400 pointer-events-none">
              {isSearching ? (
                <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
              ) : (
                <Search className="w-4 h-4" />
              )}
            </div>

            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsSearchOpen(true);
              }}
              onFocus={() => {
                if (suggestions.length > 0 || searchQuery.length >= 2) {
                  setIsSearchOpen(true);
                }
              }}
              placeholder="搜尋街道、商圈、建案或地址..."
              className="w-full pl-11 pr-11 py-3 bg-[#1c1c1e]/92 backdrop-blur-xl border border-white/15 rounded-full text-xs sm:text-sm font-medium text-white placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-400 shadow-2xl transition-all"
            />

            {searchQuery ? (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSuggestions([]);
                }}
                className="absolute right-3.5 p-1 rounded-full text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onOpenSheet}
                className="absolute right-2 px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 text-slate-200 text-xs font-bold"
                title="開啟實勘數據"
              >
                實勘
              </button>
            )}
          </div>

          {/* Autocomplete Dropdown or Hot Presets Drawer */}
          {isSearchOpen && (
            <div className="absolute bottom-full left-0 right-0 mb-2 bg-[#1c1c1e]/98 backdrop-blur-2xl border border-white/15 rounded-3xl shadow-2xl overflow-hidden max-h-72 overflow-y-auto drawer-scrollbar">
              {/* Direct Coordinate Jump Item if user typed lat/lng */}
              {matchedCoord && (
                <div className="p-1.5 border-b border-white/10 bg-sky-950/30">
                  <button
                    type="button"
                    onClick={() => {
                      onSelectCoordinate(
                        matchedCoord,
                        `經緯度定位 (${matchedCoord.lat.toFixed(4)}, ${matchedCoord.lng.toFixed(4)})`
                      );
                      setSearchQuery('');
                      setIsSearchOpen(false);
                    }}
                    className="w-full px-3 py-2 text-left text-xs bg-sky-500/20 hover:bg-sky-500/30 rounded-2xl flex items-center gap-2.5 text-sky-200 border border-sky-400/40 transition-colors"
                  >
                    <Crosshair className="w-4 h-4 text-sky-400 flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="font-bold text-white flex items-center gap-1.5">
                        <span>📍 跳轉至經緯度座標</span>
                        <span className="font-mono text-sky-300">[{matchedCoord.lat.toFixed(6)}, {matchedCoord.lng.toFixed(6)}]</span>
                      </div>
                      <div className="text-[10px] text-sky-300/80">
                        點擊立即定位至指定座標並開始實勘評分
                      </div>
                    </div>
                  </button>
                </div>
              )}

              {suggestions.length > 0 ? (
                <div className="p-1">
                  {suggestions.map((item, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSelectSuggestion(item)}
                      className="w-full px-3 py-2.5 text-left text-xs hover:bg-white/10 rounded-2xl flex items-start gap-2.5 text-slate-200 transition-colors"
                    >
                      <MapPin className="w-4 h-4 text-indigo-400 mt-0.5 flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="font-bold text-white truncate">
                          {item.name || item.display_name.split(',')[0]}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate">
                          {item.display_name}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="p-3 space-y-2">
                  <div className="text-[11px] text-slate-400 font-bold px-1">熱門實勘熱區</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {PRESET_EXPLORATION_LOCATIONS.map((preset, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleSelectPreset(preset)}
                        className="px-2.5 py-2 text-left bg-white/5 hover:bg-white/10 rounded-xl text-xs text-slate-200 transition-colors"
                      >
                        <div className="font-bold text-white truncate">
                          {preset.name.split('（')[0]}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate">
                          {preset.district} · {preset.city}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
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
