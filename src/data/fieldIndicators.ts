import { FieldCheckItem, CLSWeights, FieldObservationDefinition } from '../types';

export const DEFAULT_CLS_WEIGHTS: CLSWeights = {
  wC1: 0.20,
  wC2: 0.20,
  wC3: 0.20,
  wC4: 0.20,
  wC5: 0.20,
};

// PCA 參考權重 (依據主成分分析方差貢獻度：生活機能與交通連結權重略高)
export const PCA_SUGGESTED_WEIGHTS: CLSWeights = {
  wC1: 0.18,
  wC2: 0.25,
  wC3: 0.24,
  wC4: 0.18,
  wC5: 0.15,
};

export const INITIAL_FIELD_CHECKS: FieldCheckItem[] = [
  // C1 安全與風險
  {
    id: 'c1_lighting',
    category: 'C1',
    title: '夜間照明充足',
    description: '巷弄路燈密集度高，夜間無昏暗死角，視線良好',
    checked: true,
    scoreImpact: 5,
  },
  {
    id: 'c1_cctv',
    category: 'C1',
    title: '里民監視系統覆蓋',
    description: '主要路口與巷弄皆設有警政/里辦公室高解析度監視器',
    checked: true,
    scoreImpact: 5,
  },
  {
    id: 'c1_fire_access',
    category: 'C1',
    title: '巷弄違停阻礙消防通道',
    description: '現場發現機車或汽車佔用紅線，路寬小於4米影響救災消防車出入',
    checked: false,
    scoreImpact: -10,
  },
  {
    id: 'c1_flood_mark',
    category: 'C1',
    title: '排水溝清淤與防汛',
    description: '側溝暢通無淤塞臭味，無過往豪雨積水痕跡',
    checked: true,
    scoreImpact: 4,
  },

  // C2 便利與機能
  {
    id: 'c2_supermarket',
    category: 'C2',
    title: '生鮮超市步行即達',
    description: '500m 內有全聯、家樂福超市或傳統早市，食材採買便利',
    checked: true,
    scoreImpact: 7,
  },
  {
    id: 'c2_convenience',
    category: 'C2',
    title: '24小時超商密集',
    description: '200m 內有 7-11 或全家超商，代收與基本急需機能完備',
    checked: true,
    scoreImpact: 6,
  },
  {
    id: 'c2_medical',
    category: 'C2',
    title: '基層醫療院所與藥局',
    description: '附近有小兒/家醫/牙醫診所及健保特約藥局',
    checked: true,
    scoreImpact: 5,
  },
  {
    id: 'c2_retail_gap',
    category: 'C2',
    title: '外食餐飲選擇匱乏',
    description: '周邊多為純住宅或工廠，日常用餐需依賴外送或開車',
    checked: false,
    scoreImpact: -8,
  },

  // C3 移動與連結
  {
    id: 'c3_sidewalk_quality',
    category: 'C3',
    title: '實體人行道平整連續',
    description: '設有實體緣石或綠色標線人行道，嬰兒車/輪椅通行無阻',
    checked: true,
    scoreImpact: 8,
  },
  {
    id: 'c3_sidewalk_blocked',
    category: 'C3',
    title: '人行道遭佔用或斷點',
    description: '人行道被機車停放、盆栽或商家斜坡佔據，需與車爭道',
    checked: false,
    scoreImpact: -10,
  },
  {
    id: 'c3_youbike',
    category: 'C3',
    title: 'YouBike 站點與調度',
    description: '步行 3 分鐘內有公共自行車站點，平日尖峰借還車順暢',
    checked: true,
    scoreImpact: 6,
  },
  {
    id: 'c3_blind_corner',
    category: 'C3',
    title: '路口視線死角與反光鏡',
    description: '無號誌路口視線受擋且無反光鏡，車速快容易擦撞',
    checked: false,
    scoreImpact: -7,
  },

  // C4 環境與綠意
  {
    id: 'c4_park_walk',
    category: 'C4',
    title: '鄰里公園綠地步程內',
    description: '300m 內有帶狀綠廊、社區公園或校園操場開放空間',
    checked: true,
    scoreImpact: 8,
  },
  {
    id: 'c4_street_trees',
    category: 'C4',
    title: '街道行道樹遮蔭良好',
    description: '道路兩旁植栽茂密，夏日具良好遮蔭降溫效應',
    checked: true,
    scoreImpact: 5,
  },
  {
    id: 'c4_traffic_noise',
    category: 'C4',
    title: '臨路重車高分貝噪音',
    description: '正對主幹道或高架橋，公車大卡車與改裝車呼嘯噪音明顯',
    checked: false,
    scoreImpact: -10,
  },
  {
    id: 'c4_odor_exhaust',
    category: 'C4',
    title: '餐飲油煙或廢氣排放',
    description: '一樓店面油煙未經靜電機直排或巷口有固定垃圾堆置異味',
    checked: false,
    scoreImpact: -8,
  },

  // C5 社會與活力
  {
    id: 'c5_neighborhood_vibe',
    category: 'C5',
    title: '白天鄰里活動熱絡',
    description: '街道白天有常態行人、店家互動，氛圍溫馨安全有凝聚力',
    checked: true,
    scoreImpact: 6,
  },
  {
    id: 'c5_community_board',
    category: 'C5',
    title: '里辦公室與社區公告活躍',
    description: '布告欄有定期里民研習、健檢、環保志工與節慶活動',
    checked: true,
    scoreImpact: 5,
  },
  {
    id: 'c5_store_vacant',
    category: 'C5',
    title: '街區店面閒置率高',
    description: '沿街鐵捲門長期拉下出租或招租，商業人潮衰退顯得蕭條',
    checked: false,
    scoreImpact: -8,
  },
  {
    id: 'c5_senior_friendly',
    category: 'C5',
    title: '長者與幼童友善設施',
    description: '周邊設有社區關懷據點、親子共融遊戲場或長照日間中心',
    checked: true,
    scoreImpact: 5,
  },
];


const RATING_SCALE = [1, 2, 3, 4] as const;
const RATING_LABELS = ['Poor', 'Fair', 'Good', 'Great'] as const;

function toObservationDefinition(item: FieldCheckItem): FieldObservationDefinition {
  if (item.scoreImpact == null) {
    throw new Error(`Field observation ${item.id} is missing scoreImpact`);
  }
  return {
    id: item.id,
    category: item.category,
    title: item.title,
    description: item.description,
    ratingScale: RATING_SCALE,
    ratingLabels: RATING_LABELS,
    scoreImpact: item.scoreImpact,
    evidenceRequirement: 'note_recommended',
  };
}

// Single canonical definition used by scoring and the assessment UI. The legacy
// INITIAL_FIELD_CHECKS remains available for compatibility with older callers.
export const FIELD_OBSERVATION_DEFINITIONS: FieldObservationDefinition[] =
  INITIAL_FIELD_CHECKS.map(toObservationDefinition);
