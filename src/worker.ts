// worker：所有檔案系統與終端機操作都在這裡，panel 只透過 plugin.request 呼叫。
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import type { OrcaWorkerApi } from 'orca/worker';
import type { ActionResult, Flash, SourceView, ViewState, WorkspaceOption } from './protocol.ts';
import type { FolderNode, ScriptNode, ScriptSource, ScriptTreeState } from './core/types.ts';
import {
  addNode,
  allScripts,
  extractNodes,
  findNode,
  insertNodes,
  moveNodes,
  moveSibling,
  removeNode,
  renameFolder,
  updateScript,
} from './core/treeOps.ts';
import { contractHome, expandHome } from './core/homePath.ts';
import { validateScriptFile, validationMessage } from './core/validate.ts';
import { hasControlChars } from './core/quote.ts';
import {
  type DataFolderLayout,
  ensureFolder,
  findConflictedCopies,
  layoutFor,
  readState,
  revealTarget,
  SETTING_KEYS,
  writeState,
} from './worker/store.ts';
import { runScript } from './worker/runner.ts';

const SOURCES: ScriptSource[] = ['shared', 'private'];
const SOURCE_LABELS: Record<ScriptSource, string> = { shared: '共用', private: '私有' };

class UserError extends Error {}

export default function activate(orca: OrcaWorkerApi): void {
  async function layouts(): Promise<Record<ScriptSource, DataFolderLayout & { error?: string }>> {
    const settings = await orca.settings.get();
    const shared = layoutFor('shared', settings[SETTING_KEYS.shared]);
    const priv = layoutFor('private', settings[SETTING_KEYS.private]);
    // 兩份清單嚴格隔離：同路徑會讓兩邊互蓋同一個 scripts.json
    const error = priv.root === shared.root ? '私有資料夾不可與共用資料夾相同，請改設定' : undefined;
    return { shared, private: { ...priv, error } };
  }

  async function usableLayout(source: ScriptSource): Promise<DataFolderLayout> {
    const layout = (await layouts())[source];
    if (layout.error) {
      throw new UserError(layout.error);
    }
    return layout;
  }

  /** 讀 → 改 → 寫：mutator 回傳 false 表示沒有變動，不寫檔。 */
  async function mutate(source: ScriptSource, mutator: (state: ScriptTreeState) => boolean): Promise<boolean> {
    const layout = await usableLayout(source);
    const { state } = readState(layout);
    if (!mutator(state)) {
      return false;
    }
    writeState(layout, state);
    return true;
  }

  async function workspaceInfo(): Promise<{ workspaces: WorkspaceOption[]; focusedWorkspaceId: string | null }> {
    try {
      const [{ workspaces }, context] = await Promise.all([
        orca.host.call('workspace.list', {}),
        orca.host.call('workspace.readContext', {}),
      ]);
      // readContext 不給 id，只能用名稱 + branch 對回 workspace.list；對到不只一個就不猜
      const matches = context
        ? workspaces.filter((w) => w.name === context.displayName && (w.branch ?? '') === context.branch)
        : [];
      return {
        workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, branch: w.branch })),
        focusedWorkspaceId: matches.length === 1 ? matches[0].id : null,
      };
    } catch {
      return { workspaces: [], focusedWorkspaceId: null };
    }
  }

  async function viewState(): Promise<ViewState> {
    const all = await layouts();
    const notices: string[] = [];
    const sources: SourceView[] = [];
    for (const source of SOURCES) {
      const layout = all[source];
      const view: SourceView = {
        source,
        root: contractHome(layout.root),
        isFallback: layout.isFallback,
        roots: [],
        invalid: {},
        conflicts: [],
        // 回給 panel 的值必須是嚴格 JSON：值為 undefined 的欄位會讓 Orca 以 invalid input 拒收整個回應
        ...(layout.error ? { error: layout.error } : {}),
      };
      if (!layout.error) {
        try {
          ensureFolder(layout);
          const { state, notice } = readState(layout);
          if (notice) {
            notices.push(`${SOURCE_LABELS[source]}清單：${notice}`);
          }
          view.roots = state.roots;
          view.conflicts = findConflictedCopies(layout.root);
          await Promise.all(
            allScripts(state).map(async (script) => {
              const message = validationMessage(await validateScriptFile(expandHome(script.path)));
              if (message) {
                view.invalid[script.id] = message;
              }
            }),
          );
        } catch (err) {
          view.error = `無法使用保存資料夾：${errorText(err)}`;
        }
      }
      sources.push(view);
    }
    return { sources, notices, ...(await workspaceInfo()) };
  }

  /** 每個動作都回傳最新畫面狀態；UserError 轉成提示，其他錯誤照常拋給 panel。 */
  function action<I>(run: (input: I) => Promise<Flash | undefined>): (input: I) => Promise<ActionResult> {
    return async (input) => {
      let flash: Flash | undefined;
      try {
        flash = await run(input);
      } catch (err) {
        if (!(err instanceof UserError)) {
          orca.log(`action failed: ${errorText(err)}`);
        }
        flash = { tone: 'danger', text: errorText(err) };
      }
      const state = await viewState();
      return flash ? { state, flash } : { state };
    };
  }

  orca.panels.handle('state.get', () => viewState());

  orca.panels.handle(
    'script.add',
    action(async ({ source, parentId, path: rawPath }) => {
      const stored = normalizeScriptPath(rawPath);
      const script: ScriptNode = { kind: 'script', id: randomUUID(), label: path.basename(expandHome(stored)), path: stored };
      if (!(await mutate(source, (state) => addNode(state, script, parentId)))) {
        throw new UserError('找不到要加入的資料夾，清單可能已在別處被修改');
      }
      return validationFlash(script, `已新增「${script.label}」`);
    }),
  );

  orca.panels.handle(
    'folder.add',
    action(async ({ source, parentId, name }) => {
      const folder: FolderNode = { kind: 'folder', id: randomUUID(), name: requireName(name), children: [] };
      if (!(await mutate(source, (state) => addNode(state, folder, parentId)))) {
        throw new UserError('找不到要加入的資料夾，清單可能已在別處被修改');
      }
      return undefined;
    }),
  );

  orca.panels.handle(
    'script.update',
    action(async ({ source, id, path: rawPath, note }) => {
      let updated: ScriptNode | undefined;
      await mutate(source, (state) => {
        const node = findNode(state, id);
        if (!node || node.kind !== 'script') {
          return false;
        }
        const patch: Partial<Pick<ScriptNode, 'label' | 'path' | 'note'>> = {};
        if (note !== undefined) {
          patch.note = note.trim();
        }
        if (rawPath !== undefined) {
          patch.path = normalizeScriptPath(rawPath);
          // 顯示名稱若沿用舊檔名，跟著換成新檔名；使用者自訂過的名稱不動
          if (node.label === path.basename(expandHome(node.path))) {
            patch.label = path.basename(expandHome(patch.path));
          }
        }
        updateScript(state, id, patch);
        updated = { ...node };
        return true;
      });
      if (!updated) {
        throw new UserError('找不到這個 script，清單可能已在別處被修改');
      }
      return rawPath !== undefined ? validationFlash(updated, '已更新路徑') : undefined;
    }),
  );

  orca.panels.handle(
    'folder.rename',
    action(async ({ source, id, name }) => {
      const trimmed = requireName(name);
      await mutate(source, (state) => renameFolder(state, id, trimmed));
      return undefined;
    }),
  );

  orca.panels.handle(
    'node.delete',
    action(async ({ source, id }) => {
      await mutate(source, (state) => removeNode(state, id) !== undefined);
      return { tone: 'neutral', text: '已從清單移除（磁碟上的檔案不受影響）' };
    }),
  );

  orca.panels.handle(
    'node.shift',
    action(async ({ source, id, delta }) => {
      await mutate(source, (state) => moveSibling(state, id, delta));
      return undefined;
    }),
  );

  orca.panels.handle(
    'node.move',
    action(async ({ source, id, toSource, toFolderId }) => {
      const target = toFolderId === null ? ({ type: 'root' } as const) : ({ type: 'folder', id: toFolderId } as const);
      if (source === toSource) {
        if (!(await mutate(source, (state) => moveNodes(state, [id], target)))) {
          throw new UserError('不能移到自己或自己的子資料夾裡');
        }
        return undefined;
      }
      // 跨清單：先寫入目的地再從來源移除，中途失敗最多是重複一筆，不會讓節點消失
      const from = await usableLayout(source);
      const fromState = readState(from).state;
      const moving = extractNodes(fromState, [id]);
      if (moving.length === 0) {
        throw new UserError('找不到要移動的項目');
      }
      await mutate(toSource, (state) => {
        insertNodes(state, moving, target);
        return true;
      });
      writeState(from, fromState);
      return undefined;
    }),
  );

  orca.panels.handle(
    'script.run',
    action(async ({ source, id, workspaceId }) => {
      const layout = await usableLayout(source);
      const node = findNode(readState(layout).state, id);
      if (!node || node.kind !== 'script') {
        throw new UserError('找不到這個 script，清單可能已在別處被修改');
      }
      // 執行前即時重驗證，不信任畫面上的結果
      const message = validationMessage(await validateScriptFile(expandHome(node.path)));
      if (message) {
        throw new UserError(`無法執行「${node.label}」：${message}（${node.path}）`);
      }
      const targetId = workspaceId || (await workspaceInfo()).focusedWorkspaceId;
      if (!targetId) {
        throw new UserError('認不出目前的 workspace，請在上方「執行於」選一個');
      }
      const outcome = await runScript(orca, node, targetId);
      if (!outcome.ok) {
        throw new UserError(`無法執行「${node.label}」：${outcome.reason}`);
      }
      return {
        tone: 'success',
        text: outcome.reused ? `已在原終端機重新執行「${node.label}」` : `已開新終端機執行「${node.label}」`,
      };
    }),
  );

  orca.panels.handle(
    'dataFolder.set',
    action(async ({ source, folder }) => {
      const trimmed = folder.trim();
      if (trimmed !== '' && !trimmed.startsWith('/') && !trimmed.startsWith('~')) {
        throw new UserError('請輸入絕對路徑或 ~ 開頭的路徑；留空表示使用預設位置');
      }
      const value = trimmed === '' ? '' : contractHome(path.resolve(expandHome(trimmed)));
      await orca.settings.set(SETTING_KEYS[source], value);
      return { tone: 'success', text: `${SOURCE_LABELS[source]}清單改存到 ${value || '預設位置'}` };
    }),
  );

  orca.panels.handle(
    'dataFolder.reveal',
    action(async ({ source }) => {
      const layout = await usableLayout(source);
      ensureFolder(layout);
      await reveal(revealTarget(layout));
      return undefined;
    }),
  );
}

