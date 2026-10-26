# Session 讀取與服務復原 / Session reads and recovery

## 2026-10-26 修正

本機來源模式的原生 Codex／Claude 歷史由獨立唯讀 worker 處理，不再等待全域清單掃描。相同分頁會合併同時請求，並保留最多 8 頁、16 MiB 的記憶體快取；不建立磁碟對話副本。

每次讀快取仍驗證來源。Codex 會重新定位指定 ID，以辨識新增的原生 JSONL 優先於壓縮副本；檔案更新、刪除、來源切換與舊分頁簽章不可默默使用舊內容。來源持續寫入時只做有上限的重試，仍無法確認時回傳錯誤。最多 4 個不同待處理讀取，40 秒 worker 逾時；不終止 AI 工作程序。

面板管理／跨 AI 交接對話仍走原本的權威來源。示範模式維持虛構資料，未設定來源不會改掃使用者家目錄。登入、送出與續作資格判定不使用這個快取。

獨立讀取回傳 `historyIndependent: true` 的來源更新錯誤時，瀏覽器只重試該歷史，不強制重新掃描整份清單；其他後端保留原有相容流程。

正式環境採獨立 GET-only sidecar；公開版本把相同 worker 接到單機後端，不包含正式域名、隧道、憑證、私人路徑或對話。公開版本需要自己的設定，不能直接覆蓋既有部署接線。

## macOS 背景常駐

`config/launchd.plist.example` 是範本，不是已安裝的服務。將 `__NODE_BINARY__` 和 `__REPO_ROOT__` 替換為自己的 Node 與儲存庫絕對路徑。設定個人 LaunchAgents 前，確認目標連接埠沒有既有服務；不要停止或替換正在跑工作的程序。

範本預設仍是示範模式。只有完成 `config/local.json` 並明確加入 `CANTUS_MODE=local` 的 EnvironmentVariables 後才讀取自己的來源；AI 執行仍另需明確啟用。不可把個人化 plist 或 local.json 提交 Git。

Node 啟動器先執行設定的 Storage Guard，再開啟 `state/service-logs/` 的記錄檔。plist 不要求 launchd 直接開啟外接碟上的 stdout，避免系統啟動階段被檔案權限拒絕。RunAtLoad 與 KeepAlive 保留，重試間隔 30 秒；這是登入後的使用者服務，不是未登入就可用的系統服務。復原只啟動服務，不自動重送 AI 回合。

## English

Configured native history reads run in a separate read-only worker, independently of catalog scans. Pages are bounded (8 entries / 16 MiB), concurrent duplicates are coalesced, and each cache hit revalidates its source. Codex re-resolves the selected ID so a newly preferred writable transcript cannot be masked by an unchanged compressed copy. Changed/deleted files and stale pagination signatures remain errors, never silently accepted snapshots.

Managed and handoff histories, authentication, native-send eligibility and execution remain on their original routes. Demo mode stays disconnected; unspecified roots never fall back to personal directories. At most four distinct requests are pending; a 40-second timeout terminates only the read worker, not a provider process.

The deployment uses a separate GET-only sidecar; this portable repository integrates the same worker in its configured single-machine backend. Private deployment wiring is intentionally excluded. The launchd template uses a direct Node entrypoint with guard-first, application-owned logging and bounded service restart. It is not installed automatically, does not enable AI execution, and must not replace a running service without checking active work.

Verification covers bounded cache invalidation, preferred-source switching, large-history integrity, browser retry/draft behavior and authenticated deployment reads. Specific latency measurements are examples, not a guarantee for every transcript. Full-machine reboot and physical-device acceptance are separate checks.
