// Source text is also a stable lookup key; user-authored content is never translated.
const pairs = `
住宅行情|Residential market
純住宅成交|Residential sales only
請先選擇有街道名稱及行政區的地點。|Select a named street and district first.
不限|Any
最低總價（萬）|Min total (NT$10k)
最高總價（萬）|Max total (NT$10k)
成交期間|Transaction period
房屋型態|Property type
更多房屋條件|More housing filters
最低建物坪數|Min floor area (ping)
最高建物坪數|Max floor area (ping)
房數|Bedrooms
最高屋齡（成交時）|Max age at transaction
最低樓層|Min floor
最高樓層|Max floor
電梯|Elevator
車位|Parking
包含特殊交易|Include special transactions
套用住宅篩選|Apply housing filters
讀取住宅成交資料|Loading residential transactions
住宅資料暫時無法讀取，請稍後重試。|Housing data is temporarily unavailable. Try again later.
請確認最小值不大於最大值，且篩選條件有效。|Check that minimum values do not exceed maximums and filters are valid.
此縣市住宅資料尚未匯入，尚無法提供成交行情。|Residential transactions have not been imported for this city yet.
平均成交總價|Average total sale price
平均成交單價|Average sale price per ping
符合條件|Matching sales
單價樣本|Unit-price samples
總價中位數|Median total price
最近符合篩選成交|Latest matching sale
已匯入資料中沒有符合條件的住宅成交；不代表街道沒有交易。|No matching residential sales in imported data; this does not mean no transactions occurred.
（含車位）|(includes parking)
成交時屋齡|Age at transaction
特殊交易|Special transaction
縣市已匯入交易日期|Imported transaction dates for city
資料擷取日期|Data retrieved
以整條道路及段別比對，非 CLS 的 250 公尺路段。總價含車位；單價僅採可拆車位資料。坪數含公設；屋齡為成交時。|Matched by road and section, not the CLS 250 m portion. Total includes parking; unit prices use separable parking data only. Area includes shared spaces; age is at transaction.
在售房源尚未接入；以下開啟外部網站，需在原站設定住宅及價格條件。|Live listings are not connected. These links open external sites; set residential and price filters there.
來源：內政部實價登錄開放資料|Source: Ministry of the Interior open transaction data
萬／坪|NT$10k / ping
坪|ping
房|bedrooms
樓|floor
公寓|Walk-up apartment
華廈|Mid-rise apartment
住宅大樓|Residential tower
透天厝|Townhouse
套房|Studio

街道地圖|Street map
點選街道查看評估；鍵盤 Enter 查看地圖中心。|Select a street to view its assessment; press Enter to assess the map centre.
外部 CLS 以路段共用取樣點計算；總分另加此筆實勘調整。|External CLS uses the street portion's shared sampling point; the final score adds this visit's field adjustment.
讀取最新共用外部 CLS，保留此筆實勘加減分。|Reading the latest shared external CLS while retaining this visit's field adjustment.
🎯 評估地點|🎯 Assessment location
最愛可追蹤街道；地點紀錄保留實勘感受、照片與環境觀察。|Favorites track streets; place records preserve walk impressions, photos and environment observations.
返回地圖|Back to map
返回實勘|Back to field walk
返回環境觀察|Back to environment observations
返回資料狀態|Back to data status
1–4 級環境評分、筆記與佐證|1–4 environment ratings, notes and evidence
喜歡、不喜歡與拍照；不影響 CLS 分數。|Like, dislike and capture photos; does not affect CLS scores.
查看此地全部紀錄（照片、筆記與感受保留）|View all records here (photos, notes and impressions preserved)
歷次紀錄|Visit history
CLS 以已儲存的外部資料計算；環境觀察另記為觀察調整。|CLS uses persisted external data; environment observations are recorded separately as observation adjustments.
觀察筆記|Observation notes
街道紀錄照片|Street record photo
將評估地點設在目前 GPS 位置|Set the assessment location to the current GPS position
🎯 設為評估地點|🎯 Set assessment location
快速選取熱門評估地點：|Quick assessment location presets:
個人設定|Profile settings
語言|Language
外觀|Appearance
深色模式|Dark mode
淺色模式|Light mode
實勘|Field walk
CLS 結果報告|CLS report
環境觀察|Environment observations
資料狀態|Data status
街道資料庫|Street Library
街道數據總覽|Street overview
街道情報|STREET INTELLIGENCE
01／總覽|01 / OVERVIEW
CLS 基準|CLS BASELINE
安全|Safety
機能|Amenities
移動|Mobility
綠意|Greenery
活力|Vitality
選擇街道|Select a street
CLS 待補|CLS pending
街道宜居指數|Street livability index
待補|Pending
等待資料更新|Waiting for data update
含推估 · 查看依據|Includes estimates · View evidence
目前評估結果|Current assessment
查看評估與資料來源|View assessment and sources
五大面向|Five categories
推估|Estimated
 · 推估| · Estimated
點選地圖探索街道 · 開啟步行記下感受|Select a street on the map · Start a walk to record your impressions
地點功能|Location tools
搜尋地點|Search locations
搜尋地點或輸入座標|Search a location or enter coordinates
清除搜尋|Clear search
清除|Clear
輸入地址、街道名稱或經緯度|Enter an address, street name or coordinates
使用座標|Use coordinates
定位到目前位置|Locate me
CLS 載入狀態|CLS loading status
重試 CLS|Retry CLS
重試|Retry
關閉 CLS 提示|Dismiss CLS notice
CLS 尚未就緒|CLS not ready
正在讀取 CLS…|Loading CLS…
目前選取地點|Selected location
C1 安全|C1 Safety
C2 生活機能|C2 Amenities
C3 交通|C3 Transit
C4 綠意環境|C4 Environment
C5 社區|C5 Community
外部資料 CLS|Source data CLS
現場調整|Field adjustment
加入最愛|Add to favorites
取消最愛|Remove from favorites
已收藏|Favorited
收藏街道|Favorite street
使用者現場感受|Your impressions on site
喜歡|Like
不喜歡|Dislike
拍照紀錄|Photo record
定位精度 ±|GPS accuracy ±
CLS 分類結果|CLS category results
查看指標來源與資料時間|View indicator sources and data timestamps
現場環境觀察|On-site environment observations
實勘說明|Field notes
照片與佐證|Photos and evidence
街道實勘照片|Street walk photo
照片目前無法載入|Photo unavailable
未提供照片說明|No photo caption
這筆紀錄沒有照片。|This record has no photos.
AI 解說|AI explanation
分析中…|Analyzing…
重新產生|Regenerate
產生 AI 解說|Generate AI explanation
先將此評估儲存至 Street Library，即可產生以該筆報告資料為依據的解說。|Save this assessment to Street Library to generate an explanation grounded in its report data.
優點|Strengths
資料限制|Limitations
現場觀察|Field observations
後續確認|Follow-up checks
步行感受|Walk impressions
後鏡頭即時畫面|Live rear camera
重新開啟相機|Reopen camera
正在開啟後鏡頭…|Opening rear camera…
實勘模式|Field walk mode
正在定位…|Locating…
正在取得 GPS 位置…|Getting GPS location…
 · 等待有效定位| · Waiting for a valid location
重新定位|Retry location
結束步行|End walk
喜歡這裡|Like this place
喜歡並自動儲存（1）|Like and save automatically (1)
不喜歡並自動儲存（2）|Dislike and save automatically (2)
擷取目前畫面並自動儲存（C）|Capture current frame and save automatically (C)
儲存中…|Saving…
拍下畫面|Capture frame
詳細環境觀察|Detailed environment observations
此瀏覽器不支援定位。|This browser does not support geolocation.
請允許位置存取，再重試定位。|Allow location access, then retry.
暫時無法定位，請移到戶外後重試。|Location unavailable. Move outdoors and retry.
相機已中斷，請重新開啟。|Camera disconnected. Reopen it.
請允許相機存取，才能顯示實勘畫面。|Allow camera access to show the field walk view.
目前無法開啟相機，請確認使用 HTTPS、相機可用且未被其他程式佔用。|Cannot open the camera. Use HTTPS and check that the camera is available and not in use by another app.
正在等待有效定位，請稍後再試。|Waiting for a valid location. Try again shortly.
已記下喜歡，並加入最愛。|Like recorded and added to favorites.
已記下不喜歡。|Dislike recorded.
尚未儲存，請重試。|Not saved. Please retry.
相機尚未就緒。|Camera not ready.
實勘相機畫面|Field walk camera frame
目前畫面與位置已儲存。|Current frame and location saved.
畫面未儲存，請重試。|Frame not saved. Please retry.
街道結果報告|Street report
街道評估面板|Street assessment panel
關閉報告|Close report
返回 Street Library|Back to Street Library
關閉 Street Library|Close Street Library
返回評估|Back to assessment
關閉評估|Close assessment
CLS 街道報告|CLS street report
現場觀察與佐證|Field observations and evidence
收藏、街道與歷次評估|Favorites, streets and assessment history
觀察|Observe
儲存|Save
客觀資料|Objective data
為何是這個分數？|Why this score?
查看有資料依據的分類分數與指標來源。|See the source-backed category scores and factor provenance.
資料品質|Data quality
推估分類使用已儲存的真實參考觀察資料，並非捏造街道資料。|Estimated categories use persisted real reference observations, not fabricated street-level values.
目前五大分類均使用本地來源的觀察資料。|All five categories currently use local source-backed observations.
沒有可用的指標明細。|No factor details available.
CLS 依有來源依據的評估模型計算。現場觀察另行紀錄，不會直接加進外部資料分數。|CLS is calculated from the source-backed assessment model. Field observations are recorded separately and are not silently added to the external-data score.
外部資料狀態|External data status
評分僅讀取已儲存的來源快照。背景更新期間不會顯示佔位分數。|Scoring data is read from persisted source snapshots only. No placeholder values are shown while background refresh is pending.
淹水風險|Flood risk
交通|Transit
空氣品質|Air quality
綠地|Green space
社區|Community
無標示淹水區域|No mapped inundation
來源資料可用|Source data available
官方模型未標示此處區域|Official model has no mapped area here
資料不可用|Data unavailable
來源不可用|Source unavailable
未知來源|Unknown source
官方在地服務|Official local services
此地附近已儲存的官方清冊。這些數值是來源佐證，僅評分模型定義的指標會影響 CLS。|Persisted official inventories near this location. These values are source evidence; only metrics defined by the scoring model affect CLS.
YouBike 可借車數|YouBike bikes
自行車道 · 500m|Bike lane · 500m
人行道覆蓋 · 500m|Sidewalk coverage · 500m
醫療|Medical
公車站|Bus stop
捷運站|MRT station
圖書館 · 800m|Libraries · 800m
公廁 · 800m|Public toilets · 800m
路燈 · 300m|Street lights · 300m
公園 · 800m|Parks · 800m
歷史淹水紀錄|Historical flood records
此地附近的官方歷史淹水紀錄，僅作佐證，不會直接改變 CLS。|Official historical inundation records near this location. These records are shown as evidence and do not directly change CLS.
日期不可用|Date unavailable
深度不可用|Depth unavailable
地點不可用|Location unavailable
500 公尺內沒有記錄到歷史淹水區域。|No historical inundation polygon was recorded within 500 m.
來源：臺北市水利工程處 · 歷史淹水紀錄|Source: Taipei City Water Resources Department · historical inundation records
你的觀察|Your observation
只評估親眼觀察到的狀況，未評項目不影響 CLS。若觀察會明顯改變評估，建議附上筆記。|Rate only conditions you actually observed. Unrated items do not affect CLS. Notes are recommended when an observation meaningfully changes the assessment.
CLS 調整預覽|CLS adjustment preview
外部基準|External baseline
調整後 CLS|Adjusted CLS
基準優先使用有來源依據的觀察。沒有本地觀察時，可使用明確標示、依已儲存真實參考資料推估的分數，不會捏造街道事實。現場觀察是另行計算的有限調整。|The baseline uses source-backed observations when available. When a category has no local observation, StreetLens may use a clearly marked estimate derived from persisted real reference data; it does not fabricate street-level facts. Field observations are a separate bounded adjustment.
每類調整上限為 ±10，C1–C5 等權重合併。例如 C3 的 +8 調整對總 CLS 貢獻 +1.6。|Each category is capped at ±10. Category adjustments are then equally weighted across C1–C5, so a +8 C3 category adjustment contributes +1.6 to overall CLS.
不佳|Poor
普通|Fair
良好|Good
很好|Great
檢查並儲存|Review & save
觀察已可儲存|Observation ready to save
你的觀察會另行儲存，並在儲存時套用有限調整。|Your observations are stored separately and applied as a bounded adjustment when saved.
你觀察到了什麼？例如：人行道被佔用、遮蔭良好、車流繁忙…|What did you observe? e.g. sidewalk blocked, good shade, heavy traffic...
佐證|Evidence
照片只作佐證，不會改變 CLS。|Photos are stored as evidence only. They never change CLS.
使用裝置相機拍照|Take a photo with your device camera
拍照|Take photo
相簿|Library
移除照片|Remove photo
拍攝時間|Captured
 · 選取的街道位置| · selected street location
新增照片說明|Add a note for this photo
此筆紀錄的佐證|Saved with this session
已儲存的評估佐證|Saved assessment evidence
每筆評估最多 6 張照片。|Maximum 6 photos per assessment.
Gemini 解說|Gemini explanation
僅根據已儲存的紀錄產生，不會重新計算 CLS 或補造資料。|Generated from the saved session only. It does not recalculate CLS or add missing data.
解說中…|Explaining…
使用 Gemini 解說|Explain with Gemini
請先將評估儲存至 PostgreSQL，再產生有資料依據的解說。|Save this assessment to PostgreSQL before generating a grounded explanation.
摘要|Summary
選取的街道|Selected street
 · 隨評估時間儲存| · Saved with the assessment timestamp
全部|All
最愛|Favorites
最近|Recent
CLS 由高到低|CLS high → low
等級由高到低|Grade high → low
比較評估|Compare assessments
並列紀錄，不進行排名。|Side-by-side records; no ranking is applied.
比較|Compare
最多比較兩筆評估|Compare up to two assessments
已選取|Selected
街道|Street
刪除評估|Delete assessment
尚無收藏街道。|No favorite streets yet.
尚無已儲存評估。|No saved assessments yet.
評估名稱|Assessment name
繼續|Continue
儲存中…|Saving…
評估已儲存。|Assessment saved.
開啟網站時每 30 秒重試；有來源資料後自動補上|Retries every 30 seconds while the app is open; fills in when source data is available
已存於此裝置，等待同步|Saved on this device, waiting to sync
查看此地全部實勘紀錄（照片、筆記與感受保留）|View all visits here (photos, notes and impressions preserved)
目前地點資料|Current location data
查看此地點的資料來源、可用性與更新時間。|View sources, availability and update times for this location.
資料來源與可用性|Sources and availability
目前地點已載入的評估資料。|Assessment data loaded for the current location.
此地點尚無可顯示的資料來源狀態。|No source status is available for this location yet.
評估依據|Assessment basis
CLS 以已儲存的外部資料計算；現場環境觀察另記為實勘調整。|CLS uses persisted external data; on-site environment observations are recorded separately as field adjustments.
開始環境觀察|Start environment observations
未取得|Not retrieved
更新時間未知|Unknown freshness
資料已過期|Data expired
不到 1 小時前更新|Updated <1h ago
1 天前更新|Updated 1d ago
資料來源資訊不足|Insufficient source information
正在查詢此地點的已儲存資料。|Looking up persisted data for this location.
此地點資料正在等待背景更新，取得後會自動顯示 CLS。|Data for this location is awaiting a background update. CLS will appear when available.
等待已儲存資料…|Waiting for persisted data…
顯示已儲存的歷史 CLS。|Showing persisted historical CLS.
已儲存地點的 CLS 待補，取得資料後會自動更新。|CLS for this saved location is pending and will update when data is available.
正在載入新的街道資料…|Loading new street data…
評分服務的資料庫尚未就緒，暫時無法讀取 CLS。|The scoring database is not ready. CLS is temporarily unavailable.
目前無法取得已儲存的評估資料。|Cannot retrieve the persisted assessment right now.
最愛尚未更新，請確認瀏覽器儲存空間。|Favorites were not updated. Check browser storage space.
無法刪除，請重試。|Could not delete. Please retry.
儲存空間不足，尚未儲存；請釋出空間後重試。|Storage is full. Not saved; free space and retry.
每次 assessment 最多保留 6 張照片。多出的照片未加入。|Each assessment supports 6 photos. Extra photos were not added.
部分照片無法加入，請確認檔案是可讀取的圖片。|Some photos could not be added. Check that the files are readable images.
照片儲存失敗，Assessment 尚未儲存。請重試。|Photo storage failed. Assessment not saved. Please retry.
PostgreSQL 尚未同步；此筆 Assessment 已保留在本機。|PostgreSQL has not synced; this assessment is saved locally.
PostgreSQL 暫時無法同步；此筆 Assessment 已保留在本機。|PostgreSQL sync is unavailable; this assessment is saved locally.
已同步，但本機儲存空間不足；重新開啟可載入。|Synced, but local storage is full. Reopen to load it.
儲存空間不足，Assessment 尚未儲存。|Storage is full. Assessment not saved.
請先把 Assessment 儲存到 PostgreSQL。|Save the assessment to PostgreSQL first.
Gemini 解釋服務暫時不可用。|Gemini explanation service is temporarily unavailable.
您的瀏覽器不支援 GPS 定位服務|Your browser does not support GPS geolocation
已拒絕位置存取。請在瀏覽器網址列旁開啟「位置存取權限」以顯示目前位置|Location access denied. Enable location permission in the browser address bar to show your position.
目前無法取得裝置 GPS 訊號，您可以直接在上方搜尋框輸入地址|GPS is unavailable. Enter an address in the search bar above.
請在瀏覽器網址列旁允許位置權限|Allow location permission in the browser address bar
我的目前所在位置|My current location
將實勘點直接設在目前 GPS 位置|Set the field location to the current GPS position
關閉|Close
資料來源：|Source:
拍照留存|Save photo
夜間照明充足|Adequate night lighting
巷弄路燈密集度高，夜間無昏暗死角，視線良好|Street lights cover the alleys, with no dark blind spots at night and good visibility
里民監視系統覆蓋|Neighborhood CCTV coverage
主要路口與巷弄皆設有警政/里辦公室高解析度監視器|High-resolution police or neighborhood CCTV covers major intersections and alleys
巷弄違停阻礙消防通道|Illegal parking blocks emergency access
現場發現機車或汽車佔用紅線，路寬小於4米影響救災消防車出入|Vehicles occupy no-parking zones; a road narrower than 4 m restricts fire engine access
排水溝清淤與防汛|Drainage and flood preparedness
側溝暢通無淤塞臭味，無過往豪雨積水痕跡|Drains are clear with no odor or visible signs of past rainwater accumulation
生鮮超市步行即達|Fresh food shops within walking distance
500m 內有全聯、家樂福超市或傳統早市，食材採買便利|A supermarket or morning market within 500 m makes grocery shopping convenient
24小時超商密集|24-hour convenience store access
200m 內有 7-11 或全家超商，代收與基本急需機能完備|A 7-Eleven or FamilyMart within 200 m provides parcel services and daily essentials
基層醫療院所與藥局|Local clinics and pharmacies
附近有小兒/家醫/牙醫診所及健保特約藥局|Nearby pediatric, family medicine or dental clinics and health-insurance pharmacies
外食餐飲選擇匱乏|Limited dining options
周邊多為純住宅或工廠，日常用餐需依賴外送或開車|Mostly residential or industrial surroundings; meals require delivery or driving
實體人行道平整連續|Level, continuous sidewalks
設有實體緣石或綠色標線人行道，嬰兒車/輪椅通行無阻|Curbed or marked sidewalks allow unobstructed stroller and wheelchair access
人行道遭佔用或斷點|Blocked or discontinuous sidewalks
人行道被機車停放、盆栽或商家斜坡佔據，需與車爭道|Parked scooters, plants or shop ramps obstruct sidewalks and force people into traffic
YouBike 站點與調度|YouBike access and availability
步行 3 分鐘內有公共自行車站點，平日尖峰借還車順暢|A public bike station is within a 3-minute walk, with easy pickup and return at peak hours
路口視線死角與反光鏡|Intersection blind spots and mirrors
無號誌路口視線受擋且無反光鏡，車速快容易擦撞|An unsignaled intersection has blocked views and no mirror; fast traffic creates collision risk
鄰里公園綠地步程內|Neighborhood green space within walking distance
300m 內有帶狀綠廊、社區公園或校園操場開放空間|A green corridor, neighborhood park or open school grounds lies within 300 m
街道行道樹遮蔭良好|Good shade from street trees
道路兩旁植栽茂密，夏日具良好遮蔭降溫效應|Dense roadside planting provides shade and cooling in summer
臨路重車高分貝噪音|Loud heavy-vehicle traffic noise
正對主幹道或高架橋，公車大卡車與改裝車呼嘯噪音明顯|A main road or overpass produces noticeable noise from buses, trucks and modified vehicles
餐飲油煙或廢氣排放|Cooking fumes or exhaust
一樓店面油煙未經靜電機直排或巷口有固定垃圾堆置異味|Unfiltered cooking fumes or regularly piled rubbish create odors
白天鄰里活動熱絡|Active neighborhood during the day
街道白天有常態行人、店家互動，氛圍溫馨安全有凝聚力|Regular pedestrians and shop interactions create a welcoming, safe and connected daytime atmosphere
里辦公室與社區公告活躍|Active neighborhood notices
布告欄有定期里民研習、健檢、環保志工與節慶活動|Notice boards regularly advertise workshops, health checks, volunteering and community events
街區店面閒置率高|High storefront vacancy
沿街鐵捲門長期拉下出租或招租，商業人潮衰退顯得蕭條|Long-closed storefronts and rental signs suggest declining foot traffic
長者與幼童友善設施|Facilities for seniors and children
周邊設有社區關懷據點、親子共融遊戲場或長照日間中心|Nearby community care points, inclusive playgrounds or senior day care centers
CARTO Basemaps 金鑰測試與設定|CARTO basemap key setup and testing
即時測試金鑰有效性並無縫切換底圖|Test the key and switch basemaps immediately
金鑰|CARTO API Key
即時連線測試中...|Testing connection…
測試並儲存套用|Test, save and apply
已清除自訂金鑰，系統將改用免金鑰 OSM Apple Maps 風格底圖|Custom key cleared. Using the key-free OSM basemap with Apple Maps styling.
驗證成功！CARTO 金鑰有效，深色夜間底圖已立即套用！|CARTO key verified. Dark basemap applied.
CARTO 伺服器拒絕載入此圖磚（金鑰格式有誤、已失效或非 basemaps 權限金鑰）。系統已自動保護並切換至免金鑰高清底圖，防止黑屏破圖。|CARTO rejected the tile. Check the key format, validity and basemap permissions. Switched to the key-free basemap.
清除並切換回免金鑰高清地圖|Clear and use the key-free basemap
貼上您的 CARTO API Key (例如：default_public 或自訂 Key)...|Paste your CARTO API key (e.g. default_public or a custom key)…
GPS 經緯度座標與定位工具|GPS coordinates and location tools
即時監控所在座標，支援直接輸入經緯度跳轉|Monitor coordinates and navigate by entering latitude and longitude
目前裝置 GPS 經緯度|Device GPS coordinates
緯度 (Latitude)|Latitude
經度 (Longitude)|Longitude
已複製座標|Coordinates copied
複製經緯度|Copy coordinates
定位中...|Locating…
重新偵測 GPS|Refresh GPS
緯度 (例如: 25.0339)|Latitude (e.g. 25.0339)
經度 (例如: 121.5645)|Longitude (e.g. 121.5645)
立即跳轉至此經緯度座標|Go to these coordinates
快速選取熱門實勘經緯度：|Quick field location presets:
說明：CARTO 官方規定自 2024 年底起請求 basemaps 圖磚時需附加|CARTO basemap requests require
。 若金鑰無效或權限未開通，本系統具備自動容錯保護，會自動切換至 Apple Maps 高清主題，絕不黑屏。|. If the key is invalid or lacks permissions, the map automatically falls back to the Apple Maps theme.
使用免金鑰底圖|Use key-free basemap
誤差 ±|Accuracy ±
🎯 設為實勘點|🎯 Set field location
手動輸入自訂經緯度（坐標精確定位）|Enter custom latitude and longitude
已觀測 ·|observed ·
推估 ·|estimated ·
不可用|unavailable
· 項目影響|· item impact
· 選取的街道位置|· selected street location
· 隨評估時間儲存|· Saved with the assessment timestamp
最愛可追蹤街道；已儲存評估保留各次實勘紀錄。|Favorites help you track streets; saved assessments preserve individual field sessions.
· 照片|· Photos
瀏覽器儲存空間不足，請釋出空間後重試。|Browser storage is full. Free space and retry.
CLS 已取得，但儲存空間不足；請釋出空間後重試。|CLS is available, but storage is full. Free space and retry.
 · 最愛| · Favorite
C4 綠意|C4 Green
可用|available
尚無資料|empty
缺少資料|missing
更新失敗|error
等待更新|pending_refresh
快取資料|cached
已觀測|observed
資料不足|insufficient
未知|unknown
來源資料|source
計算|calculated
計算|computed
高可信度|high
中可信度|medium
低可信度|low
交通事故|accidents
景點與設施|POIs
路燈|lights
設備|devices
消防栓|hydrants
自行車|bikes
停車柱|docks
公園|parks
地點|places
分數|score
樹木|trees
樹木／平方公里|trees/km²
相機畫面尚未就緒。|Camera frame not ready.
此瀏覽器無法擷取畫面。|This browser cannot capture a frame.
畫面擷取失敗，請重試。|Frame capture failed. Please retry.
畫面超過 2 MB，請重試。|Frame exceeds 2 MB. Please retry.
AI 解說暫時不可用，請重試。|AI explanation is temporarily unavailable. Please retry.
解說語言不符，請重新產生。|Explanation language did not match. Please regenerate.
🎯 實勘點|🎯 Field location
CLS · 資料來源 · 歷史比較|CLS · Sources · History comparison
社區治安防護據點|Neighborhood safety point
轄區警察治安機關|Local police station
消防救災與安全據點|Fire and emergency response station
生鮮超市日常採買|Supermarket for daily groceries
生鮮食材百貨日常採買|Grocery shop for fresh food and essentials
民生福利超市生鮮採買|Supermarket for fresh groceries
24H 連鎖超商生活機能|24-hour convenience store
藥局健保特約醫療處方|Health-insurance pharmacy and prescriptions
藥局健保醫療生活用品|Pharmacy and health essentials
基層社區醫療照護|Local community healthcare
區域醫療院所|Regional healthcare facility
綜合醫療中心|General medical center
專業門診醫療照護據點|Specialist outpatient healthcare
社區聯合健保診所|Community health-insurance clinic
牙醫診所照護|Dental clinic
日常烘焙與民生補給|Bakery and daily supplies
金融服務與臨櫃ATM|Banking services and ATM
金融機構與理財服務|Financial services
郵政物流與包裹服務據點|Postal and parcel services
捷運大眾運輸通勤樞紐|MRT commuting hub
鐵路大眾運輸通勤樞紐|Rail commuting hub
輕軌大眾運輸通勤樞紐|Light rail commuting hub
大眾運輸通勤樞紐|Public transport hub
公車轉運幹線接駁據點|Bus transfer station
市區公車站點便捷候車|Local bus stop
鄰里休憩綠地公園|Neighborhood park
都會綠地休憩公園|Urban park
林蔭景觀綠帶步道|Shaded garden paths
兒童遊憩與社區綠地|Playground and community green space
地方社區與公民活動據點|Community activity center
地方行政與里民服務據點|Local government and neighborhood services
市政行政便民據點|City administration services
公共圖書館與文化自修據點|Public library and study space
學校教育與日常生活機能|School and neighborhood amenities
國民小學教育設施|Primary school
國民中學教育設施|Secondary school
`;

