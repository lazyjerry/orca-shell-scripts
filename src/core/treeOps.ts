// 樹操作純函式：所有「樹要怎麼變」都在這裡，UI 層只是接線。
// 函式直接 mutate 傳入的 state，回傳值表示是否有變動。
// 純 Node，不依賴 Orca API。

import type { FolderNode, ScriptNode, ScriptTreeState, TreeNode } from './types.ts';
import { emptyState } from './types.ts';

export type DropTarget =
  | { type: 'folder'; id: string }
  | { type: 'after'; id: string }
  | { type: 'root' };

export function findNode(state: ScriptTreeState, id: string): TreeNode | undefined {
  return findIn(state.roots, id);
}

function findIn(nodes: TreeNode[], id: string): TreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    if (node.kind === 'folder') {
      const hit = findIn(node.children, id);
      if (hit) {
        return hit;
      }
    }
  }
  return undefined;
}

/** 回傳包含該節點的陣列（roots 或某 folder 的 children）。 */
export function findContainer(state: ScriptTreeState, id: string): TreeNode[] | undefined {
  return findContainerIn(state.roots, id);
}

function findContainerIn(nodes: TreeNode[], id: string): TreeNode[] | undefined {
  if (nodes.some((n) => n.id === id)) {
    return nodes;
  }
  for (const node of nodes) {
    if (node.kind === 'folder') {
      const hit = findContainerIn(node.children, id);
      if (hit) {
        return hit;
      }
    }
  }
  return undefined;
}

/** 深度優先列出所有 script 節點（驗證批次用）。 */
export function allScripts(state: ScriptTreeState): ScriptNode[] {
  const out: ScriptNode[] = [];
  const walk = (nodes: TreeNode[]): void => {
    for (const node of nodes) {
      if (node.kind === 'script') {
        out.push(node);
      } else {
        walk(node.children);
      }
    }
  };
  walk(state.roots);
  return out;
}

/** 加入節點：有 parentFolderId 就進該資料夾末尾，否則進 roots 末尾。 */
export function addNode(state: ScriptTreeState, node: TreeNode, parentFolderId?: string): boolean {
  if (parentFolderId === undefined) {
    state.roots.push(node);
    return true;
  }
  const parent = findNode(state, parentFolderId);
  if (!parent || parent.kind !== 'folder') {
    return false;
  }
  parent.children.push(node);
  return true;
}

/** 移除節點並回傳被移除的節點（不存在回 undefined）。 */
export function removeNode(state: ScriptTreeState, id: string): TreeNode | undefined {
  const container = findContainer(state, id);
  if (!container) {
    return undefined;
  }
  const index = container.findIndex((n) => n.id === id);
  return container.splice(index, 1)[0];
}

export function renameFolder(state: ScriptTreeState, id: string, name: string): boolean {
  const node = findNode(state, id);
  if (!node || node.kind !== 'folder') {
    return false;
  }
  node.name = name;
  return true;
}

export function updateScript(
  state: ScriptTreeState,
  id: string,
  patch: Partial<Pick<ScriptNode, 'label' | 'path' | 'note'>>,
): boolean {
  const node = findNode(state, id);
  if (!node || node.kind !== 'script') {
    return false;
  }
  Object.assign(node, patch);
  if (node.note === '') {
    delete node.note;
  }
  return true;
}

/** target 是否為 folder 自身或其子孫（循環防護用）。 */
function isSelfOrDescendant(folder: FolderNode, targetId: string): boolean {
  if (folder.id === targetId) {
    return true;
  }
  return findIn(folder.children, targetId) !== undefined;
}

/** 整批移除 ids 並回傳最外層節點（已被同批 folder 涵蓋的子孫不重複取出，跟著 folder 走）。 */
export function extractNodes(state: ScriptTreeState, ids: string[]): TreeNode[] {
  const moving = ids
    .map((id) => findNode(state, id))
    .filter((n): n is TreeNode => n !== undefined);
  const topLevel = moving.filter(
    (n) => !moving.some((m) => m !== n && m.kind === 'folder' && findIn(m.children, n.id) !== undefined),
  );
  for (const node of topLevel) {
    removeNode(state, node.id);
  }
  return topLevel;
}

/** 插入節點：folder = 移入末尾、after = 插在該節點之後、root = roots 末尾。target 消失時退回 roots，不讓節點蒸發。 */
export function insertNodes(state: ScriptTreeState, nodes: TreeNode[], target: DropTarget): void {
  if (nodes.length === 0) {
    return;
  }
  if (target.type === 'folder') {
    const folder = findNode(state, target.id);
    if (folder && folder.kind === 'folder') {
      folder.children.push(...nodes);
      return;
    }
  } else if (target.type === 'after') {
    const container = findContainer(state, target.id);
    if (container) {
      const index = container.findIndex((n) => n.id === target.id);
      container.splice(index + 1, 0, ...nodes);
      return;
    }
  }
  state.roots.push(...nodes);
}

/**
 * 同一棵樹內搬移。先整批移除再插入（避免同層往後移的 index 位移）。違反防護時整批 no-op：
 * - target 在來源集合內（或其子孫）
 * - 來源 folder 是 target 的祖先（移入自身子孫）
 */
export function moveNodes(state: ScriptTreeState, ids: string[], target: DropTarget): boolean {
  if (target.type !== 'root') {
    const moving = ids
      .map((id) => findNode(state, id))
      .filter((n): n is TreeNode => n !== undefined);
    if (moving.length === 0) {
      return false;
    }
    const targetInMoving = moving.some(
      (n) => n.id === target.id || (n.kind === 'folder' && isSelfOrDescendant(n, target.id)),
    );
    if (targetInMoving) {
      return false;
    }
  }
  const extracted = extractNodes(state, ids);
  if (extracted.length === 0) {
    return false;
  }
  insertNodes(state, extracted, target);
  return true;
}

/** 載入時修復壞資料：過濾缺欄位的節點、補 version。非物件輸入回空 state。 */
export function normalizeState(raw: unknown): ScriptTreeState {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { roots?: unknown }).roots)) {
    return emptyState();
  }
  return { version: 1, roots: normalizeNodes((raw as { roots: unknown[] }).roots) };
}

function normalizeNodes(raw: unknown[]): TreeNode[] {
  const out: TreeNode[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const node = item as Record<string, unknown>;
    if (typeof node.id !== 'string' || node.id === '') {
      continue;
    }
    if (node.kind === 'script' && typeof node.path === 'string' && typeof node.label === 'string') {
      const script: ScriptNode = { kind: 'script', id: node.id, label: node.label, path: node.path };
      if (typeof node.note === 'string' && node.note !== '') {
        script.note = node.note;
      }
      out.push(script);
    } else if (node.kind === 'folder' && typeof node.name === 'string') {
      out.push({
        kind: 'folder',
        id: node.id,
        name: node.name,
        children: Array.isArray(node.children) ? normalizeNodes(node.children) : [],
      });
    }
  }
  return out;
}

/** 同層上移（delta = -1）或下移（delta = 1）；已在邊界回 false。取代 VS Code 版的拖曳排序。 */
export function moveSibling(state: ScriptTreeState, id: string, delta: -1 | 1): boolean {
  const container = findContainer(state, id);
  if (!container) {
    return false;
  }
  const index = container.findIndex((n) => n.id === id);
  const next = index + delta;
  if (next < 0 || next >= container.length) {
    return false;
  }
  [container[index], container[next]] = [container[next], container[index]];
  return true;
}
