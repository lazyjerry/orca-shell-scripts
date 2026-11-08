// 執行指令字串的組裝。純 Node，不依賴 Orca API。

/** 以單引號包住並跳脫內含單引號，路徑含空白、中文、特殊字元都安全。 */
export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** 啟動器檔內容：由 bash 解析，所以 POSIX 跳脫在這裡永遠成立。 */
export function launcherScript(absolutePath: string, directory: string): string {
  return `#!/bin/bash\ncd ${shellSingleQuote(directory)} || exit 1\nexec bash ${shellSingleQuote(absolutePath)}\n`;
}

/** 換行等控制字元會讓送進終端機的字串變成多行指令，任何 shell 都擋。 */
export function hasControlChars(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}
