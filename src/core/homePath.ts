// 家目錄路徑的展開與收斂：儲存與顯示用 '~/...'，實際 fs 操作與執行用絕對路徑。
// 純 Node，不依賴 Orca API。

import * as os from 'node:os';
import * as path from 'node:path';

export function expandHome(p: string): string {
  if (p === '~') {
    return os.homedir();
  }
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/** 家目錄前綴收斂為 ~；只在完整路徑段命中才收斂（/Users/foobar 不因 /Users/foo 而誤收）。 */
export function contractHome(p: string): string {
  const home = os.homedir();
  if (p === home) {
    return '~';
  }
  if (p.startsWith(home + path.sep)) {
    return '~/' + p.slice(home.length + 1);
  }
  return p;
}
