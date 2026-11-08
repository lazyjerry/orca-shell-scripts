// script 檔驗證：存在 + 是 bash 檔（副檔名 .sh/.bash 或 shebang 含 bash/sh）。
// 純 Node，不依賴 Orca API。路徑須為展開後的絕對路徑。

import * as fs from 'node:fs';
import * as path from 'node:path';

export type ScriptValidation =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'not-file' | 'not-bash' | 'unreadable' };

export function hasShellExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.sh' || ext === '.bash';
}

/** 取直譯器名稱（含 env 轉呼叫）精確比對，zsh/fish 或 sh-tools 這類路徑段不誤中。 */
export function shebangIsShell(firstLine: string): boolean {
  return /^#!\s*(?:\S*\/)?(?:env\s+)?(?:bash|sh)(?:\s|$)/.test(firstLine);
}

/** 只讀前 maxBytes 取第一行，不整檔讀入（可能是大檔或誤登錄的 binary）。 */
export async function readFirstLine(filePath: string, maxBytes = 512): Promise<string> {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    const newline = text.indexOf('\n');
    return newline === -1 ? text : text.slice(0, newline);
  } finally {
    await handle.close();
  }
}

export async function validateScriptFile(filePath: string): Promise<ScriptValidation> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return { ok: false, reason: 'missing' };
  }
  if (!stat.isFile()) {
    return { ok: false, reason: 'not-file' };
  }
  // 副檔名是零額外 IO 的快速路徑，命中即通過；shebang 只在無副檔名時才讀
  if (hasShellExtension(filePath)) {
    return { ok: true };
  }
  try {
    const firstLine = await readFirstLine(filePath);
    return shebangIsShell(firstLine) ? { ok: true } : { ok: false, reason: 'not-bash' };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

export function validationMessage(validation: ScriptValidation): string | undefined {
  if (validation.ok) {
    return undefined;
  }
  switch (validation.reason) {
    case 'missing':
      return '檔案不存在';
    case 'not-file':
      return '路徑不是檔案';
    case 'not-bash':
      return '不是 bash 檔（無 .sh/.bash 副檔名，shebang 也不含 bash/sh）';
    case 'unreadable':
      return '檔案無法讀取';
  }
}