/** 只接受絕對路徑或 ~ 開頭；家目錄下一律收斂為 ~ 形式，方便多機同步。 */
function normalizeScriptPath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') && !trimmed.startsWith('~')) {
    throw new UserError('請輸入絕對路徑或 ~ 開頭的路徑');
  }
  if (hasControlChars(trimmed)) {
    throw new UserError('路徑不可包含換行等控制字元');
  }
  return contractHome(path.resolve(expandHome(trimmed)));
}

function requireName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') {
    throw new UserError('名稱不可空白');
  }
  return trimmed;
}

/** 登錄即驗證：失敗只警告不擋，讓使用者先登錄、之後再修檔。 */
async function validationFlash(script: ScriptNode, okText: string): Promise<Flash> {
  const message = validationMessage(await validateScriptFile(expandHome(script.path)));
  return message ? { tone: 'warning', text: `「${script.label}」驗證未通過：${message}` } : { tone: 'success', text: okText };
}

/** 以參數陣列呼叫，不經 shell；不用「開啟」資料夾，避免 *.app 這類 bundle 被 macOS 直接啟動。 */
function reveal(target: string): Promise<void> {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', ['-R', target]]
      : process.platform === 'win32'
        ? ['explorer.exe', [`/select,${target}`]]
        : ['xdg-open', [path.dirname(target)]];
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err) => (err && process.platform !== 'win32' ? reject(err) : resolve()));
  });
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
