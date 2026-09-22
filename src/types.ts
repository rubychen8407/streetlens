export interface LocationCoord {
  lat: number;
  lng: number;
}

// C1: 安全與風險指數 (Safety & Risk Index, SRI)
// SRI = 100 * (1 - (w1*Crime + w2*Accident + w3*Hazard) / maxScore)
export interface C1Data {
  crimeRate: number;      // 0~100 (每千人犯罪件數標準化，越低越好)
  accidentRate: number;   // 0~100 (每萬車公里事故數標準化，越低越好)
  hazardLevel: number;    // 0~100 (淹水/地震/順向坡 1~5 級轉為 0~100，越低越好)
  wCrime: number;         // 權重 (預設 0.333)
  wAccident: number;      // 權重 (預設 0.333)
  wHazard: number;        // 權重 (預設 0.333)
  score: number;          // 0~100 (越高越安全)
}

// C2: 便利與機能指數 (Amenity Accessibility Index, AAI)
// AAI_i = sum(S_j / (d_ij ^ beta))
export interface C2Data {
  supermarketDist: number; // 最近生鮮超市步行距離 (m)
  convenienceDist: number; // 最近便利超商步行距離 (m)
  clinicDist: number;      // 最近診所/藥局距離 (m)
  schoolDist: number;      // 最近國中小學距離 (m)
  bankPostDist: number;    // 最近金融郵局距離 (m)
  decayBeta: number;       // 衰減係數 beta (1.0 ~ 2.0, 預設 1.5)
  poiDensityCount: number; // 500m 內主要生活機能 POI 總量
  score: number;           // 0~100 (Walk Score 衰減標準化後)
}

// C3: 移動與連結指數 (Mobility & Connectivity Index, MCI)
// MCI = w1*Transit + w2*Walk + w3*Bike
// Transit = (1/K) * sum( (班次_k / max班次) * (1 / (1 + d_k/500)) ) * 100
export interface C3Data {
  mrtOrRailDist: number;   // 捷運或鐵路站點距離 (m)
  busStopDist: number;     // 最近公車站牌距離 (m)
  busFrequencyScore: number; // 班次密度與距離衰減分數 (0~100)
  walkabilityScore: number;// 人行道完備度、路口密度、無障礙設施 (0~100)
  bikeLaneScore: number;   // 自行車道密度與 YouBike 友善度 (0~100)
  wTransit: number;        // 權重 (預設 0.4)
  wWalk: number;           // 權重 (預設 0.35)
  wBike: number;           // 權重 (預設 0.25)
  score: number;           // 0~100
}

// C4: 環境與綠意指數 (Environment & Greenness Index, EGI)
// EGI = w1*Air + w2*Noise + w3*Green + w4*ParkAccess
export interface C4Data {
  airQualityScore: number; // 空氣品質逆向分數 (PM2.5 / AQI 0~100, 越好越高分)
  noiseScore: number;      // 噪音評估逆向分數 (分貝逆向 0~100, 越安靜越高分)
  greenCoveragePct: number;// 綠覆率 % (0~100)
  parkDistance: number;    // 最近公園綠地距離 (m)
  parkAccessScore: number; // 公園可及性距離衰減分 (0~100)
  wAir: number;            // 0.25
  wNoise: number;          // 0.25
  wGreen: number;          // 0.25
  wPark: number;           // 0.25
  score: number;           // 0~100
}

// C5: 社會與活力指數 (Social & Vitality Index, SVI)
// SVI = w1*Activity + w2*Trust + w3*Jobs + w4*Governance
export interface C5Data {
  activityFrequency: number;     // 社區活動頻率 (每月活動數標準化 0~100)
  neighborhoodTrust: number;     // 鄰里信任度/治安安心感 (0~100)
  jobCommercialDensity: number;  // 500m 內就業機會與商圈活力 (0~100)
  governanceParticipation: number;// 里民參與度與地方自治活力 (0~100)
  wActivity: number;             // 0.25
  wTrust: number;                // 0.25
  wJobs: number;                 // 0.25
  wGovernance: number;           // 0.25
  score: number;                 // 0~100
}

// CLS 綜合指標權重 (總和 1.0)
export interface CLSWeights {
  wC1: number; // 安全與風險 (預設 0.2)
  wC2: number; // 便利與機能 (預設 0.2)
  wC3: number; // 移動與連結 (預設 0.2)
  wC4: number; // 環境與綠意 (預設 0.2)
  wC5: number; // 社會與活力 (預設 0.2)
}

// 實勘現場勾選與校正項目
export interface FieldCheckItem {
  id: string;
  category: 'C1' | 'C2' | 'C3' | 'C4' | 'C5';
  title: string;
  description: string;
  checked: boolean;
  scoreImpact: number; // 分數加減影響 (例如人行道被佔用 -10, 有夜間巡守隊 +5)
}

// 地圖上的 POI 標記
export interface POIMarker {
  id: string;
  name: string;
  category: 'C1' | 'C2' | 'C3' | 'C4' | 'C5';
  lat: number;
  lng: number;
  distanceMeters: number;
  scale?: number;
  note?: string;
}

// 街道段評分覆蓋線
export interface StreetSegmentScore {
  id: string;
  name: string;
  coords: [number, number][];
  clsScore: number;
  c1: number;
  c2: number;
  c3: number;
  c4: number;
  c5: number;
}

// 完整社區宜居度評估結果物件
export interface CommunityLivabilityAssessment {
  id: string;
  streetName: string;
  district: string;
  city: string;
  coords: LocationCoord;
  timestamp: number;
  clsScore: number; // 0~100 (Community Livability Score)
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  weights: CLSWeights;
  weightMode: 'equal' | 'pca' | 'custom';
  
  // 指標資料 (包含基準值與實勘值)
  c1: C1Data;
  c2: C2Data;
  c3: C3Data;
  c4: C4Data;
  c5: C5Data;

  // 原始基準值 (未經現場校正前)
  baselineScores: {
    cls: number;
    c1: number;
    c2: number;
    c3: number;
    c4: number;
    c5: number;
  };

  fieldNotes: string;
  fieldChecks: FieldCheckItem[];
  dataSourceSummary: string;
}

export interface WeatherData {
  temperature: number;
  humidity: number;
  weatherCode: number;
  condition: string;
  aqi: number;
  aqiStatus: '良好' | '普通' | '對敏感族群不健康' | '不健康';
  pm25: number;
  stationName: string;
  windSpeed?: number;
}

export interface IndicatorSourceItem {
  indicator: string;
  category: 'C1' | 'C2' | 'C3' | 'C4' | 'C5';
  source: string;
  currentValue: string;
  score: number;
  status: 'active' | 'loading';
}
