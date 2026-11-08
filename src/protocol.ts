// panel 與 worker 的請求契約，兩邊共用。
import type { ScriptSource, TreeNode } from './core/types.ts';

export type { FolderNode, ScriptNode, ScriptSource, TreeNode } from './core/types.ts';

export interface SourceView {
  source: ScriptSource;
  /** 顯示用（家目錄收斂為 ~） */
  root: string;
  isFallback: boolean;
  roots: TreeNode[];
  /** script id → 驗證失敗原因；通過的不列 */
  invalid: Record<string, string>;
  conflicts: string[];
  /** 這份清單整體無法使用的原因（例如與共用資料夾同路徑） */
  error?: string;
}

export interface ViewState {
  sources: SourceView[];
  notices: string[];
}

export interface Flash {
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  text: string;
}

export interface ActionResult {
  state: ViewState;
  flash?: Flash;
}

type Target = { source: ScriptSource; id: string };

/** 「建立至快速命令中」的操作步驟要貼的內容；checked = 是否成功比對過現有快速命令。 */
export interface QuickCommandGuide {
  label: string;
  command: string;
  checked: boolean;
}

declare module 'orca' {
  interface PluginRequests {
    'state.get': { output: ViewState };
    'script.add': { input: { source: ScriptSource; parentId?: string; path: string }; output: ActionResult };
    'folder.add': { input: { source: ScriptSource; parentId?: string; name: string }; output: ActionResult };
    'script.update': { input: Target & { path?: string; note?: string }; output: ActionResult };
    'folder.rename': { input: Target & { name: string }; output: ActionResult };
    'node.delete': { input: Target; output: ActionResult };
    'node.shift': { input: Target & { delta: -1 | 1 }; output: ActionResult };
    /** toFolderId 為 null = 移到該清單最上層 */
    'node.move': { input: Target & { toSource: ScriptSource; toFolderId: string | null }; output: ActionResult };
    'script.run': { input: Target; output: ActionResult };
    'dataFolder.set': { input: { source: ScriptSource; folder: string }; output: ActionResult };
    'dataFolder.reveal': { input: { source: ScriptSource }; output: ActionResult };
    /** 已有相同 bash 的快速命令時不給 guide，改回 danger flash */
    'quickCommand.prepare': { input: Target; output: ActionResult & { guide?: QuickCommandGuide } };
    'clipboard.copy': { input: { text: string; what: string }; output: { flash: Flash } };
  }
}
