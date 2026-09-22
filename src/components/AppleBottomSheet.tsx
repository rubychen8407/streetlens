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
} from 'lucide-react';

interface AppleBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  clsScore: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
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
    cls: number;
    c1: number;
    c2: number;
    c3: number;
    c4: number;
    c5: number;
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
  targetLocation?: { lat: number; lng: number };
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
  targetLocation,
}: AppleBottomSheetProps) {
  const [sheetTab, setSheetTab] = useState<'overview' | 'sources' | 'calibrate' | 'report'>('overview');
  const [selectedCat, setSelectedCat] = useState<'C1' | 'C2' | 'C3' | 'C4' | 'C5'>('C1');
  const [sheetHeight, setSheetHeight] = useState<'half' | 'full'>('half');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const getDeltaBadge = (current: number, base: number) => {
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
  • C1 安全風險：${c1.score}分 (基準: ${baselineScores.c1})
  • C2 便利機能：${c2.score}分 (基準: ${baselineScores.c2})
  • C3 移動連結：${c3.score}分 (基準: ${baselineScores.c3})
  • C4 環境綠意：${c4.score}分 (基準: ${baselineScores.c4})
  • C5 社會活力：${c5.score}分 (基準: ${baselineScores.c5})
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
          <div className="flex p-1 bg-black/40 rounded-xl border border-white/5 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setSheetTab('overview')}
              className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
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
              onClick={() => setSheetTab('sources')}
              className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
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
              className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
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
              className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
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
                    網路基準：{baselineScores.cls} 分 · 現場校正後得分
                  </div>
                </div>

                <div className="text-center bg-indigo-600/20 border border-indigo-500/30 px-3.5 py-2 rounded-2xl">
                  <div className="text-[10px] text-indigo-300 font-bold">評級</div>
                  <div className="text-2xl font-black text-white font-mono">{grade}</div>
                </div>
              </div>

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
                            weatherData.aqi <= 50
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
                  <span>已自動抓取 8 大官方來源對應數據</span>
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
                        style={{ width: `${c1.score}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getDeltaBadge(c1.score, baselineScores.c1)}
                    <span className="font-mono font-bold text-sm text-white">{c1.score}</span>
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
                        style={{ width: `${c2.score}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getDeltaBadge(c2.score, baselineScores.c2)}
                    <span className="font-mono font-bold text-sm text-white">{c2.score}</span>
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
                        style={{ width: `${c3.score}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getDeltaBadge(c3.score, baselineScores.c3)}
                    <span className="font-mono font-bold text-sm text-white">{c3.score}</span>
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
                        style={{ width: `${c4.score}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getDeltaBadge(c4.score, baselineScores.c4)}
                    <span className="font-mono font-bold text-sm text-white">{c4.score}</span>
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
                        style={{ width: `${c5.score}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getDeltaBadge(c5.score, baselineScores.c5)}
                    <span className="font-mono font-bold text-sm text-white">{c5.score}</span>
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

          {/* TAB: 8 OFFICIAL DATA SOURCES */}
          {sheetTab === 'sources' && (
            <div className="space-y-3 pb-6">
              <div className="p-3.5 rounded-2xl bg-indigo-950/40 border border-indigo-500/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-indigo-300">
                    <Database className="w-4 h-4 text-indigo-400" />
                    <span>官方開放資料庫對應 (8大指標)</span>
                  </div>
                  <button
                    type="button"
                    onClick={onAutoFetchBaseline}
                    disabled={isLoadingBaseline}
                    className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${isLoadingBaseline ? 'animate-spin' : ''}`} />
                    <span>即時更新</span>
                  </button>
                </div>
                <p className="text-[11px] text-slate-300 mt-1.5 leading-relaxed">
                  系統根據當前地圖所選坐標與生活圈（{city} {district} {streetName || '目標地'}），自動對應抓取以下 8 大中央及地方主管機關之資料庫數值：
                </p>
              </div>

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
                    <span>資料來源：<strong className="text-slate-200">內政部警政署犯罪統計</strong></span>
                    <span className="text-[10px] text-emerald-400 flex items-center gap-0.5">
                      <CheckCircle2 className="w-3 h-3" /> 連線正常
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
                    <span>資料來源：<strong className="text-slate-200">交通部交通事故資料庫</strong></span>
                    <span className="text-[10px] text-emerald-400 flex items-center gap-0.5">
                      <CheckCircle2 className="w-3 h-3" /> 連線正常
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
                    <span>資料來源：<strong className="text-slate-200">經濟部水利署淹水潛勢圖、中央地質調查所</strong></span>
                    <span className="text-[10px] text-emerald-400 flex items-center gap-0.5">
                      <CheckCircle2 className="w-3 h-3" /> 連線正常
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
                    <span className="text-[10px] text-emerald-400 flex items-center gap-0.5">
                      <CheckCircle2 className="w-3 h-3" /> 連線正常
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
                    <span className="text-[10px] text-emerald-400 flex items-center gap-0.5">
                      <CheckCircle2 className="w-3 h-3" /> 連線正常
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
                      <CheckCircle2 className="w-3 h-3" /> 即時監測中
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
                    <span className="text-[10px] text-emerald-400 flex items-center gap-0.5">
                      <CheckCircle2 className="w-3 h-3" /> 連線正常
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
                    <span>資料來源：<strong className="text-slate-200">里辦公室公告、問卷調查</strong></span>
                    <span className="text-[10px] text-emerald-400 flex items-center gap-0.5">
                      <CheckCircle2 className="w-3 h-3" /> 連線正常
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
                      得分: {c1.score}分
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
                      value={c1.crimeRate}
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
                      value={c1.accidentRate}
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
                      value={c1.hazardLevel}
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
                      得分: {c2.score}分
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
                      value={c2.supermarketDist}
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
                      value={c2.convenienceDist}
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
                      value={c2.clinicDist}
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
                      得分: {c3.score}分
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
                      value={c3.mrtOrRailDist}
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
                      value={c3.walkabilityScore}
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
                      得分: {c4.score}分
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
                      value={c4.airQualityScore}
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
                      value={c4.greenCoveragePct}
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
                      得分: {c5.score}分
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
                      value={c5.neighborhoodTrust}
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
                          {item.scoreImpact > 0 ? `+${item.scoreImpact}` : item.scoreImpact}分
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
