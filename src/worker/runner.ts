// 在系統預設終端機執行 script：寫一個 .command 啟動器，交給 macOS 的 `open`，
// 由 LaunchServices 用使用者設定的預設終端機（Terminal、iTerm…）開新視窗執行。
// 啟動器先切到 script 所在目錄再以 `bash` 執行，避開 chmod +x 權限問題；stdin 互動與 TUI 由終端機原生提供。

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ScriptNode } from '../core/types.ts';
import { expandHome } from '../core/homePath.ts';
import { hasControlChars, launcherScript } from '../core/quote.ts';

export type RunOutcome = { ok: true } | { ok: false; reason: string };

export type Opener = (file: string) => Promise<void>;

const openWithDefaultApp: Opener = (file) =>
  new Promise((resolve, reject) => {
    execFile('open', [file], (err) => (err ? reject(err) : resolve()));
  });

/**
 * 啟動器寫在只有自己可讀寫的暫存目錄；真正的 script 路徑寫在檔案裡，由 bash 解析。
 * 檔名取 script id 的雜湊，id 來自可被同步改寫的 scripts.json，不直接拼進路徑。
 */
export function writeLauncher(script: ScriptNode, absolutePath: string, baseDir: string = os.tmpdir()): string {
  const dir = path.join(baseDir, `orca-shell-scripts-${os.userInfo().uid}`);
  const file = path.join(dir, `${createHash('sha256').update(script.id).digest('hex').slice(0, 16)}.command`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, launcherScript(absolutePath, path.dirname(absolutePath)), { mode: 0o700 });
  // writeFileSync 的 mode 只在新建時生效，既有檔案要另外確保可執行
  fs.chmodSync(file, 0o700);
  return file;
}

export async function runScript(
  script: ScriptNode,
  open: Opener = openWithDefaultApp,
  platform: NodeJS.Platform = process.platform,
): Promise<RunOutcome> {
  if (platform !== 'darwin') {
    return { ok: false, reason: '目前只支援 macOS 的預設終端機' };
  }
  const absolutePath = expandHome(script.path);
  if (hasControlChars(absolutePath)) {
    return { ok: false, reason: '路徑含控制字元，無法安全帶入' };
  }
  try {
    await open(writeLauncher(script, absolutePath));
  } catch (err) {
    return { ok: false, reason: `無法開啟預設終端機：${err instanceof Error ? err.message : String(err)}` };
  }
  return { ok: true };
}
