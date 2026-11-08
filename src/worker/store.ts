// 共用／私有兩份 scripts.json 的讀寫。格式與 VS Code 版 Shell Scripts 相同，可指向同一個雲端資料夾共用。
// 每個請求都重讀磁碟、改完立即原子寫回：worker 隨時可能被 Orca 回收，不留記憶體狀態，
// 外部變更（Dropbox 回寫、VS Code 版寫入）因此不需要 mtime 比對。

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ScriptSource, ScriptTreeState } from '../core/types.ts';
import { emptyState } from '../core/types.ts';
import { normalizeState } from '../core/treeOps.ts';
import { expandHome } from '../core/homePath.ts';

export const FORMAT_VERSION = 1;
export const SCRIPTS_FILE_NAME = 'scripts.json';
export const SETTING_KEYS: Record<ScriptSource, string> = {
  shared: 'dataFolder',
  private: 'privateDataFolder',
};

export interface DataFolderLayout {
  root: string;
  scriptsFile: string;
  /** true = 使用者未設定，落在預設資料夾 */
  isFallback: boolean;
}

export function fallbackRoot(source: ScriptSource): string {
  const base = path.join(os.homedir(), '.orca-shell-scripts');
  return source === 'private' ? path.join(base, 'private') : base;
}

/** 只解析路徑，不碰磁碟。 */
export function layoutFor(source: ScriptSource, configValue: unknown): DataFolderLayout {
  const trimmed = typeof configValue === 'string' ? configValue.trim() : '';
  const isFallback = trimmed === '';
  const root = isFallback ? fallbackRoot(source) : path.resolve(expandHome(trimmed));
  return { root, scriptsFile: path.join(root, SCRIPTS_FILE_NAME), isFallback };
}

/** 建立資料夾並寫入格式版本標記（與 VS Code 版相同的 .shell-scripts.json）。 */
export function ensureFolder(layout: DataFolderLayout): void {
  fs.mkdirSync(layout.root, { recursive: true });
  const markerPath = path.join(layout.root, '.shell-scripts.json');
  if (!fs.existsSync(markerPath)) {
    fs.writeFileSync(markerPath, JSON.stringify({ formatVersion: FORMAT_VERSION }, null, 2) + '\n');
  }
}

export interface ReadResult {
  state: ScriptTreeState;
  /** 解析失敗時的說明；壞檔已改名保留 */
  notice?: string;
}

export function readState(layout: DataFolderLayout): ReadResult {
  let text: string;
  try {
    text = fs.readFileSync(layout.scriptsFile, 'utf8');
  } catch {
    return { state: emptyState() };
  }
  try {
    return { state: normalizeState(JSON.parse(text)) };
  } catch {
    // 把壞檔改名保留，避免之後的寫入蓋掉使用者資料
    const backupPath = `${layout.scriptsFile}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(layout.scriptsFile, backupPath);
      return {
        state: emptyState(),
        notice: `無法解析 ${SCRIPTS_FILE_NAME}，已改名為 ${path.basename(backupPath)} 保留`,
      };
    } catch {
      return { state: emptyState(), notice: `無法解析 ${SCRIPTS_FILE_NAME}` };
    }
  }
}

/** tmp + rename 原子寫：Dropbox 不會同步到寫一半的檔案。 */
export function writeState(layout: DataFolderLayout, state: ScriptTreeState): void {
  ensureFolder(layout);
  const tmpPath = `${layout.scriptsFile}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpPath, layout.scriptsFile);
}

/** Dropbox 衝突副本偵測（"scripts (使用者的衝突的複本 2024-01-01).json" 等）。 */
export function findConflictedCopies(root: string): string[] {
  try {
    return fs.readdirSync(root).filter((f) => /conflicted copy|衝突的複本/i.test(f));
  } catch {
    return [];
  }
}

/** 「顯示保存資料夾」的目標：有清單檔就選取它，Finder 會停在資料夾內。 */
export function revealTarget(layout: DataFolderLayout): string {
  return fs.existsSync(layout.scriptsFile) ? layout.scriptsFile : layout.root;
}
