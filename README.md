# StreetLens

**用真實資料理解街道，也留下自己的實勘紀錄。**

StreetLens 是街道層級的宜居評估地圖，整合外部資料、CLS 評分、現場觀察與照片，協助使用者探索、收藏及比較想居住的地點。

[開啟應用程式](https://streetlens-fokj.onrender.com/) · [GitHub](https://github.com/rubychen8407/streetlens)

## 功能

- **搜尋與地圖探索**：選擇地點，查看街道評估、指標來源與資料狀態。
- **CLS 評估**：由後端依據已儲存的外部資料計算分數，呈現觀測或推估模式及信心水準。
- **現場觀察**：以結構化環境觀察調整評分；調整由後端計算並限制幅度。
- **收藏與歷史**：保存地點、評估與照片，並比較歷史紀錄；尚未取得分數的紀錄顯示「CLS 待補」。
- **AI 解說**：Gemini 根據已儲存的評估解釋結果，不產生原始數據，也不決定分數。

### 使用流程

1. 搜尋地點或在地圖上選擇位置。
2. 查看 CLS、資料來源、更新時間與缺資料狀態。
3. 開啟環境觀察面板，確認正在評估的地點。
4. 填寫現場觀察，於儲存步驟加入筆記或佐證照片。
5. 在收藏、歷史與比較畫面回顧紀錄。

## 資料與評分原則

StreetLens 不使用隨機分數、合成 POI 數量或 AI 生成的外部測量值。

- 評估 API 讀取 PostgreSQL 已儲存的資料快照，不在使用者評估請求中爬取評分資料。
- 查詢會登記待更新座標，外部資料由獨立的批次更新流程取得並寫入資料庫。
- 尚未取得所需快照時，API 可回傳 HTTP `202`；畫面提供等待、重試與錯誤狀態。
- 缺少觀測值不等於數值為 `0`。有足夠真實參考資料時，部分類別可使用區域資料先驗推估，並標示 `estimated`、方法與參考樣本數；推估不代表該街道的實測值。
- 若仍有類別無法取得分數，總分維持 `null`，不以假資料補齊。
- 外部資料保留來源與時間等資訊；實勘調整由伺服器重新計算。
- 已有分數的歷史紀錄不因待補分數流程被覆寫。

目前分類涵蓋安全、生活機能、交通、綠意與環境，以及社區相關指標。計算與完整性規則見 [`scoring.ts`](scoring.ts)。

### 外部資料來源

| 來源 | 用途 |
| --- | --- |
| Google Places、OpenStreetMap / Overpass | POI、生活機能及部分街道與設施資料 |
| TDX | 大眾運輸資料 |
| 臺北市官方開放資料 | 行道樹、公園樹木、交通事故、淹水潛勢與歷史淹水等 |
| 臺北市公共設施資料 | YouBike、醫療、路燈、公車站、捷運、圖書館、公廁、公園、自行車道、人行道、市場、降溫點、AED、消防栓與消防站等 |
| Open-Meteo、臺北市官方空品資料 | 空氣品質相關指標 |

資料涵蓋範圍、時間與完整度依來源而異；臺北市專屬資料不能視為其他城市也有相同覆蓋率。已接入資料來源不代表每個地點或每個欄位都可用。

## 技術架構

| 層級 | 技術與責任 |
| --- | --- |
| 前端 | React 19、TypeScript、Vite、Tailwind CSS、Leaflet |
| 後端 | Node.js、Express、TypeScript；評估與實勘調整計算 |
| 資料庫 | PostgreSQL / Neon；外部快照、評估、證據與照片 |
| AI 解說 | Google Gemini；解釋既有評估 |
| 座標轉換 | proj4；處理官方資料的座標系統 |
| 驗證 | TypeScript、回歸測試、Playwright、GitHub Actions |
| 部署 | Render Web Service；設定見 `render.yaml` |

評分資料流：**外部來源 → 批次更新 → PostgreSQL 快照 → 評估 API → 地圖與 CLS**。實勘紀錄先保存在瀏覽器，再於背景同步到伺服器。

## 本機開發

### 需求

- Node.js 22 與 npm（與目前 CI 使用版本一致）。
- 可連線的 PostgreSQL 資料庫；可使用 Neon。
- 需要使用特定外部來源或 Gemini 時，設定對應憑證。

```bash
git clone https://github.com/rubychen8407/streetlens.git
cd streetlens
npm ci
cp .env.example .env
```

編輯 `.env` 後啟動：

```bash
npm run dev
```

開啟 `http://localhost:3000`。伺服器啟動時會建立目前原型所需的資料表。新資料庫尚無外部快照時，評估可能顯示待更新；請依下方流程執行資料更新。

### 環境變數

| 變數 | 說明 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 連線字串；持久化資料所需 |
| `DATABASE_SSL` | 範例預設 `true`；依資料庫連線需求設定 |
| `STREETLENS_REFRESH_TOKEN` | 保護內部資料更新端點的長隨機 token；執行更新時必須設定 |
| `GOOGLE_MAPS_API_KEY` | 選填；Google 資料來源憑證 |
| `TDX_CLIENT_ID` / `TDX_CLIENT_SECRET` | 選填；TDX 資料來源憑證 |
| `GEMINI_API_KEY` | 選填；AI 解說所需 |
| `PORT` | 選填；伺服器預設 `3000` |

API 憑證與資料庫連線字串只放在伺服器環境，請勿提交 `.env` 或放進前端程式碼。未設定選填憑證時，對應功能可能不可用。

## 外部資料更新

先啟動伺服器、查詢需要評估的位置以登記更新目標，再執行：

```bash
STREETLENS_REFRESH_URL=http://localhost:3000 \
STREETLENS_REFRESH_TOKEN=your-refresh-token \
npm run refresh:data
```

請將 `your-refresh-token` 換成與伺服器相同的值。這支腳本直接讀取程序環境變數，不會自動載入 `.env`。

- `STREETLENS_REFRESH_URL` 也可替換為部署後的服務網址；腳本亦支援 `STREETLENS_BASE_URL`。
- 腳本依來源呼叫 `POST /api/internal/refresh-data`，輸出更新、跳過與錯誤數量。
- 伺服器依各來源的更新週期判斷是否到期；內容雜湊未變更時避免重複寫入。
- 目前 `scheduled-data-refresh.yml` 每六小時觸發一次（UTC cron `17 */6 * * *`），實際來源更新由伺服器判斷。Actions 排程並非即時保證。
- GitHub Actions 需設定 `STREETLENS_REFRESH_URL`（或 `STREETLENS_BASE_URL`）與 `STREETLENS_REFRESH_TOKEN` secrets。

外部服務、憑證或網路失敗可能導致更新不完整；請查看腳本摘要及各來源狀態。

## 開發與驗證指令

| 指令 | 用途 |
| --- | --- |
| `npm run dev` | 啟動開發伺服器 |
| `npm run lint` | TypeScript 型別檢查（`tsc --noEmit`） |
| `npm run build` | 建置前端與後端 |
| `npm start` | 啟動建置後的服務 |
| `npm run ci` | 型別檢查、建置、評分完整性、評估政策、快照保存與實勘回歸測試 |
| `npm run check:external-data` | 外部資料來源健康檢查；需另外確認網路與憑證 |
| `npm run refresh:data` | 執行外部資料批次更新 |
| `npm run db:storage` | 唯讀資料庫容量報告 |

首次執行瀏覽器測試前：

```bash
npx playwright install --with-deps chromium --only-shell
npm run ci
```

外部資料健康檢查與確定性的 CI 分開執行；CI 通過不代表所有外部 API 都正常。原生相機與 HEIC 照片仍需實機驗證。開發協作規則見 [`AGENTS.md`](AGENTS.md)。

## 部署

目前專案提供 Render Blueprint，搭配 Neon PostgreSQL：

1. 建立 PostgreSQL 資料庫並取得連線字串。
2. 在 Render 連接此 GitHub repository，使用 `render.yaml` 建立服務。
3. 設定 `DATABASE_URL`、`STREETLENS_REFRESH_TOKEN` 與所需 API 憑證。
4. Blueprint 使用 `npm ci && npm run build` 建置，使用 `npm start` 啟動。
5. 檢查 `/api/health`，再確認地圖、資料更新、評估保存與重新載入流程。

詳細操作見 [`docs/deployment-free.md`](docs/deployment-free.md)。服務休眠或冷啟動可能增加首次載入時間；資料庫與部署方案的額度請以供應商目前條件為準。

## 紀錄保存與限制

- 目前使用瀏覽器產生的匿名 `workspaceId` 識別紀錄，尚非正式帳號登入與跨裝置同步機制。
- 實勘紀錄先寫入 localStorage，照片先寫入 IndexedDB；成功同步後才有伺服器副本。
- 「已存於此裝置，等待同步」代表尚未確認伺服器保存。清除瀏覽器資料可能刪除未同步紀錄。
- 目前伺服器照片儲存在 PostgreSQL `BYTEA`，每張上限 5 MB；容量規劃見 [`docs/storage-budget.md`](docs/storage-budget.md)。
- 本應用程式不提供離線地圖或 iOS 原生背景紀錄。
- CLS 是依現有資料與方法計算的探索工具；判讀時應一併查看資料時效、缺值與推估標示。

## 專案結構

| 路徑 | 內容 |
| --- | --- |
| `src/App.tsx`、`src/components/` | 地圖、評估面板、實勘與介面元件 |
| `src/hooks/`、`src/utils/` | 面板狀態、保存、照片與 API 邏輯 |
| `src/data/` | 指標與結構化實勘定義 |
| `server.ts` | Express API 與資料更新協調 |
| `scoring.ts` | 評分、推估、實勘調整與完整性規則 |
| `db.ts`、`assessmentDb.ts` | 外部快照及評估持久化 |
| `green.ts`、`safety.ts`、`transit.ts`、`official.ts` | 外部來源與官方資料處理 |
| `scripts/` | 更新、健康檢查、容量報告與測試 |
| `.github/workflows/` | CI、健康檢查與資料更新工作流程 |
| `docs/` | 架構、部署、設計、實勘與儲存文件 |

## 延伸文件

- [系統架構](docs/architecture.md)
- [資料更新架構](docs/data-refresh.md)
- [部署設定](docs/deployment-free.md)
- [環境觀察與延遲 CLS](docs/walk-moments.md)
- [儲存容量規劃](docs/storage-budget.md)
- [介面設計規範](docs/tactical-design.md)

若文件與程式碼存在差異，請以目前程式碼及 workflow 設定為準。此 README 的更新排程與推估說明依主分支實作整理。

## 授權

目前 repository 未提供專案 `LICENSE`。外部資料、地圖服務、字型與第三方套件各自適用其授權及使用條款。

