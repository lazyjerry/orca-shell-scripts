// 「建立至快速命令中」：plugin API 沒有寫入 Orca 快速命令的方法，所以只組好要貼的文字，交給使用者手動新增。
// 重複檢查唯讀 Orca 的 profile-state.db（settings.terminalQuickCommands），這是未公開的內部格式，
// 讀不到或格式變了一律回 null，呼叫端照樣給操作步驟，只是提示無法檢查重複。

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { contractHome } from '../core/homePath.ts';
import { shellSingleQuote } from '../core/quote.ts';

export interface QuickCommand {
  label: string;
  command: string;
}

type Dict = Record<string, unknown>;

const isDict = (value: unknown): value is Dict => typeof value === 'object' && value !== null && !Array.isArray(value);

/** 與「執行」的啟動器一致：先切到 script 所在目錄，再交給 bash。 */
export function quickCommandText(absolutePath: string): string {
  return `cd ${shellSingleQuote(path.dirname(absolutePath))} && bash ${shellSingleQuote(absolutePath)}`;
}

/** 只取「終端機」類型的快速命令；代理程式提示詞不會是 bash 命令。 */
export function parseQuickCommands(settingsPayload: string): QuickCommand[] | null {
  let data: unknown;
  try {
    data = JSON.parse(settingsPayload);
  } catch {
    return null;
  }
  if (!isDict(data) || !Array.isArray(data.terminalQuickCommands)) {
    return null;
  }
  return data.terminalQuickCommands
    .filter((item): item is Dict => isDict(item) && item.action !== 'agent-prompt' && typeof item.command === 'string')
    .map((item) => ({ label: typeof item.label === 'string' ? item.label : '', command: String(item.command) }));
}

const PATH_CHAR = /[A-Za-z0-9._~\/-]/;

/** 命令中出現完整的路徑（前後不接其他路徑字元），/a/run.sh 不會因 /x/a/run.sh 或 /a/run.sh.bak 誤判。 */
function mentionsPath(command: string, target: string): boolean {
  for (let at = command.indexOf(target); at >= 0; at = command.indexOf(target, at + 1)) {
    const before = command[at - 1];
    const after = command[at + target.length];
    if ((before === undefined || !PATH_CHAR.test(before)) && (after === undefined || !PATH_CHAR.test(after))) {
      return true;
    }
  }
  return false;
}

/** 已經有快速命令執行同一支 script（完全相同的命令，或命令裡寫了同一個絕對路徑／~ 路徑）就回傳那一筆。 */
export function findDuplicate(commands: readonly QuickCommand[], absolutePath: string): QuickCommand | null {
  const text = quickCommandText(absolutePath);
  const forms = [absolutePath, contractHome(absolutePath)];
  return commands.find((item) => item.command.trim() === text || forms.some((form) => mentionsPath(item.command, form))) ?? null;
}

/** Orca 的 userData 是 Electron 預設位置；啟用中的 profile 記在 orca-profile-index.json。 */
export async function locateProfileDb(home: string = os.homedir()): Promise<string | null> {
  const userData = path.join(home, 'Library', 'Application Support', 'orca');
  try {
    const index: unknown = JSON.parse(await fs.readFile(path.join(userData, 'orca-profile-index.json'), 'utf8'));
    const profileId = isDict(index) ? index.activeProfileId : null;
    // profile id 會拼進路徑，跟 Orca 一樣先檢查格式
    if (typeof profileId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(profileId)) {
      return null;
    }
    return path.join(userData, 'profiles', profileId, 'profile-state.db');
  } catch {
    return null;
  }
}

export async function readQuickCommands(dbPath: string | null): Promise<QuickCommand[] | null> {
  if (!dbPath) {
    return null;
  }
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db.prepare(`SELECT payload FROM profile_state_documents WHERE domain = 'settings'`).get() as
        | { payload?: unknown }
        | undefined;
      return typeof row?.payload === 'string' ? parseQuickCommands(row.payload) : null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/** 以 stdin 交給 pbcopy，不經 shell。 */
export function copyToClipboard(text: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  if (platform !== 'darwin') {
    return Promise.reject(new Error('目前只支援 macOS 的剪貼簿'));
  }
  return new Promise((resolve, reject) => {
    const child = execFile('pbcopy', (err) => (err ? reject(err) : resolve()));
    child.stdin?.end(text);
  });
}
