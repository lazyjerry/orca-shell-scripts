// 資料模型：script 是「登錄的路徑參照」，不是掃描實體目錄。
// 純 Node，不依賴 Orca API。

export type ScriptSource = 'shared' | 'private';

export interface ScriptNode {
  kind: 'script';
  id: string;
  label: string;
  /** 儲存值：家目錄下的路徑一律收斂為 '~/...'；使用時 expandHome */
  path: string;
  /** 備註，TreeView 顯示在檔名後 */
  note?: string;
}

export interface FolderNode {
  kind: 'folder';
  id: string;
  name: string;
  /** 順序 = 陣列順序，支援巢狀 */
  children: TreeNode[];
}

export type TreeNode = ScriptNode | FolderNode;

export interface ScriptTreeState {
  version: 1;
  roots: TreeNode[];
}

export function emptyState(): ScriptTreeState {
  return { version: 1, roots: [] };
}
