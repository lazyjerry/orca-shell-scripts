# Shell Scripts（Orca 外掛）

在 Orca 右側欄管理 bash script 清單，選取後在 Orca 終端機互動執行。移植自 VS Code 延伸模組 [Shell Scripts](https://github.com/lazyjerry/shell-script-ext)（`workjerry.shell-script`）。

## 功能

- **共用／私有雙清單**：各自保存一份 `scripts.json`，格式與 VS Code 版相同，兩邊可以指向同一個 Dropbox 資料夾共用。
- **資料夾分組、備註、驗證**：檔案不存在或不是 bash 檔時顯示警告圖示，原因寫在項目後面。
- **執行**：選取 script 後按「執行」。同一個 script 在同一個 workspace 會沿用原本的終端機。
- **排序與搬移**：上移、下移，或用「移到…」移到任一份清單的任一個資料夾。
- **保存位置**：在「共用」或「私有」上選「選擇保存位置」，或到 Orca 的 Settings → Plugins → Shell Scripts 修改。

## 與 VS Code 版的差異

| VS Code 版 | Orca 版 | 原因 |
|---|---|---|
| 拖曳排序、搬移 | 上移／下移按鈕與「移到…」選單 | Orca 的清單元件不支援拖曳 |
| 檔案／資料夾選擇器 | 手動輸入路徑（支援 `~/`） | plugin API 沒有開啟檔案的對話框 |
| 項目上的 inline 按鈕、右鍵選單 | 選取後下方的動作區 | 清單項目（`ListItem`）只有按下事件 |
| 執行時把終端機帶到前景 | 終端機在背景開啟，要自己切過去 | plugin API 沒有切換終端機的方法 |
| 執行目標是目前視窗 | 「執行於」選單：預設跟著聚焦的 workspace，也可以固定一個 | Orca 的終端機屬於某個 workspace |
| 未設定時存在延伸模組的儲存空間 | 未設定時存在 `~/.orca-shell-scripts/`（私有清單在 `private/`） | Orca 不提供外掛資料夾路徑 |

## 執行方式與安全性

- 登入 shell 是 bash／zsh／sh 等 POSIX shell 時，送出 `cd '<目錄>' && bash '<路徑>'`，路徑一律以單引號跳脫。
- 其他 shell（fish、PowerShell）的引號規則不同，照樣拼字串可能被特殊檔名注入指令。這時改送 `bash <啟動器>`：啟動器放在 `$TMPDIR/orca-shell-scripts-<uid>/`，檔名是 script id 的雜湊，只含安全字元；真正的路徑寫在啟動器裡，交給 bash 解析。
- 含換行等控制字元的路徑無法登錄。
- 「顯示保存資料夾」以 `open -R` 選取檔案，不直接開啟資料夾，避免 `*.app` 這類 bundle 被 macOS 當成 app 啟動。

## 已知限制

- script 還在執行時再按一次「執行」，指令會被送進那個 script 的 stdin（與 VS Code 版的 POSIX 模式相同）。
- SSH／WSL workspace：script 路徑以 Orca 主機為準，遠端終端機上可能不存在。
- 聚焦的 workspace 以名稱加 branch 對出來；對不到或有重名時，請在「執行於」手動選擇。

## 權限

安裝時 Orca 會要求核准 `trusted-worker`（worker 以你的使用者帳號在本機執行 Node），以及以下能力：

| 能力 | 用途 |
|---|---|
| `settings:own` | 兩個保存資料夾設定 |
| `storage:own` | 記住每個 script 對應的終端機 |
| `workspace:read` | 列出 workspace、找出聚焦的 workspace |
| `terminal:send` | 開終端機、送出執行指令 |

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
├── worker/      # scripts.json 讀寫（store.ts）、終端機執行（runner.ts）
├── worker.ts    # worker 進入點：處理 panel 的請求
├── panel.tsx    # 右側欄面板
└── protocol.ts  # panel 與 worker 的請求契約
```

worker 不保留記憶體狀態：每個請求都重讀 `scripts.json`、改完立即以 tmp + rename 原子寫回，所以 Dropbox 或 VS Code 版寫入的變更下次操作就會生效。衝突策略是 last-writer-wins，偵測到 Dropbox 衝突副本時面板會提醒手動整併。

## 授權

Apache-2.0
