import { useState } from 'react';
import {
  C1Data,
  C2Data,
  C3Data,
  C4Data,
  C5Data,
  CLSWeights,
  FieldCheckItem,
  WeatherData,
  IndicatorSourceItem,
  ScoreFactor,
  SavedLocation,
  AssessmentSourceStatus,
} from '../types';
import {
  X,
  ChevronUp,
  ChevronDown,
  Globe,
  Copy,
  Check,
  RotateCcw,
  Sliders,
  FileText,
  Activity,
  Shield,
  ShoppingBag,
  Bus,
  Trees,
  Users,
  CloudSun,
  Database,
  RefreshCw,
  Wind,
  CheckCircle2,
  Bookmark,
  BookmarkCheck,
  Trash2,
  MapPin,
  Compass,
  Search,
  Download,
} from 'lucide-react';

const SAVED_LOCATIONS_STORAGE_KEY = 'cls_saved_locations';

function getStoredSavedLocations(): SavedLocation[] {
  try {
    const raw = localStorage.getItem(SAVED_LOCATIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn('Failed to parse saved locations from localStorage', e);
    return [];
  }
}

interface AppleBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  clsScore: number | null;
  grade: 'S' | 'A' | 'B' | 'C' | 'D' | null;
  streetName: string;
  district: string;
  city: string;
  c1: C1Data;
  c2: C2Data;
  c3: C3Data;
  c4: C4Data;
  c5: C5Data;
  onUpdateC1: React.Dispatch<React.SetStateAction<C1Data>>;
  onUpdateC2: React.Dispatch<React.SetStateAction<C2Data>>;
  onUpdateC3: React.Dispatch<React.SetStateAction<C3Data>>;
  onUpdateC4: React.Dispatch<React.SetStateAction<C4Data>>;
  onUpdateC5: React.Dispatch<React.SetStateAction<C5Data>>;
  weights: CLSWeights;
  onUpdateWeights: (weights: CLSWeights, mode: 'equal' | 'pca' | 'custom') => void;
  weightMode: 'equal' | 'pca' | 'custom';
  baselineScores: {
    cls: number | null;
    c1: number | null;
    c2: number | null;
    c3: number | null;
    c4: number | null;
    c5: number | null;
  };
  fieldChecks: FieldCheckItem[];
  onToggleFieldCheck: (id: string) => void;
  onAutoFetchBaseline: () => void;
  isLoadingBaseline: boolean;
  baselineSummary: string;
  fieldNotes: string;
  onUpdateNotes: (notes: string) => void;
  onResetToBaseline: () => void;
  weatherData?: WeatherData | null;
  indicatorSources?: IndicatorSourceItem[];
  scoreFactors?: ScoreFactor[];
  sourceStatus?: AssessmentSourceStatus[];
  targetLocation?: { lat: number; lng: number };
  onSelectSavedLocation?: (saved: SavedLocation) => void;
}

