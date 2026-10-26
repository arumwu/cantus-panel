<div align="center">

# Cantus

### 眾聲並作，所託如一。

已恢復使用 **Cantus** 名稱；桌面新版六個介面持續提供。[名稱與相容性說明](docs/RENAMING.md)

讓散落在 Codex 與 Claude 裡的對話，回到同一個安靜的工作空間。

**Work · Lineage · Live · Task（桌面新版）**

[六個介面](#六個介面) · [開始體驗](#開始體驗) · [畫面預覽](#畫面預覽) · [連接自己的資料](docs/SETUP.md) · [隱私與邊界](docs/PRIVACY.md)

</div>

## 六個介面

把工作空間、對話、執行中的指示、執行紀錄、工作拆分樹與任務看板，整合進同一套 Cantus。六個介面分布在 **Work、Lineage、Live、Task** 四個桌面視角裡。

| 介面 | 你可以做什麼 | 在哪裡 |
| --- | --- | --- |
| **AI Workspace · 工作空間** | 在同一個工作區切換對話、工作關係、即時動態與任務，沿用原有外框、配色與字體。 | 桌面頂端的 Work／Lineage／Live／Task |
| **Agent Chat · 工作對話** | 閱讀 Codex、Claude 的對話，保留草稿、接續工作、確認工具權限，並把後續訊息加入排隊。 | Work 中間的對話區 |
| **Agent Steering · 執行中指示** | 執行中補充方向、暫停、沿同一段對話繼續，或停止目前回合。Codex 支援原生插話；Claude 使用排隊。 | Work 底部的 Agent Steering |
| **Agent Run · 執行紀錄** | 查看歷史回合、計畫、工具步驟、輸入輸出、錯誤與來源回報的用量、成本；也可請 AI 檢查並重試失敗步驟。 | Work 右側「執行紀錄」 |
| **Agent Tree · 工作拆分樹** | 用樹狀圖整理已確認的拆分關係，收合分支、自動縮放，並直接在下拉選單搜尋起點與終點。 | Lineage 中間的工作拆分樹 |
| **Task Board · 任務看板** | 用四欄水平看板推進工作，拖曳排序、搜尋任務，編輯狀態、優先度、負責人、標籤與說明。 | Task |

進階執行控制適用桌面新版建立的本機獨立對話；原有對話沿用原後端。手機繼續使用原版介面。功能位置與操作細節見 [桌面整合說明](docs/DESKTOP.md)。

## 四種桌面視角

| 視角 | 日常用途 |
| --- | --- |
| **Work** | 對話、調整方向、查看執行紀錄，在同一頁完成。 |
| **Lineage** | 看清楚一件工作如何拆分，以及工作之間的依賴關係。 |
| **Live** | 中間查看工作動態，右側切換「機器」與「工作詳情」。 |
| **Task** | 從「待處理」往右推進到「進行中」「待你確認」「已完成」，四欄隨視窗等寬縮放。 |

柔和的冰藍與淡粉、乾淨的留白、可折疊的長訊息與程式碼。重要內容留在眼前，其餘細節需要時再打開。

手機採用獨立的全螢幕清單與對話，底部切換三種視角；「工作區」切換主機與設定，「更多」查看對話資訊，列上的「⋯」可改名與分類。返回清單保留未送出的草稿，輸入區支援可用畫面高度變動，橫放仍使用手機介面。已以瀏覽器觸控模擬驗證，實體手機鍵盤與 Safari 體驗仍需實機驗收。

手機輸入框整合文字、派工圖示與送出鍵；點派工圖示開啟原生選單，閒置時不顯示 `idle`。送出圓鈕為 36px，點擊範圍保留 44px。Claude／Codex 的服務標示使用 [官方品牌圖樣](docs/BRAND-ASSETS.md)，不再用字母代替。

## 桌面新版：六項介面整合

```bash
npm run start:desktop
```

開啟 <http://127.0.0.1:4591>。這個指令在同一程序啟動原後端（4589）與桌面入口（4591）；兩者都預設虛構示範，不讀帳號、不啟動 AI。若已有服務佔用這些埠，可用 `CANTUS_PANEL_PORT` 與 `CANTUS_NEXT_PORT` 指定另外兩個埠，不會替換既有服務。

桌面保留原外框、配色與字體，加入 Task 四欄看板、可搜尋及縮放的工作拆分樹、Agent Chat、Agent Steering 與 Agent Run。Work 右側的「執行紀錄」顯示回合與步驟；底部 Agent Steering 顯示插話、暫停及繼續控制。進階控制適用新版建立的本機獨立對話；原有對話保持原後端寫入。

手機繼續載入原版前端，不載入桌面擴充。`npm start` 的原版入口也保留。六項對照、設定及驗證限制見 [桌面整合說明](docs/DESKTOP.md)。

## 畫面預覽

以下兩張桌面畫面是實際介面截圖，內容全部來自虛構示範資料。示範模式沒有連接帳號，也不會啟動 AI。

### Task · 四欄任務看板

![Cantus Task：四欄水平任務看板，顯示虛構測試任務](docs/images/desktop-task.jpg)

### Work · 對話、執行中指示與執行紀錄

![Cantus Work：中間為虛構對話與 Agent Steering，右側為 Agent Run 執行紀錄](docs/images/desktop-agent-run.jpg)

### 視覺概念

![Cantus 概念展示圖：所有名稱與對話皆為虛構](docs/images/workspace-concept.png)

> AI 概念圖，用來展示視覺方向；實際介面請看上方桌面截圖與下方登入截圖。

### 登入 · 桌面

![Cantus 桌面登入：空白帳密欄位與像素角色](docs/images/login-desktop.png)

### 登入 · 手機

<div align="center">
<img src="docs/images/login-mobile.png" width="320" alt="Cantus 手機登入畫面，不含帳號與密碼">
</div>

四隻像素小角色陪你進入工作區；開啟系統「減少動態效果」時會停止動態。截圖只展示空白表單，沒有任何登入資料。

## 開始體驗

需要 **Node.js 24 或更新版本**。沒有需要下載的 npm 套件；來源讀取元件已放在 `vendor/`。

```bash
git clone https://github.com/arumwu/cantus-panel.git
cd cantus-panel
npm run start:desktop
```

開啟 <http://127.0.0.1:4591>，即可體驗六項桌面整合。原版入口仍可用 `npm start` 啟動，位於 <http://127.0.0.1:4589>。

預設就是 **虛構資料示範**：兩個來源、十段虛構會話。不讀取你的帳號或歷史，不啟動 AI，不需要 API key。關係整理與規則預覽可在本機操作，產生的狀態放在不追蹤的 `state/`。

此儲存庫公開分享程式與虛構展示資料，不包含既有部署的接線或私人工作資料。

## 連接自己的資料

原生對話讀取已改為獨立 worker 與來源驗證快取；macOS 背景常駐範本與限制見 [Session 讀取與服務復原](docs/SESSION-READS.md)。示範模式仍不讀取私人資料。

示範、來源閱讀、AI 執行是三個分開的層級。必須自行填入設定並明確啟用，才會接觸真實資料。

```bash
cp config/local.example.json config/local.json
# 編輯 config/local.json，只保留你要連接的來源與路徑。
CANTUS_MODE=local npm run start:desktop
```

這時可閱讀已設定的來源，AI 執行仍然關閉。完整設定、選用的登入入口、啟用執行的注意事項，見 [SETUP.md](docs/SETUP.md)。

## 開發與驗證

```bash
npm test
npm run check:privacy
```

測試涵蓋專案與分支、關係驗證、修訂衝突、切換模型的上下文邊界、停止行為、預設不連線、登入與來源限制。測試使用虛構資料或替代的執行器，不呼叫付費 AI。

四隻像素角色沿主框上緣移動；登入後只顯示「登出工作區」。切換來源時會丟棄舊請求，避免誤寫到另一個工作區。預設只有單機示範；[雙工作站模式](docs/PAIR.md) 需自行設定連線，repo 不包含私人主機接線。

回覆中可以繼續輸入，按「加入排隊」會在本回合完成後依序送出，也可取消待送訊息。排隊綁定原工作區與對話，切換畫面不會改送到另一台主機；需要保持分頁開啟。重新整理後保留的隊列先暫停，由你確認繼續；失敗、停止或結果不明時不會自行重送。這是排隊，不是中途插入正在執行的回合。

Codex、Claude 都使用相同排隊流程。選用的瀏覽器測試在 `cloud/message-queue-ui.test.cjs`，使用虛構回覆；需已有 Playwright 與 Chrome，可用 `PLAYWRIGHT_MODULE`、`CHROME_PATH` 指定本機位置，不會自動安裝或呼叫真實 AI。

這些測試不代表所有原生 CLI 版本、真實帳號或正式部署都已驗收。分享版的登入入口連到一個本機控制端；選用的第二台工作站由你自行設定，不附帶既有部署或跨主機接線。

## 專案結構

```text
app.js / index.html / style.css   主介面
conversation-tree.js             專案與分支
lineage*.cjs / lineage-ui.js      工作關係
native.cjs / managed.cjs         選用的原生執行
handoff.cjs / routing*.cjs       對話切換與規則
desktop/                        六項桌面介面與進階執行控制
cloud/                          選用的獨立登入入口
demo.cjs                        純虛構示範資料
config/local.example.json       不含接線資料的設定範本
vendor/session-exporter/        本機來源讀取元件
docs/                           設定、隱私、展示素材
```

## 授權與聲明

Cantus 目前未提供開源授權（`UNLICENSED`）；公開可見與允許自由再利用是不同的事。第三方元件沿用其原始 MIT 授權，見 [第三方聲明](vendor/session-exporter/NOTICE) 與 [LICENSE](vendor/session-exporter/LICENSE)。

這是獨立專案，並非 OpenAI 或 Anthropic 官方產品。Codex 與 Claude 名稱及商標屬於各自權利人。
