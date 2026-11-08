// 執行指令字串的組裝。純 Node，不依賴 Orca API。

/** 以單引號包住並跳脫內含單引號，路徑含空白、中文、特殊字元都安全。 */
export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// shellSingleQuote 的 '\'' 跳脫只在 POSIX 系 shell 成立；fish 單引號內 \' 是跳脫、
// PowerShell 用 '' 跳脫、cmd 不認單引號，照樣拼字串會讓特殊路徑變成指令注入。
const POSIX_SHELLS = new Set(['bash', 'zsh', 'sh', 'dash', 'ksh', 'gitbash']);

export function isPosixShell(shell: string | null | undefined): boolean {
  if (!shell) {
    return false;
  }
  const name = shell
    .split(/[\\/]/)
    .pop()!
    .toLowerCase()
    .replace(/\.exe$/, '');
  return POSIX_SHELLS.has(name);
}

/**
 * 不需任何引號、在每種 shell 都只會被當成單一字面參數的路徑。
 * Orca 的 terminal.create 只能送字串、不能指定 shell 執行檔，非 POSIX shell 只能靠這種路徑。
 */
export function isShellNeutralPath(value: string): boolean {
  return /^\/[A-Za-z0-9_./-]+$/.test(value) && !value.includes('..');
}

/** 在 POSIX shell 中先切到 script 所在目錄再以 bash 執行（對應 VS Code 版的 cwd = dirname）。 */
export function posixRunCommand(absolutePath: string, directory: string): string {
  return `cd ${shellSingleQuote(directory)} && bash ${shellSingleQuote(absolutePath)}`;
}

/** 啟動器檔內容：由 bash 解析，所以 POSIX 跳脫在這裡永遠成立。 */
export function launcherScript(absolutePath: string, directory: string): string {
  return `#!/bin/bash\ncd ${shellSingleQuote(directory)} || exit 1\nexec bash ${shellSingleQuote(absolutePath)}\n`;
}

/** 換行等控制字元會讓送進終端機的字串變成多行指令，任何 shell 都擋。 */
export function hasControlChars(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}
