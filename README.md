# Shell Scripts（Orca 外掛）

在 Orca 右側欄管理 bash script 清單，選取後在系統預設終端機互動執行。移植自 VS Code 延伸模組 [Shell Scripts](https://github.com/lazyjerry/shell-script-ext)（`workjerry.shell-script`）。

## 定位

這個外掛用來讓 VS Code 版與 Orca 共用同一份 script 清單，或在兩者之間過渡：

- **共用**：兩邊的 `scripts.json` 格式相同，保存資料夾指向同一處（例如 Dropbox），在任一邊新增、整理的 script，另一邊下次操作就看得到。
- **過渡**：從 VS Code 轉到 Orca 時，原本的清單不必搬移或重建，直接沿用。

只在 Orca 裡用、而且 script 不多時，Orca 內建的「快速命令」可能就夠用了。需要時，可以用「建立至快速命令中」把個別 script 轉成快速命令。

## 功能

- **共用／私有雙清單**：各自保存一份 `scripts.json`，格式與 VS Code 版相同，兩邊可以指向同一個 Dropbox 資料夾共用。
- **資料夾分組、備註、驗證**：檔案不存在或不是 bash 檔時顯示警告圖示，原因寫在項目後面。
- **執行**：選取 script 後按「執行」，在系統預設終端機（Terminal、iTerm 等）開新視窗執行。
- **排序與搬移**：上移、下移，或用「移到…」移到任一份清單的任一個資料夾。
- **保存位置**：在「共用」或「私有」上選「選擇保存位置」，或到 Orca 的 Settings → Plugins → Shell Scripts 修改。
- **建立至快速命令中**：選取 script 後按「刪除」左邊的按鈕，面板列出新增 Orca 快速命令的步驟，附標籤、命令（`cd '<目錄>' && bash '<路徑>'`）與複製鈕。已有快速命令執行同一支 script 時擋下。

## 與 VS Code 版的差異

| VS Code 版 | Orca 版 | 原因 |
|---|---|---|
| 拖曳排序、搬移 | 上移／下移按鈕與「移到…」選單 | Orca 的清單元件不支援拖曳 |
| 檔案／資料夾選擇器 | 手動輸入路徑（支援 `~/`） | plugin API 沒有開啟檔案的對話框 |
| 項目上的 inline 按鈕、右鍵選單 | 選取後下方的動作區 | 清單項目（`ListItem`）只有按下事件 |
| 在 VS Code 內建終端機執行 | 在系統預設終端機開新視窗執行 | Orca 的 `terminal.create` 只在背景開啟、無法切到前景，且必須指定 workspace，而 plugin API 認不出聚焦的是哪一個 |
| 未設定時存在延伸模組的儲存空間 | 未設定時存在 `~/.orca-shell-scripts/`（私有清單在 `private/`） | Orca 不提供外掛資料夾路徑 |

## 執行方式與安全性

- 每次執行寫一個 `.command` 啟動器到 `$TMPDIR/orca-shell-scripts-<uid>/`（目錄與檔案僅限本人存取），再以 `open` 交給 macOS 預設的終端機開啟。檔名是 script id 的雜湊，不拼入使用者資料。
- 啟動器內容是 `cd '<目錄>'` 後 `exec bash '<路徑>'`，由 bash 解析，路徑一律以單引號跳脫，與登入 shell 是哪一種無關。
- 含換行等控制字元的路徑無法登錄。
- 「顯示保存資料夾」以 `open -R` 選取檔案，不直接開啟資料夾，避免 `*.app` 這類 bundle 被 macOS 當成 app 啟動。

## 已知限制

- 只支援 macOS：其他平台按「執行」會顯示不支援。
- 每按一次「執行」就開一個新視窗，不沿用前一次的視窗。
- 預設終端機由 macOS 的 `.command` 檔關聯決定；想改用 iTerm 等，在 Finder 對任一 `.command` 檔「取得資訊 → 打開檔案的應用程式」設定。
- 「建立至快速命令中」無法自動新增：plugin API 與 `orca` CLI 都沒有寫入快速命令的方法，只能照步驟手動貼上。重複檢查唯讀 Orca 內部的 `profile-state.db`（未公開格式），讀不到時面板會提示無法檢查；Orca 改版變更格式時可能失效。

## 權限

安裝時 Orca 會要求核准 `trusted-worker`（worker 以你的使用者帳號在本機執行 Node），以及以下能力：

| 能力 | 用途 |
|---|---|
| `settings:own` | 兩個保存資料夾設定 |

## 開發

型別檢查工具（`typescript`、`@types/node`）裝在上一層資料夾：外掛資料夾裡不能有 `node_modules`，Orca 會因裡面的 symlink 拒收整個外掛。

```sh
cd ..                                   # orca-ext/
npm install
npm run check                           # typecheck + validate + inspect + test + check
orca plugin dev watch shell-scripts     # 載入 Orca 開發；第一次會要求 --approve
```

- `orca plugin test`：執行 `src/**/*.test.ts(x)`。
- `orca plugin check`：以真的 worker 渲染 `src/panel.check.ts` 的各情境。
- 只跑 `orca plugin validate` 不夠：它不檢查 symlink，`inspect` 與實際載入才會擋。

```
src/
├── core/        # 純 Node 邏輯，自 VS Code 版移植（treeOps、homePath、validate、quote）
├── worker/      # scripts.json 讀寫（store.ts）、預設終端機執行（runner.ts）、快速命令文字與重複檢查（quickCommands.ts）
├── worker.ts    # worker 進入點：處理 panel 的請求
├── panel.tsx    # 右側欄面板
└── protocol.ts  # panel 與 worker 的請求契約
```

worker 不保留記憶體狀態：每個請求都重讀 `scripts.json`、改完立即以 tmp + rename 原子寫回，所以 Dropbox 或 VS Code 版寫入的變更下次操作就會生效。衝突策略是 last-writer-wins，偵測到 Dropbox 衝突副本時面板會提醒手動整併。

## 授權

Apache-2.0