export const catalog: Record<string, { 'zh-TW': string; en: string }> = {};
for (const line of pairs.trim().split('\n')) {
  const [zh, en] = line.split('|');
  const entry = { 'zh-TW': zh, en };
  catalog[zh] = entry;
  // First entry defines aliases shared by multiple source strings.
  catalog[en] ??= entry;
}
Object.assign(catalog, {
  'Street library': catalog['Street Library'],
  'Data status': catalog['資料狀態'],
  'Field adjustment': catalog['現場調整'],
  'Field observations': catalog['現場觀察'],
  'Not retrieved': catalog['未取得'],
  'not retrieved': catalog['未取得'],
  '未知': { 'zh-TW': '未知', en: 'Unknown' },
});

const metadata: Record<string, [string, string]> = {
  trafficAccidentCount500m: ['交通事故 · 500m', 'Traffic accidents · 500m'],
  fatalTrafficAccidentCount500m: ['死亡事故 · 500m', 'Fatal accidents · 500m'],
  injuryTrafficAccidentCount500m: ['受傷事故 · 500m', 'Injury accidents · 500m'],
  streetLightCount300m: ['路燈 · 300m', 'Street lights · 300m'],
  aedCount500m: ['AED · 500m', 'AEDs · 500m'],
  fireHydrantCount500m: ['消防栓 · 500m', 'Fire hydrants · 500m'],
  supermarketDist: ['超市距離', 'Supermarket distance'],
  convenienceDist: ['超商距離', 'Convenience store distance'],
  clinicDist: ['診所距離', 'Clinic distance'],
  schoolDist: ['學校距離', 'School distance'],
  bankPostDist: ['銀行或郵局距離', 'Bank or post office distance'],
  poiDensityCount: ['設施數量', 'Amenity count'],
  mrtOrRailDist: ['捷運或鐵路距離', 'MRT or rail distance'],
  busStopDist: ['公車站距離', 'Bus stop distance'],
  youBikeNearestDist: ['YouBike 距離', 'YouBike distance'],
  youBikeAvailableBikes: ['YouBike 可借車數', 'YouBike available bikes'],
  youBikeAvailableDocks: ['YouBike 可還車位', 'YouBike available docks'],
  bikeLaneLength500m: ['自行車道長度 · 500m', 'Bike lane length · 500m'],
  sidewalkCoverage500mPct: ['人行道覆蓋率 · 500m', 'Sidewalk coverage · 500m'],
  airQualityScore: ['空氣品質分數', 'Air quality score'],
  streetTreeCount800m: ['行道樹 · 800m', 'Street trees · 800m'],
  parkTreeCount800m: ['公園樹木 · 800m', 'Park trees · 800m'],
  streetTreeDensityPerKm2: ['行道樹密度', 'Street tree density'],
  parkTreeDensityPerKm2: ['公園樹木密度', 'Park tree density'],
  nearestParkDist: ['最近公園距離', 'Nearest park distance'],
  nearestParkDistanceScore: ['公園距離分數', 'Park distance score'],
  parkCount800m: ['公園 · 800m', 'Parks · 800m'],
  coolingPointCount1200m: ['避暑設施 · 1200m', 'Cooling points · 1200m'],
  communityCulturalPoiCount800m: ['社區文化設施 · 800m', 'Community cultural facilities · 800m'],
  nearestCommunityCulturalFacilityDistanceScore: ['社區文化設施距離分數', 'Community facility distance score'],
  regionalReferencePrior: ['區域參考資料推估', 'Regional reference estimate'],
  marketDist: ['市場距離', 'Market distance'],
  taipei_youbike: ['臺北 YouBike', 'Taipei YouBike'],
  osm_static_taipei: ['OSM 臺北靜態備援', 'OSM Taipei static fallback'],
  taipei_medical: ['臺北醫療設施', 'Taipei medical facilities'],
  taipei_street_lights: ['臺北路燈', 'Taipei street lights'],
  taipei_bus_stops: ['臺北公車站', 'Taipei bus stops'],
  taipei_mrt_stations: ['臺北捷運站', 'Taipei MRT stations'],
  taipei_libraries: ['臺北圖書館', 'Taipei libraries'],
  taipei_public_toilets: ['臺北公廁', 'Taipei public toilets'],
  taipei_parks: ['臺北公園', 'Taipei parks'],
  taipei_bike_lanes: ['臺北自行車道', 'Taipei bike lanes'],
  taipei_sidewalk_areas: ['臺北人行道', 'Taipei sidewalks'],
  taipei_markets: ['臺北市場', 'Taipei markets'],
  taipei_cooling_points: ['臺北避暑設施', 'Taipei cooling points'],
  taipei_aed: ['臺北 AED', 'Taipei AEDs'],
  taipei_fire_hydrants: ['臺北消防栓', 'Taipei fire hydrants'],
  taipei_official_aqi: ['臺北官方空氣品質', 'Taipei official air quality'],
  taipei_fire_stations: ['臺北消防分隊', 'Taipei fire stations'],
  taipei_safety: ['臺北安全資料', 'Taipei safety data'],
  taipei_flood: ['臺北淹水模型', 'Taipei flood model'],
  taipei_historical_flood: ['臺北歷史淹水資料', 'Taipei historical flood data'],
  taipei_services: ['臺北公共服務', 'Taipei public services'],
  taipei_green: ['臺北綠地資料', 'Taipei greenery data'],
  tdx: ['運輸資料流通服務', 'Transport Data Exchange'],
  tdx_transit: ['運輸資料流通服務', 'Transport Data Exchange'],
  open_meteo_air_quality: ['Open-Meteo 空氣品質', 'Open-Meteo air quality'],
  weather: ['天氣資料', 'Weather data'],
  google_places: ['Google 地點資料', 'Google Places'],
  openstreetmap: ['OpenStreetMap 地點資料', 'OpenStreetMap places'],
  'StreetLens persisted real reference observations': ['StreetLens 已儲存的真實參考觀察', 'StreetLens persisted real reference observations'],
  'Taipei City Transportation Department': ['臺北市交通局', 'Taipei City Transportation Department'],
  'Taipei City Transportation Department bus-stop data': ['臺北市交通局公車站資料', 'Taipei City Transportation Department bus-stop data'],
  'Taipei City official rainfall inundation simulation (112 revision)': ['臺北市官方降雨淹水模擬（112 年版）', 'Taipei City official rainfall inundation simulation (112 revision)'],
  'Open-Meteo Air Quality (CAMS model data)': ['Open-Meteo 空氣品質（CAMS 模型）', 'Open-Meteo Air Quality (CAMS model data)'],
  'Open-Meteo Air Quality': ['Open-Meteo 空氣品質', 'Open-Meteo Air Quality'],
};
for (const [key, [zh, en]] of Object.entries(metadata)) catalog[key] = { 'zh-TW': zh, en };