export function AppleBottomSheet({
  isOpen,
  onClose,
  clsScore,
  grade,
  streetName,
  district,
  city,
  c1,
  c2,
  c3,
  c4,
  c5,
  onUpdateC1,
  onUpdateC2,
  onUpdateC3,
  onUpdateC4,
  onUpdateC5,
  weights,
  onUpdateWeights,
  weightMode,
  baselineScores,
  fieldChecks,
  onToggleFieldCheck,
  onAutoFetchBaseline,
  isLoadingBaseline,
  baselineSummary,
  fieldNotes,
  onUpdateNotes,
  onResetToBaseline,
  weatherData,
  indicatorSources = [],
  scoreFactors = [],
  sourceStatus = [],
  targetLocation,
  onSelectSavedLocation,
}: AppleBottomSheetProps) {
  const [sheetTab, setSheetTab] = useState<'overview' | 'saved' | 'evidence' | 'sources' | 'calibrate' | 'report'>('overview');
  const [selectedCat, setSelectedCat] = useState<'C1' | 'C2' | 'C3' | 'C4' | 'C5'>('C1');
  const [sheetHeight, setSheetHeight] = useState<'half' | 'full'>('half');
  const [copied, setCopied] = useState(false);

  // Saved Locations state
  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>(getStoredSavedLocations);
  const [customLocationName, setCustomLocationName] = useState('');
  const [savedSearchQuery, setSavedSearchQuery] = useState('');
  const [saveSuccessNotice, setSaveSuccessNotice] = useState<string | null>(null);
  const [copiedCoordId, setCopiedCoordId] = useState<string | null>(null);

  if (!isOpen) return null;

  const currentCoords = targetLocation || { lat: 25.033, lng: 121.5654 };
  const isCurrentSaved = savedLocations.some(
    (loc) =>
      Math.abs(loc.coords.lat - currentCoords.lat) < 0.0001 &&
      Math.abs(loc.coords.lng - currentCoords.lng) < 0.0001
  );

  const handleSaveCurrentLocation = () => {
    const defaultName = `${district ? district + ' ' : ''}${streetName || '實勘點位'}`;
    const nameToUse = customLocationName.trim() || defaultName;

    const existingIndex = savedLocations.findIndex(
      (loc) =>
        Math.abs(loc.coords.lat - currentCoords.lat) < 0.0001 &&
        Math.abs(loc.coords.lng - currentCoords.lng) < 0.0001
    );

    const newEntry: SavedLocation = {
      id:
        existingIndex >= 0
          ? savedLocations[existingIndex].id
          : `saved_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: nameToUse,
      streetName: streetName || '實勘路段',
      district: district || '',
      city: city || '台灣',
      coords: currentCoords,
      clsScore,
      grade,
      scores: {
        c1: c1.score,
        c2: c2.score,
        c3: c3.score,
        c4: c4.score,
        c5: c5.score,
      },
      c1Data: c1,
      c2Data: c2,
      c3Data: c3,
      c4Data: c4,
      c5Data: c5,
      weights,
      fieldNotes,
      timestamp: Date.now(),
    };

    let updatedList: SavedLocation[];
    if (existingIndex >= 0) {
      updatedList = [...savedLocations];
      updatedList[existingIndex] = newEntry;
    } else {
      updatedList = [newEntry, ...savedLocations];
    }

    setSavedLocations(updatedList);
    try {
      localStorage.setItem(SAVED_LOCATIONS_STORAGE_KEY, JSON.stringify(updatedList));
    } catch (e) {
      console.warn('Failed to save to localStorage', e);
    }

    setCustomLocationName('');
    setSaveSuccessNotice(
      existingIndex >= 0
        ? `已更新【${nameToUse}】之評估分數（CLS: ${clsScore}分）！`
        : `已成功儲存【${nameToUse}】（CLS: ${clsScore}分）！`
    );
    setTimeout(() => setSaveSuccessNotice(null), 3500);
  };

  const handleDeleteSavedLocation = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const updated = savedLocations.filter((loc) => loc.id !== id);
    setSavedLocations(updated);
    try {
      localStorage.setItem(SAVED_LOCATIONS_STORAGE_KEY, JSON.stringify(updated));
    } catch (err) {
      console.warn('Failed to update localStorage', err);
    }
  };

  const handleClearAllSaved = () => {
    if (window.confirm('確定要清空所有已儲存的勘查地點嗎？')) {
      setSavedLocations([]);
      try {
        localStorage.removeItem(SAVED_LOCATIONS_STORAGE_KEY);
      } catch (err) {}
    }
  };

  const handleCopyCoords = (loc: SavedLocation, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const str = `${loc.coords.lat.toFixed(6)}, ${loc.coords.lng.toFixed(6)}`;
    navigator.clipboard.writeText(str);
    setCopiedCoordId(loc.id);
    setTimeout(() => setCopiedCoordId(null), 2000);
  };

  const handleLoadSavedLocation = (loc: SavedLocation) => {
    if (onSelectSavedLocation) {
      onSelectSavedLocation(loc);
    }
    setSaveSuccessNotice(`已在地圖載入【${loc.name}】之座標與評估！`);
    setTimeout(() => setSaveSuccessNotice(null), 3500);
  };

  const handleExportSavedJson = () => {
    const dataStr =
      'data:text/json;charset=utf-8,' +
      encodeURIComponent(JSON.stringify(savedLocations, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute(
      'download',
      `cls_saved_locations_${new Date().toISOString().slice(0, 10)}.json`
    );
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const filteredSavedLocations = savedLocations.filter((loc) => {
    if (!savedSearchQuery.trim()) return true;
    const q = savedSearchQuery.toLowerCase();
    return (
      loc.name.toLowerCase().includes(q) ||
      loc.streetName.toLowerCase().includes(q) ||
      loc.district.toLowerCase().includes(q) ||
      loc.city.toLowerCase().includes(q)
    );
  });

  const getDeltaBadge = (current: number | null, base: number | null) => {
    if (current == null || base == null) return null;
    const diff = Math.round(current - base);
    if (diff > 0) {
      return (
        <span className="text-[11px] font-mono font-bold text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/40">
          +{diff}
        </span>
      );
    }
    if (diff < 0) {
      return (
        <span className="text-[11px] font-mono font-bold text-rose-400 bg-rose-950/60 px-1.5 py-0.5 rounded border border-rose-800/40">
          {diff}
        </span>
      );
    }
    return (
      <span className="text-[11px] font-mono text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
        ±0
      </span>
    );
  };

  const handleCopyReport = async () => {
    const checked = fieldChecks.filter((i) => i.checked);
    const text = `【社區宜居綜合指數 (CLS) 實勘速報】
📍 探查地點：${city} ${district} ${streetName || '現場位置'}
⭐️ 宜居總分：${clsScore} 分 (${grade}級)
📊 5 大指標：
  • C1 安全風險：${c1.score ?? 'N/A'}分 (基準: ${baselineScores.c1})
  • C2 便利機能：${c2.score ?? 'N/A'}分 (基準: ${baselineScores.c2})
  • C3 移動連結：${c3.score ?? 'N/A'}分 (基準: ${baselineScores.c3})
  • C4 環境綠意：${c4.score ?? 'N/A'}分 (基準: ${baselineScores.c4})
  • C5 社會活力：${c5.score ?? 'N/A'}分 (基準: ${baselineScores.c5})
📝 現場特徵：${checked.map((c) => c.title).join('、') || '無特殊勾選'}
📌 筆記：${fieldNotes || '無'}
時間：${new Date().toLocaleString('zh-TW')}`;

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-[800] max-w-xl mx-auto flex flex-col transition-all duration-300 ease-out shadow-2xl ${
        sheetHeight === 'full' ? 'h-[92dvh]' : 'h-[62dvh] sm:h-[68dvh]'
      }`}
      id="apple-bottom-sheet"
    >
      {/* Container with Apple Glass morphism */}
      <div className="flex-1 flex flex-col bg-[#1c1c1e]/96 backdrop-blur-2xl text-white rounded-t-[32px] sm:rounded-3xl border border-white/10 overflow-hidden shadow-[0_-8px_30px_rgba(0,0,0,0.45)]">
        {/* Grab Handle & Height Toggle */}
        <div
          className="pt-2.5 pb-1.5 flex justify-center cursor-pointer group select-none"
          onClick={() => setSheetHeight((h) => (h === 'half' ? 'full' : 'half'))}
        >
          <div className="w-10 h-1.2 rounded-full bg-white/25 group-hover:bg-white/40 transition-colors" />
        </div>

        {/* Header Bar */}
        <div className="px-5 py-2 flex items-center justify-between border-b border-white/10">
          <div className="min-w-0 flex-1 pr-2">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white truncate">
                {streetName || '實勘目標路段'}
              </h2>
              <span className="text-xs text-slate-400 font-medium">
                {district} · {city}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
              <span>CLS 宜居指數</span>
              <span className="font-mono font-bold text-indigo-400 text-xs">{clsScore}分</span>
              <span className="px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 text-[10px] font-bold border border-indigo-500/30">
                {grade}級
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                if (sheetTab !== 'saved') {
                  setSheetTab('saved');
                } else {
                  handleSaveCurrentLocation();
                }
              }}
              className={`p-1.5 rounded-full transition-colors text-xs flex items-center gap-1 ${
                isCurrentSaved
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-white/10 hover:bg-white/20 text-slate-300'
              }`}
              title={isCurrentSaved ? '此地點已在收藏清單（點擊查看）' : '收藏此地點與 CLS 評估'}
            >
              {isCurrentSaved ? (
                <BookmarkCheck className="w-4 h-4 text-amber-400" />
              ) : (
                <Bookmark className="w-4 h-4" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setSheetHeight((h) => (h === 'half' ? 'full' : 'half'))}
              className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 transition-colors text-xs"
              title={sheetHeight === 'half' ? '放大抽屜' : '縮小抽屜'}
            >
              {sheetHeight === 'half' ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 transition-colors"
              title="關閉"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Apple Segmented Control */}
        <div className="px-5 pt-2.5 pb-2">
          <div className="flex p-1 bg-black/40 rounded-xl border border-white/5 text-xs font-semibold overflow-x-auto drawer-scrollbar">
            <button
              type="button"
              onClick={() => setSheetTab('overview')}
              className={`flex-1 min-w-[72px] py-1.5 px-2 rounded-lg flex items-center justify-center gap-1 transition-all whitespace-nowrap ${
                sheetTab === 'overview'
                  ? 'bg-white/20 text-white shadow-xs font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>宜居總覽</span>
            </button>
            <button
              type="button"
              onClick={() => setSheetTab('saved')}
              className={`flex-1 min-w-[76px] py-1.5 px-2 rounded-lg flex items-center justify-center gap-1 transition-all whitespace-nowrap ${
                sheetTab === 'saved'
                  ? 'bg-white/20 text-white shadow-xs font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Bookmark className="w-3.5 h-3.5 text-amber-400" />
              <span>已存地點</span>
              {savedLocations.length > 0 && (
                <span className="ml-0.5 px-1.5 py-0.2 rounded-full bg-amber-500/30 text-amber-300 text-[10px] font-bold">
                  {savedLocations.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setSheetTab('evidence')}
              className={`flex-1 min-w-[76px] py-1.5 px-2 rounded-lg flex items-center justify-center gap-1 transition-all whitespace-nowrap ${
                sheetTab === 'evidence'
                  ? 'bg-white/20 text-white shadow-xs font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>分數證據</span>
            </button>
            <button
              type="button"
              onClick={() => setSheetTab('sources')}
              className={`flex-1 min-w-[72px] py-1.5 px-2 rounded-lg flex items-center justify-center gap-1 transition-all whitespace-nowrap ${
                sheetTab === 'sources'
                  ? 'bg-white/20 text-white shadow-xs font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              <span>8大資料源</span>
            </button>
            <button
              type="button"
              onClick={() => setSheetTab('calibrate')}
              className={`flex-1 min-w-[72px] py-1.5 px-2 rounded-lg flex items-center justify-center gap-1 transition-all whitespace-nowrap ${
                sheetTab === 'calibrate'
                  ? 'bg-white/20 text-white shadow-xs font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>現場校正</span>
            </button>
            <button
              type="button"
              onClick={() => setSheetTab('report')}
              className={`flex-1 min-w-[72px] py-1.5 px-2 rounded-lg flex items-center justify-center gap-1 transition-all whitespace-nowrap ${
                sheetTab === 'report'
                  ? 'bg-white/20 text-white shadow-xs font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>報告筆記</span>
            </button>
          </div>
        </div>

        {/* Tab Content Area */}
        <div className="flex-1 overflow-y-auto px-5 py-2 space-y-4 drawer-scrollbar">
          {/* TAB 1: OVERVIEW */}
          {sheetTab === 'overview' && (
            <div className="space-y-3.5 pb-6">
              {/* Score Hero Card */}
              <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-950/60 to-black/40 border border-indigo-500/20 flex items-center justify-between">
                <div>
                  <div className="text-xs text-indigo-300 font-semibold tracking-wide">
                    社區宜居綜合指數 (CLS)
                  </div>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="text-3xl font-black text-white font-mono tracking-tight">
                      {clsScore}
                    </span>
                    <span className="text-xs text-slate-400">/ 100 分</span>
                    {getDeltaBadge(clsScore, baselineScores.cls)}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    資料狀態：{clsScore == null ? '尚無可用分數' : '已使用已儲存的來源資料'}
                  </div>
                </div>

                <div className="text-center bg-indigo-600/20 border border-indigo-500/30 px-3.5 py-2 rounded-2xl">
                  <div className="text-[10px] text-indigo-300 font-bold">評級</div>
                  <div className="text-2xl font-black text-white font-mono">{grade}</div>
                </div>
              </div>

              {/* Quick Save Current Location Banner in Overview */}
              <button
                type="button"
                onClick={() => {
                  handleSaveCurrentLocation();
                  setSheetTab('saved');
                }}
                className={`w-full py-2.5 px-3.5 rounded-xl border text-xs font-semibold flex items-center justify-between transition-all ${
                  isCurrentSaved
                    ? 'bg-amber-500/15 border-amber-500/30 text-amber-300 hover:bg-amber-500/25'
                    : 'bg-indigo-600/20 border-indigo-500/30 text-indigo-200 hover:bg-indigo-600/30'
                }`}
              >
                <div className="flex items-center gap-2">
                  {isCurrentSaved ? (
                    <BookmarkCheck className="w-4 h-4 text-amber-400" />
                  ) : (
                    <Bookmark className="w-4 h-4 text-indigo-400" />
                  )}
                  <span>
                    {isCurrentSaved
                      ? '此地點已收藏 · 點擊前往查看或更新評分'
                      : '儲存目前座標與 CLS 評估分數至已存清單'}
                  </span>
                </div>
                <span className="text-[11px] font-bold">
                  {isCurrentSaved ? '查看已存地點 →' : '儲存點位 +'}
                </span>
              </button>

              {/* Real-time Weather & Monitoring Station Pill */}
              {weatherData && (
                <div className="px-3.5 py-2.5 rounded-xl bg-sky-950/40 border border-sky-500/30 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2.5">
                    <CloudSun className="w-4 h-4 text-sky-400 shrink-0" />
                    <div>
                      <div className="text-slate-200 font-medium flex items-center gap-1.5">
                        <span>{weatherData.temperature}°C {weatherData.condition}</span>
                        <span className="text-slate-500">·</span>
                        <span>環保署【{weatherData.stationName}】測站 AQI {weatherData.aqi}</span>
                        <span
                          className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                            weatherData.aqi != null && weatherData.aqi <= 50
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          }`}
                        >
                          {weatherData.aqiStatus}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400">
                        PM2.5: {weatherData.pm25} µg/m³ · 濕度: {weatherData.humidity}%
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={onAutoFetchBaseline}
                    disabled={isLoadingBaseline}
                    className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 transition-colors flex items-center gap-1 text-[11px]"
                    title="重新比對政府開放資料庫"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingBaseline ? 'animate-spin text-sky-400' : ''}`} />
                    <span className="hidden sm:inline">重整</span>
                  </button>
                </div>
              )}

              {/* Quick 8 Data Sources Banner */}
              <div
                onClick={() => setSheetTab('sources')}
                className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 cursor-pointer transition-colors flex items-center justify-between"
              >
                <div className="flex items-center gap-2 text-xs text-slate-300">
                  <Database className="w-3.5 h-3.5 text-indigo-400" />
                  <span>已載入 8 大來源的持久化快照</span>
                </div>
                <div className="text-[11px] text-indigo-300 font-semibold flex items-center gap-1">
                  <span>查看詳情</span>
                  <span className="text-xs">→</span>
                </div>
              </div>

              {/* 5 Core Indicator Quick Rows */}
              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-300 flex items-center justify-between">
                  <span>5 大核心面向得分</span>
                  <span className="text-[11px] text-slate-500">點擊切換校正</span>
                </div>

                {/* C1 */}
                <div
                  onClick={() => {
                    setSelectedCat('C1');
                    setSheetTab('calibrate');
                  }}
                  className="p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 cursor-pointer transition-colors flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2.5 min-w-[120px]">
                    <div className="w-6 h-6 rounded-lg bg-rose-500/20 text-rose-400 flex items-center justify-center text-xs">
                      <Shield className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-200">C1 安全與風險</div>
                      <div className="text-[10px] text-slate-400">犯罪 / 事故 / 災害</div>
                    </div>
                  </div>
                  <div className="flex-1 max-w-[140px] hidden sm:block">
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-rose-500 rounded-full"
                        style={{ width: `${c1.score ?? 'N/A'}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getDeltaBadge(c1.score, baselineScores.c1)}
                    <span className="font-mono font-bold text-sm text-white">{c1.score ?? 'N/A'}</span>
                  </div>
                </div>

                {/* C2 */}
                <div
                  onClick={() => {
                    setSelectedCat('C2');
                    setSheetTab('calibrate');
                  }}
                  className="p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 cursor-pointer transition-colors flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2.5 min-w-[120px]">
                    <div className="w-6 h-6 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center text-xs">
                      <ShoppingBag className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-200">C2 便利與機能</div>
                      <div className="text-[10px] text-slate-400">15分鐘採買醫療</div>
                    </div>
                  </div>
                  <div className="flex-1 max-w-[140px] hidden sm:block">
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500 rounded-full"
                        style={{ width: `${c2.score ?? 'N/A'}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getDeltaBadge(c2.score, baselineScores.c2)}
                    <span className="font-mono font-bold text-sm text-white">{c2.score ?? 'N/A'}</span>
                  </div>
                </div>

                {/* C3 */}
                <div
                  onClick={() => {
                    setSelectedCat('C3');
                    setSheetTab('calibrate');
                  }}
                  className="p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 cursor-pointer transition-colors flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2.5 min-w-[120px]">
                    <div className="w-6 h-6 rounded-lg bg-sky-500/20 text-sky-400 flex items-center justify-center text-xs">
                      <Bus className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-200">C3 移動與連結</div>
                      <div className="text-[10px] text-slate-400">捷運 / 步行 / 自行車</div>
                    </div>
                  </div>
                  <div className="flex-1 max-w-[140px] hidden sm:block">
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-sky-500 rounded-full"
                        style={{ width: `${c3.score ?? 'N/A'}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getDeltaBadge(c3.score, baselineScores.c3)}
                    <span className="font-mono font-bold text-sm text-white">{c3.score ?? 'N/A'}</span>
                  </div>
                </div>

                {/* C4 */}
                <div
                  onClick={() => {
                    setSelectedCat('C4');
                    setSheetTab('calibrate');
                  }}
                  className="p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 cursor-pointer transition-colors flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2.5 min-w-[120px]">
                    <div className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-xs">
                      <Trees className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-200">C4 環境與綠意</div>
                      <div className="text-[10px] text-slate-400">空品 / 噪音 / 公園</div>
                    </div>
                  </div>
                  <div className="flex-1 max-w-[140px] hidden sm:block">
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full"
                        style={{ width: `${c4.score ?? 'N/A'}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getDeltaBadge(c4.score, baselineScores.c4)}
                    <span className="font-mono font-bold text-sm text-white">{c4.score ?? 'N/A'}</span>
                  </div>
                </div>

                {/* C5 */}
                <div
                  onClick={() => {
                    setSelectedCat('C5');
                    setSheetTab('calibrate');
                  }}
                  className="p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 cursor-pointer transition-colors flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2.5 min-w-[120px]">
                    <div className="w-6 h-6 rounded-lg bg-purple-500/20 text-purple-400 flex items-center justify-center text-xs">
                      <Users className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-200">C5 社會與活力</div>
                      <div className="text-[10px] text-slate-400">活動 / 信任 / 治理</div>
                    </div>
                  </div>
                  <div className="flex-1 max-w-[140px] hidden sm:block">
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-500 rounded-full"
                        style={{ width: `${c5.score ?? 'N/A'}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getDeltaBadge(c5.score, baselineScores.c5)}
                    <span className="font-mono font-bold text-sm text-white">{c5.score ?? 'N/A'}</span>
                  </div>
                </div>
              </div>

              {/* Weight Mode Switcher */}
              <div className="p-3 rounded-xl bg-black/40 border border-white/10 flex items-center justify-between">
                <span className="text-xs text-slate-300 font-semibold">權重配置</span>
                <div className="flex gap-1 text-[11px]">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateWeights(
                        { wC1: 0.2, wC2: 0.2, wC3: 0.2, wC4: 0.2, wC5: 0.2 },
                        'equal'
                      )
                    }
                    className={`px-2.5 py-1 rounded-lg transition-all ${
                      weightMode === 'equal'
                        ? 'bg-indigo-600 text-white font-bold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    等權重 (各20%)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateWeights(
                        { wC1: 0.25, wC2: 0.25, wC3: 0.2, wC4: 0.15, wC5: 0.15 },
                        'pca'
                      )
                    }
                    className={`px-2.5 py-1 rounded-lg transition-all ${
                      weightMode === 'pca'
                        ? 'bg-indigo-600 text-white font-bold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    PCA 主成分
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB: SAVED LOCATIONS (已存地點) */}
          {sheetTab === 'saved' && (
            <div className="space-y-4 pb-6">
              {/* Feedback toast / notification */}
              {saveSuccessNotice && (
                <div className="p-3 bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 rounded-xl text-xs font-semibold flex items-center justify-between animate-in fade-in duration-200">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>{saveSuccessNotice}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSaveSuccessNotice(null)}
                    className="text-emerald-400 hover:text-white text-xs px-1.5 py-0.5"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Current Target Save Hero Card */}
              <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-950/60 via-[#1e1c2e]/60 to-black/60 border border-indigo-500/30 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 flex items-center justify-center">
                      <MapPin className="w-4 h-4 text-indigo-400" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-white">儲存目前勘查點位</div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        {currentCoords.lat.toFixed(5)}, {currentCoords.lng.toFixed(5)}
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="flex items-baseline justify-end gap-1.5">
                      <span className="text-2xl font-black text-white font-mono">{clsScore ?? 'N/A'}</span>
                      <span className="text-[11px] text-slate-400">分</span>
                      <span className="px-1.5 py-0.2 rounded bg-indigo-500/30 text-indigo-300 text-[10px] font-bold border border-indigo-500/40">
                        {grade}級
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400">當前綜合 CLS 指數</div>
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-black/40 border border-white/5 space-y-1.5">
                  <div className="text-xs font-semibold text-slate-200 truncate">
                    {city} · {district} · {streetName || '實勘路段'}
                  </div>
                  <div className="grid grid-cols-5 gap-1 text-center text-[10px]">
                    <div className="p-1 rounded bg-rose-500/10 border border-rose-500/20 text-rose-300 font-mono">
                      <div className="text-[9px] text-rose-400/80">C1 安全</div>
                      <div className="font-bold">{c1.score ?? 'N/A'}</div>
                    </div>
                    <div className="p-1 rounded bg-amber-500/10 border border-amber-500/20 text-amber-300 font-mono">
                      <div className="text-[9px] text-amber-400/80">C2 機能</div>
                      <div className="font-bold">{c2.score ?? 'N/A'}</div>
                    </div>
                    <div className="p-1 rounded bg-sky-500/10 border border-sky-500/20 text-sky-300 font-mono">
                      <div className="text-[9px] text-sky-400/80">C3 移動</div>
                      <div className="font-bold">{c3.score ?? 'N/A'}</div>
                    </div>
                    <div className="p-1 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 font-mono">
                      <div className="text-[9px] text-emerald-400/80">C4 綠意</div>
                      <div className="font-bold">{c4.score ?? 'N/A'}</div>
                    </div>
                    <div className="p-1 rounded bg-purple-500/10 border border-purple-500/20 text-purple-300 font-mono">
                      <div className="text-[9px] text-purple-400/80">C5 活力</div>
                      <div className="font-bold">{c5.score ?? 'N/A'}</div>
                    </div>
                  </div>
                </div>

                {/* Custom Name / Tag Input */}
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-300 font-medium">
                    自訂地點備註標籤（選填）：
                  </label>
                  <input
                    type="text"
                    value={customLocationName}
                    onChange={(e) => setCustomLocationName(e.target.value)}
                    placeholder={`${district ? district + ' ' : ''}${streetName || '實勘點位'} (例如：公園景觀預售案、學區換屋首選)`}
                    className="w-full text-xs p-2.5 bg-black/50 border border-white/10 rounded-xl focus:outline-none focus:border-indigo-500 text-white placeholder:text-slate-500"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleSaveCurrentLocation}
                  className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${
                    isCurrentSaved
                      ? 'bg-amber-500 hover:bg-amber-400 text-black shadow-lg shadow-amber-950/40'
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-950/40'
                  }`}
                >
                  {isCurrentSaved ? (
                    <>
                      <BookmarkCheck className="w-4 h-4" />
                      <span>已在清單中 · 點擊更新最新評分 (CLS: {clsScore}分)</span>
                    </>
                  ) : (
                    <>
                      <Bookmark className="w-4 h-4" />
                      <span>儲存此座標與 CLS 評估分數至已存清單</span>
                    </>
                  )}
                </button>
              </div>

              {/* Saved Locations List Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white">已儲存的地點</span>
                    <span className="px-2 py-0.5 rounded-full bg-white/10 text-slate-300 text-[11px] font-mono font-bold">
                      {savedLocations.length} 處
                    </span>
                  </div>

                  {savedLocations.length > 0 && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleExportSavedJson}
                        className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white text-[11px] flex items-center gap-1 transition-colors"
                        title="匯出已存地點資料 (JSON)"
                      >
                        <Download className="w-3 h-3" />
                        <span>匯出</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleClearAllSaved}
                        className="px-2 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-[11px] transition-colors"
                        title="清空所有已存地點"
                      >
                        清空
                      </button>
                    </div>
                  )}
                </div>

                {/* Filter Search Input if multiple saved */}
                {savedLocations.length >= 2 && (
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={savedSearchQuery}
                      onChange={(e) => setSavedSearchQuery(e.target.value)}
                      placeholder="搜尋已存地點名稱、道路或行政區..."
                      className="w-full text-xs pl-8 pr-3 py-1.5 bg-black/40 border border-white/10 rounded-xl focus:outline-none focus:border-indigo-500 text-white placeholder:text-slate-500"
                    />
                    {savedSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setSavedSearchQuery('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                )}

                {/* Empty State */}
                {savedLocations.length === 0 ? (
                  <div className="p-8 rounded-2xl border border-dashed border-white/10 text-center space-y-3 bg-white/[0.02]">
                    <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center mx-auto text-slate-400">
                      <Bookmark className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-200">尚未儲存任何勘查地點</div>
                      <p className="text-[11px] text-slate-400 max-w-xs mx-auto mt-1 leading-relaxed">
                        點選地圖上任何地點或完成現場校正後，點擊上方按鈕即可儲存該位置座標與 5 大面向 CLS 指標，供日後回顧與比對。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleSaveCurrentLocation}
                      className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors shadow-md"
                    >
                      <Bookmark className="w-3.5 h-3.5" />
                      <span>立即儲存目前位置 (CLS: {clsScore}分)</span>
                    </button>
                  </div>
                ) : filteredSavedLocations.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-400 bg-white/5 rounded-xl border border-white/5">
                    找不到符合「{savedSearchQuery}」的已存地點
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {filteredSavedLocations.map((loc) => {
                      const isCurrentActive =
                        Math.abs(loc.coords.lat - currentCoords.lat) < 0.0001 &&
                        Math.abs(loc.coords.lng - currentCoords.lng) < 0.0001;

                      const formattedTime = new Date(loc.timestamp).toLocaleString('zh-TW', {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      });

                      return (
                        <div
                          key={loc.id}
                          className={`p-3.5 rounded-2xl border transition-all ${
                            isCurrentActive
                              ? 'bg-indigo-950/40 border-indigo-500/40 shadow-md'
                              : 'bg-white/5 hover:bg-white/10 border-white/5'
                          }`}
                        >
                          {/* Card Header */}
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-bold text-white">{loc.name}</span>
                                {isCurrentActive && (
                                  <span className="px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 text-[10px] font-semibold border border-indigo-500/30">
                                    當前位置
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-300 mt-0.5">
                                {loc.city} {loc.district} {loc.streetName}
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                                座標: {loc.coords.lat.toFixed(5)}, {loc.coords.lng.toFixed(5)} · {formattedTime}
                              </div>
                            </div>

                            <div className="text-right shrink-0">
                              <div className="flex items-baseline gap-1 justify-end">
                                <span className="text-xl font-black text-white font-mono">
                                  {loc.clsScore}
                                </span>
                                <span className="text-[10px] text-slate-400">分</span>
                                <span className="px-1.5 py-0.2 rounded bg-indigo-500/30 text-indigo-300 text-[10px] font-bold border border-indigo-500/40">
                                  {loc.grade}級
                                </span>
                              </div>
                              <div className="text-[10px] text-slate-500 font-mono">
                                CLS 宜居指數
                              </div>
                            </div>
                          </div>

                          {/* 5-Dimension Mini Grid */}
                          <div className="grid grid-cols-5 gap-1 mt-2.5 text-center text-[10px] bg-black/40 p-1.5 rounded-xl border border-white/5">
                            <div className="font-mono">
                              <span className="text-[9px] text-rose-400 block">C1 安全</span>
                              <span className="font-bold text-white">{loc.scores.c1}</span>
                            </div>
                            <div className="font-mono">
                              <span className="text-[9px] text-amber-400 block">C2 機能</span>
                              <span className="font-bold text-white">{loc.scores.c2}</span>
                            </div>
                            <div className="font-mono">
                              <span className="text-[9px] text-sky-400 block">C3 移動</span>
                              <span className="font-bold text-white">{loc.scores.c3}</span>
                            </div>
                            <div className="font-mono">
                              <span className="text-[9px] text-emerald-400 block">C4 綠意</span>
                              <span className="font-bold text-white">{loc.scores.c4}</span>
                            </div>
                            <div className="font-mono">
                              <span className="text-[9px] text-purple-400 block">C5 活力</span>
                              <span className="font-bold text-white">{loc.scores.c5}</span>
                            </div>
                          </div>

                          {/* Field Notes Snippet if available */}
                          {loc.fieldNotes && (
                            <div className="mt-2 text-[11px] text-slate-300 bg-white/5 p-2 rounded-lg border border-white/5 italic line-clamp-2">
                              "{loc.fieldNotes}"
                            </div>
                          )}

                          {/* Card Actions */}
                          <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-white/10 text-xs">
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleLoadSavedLocation(loc)}
                                className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center gap-1.5 transition-all shadow-sm active:scale-95"
                                title="將地圖移動至此坐標並載入評估數據供檢視"
                              >
                                <Compass className="w-3.5 h-3.5" />
                                <span>載入至地圖檢視</span>
                              </button>

                              <button
                                type="button"
                                onClick={(e) => handleCopyCoords(loc, e)}
                                className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition-colors"
                                title="複製經緯度座標"
                              >
                                {copiedCoordId === loc.id ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>

                            <button
                              type="button"
                              onClick={(e) => handleDeleteSavedLocation(loc.id, e)}
                              className="p-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition-colors"
                              title="刪除此儲存點"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB: SCORE EVIDENCE */}
          {sheetTab === 'evidence' && (
            <div className="space-y-3 pb-6">
              <div className="p-3.5 rounded-2xl bg-indigo-950/40 border border-indigo-500/20">
                <div className="flex items-center gap-2 text-xs font-bold text-indigo-300">
                  <Database className="w-4 h-4 text-indigo-400" />
                  <span>分數證據</span>
                </div>
                <p className="text-[11px] text-slate-300 mt-1.5 leading-relaxed">
                  每個分數只顯示後端已持久化的真實資料，以及實際使用的來源、方法、信心與取得時間。
                </p>
              </div>
              {scoreFactors.length === 0 ? (
                <div className="p-4 rounded-xl bg-white/5 border border-white/5 text-xs text-slate-400">
                  尚無可用的分數證據。
                </div>
              ) : (
                <div className="space-y-2">
                  {(['C1', 'C2', 'C3', 'C4', 'C5'] as const).map((category) => {
                    const factors = scoreFactors.filter((factor) => factor.category === category);
                    if (!factors.length) return null;
                    return (
                      <div key={category} className="rounded-xl bg-white/5 border border-white/5 overflow-hidden">
                        <div className="px-3 py-2 bg-white/5 flex items-center justify-between">
                          <span className="text-xs font-bold text-white">{category}</span>
                          <span className="text-[10px] text-slate-400">{factors.length} 個指標</span>
                        </div>
                        <div className="divide-y divide-white/5">
                          {factors.map((factor, index) => (
                            <div key={factor.indicator + '-' + index} className="px-3 py-2.5">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-[11px] font-semibold text-white break-words">{factor.indicator}</div>
                                  <div className="text-[10px] text-slate-400 mt-0.5">
                                    {factor.direction === 'higher_is_better' ? '數值越高越有利' : '數值越低越有利'}
                                  </div>
                                </div>
                                <span className="shrink-0 text-xs font-mono font-bold text-indigo-300">
                                  {factor.value == null ? 'N/A' : String(factor.value) + (factor.unit ? ' ' + factor.unit : '')}
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2 text-[10px]">
                                <div><span className="text-slate-500">來源</span><div className="text-slate-200 break-words">{factor.source || 'unavailable'}</div></div>
                                <div><span className="text-slate-500">方法</span><div className="text-slate-200">{factor.method}</div></div>
                                <div><span className="text-slate-500">信心</span><div className="text-slate-200">{factor.confidence}</div></div>
                                <div><span className="text-slate-500">狀態</span><div className="text-slate-200">{factor.status || 'unavailable'}</div></div>
                                <div className="col-span-2">
                                  <span className="text-slate-500">Reference</span>
                                  <div className="text-slate-200">
                                    {factor.referenceSampleSize != null
                                      ? factor.referenceSampleSize >= 20
                                        ? `${factor.referenceSampleSize} 筆真實觀測`
                                        : `${factor.referenceSampleSize} 筆真實觀測（不足 20，無法計算 percentile）`
                                      : 'N/A'}
                                  </div>
                                </div>
                                <div className="col-span-2">
                                  <span className="text-slate-500">評分方式</span>
                                  <div className="text-slate-200">
                                    {factor.scoringMethod === 'empirical_percentile'
                                      ? '實證 percentile（真實觀測分布）'
                                      : factor.scoringMethod === 'raw_observation'
                                        ? '原始觀測值（未做 percentile）'
                                        : '未計分'}
                                  </div>
                                </div>
                                {factor.availabilityReason && (
                                  <div className="col-span-2">
                                    <span className="text-slate-500">不可計分原因</span>
                                    <div className="text-amber-300">
                                      {factor.availabilityReason === 'insufficient_reference_data'
                                        ? '真實 reference 觀測不足 20 筆'
                                        : factor.availabilityReason === 'source_unavailable'
                                          ? '來源資料不可用'
                                          : '目前沒有此位置的真實觀測'}
                                    </div>
                                  </div>
                                )}
                              </div>
                              {factor.retrievedAt && (
                                <div className="text-[10px] text-slate-500 mt-2">
                                  retrievedAt: {new Date(factor.retrievedAt).toLocaleString('zh-TW')}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB: 8 OFFICIAL DATA SOURCES */}
          {sheetTab === 'sources' && (
            <div className="space-y-3 pb-6">
              <div className="p-3.5 rounded-2xl bg-indigo-950/40 border border-indigo-500/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-indigo-300">
                    <Database className="w-4 h-4 text-indigo-400" />
                    <span>外部資料來源（7 個來源）</span>
                  </div>
                  <button
                    type="button"
                    onClick={onAutoFetchBaseline}
                    disabled={isLoadingBaseline}
                    className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${isLoadingBaseline ? 'animate-spin' : ''}`} />
                    <span>查看快照</span>
                  </button>
                </div>
                <p className="text-[11px] text-slate-300 mt-1.5 leading-relaxed">
                  系統根據當前地圖所選坐標與生活圈（{city} {district} {streetName || '目標地'}），顯示以下 8 大來源的已持久化快照；外部來源由背景更新流程負責同步：
                </p>
              </div>

              {/* Persisted source freshness */}
              {sourceStatus.length > 0 && (
                <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
                    <Database className="w-4 h-4 text-indigo-400" />
                    <span>已持久化資料快照狀態</span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1.5">
                    評分請求只讀取資料庫快照，不會在使用者請求中即時抓取外部資料。
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {sourceStatus.map((item) => (
                      <div key={item.source} className="rounded-lg bg-black/20 px-2.5 py-2 text-[10px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-slate-200 font-semibold">{item.source}</span>
                          <span className={item.status === 'available' ? 'text-emerald-400' : 'text-amber-400'}>
                            {item.status}
                          </span>
                        </div>
                        <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-slate-500">
                          <span>取得：{item.retrievedAt ? new Date(item.retrievedAt).toLocaleString() : 'N/A'}</span>
                          <span>檢查：{item.checkedAt ? new Date(item.checkedAt).toLocaleString() : 'N/A'}</span>
                          <span>版本：{item.sourceVersion || 'N/A'}</span>
                          <span>Freshness：{item.freshnessMethod}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* List of 8 items */}
              <div className="space-y-2">
                {/* 1. 犯罪率 */}
                <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-xs font-bold text-white">犯罪率</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">C1 安全</span>
                    </div>
                    <span className="text-[11px] text-indigo-300 font-mono font-bold">
                      每千人犯罪係數: {c1.crimeRate}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
                    <span>來源狀態由上方持久化快照與 Evidence 指標決定，不使用靜態即時連線狀態。</span>
                    <span className="text-[10px] flex items-center gap-0.5">
                      <CheckCircle2 className="w-3 h-3" /> 已持久化
                    </span>
                  </div>
                </div>

                {/* 2. 交通事故 */}
                <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-xs font-bold text-white">交通事故</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">C1 安全</span>
                    </div>
                    <span className="text-[11px] text-indigo-300 font-mono font-bold">
                      事故風險係數: {c1.accidentRate}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
                    <span>來源與取得時間請查看 Evidence 指標。</span>
                    <span className="text-[10px] flex items-center gap-0.5">
                      <CheckCircle2 className="w-3 h-3" /> 已持久化
                    </span>
                  </div>
                </div>

                {/* 3. 災害潛勢 */}
                <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-xs font-bold text-white">災害潛勢</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">C1 安全</span>
                    </div>
                    <span className="text-[11px] text-indigo-300 font-mono font-bold">
                      防汛地質潛勢: {c1.hazardLevel}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
                    <span>來源與取得時間請查看 Evidence 指標。</span>
                    <span className="text-[10px] flex items-center gap-0.5">
                      <CheckCircle2 className="w-3 h-3" /> 已持久化
                    </span>
                  </div>
                </div>

                {/* 4. POI */}
                <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-xs font-bold text-white">POI 生活機能</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">C2 機能</span>
                    </div>
                    <span className="text-[11px] text-indigo-300 font-mono font-bold">
                      500m設施: {c2.poiDensityCount}處 · 超商{c2.convenienceDist}m
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
                    <span>資料來源：<strong className="text-slate-200">Google Maps API、OpenStreetMap、政府開放資料</strong></span>
                    <span className="text-[10px] flex items-center gap-0.5">
                      <CheckCircle2 className="w-3 h-3" /> 已持久化
                    </span>
                  </div>
                </div>

                {/* 5. 公共運輸 */}
                <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-xs font-bold text-white">公共運輸</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">C3 移動</span>
                    </div>
                    <span className="text-[11px] text-indigo-300 font-mono font-bold">
                      軌道: {c3.mrtOrRailDist}m · 公車: {c3.busStopDist}m (班次{c3.busFrequencyScore}分)
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
                    <span>資料來源：<strong className="text-slate-200">公車動態 API、捷運營運資料</strong></span>
                    <span className="text-[10px] flex items-center gap-0.5">
                      <CheckCircle2 className="w-3 h-3" /> 已持久化
                    </span>
                  </div>
                </div>

                {/* 6. 空氣/噪音 */}
                <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-xs font-bold text-white">空氣 / 噪音</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">C4 環境</span>
                    </div>
                    <span className="text-[11px] text-indigo-300 font-mono font-bold">
                      {weatherData ? `${weatherData.stationName}站 AQI ${weatherData.aqi} (${weatherData.aqiStatus})` : `空品: ${c4.airQualityScore}分`}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
                    <span>資料來源：<strong className="text-slate-200">環保署監測站</strong></span>
                    <span className="text-[10px] text-emerald-400 flex items-center gap-0.5">
                      <CheckCircle2 className="w-3 h-3" /> 已持久化
                    </span>
                  </div>
                </div>

                {/* 7. 綠地 */}
                <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-xs font-bold text-white">綠地</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">C4 環境</span>
                    </div>
                    <span className="text-[11px] text-indigo-300 font-mono font-bold">
                      綠覆率: {c4.greenCoveragePct}% · 最近公園: {c4.parkDistance}m
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
                    <span>資料來源：<strong className="text-slate-200">國土測繪圖資、都發局綠地資料</strong></span>
                    <span className="text-[10px] flex items-center gap-0.5">
                      <CheckCircle2 className="w-3 h-3" /> 已持久化
                    </span>
                  </div>
                </div>

                {/* 8. 社會/活動 */}
                <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-xs font-bold text-white">社會 / 活動</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">C5 社會</span>
                    </div>
                    <span className="text-[11px] text-indigo-300 font-mono font-bold">
                      活動頻率: {c5.activityFrequency} · 鄰里信任: {c5.neighborhoodTrust}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
                    <span>資料來源：<strong className="text-slate-200">政府開放資料與持久化觀測</strong></span>
                    <span className="text-[10px] flex items-center gap-0.5">
                      <CheckCircle2 className="w-3 h-3" /> 已持久化
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: CALIBRATE */}
          {sheetTab === 'calibrate' && (

            <div className="space-y-4 pb-6">
              {/* Category selector chips */}
              <div className="flex gap-1.5 overflow-x-auto pb-1 text-xs">
                {(['C1', 'C2', 'C3', 'C4', 'C5'] as const).map((cat) => {
                  const names = {
                    C1: 'C1 安全',
                    C2: 'C2 機能',
                    C3: 'C3 移動',
                    C4: 'C4 綠意',
                    C5: 'C5 活力',
                  };
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCat(cat)}
                      className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition-all ${
                        selectedCat === cat
                          ? 'bg-indigo-600 text-white'
                          : 'bg-white/10 text-slate-400 hover:text-white'
                      }`}
                    >
                      {names[cat]}
                    </button>
                  );
                })}
              </div>

              {/* Auto Baseline Action */}
              <div className="flex items-center justify-between p-2.5 bg-white/5 rounded-xl border border-white/10 text-xs">
                <span className="text-slate-300">目前為現場校正數值</span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onResetToBaseline}
                    className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 text-[11px] flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>復原基準</span>
                  </button>
                  <button
                    type="button"
                    onClick={onAutoFetchBaseline}
                    disabled={isLoadingBaseline}
                    className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] flex items-center gap-1 disabled:opacity-50"
                  >
                    <Globe className="w-3 h-3" />
                    <span>{isLoadingBaseline ? '載入中...' : '帶入網路基準'}</span>
                  </button>
                </div>
              </div>

              {/* Sliders for selected category */}
              {selectedCat === 'C1' && (
                <div className="space-y-3 p-3 bg-black/40 rounded-2xl border border-white/5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-rose-400">C1 安全指標數值微調</span>
                    <span className="font-mono text-xs font-bold text-white">
                      得分: {c1.score ?? 'N/A'}分
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>犯罪治安率 (越低越好)</span>
                      <span className="font-mono text-slate-200">{c1.crimeRate} / 100</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={c1.crimeRate ?? ''}
                      onChange={(e) =>
                        onUpdateC1((prev) => ({ ...prev, crimeRate: parseInt(e.target.value, 10) }))
                      }
                      className="w-full accent-rose-500 cursor-pointer"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>交通事故件數 (越低越好)</span>
                      <span className="font-mono text-slate-200">{c1.accidentRate} / 100</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={c1.accidentRate ?? ''}
                      onChange={(e) =>
                        onUpdateC1((prev) => ({
                          ...prev,
                          accidentRate: parseInt(e.target.value, 10),
                        }))
                      }
                      className="w-full accent-rose-500 cursor-pointer"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>災害潛勢 (1安全 ~ 5高風險)</span>
                      <span className="font-mono text-slate-200">{c1.hazardLevel} 級</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={5}
                      value={c1.hazardLevel ?? ''}
                      onChange={(e) =>
                        onUpdateC1((prev) => ({
                          ...prev,
                          hazardLevel: parseInt(e.target.value, 10),
                        }))
                      }
                      className="w-full accent-rose-500 cursor-pointer"
                    />
                  </div>
                </div>
              )}

              {selectedCat === 'C2' && (
                <div className="space-y-3 p-3 bg-black/40 rounded-2xl border border-white/5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-400">C2 機能可及距離 (公尺)</span>
                    <span className="font-mono text-xs font-bold text-white">
                      得分: {c2.score ?? 'N/A'}分
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>生鮮超市距離 (公尺)</span>
                      <span className="font-mono text-slate-200">{c2.supermarketDist}m</span>
                    </div>
                    <input
                      type="range"
                      min={50}
                      max={1500}
                      step={50}
                      value={c2.supermarketDist ?? ''}
                      onChange={(e) =>
                        onUpdateC2((prev) => ({
                          ...prev,
                          supermarketDist: parseInt(e.target.value, 10),
                        }))
                      }
                      className="w-full accent-amber-500 cursor-pointer"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>便利商店距離 (公尺)</span>
                      <span className="font-mono text-slate-200">{c2.convenienceDist}m</span>
                    </div>
                    <input
                      type="range"
                      min={30}
                      max={1000}
                      step={20}
                      value={c2.convenienceDist ?? ''}
                      onChange={(e) =>
                        onUpdateC2((prev) => ({
                          ...prev,
                          convenienceDist: parseInt(e.target.value, 10),
                        }))
                      }
                      className="w-full accent-amber-500 cursor-pointer"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>診所藥局距離 (公尺)</span>
                      <span className="font-mono text-slate-200">{c2.clinicDist}m</span>
                    </div>
                    <input
                      type="range"
                      min={50}
                      max={1500}
                      step={50}
                      value={c2.clinicDist ?? ''}
                      onChange={(e) =>
                        onUpdateC2((prev) => ({
                          ...prev,
                          clinicDist: parseInt(e.target.value, 10),
                        }))
                      }
                      className="w-full accent-amber-500 cursor-pointer"
                    />
                  </div>
                </div>
              )}

              {selectedCat === 'C3' && (
                <div className="space-y-3 p-3 bg-black/40 rounded-2xl border border-white/5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-sky-400">C3 移動交通指標</span>
                    <span className="font-mono text-xs font-bold text-white">
                      得分: {c3.score ?? 'N/A'}分
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>捷運／鐵路車站距離</span>
                      <span className="font-mono text-slate-200">{c3.mrtOrRailDist}m</span>
                    </div>
                    <input
                      type="range"
                      min={100}
                      max={2000}
                      step={50}
                      value={c3.mrtOrRailDist ?? ''}
                      onChange={(e) =>
                        onUpdateC3((prev) => ({
                          ...prev,
                          mrtOrRailDist: parseInt(e.target.value, 10),
                        }))
                      }
                      className="w-full accent-sky-500 cursor-pointer"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>人行道完備度 (Walkability)</span>
                      <span className="font-mono text-slate-200">{c3.walkabilityScore}分</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={c3.walkabilityScore ?? ''}
                      onChange={(e) =>
                        onUpdateC3((prev) => ({
                          ...prev,
                          walkabilityScore: parseInt(e.target.value, 10),
                        }))
                      }
                      className="w-full accent-sky-500 cursor-pointer"
                    />
                  </div>
                </div>
              )}

              {selectedCat === 'C4' && (
                <div className="space-y-3 p-3 bg-black/40 rounded-2xl border border-white/5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-400">C4 環境綠意微調</span>
                    <span className="font-mono text-xs font-bold text-white">
                      得分: {c4.score ?? 'N/A'}分
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>空氣品質 AQI 評分 (高為優)</span>
                      <span className="font-mono text-slate-200">{c4.airQualityScore}分</span>
                    </div>
                    <input
                      type="range"
                      min={20}
                      max={100}
                      value={c4.airQualityScore ?? ''}
                      onChange={(e) =>
                        onUpdateC4((prev) => ({
                          ...prev,
                          airQualityScore: parseInt(e.target.value, 10),
                        }))
                      }
                      className="w-full accent-emerald-500 cursor-pointer"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>綠覆率 (%)</span>
                      <span className="font-mono text-slate-200">{c4.greenCoveragePct}%</span>
                    </div>
                    <input
                      type="range"
                      min={5}
                      max={60}
                      value={c4.greenCoveragePct ?? ''}
                      onChange={(e) =>
                        onUpdateC4((prev) => ({
                          ...prev,
                          greenCoveragePct: parseInt(e.target.value, 10),
                        }))
                      }
                      className="w-full accent-emerald-500 cursor-pointer"
                    />
                  </div>
                </div>
              )}

              {selectedCat === 'C5' && (
                <div className="space-y-3 p-3 bg-black/40 rounded-2xl border border-white/5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-purple-400">C5 社會活力微調</span>
                    <span className="font-mono text-xs font-bold text-white">
                      得分: {c5.score ?? 'N/A'}分
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>鄰里信任與守望度</span>
                      <span className="font-mono text-slate-200">{c5.neighborhoodTrust}分</span>
                    </div>
                    <input
                      type="range"
                      min={20}
                      max={100}
                      value={c5.neighborhoodTrust ?? ''}
                      onChange={(e) =>
                        onUpdateC5((prev) => ({
                          ...prev,
                          neighborhoodTrust: parseInt(e.target.value, 10),
                        }))
                      }
                      className="w-full accent-purple-500 cursor-pointer"
                    />
                  </div>
                </div>
              )}

              {/* On-site Checkboxes */}
              <div className="space-y-2 pt-1">
                <div className="text-xs font-bold text-slate-300">
                  {selectedCat} 現場實地觀察項目（勾選直接影響得分）
                </div>
                <div className="space-y-1.5">
                  {fieldChecks
                    .filter((item) => item.category === selectedCat)
                    .map((item) => (
                      <div
                        key={item.id}
                        onClick={() => onToggleFieldCheck(item.id)}
                        className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-2 ${
                          item.checked
                            ? 'bg-indigo-600/25 border-indigo-500/40 text-white'
                            : 'bg-white/5 border-white/5 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <div className="flex items-center gap-2 text-xs">
                          <div
                            className={`w-4 h-4 rounded flex items-center justify-center border ${
                              item.checked
                                ? 'bg-indigo-600 border-indigo-400 text-white'
                                : 'border-slate-500'
                            }`}
                          >
                            {item.checked && <Check className="w-3 h-3 stroke-[3]" />}
                          </div>
                          <span>{item.title}</span>
                        </div>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/40 text-slate-300">
                          {item.scoreImpact == null ? 'N/A' : item.scoreImpact > 0 ? `+${item.scoreImpact}` : item.scoreImpact}分
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: REPORT & NOTES */}
          {sheetTab === 'report' && (
            <div className="space-y-4 pb-6">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300">實勘診斷速報</span>
                <button
                  type="button"
                  onClick={handleCopyReport}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all ${
                    copied
                      ? 'bg-emerald-600 text-white'
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                  }`}
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>已複製報告</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>複製報告</span>
                    </>
                  )}
                </button>
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">現場筆記</label>
                <textarea
                  rows={3}
                  value={fieldNotes}
                  onChange={(e) => onUpdateNotes(e.target.value)}
                  placeholder="紀錄現場觀察，例如：巷口視距良好、下午 4 點車流少、附近綠樹成蔭..."
                  className="w-full text-xs p-3 bg-black/40 border border-white/10 rounded-xl focus:outline-none focus:border-indigo-500 text-white placeholder:text-slate-500"
                />
              </div>

              {/* Compact Formula Reference */}
              <div className="p-3 bg-white/5 rounded-xl border border-white/5 space-y-1.5 text-[11px] text-slate-300 font-mono">
                <div className="font-bold text-indigo-400">CLS 計算公式模型</div>
                <div>CLS = Σ (W_k × C_k)，Σ W_k = 1.0</div>
                <div className="text-slate-400 text-[10px] leading-relaxed">
                  C1: 100×(1 - (w1·Crime + w2·Accident + w3·Hazard)/max)
                  <br />
                  C2: Σ(S_j / d_ij^β) 15分鐘可及圈衰減
                  <br />
                  C3: 大眾運輸班次 + 人行道友善度 + 自行車
                  <br />
                  C4: 空氣 AQI + 噪音分貝 + 綠覆率 + 公園距離
                  <br />
                  C5: 社區活動 + 鄰里信任 + 就業商業 + 治理參與
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
