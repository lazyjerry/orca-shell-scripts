// 在 Orca 終端機執行 script：每個 script 在每個 workspace 各一個終端機，還活著就沿用、送新指令。
// 用 `bash '<path>'` 執行，避開 chmod +x 權限問題；stdin 互動與 TUI 由終端機原生提供。

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { OrcaWorkerApi } from 'orca/worker';
import type { ScriptNode } from '../core/types.ts';
import { expandHome } from '../core/homePath.ts';
import {
  hasControlChars,
  isPosixShell,
  isShellNeutralPath,
  launcherScript,
  posixRunCommand,
} from '../core/quote.ts';

const TERMINALS_KEY = 'terminals';

export type RunOutcome = { ok: true; reused: boolean } | { ok: false; reason: string };

function loginShell(): string | null {
  try {
    return os.userInfo().shell;
  } catch {
    return null;
  }
}

/**
 * 非 POSIX shell（fish、PowerShell…）無法安全地以引號帶入任意路徑，改送只含安全字元的啟動器路徑；
 * 真正的 script 路徑寫在啟動器檔裡，由 bash 解析。檔名取 script id 的雜湊，id 來自可被同步改寫的 scripts.json。
 */
function writeLauncher(script: ScriptNode, absolutePath: string): string | null {
  const dir = path.join(os.tmpdir(), `orca-shell-scripts-${os.userInfo().uid}`);
  const file = path.join(dir, `${createHash('sha256').update(script.id).digest('hex').slice(0, 16)}.sh`);
  if (!isShellNeutralPath(file)) {
    return null;
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, launcherScript(absolutePath, path.dirname(absolutePath)), { mode: 0o700 });
  return file;
}

export function commandFor(script: ScriptNode, shell: string | null = loginShell()): string | null {
  const absolutePath = expandHome(script.path);
  if (hasControlChars(absolutePath)) {
    return null;
  }
  if (isPosixShell(shell)) {
    return posixRunCommand(absolutePath, path.dirname(absolutePath));
  }
  const launcher = writeLauncher(script, absolutePath);
  return launcher ? `bash ${launcher}` : null;
}

async function storedTerminals(orca: OrcaWorkerApi): Promise<Record<string, string>> {
  const value = await orca.storage.get(TERMINALS_KEY);
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, string>) : {};
}

export async function runScript(orca: OrcaWorkerApi, script: ScriptNode, workspaceId: string): Promise<RunOutcome> {
  const command = commandFor(script);
  if (!command) {
    return { ok: false, reason: '路徑含控制字元，或目前的 shell 無法安全帶入這個路徑' };
  }
  // terminalId 存在 storage：worker 閒置會被回收，記憶體裡的對照表撐不到下次執行
  const terminals = await storedTerminals(orca);
  const key = `${workspaceId}\u0000${script.id}`;
  const existing = terminals[key];
  if (existing) {
    try {
      const { accepted } = await orca.host.call('terminal.sendText', {
        terminalId: existing,
        text: command,
        enter: true,
      });
      if (accepted) {
        return { ok: true, reused: true };
      }
    } catch {
      // 終端機已關閉：往下開新的
    }
  }
  const { terminalId } = await orca.host.call('terminal.create', {
    workspaceId,
    title: `▶ ${script.label}`.slice(0, 512),
    command,
  });
  terminals[key] = terminalId;
  await orca.storage.set(TERMINALS_KEY, terminals);
  return { ok: true, reused: false };
}
