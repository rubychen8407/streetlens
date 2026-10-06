# StreetLens · 社區宜居指數實勘系統

> **用真實資料理解街道，也留下自己的實勘紀錄。**  
> 整合開放地理資料、CLS 宜居綜合評分、現場觀察校正與實拍佐證，協助您探索、收藏與比較理想的生活街道。

[![App](https://img.shields.io/badge/Live%20App-Render%20Web%20Service-blue?style=flat-square)](https://streetlens-fokj.onrender.com/)
[![React](https://img.shields.io/badge/Frontend-React%2019%20%2B%20Vite-61dafb?style=flat-square)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-3178c6?style=flat-square)](https://www.typescriptlang.org/)
[![Database](https://img.shields.io/badge/Database-PostgreSQL%20%2F%20Neon-336791?style=flat-square)](https://neon.tech/)

---

## 核心特色

- **高效極簡介面**：全新戰術導航 Dock 設計，告別擁擠頂欄；地圖標記採用簡潔圖示，無雜訊干擾。
- **5 大維度 CLS 綜合指標**：
  - **C1 安全熱點**（交通事故、安全防護與災害風險）
  - **C2 生活機能**（超市、便利商店、診所、文教設施距離與密度）
  - **C3 大眾交通**（捷運、公車站點、班次頻率與步行友善度）
  - **C4 綠意環境**（樹木覆蓋率、公園綠地可達性、空氣品質指標）
  - **C5 社區活力**（商業活力、多元公共設施與鄰里互信氛圍）
- ** 實勘模式（Field Walk Mode）**：現場步行感受即時反饋、拍照留存佐證，並支援鍵盤快捷鍵（`1` 喜歡、`2` 待改善、`c` 拍照）。
- ** Street Library（街道資料庫）**：離線優先儲存收藏地點、歷次評估歷程與實勘照片，輕鬆比較不同街區。
- ** Gemini AI 專業分析**：基於已保存的客觀資料生成街道宜居優缺點解讀，不捏造數據，亦不擅自竄改評分。

---

## 🧭 左側導航 Dock 結構

介面主要功能整合於左側垂直 Dock（行動端自適應於底部），直覺易用：

| 圖示 | 功能項目 | 說明 |
| :---: | :--- | :--- |
| <img src="https://api.iconify.design/lucide:layers.svg" width="18"/> | **圖層開關 (Layers)** | 隨選切換步行半徑圈 (300m/500m)、街道評分線與 C1~C5 圖層 |
| <img src="https://api.iconify.design/lucide:bar-chart-3.svg" width="18"/> | **街道數據 (Street Data)** | 瀏覽當前街道的 CLS 綜合分數、圖像化類別進度條與指標來源明細 |
| <img src="https://api.iconify.design/lucide:star.svg" width="18"/> | **我的最愛 (Street Library)** | 管理收藏地點、回顧歷史實勘紀錄與比對評估 |
| <img src="https://api.iconify.design/lucide:footprints.svg" width="18"/> | **實勘模式 (Walk Mode)** | 開啟即時實地探查，記錄行經街道時的現場感受與相片 |
| <img src="https://api.iconify.design/lucide:notebook-pen.svg" width="18"/> | **環境觀察 (Observations)** | 填寫 1–4 級結構化環境評分，由後端演算法計算合理的現場校正值 |
| <img src="https://api.iconify.design/lucide:database.svg" width="18"/> | **資料狀態 (Data Status)** | 查看外部資料庫連線、各來源更新時戳與資料庫容量報告 |
| <img src="https://api.iconify.design/lucide:sun.svg" width="18"/> | **淺色/深色切換 (Theme)** | 一鍵切換高對比 Apple Maps 風格深色模式與清新淺色模式 |
| <img src="https://api.iconify.design/lucide:settings.svg" width="18"/> | **個人設定 (Settings)** | 雙語切換（繁體中文 / English）與個人化偏好管理 |

---

## 資料原則與評分嚴謹性

StreetLens 嚴格遵循**真實資料防偽與高完整性原則**：

1. **拒絕隨機與假資料**：不使用合成 POI 或虛假隨機評分。
2. **快照先行架構**：評估 API 僅讀取 PostgreSQL 已保存的資料快照，不於使用者即時請求中發動脆弱的即時網頁爬蟲。
3. **推估模式透明化**：缺少實測值時標註 `estimated` 並附帶參考樣本數，不將缺少資料誤算為 `0` 分。
4. **現場微調邊界受限**：實勘感受與筆記僅在嚴格上限內調整分數，基準分數始終由真實客觀資料決定。
5. **歷史紀錄不可竄改**：歷史快照不因背景待補分數流程而遭到非預期覆寫。

---

## 外部資料來源

| 來源類別 | 主要資料集 | 用途說明 |
| :--- | :--- | :--- |
| **地理與設施** | Google Places、OpenStreetMap (OSM) / Overpass | 商店、超市、診所、文教等生活機能設施 |
| **大眾運輸** | 交通部 TDX 運輸資料流通服務 | 捷運路網、公車站點、即時班次與自行車站 |
| **城市環境** | 臺北市官方開放資料 (Data.Taipei) | 行道樹分佈、公園綠地、路燈照明、降溫點 |
| **安全防護** | 臺北市政府警察局、交通局開放資料 | 交通事故熱點統計、消防設施與防災潛勢 |
| **氣象與空氣** | Open-Meteo、環境部空品監測網 | 即時氣溫、體感溫度、AQI、PM2.5 指標 |

---

## 本機開發指南

### 1. 系統需求
- **Node.js 22+** 與 **npm**
- 可用的 **PostgreSQL** 資料庫（推薦使用免費 [Neon Serverless Postgres](https://neon.tech/)）

### 2. 安裝與設定
```bash
# 複製專案
git clone https://github.com/rubychen8407/streetlens.git
cd streetlens

# 安裝相依套件
npm ci

# 設定環境變數
cp .env.example .env
```

### 3. 環境變數說明 (`.env`)
```ini
DATABASE_URL="postgres://user:pass@host/dbname?sslmode=require"
DATABASE_SSL="true"
STREETLENS_REFRESH_TOKEN="your_secure_refresh_token_here"
# 選填服務金鑰
GEMINI_API_KEY=""
GOOGLE_MAPS_API_KEY=""
TDX_CLIENT_ID=""
TDX_CLIENT_SECRET=""
PORT=3000
```

### 4. 啟動開發伺服器
```bash
npm run dev
```
瀏覽器造訪 `http://localhost:3000` 即可進行開發與操作。

---

## 常用指令與 CI 驗證

| 指令 | 說明 |
| :--- | :--- |
| `npm run dev` | 啟動全端開發環境（前端 Vite + 後端 Express） |
| `npm run lint` | 執行 TypeScript 型別檢查（`tsc --noEmit`） |
| `npm run build` | 建置前端 SPA 與後端 Node.js Bundle |
| `npm start` | 執行建置後的正式環境伺服器 |
| `npm run ci` | 完整 CI 驗證門禁（含型別、建置、分數完整性、儲存預算與多斷點 Playwright 測試） |
| `npm run refresh:data` | 執行外部資料批次更新流程 |
| `npm run check:external-data` | 檢查外部 API 來源健康狀態 |
| `npm run db:storage` | 產出資料庫使用容量與預算報告 |

---

## 部署說明

專案提供完整的 **Render Web Service** 藍圖（`render.yaml`），搭配 Neon PostgreSQL：

1. 於 [Neon](https://neon.tech/) 建立 PostgreSQL 資料庫並取得連線字串。
2. 於 [Render](https://render.com/) 連結此 GitHub Repository。
3. 設定環境變數 `DATABASE_URL` 與 `STREETLENS_REFRESH_TOKEN`。
4. 建置指令：`npm ci && npm run build`；啟動指令：`npm start`。
5. 服務提供健康檢查端點：`GET /api/health`。

詳細說明請參閱 [`docs/deployment-free.md`](docs/deployment-free.md)。

---

## 專案結構

```
streetlens/
├── src/
│   ├── components/       # 地圖 (ScoutMap)、導航控制 (FloatingControls)、報告 (StreetReport)
│   ├── data/             # 5 大維度指標定義與權重預設值
│   ├── hooks/            # 導航狀態機、Street Library 儲存管理
│   ├── i18n/             # 繁體中文 / 英文雙語多國語系字典
│   ├── styles/           # 戰術 HUD 樣式、深淺色主題
│   └── utils/            # 評分計算、相片快取、離線儲存
├── server.ts             # Express 全端 API 服務
├── scoring.ts            # CLS 綜合評分、推估演算法與完整性政策
├── db.ts                 # PostgreSQL 資料庫連線池與快照存取
├── scripts/              # CI 驗證、Playwright 瀏覽器測試、批次更新腳本
└── docs/                 # 架構圖、資料管線、儲存預算說明文件
```

---

## 延伸文件

- [系統架構概覽 (Architecture)](docs/architecture.md)
- [資料更新管線 (Data Refresh)](docs/data-refresh.md)
- [實勘模式與現場觀察 (Walk Moments)](docs/walk-moments.md)
- [儲存容量預算 (Storage Budget)](docs/storage-budget.md)
- [介面設計原則 (Tactical Design)](docs/tactical-design.md)
