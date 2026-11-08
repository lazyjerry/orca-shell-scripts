// 右側欄面板：清單、選取後的動作區、行內表單。狀態都由 worker 回傳的 ViewState 驅動。
import {
  atom,
  Button,
  Callout,
  Card,
  EmptyState,
  Input,
  KeyValue,
  on,
  plugin,
  read,
  Row,
  Select,
  set,
  Spinner,
  Stack,
  Text,
  Toolbar,
  IconButton,
  Box,
  List,
  ListItem,
  type IconName,
  type OrcaNode,
  type PanelContext,
} from 'orca';
import type { ActionResult, Flash, FolderNode, ScriptNode, ScriptSource, SourceView, TreeNode, ViewState } from './protocol.ts';

const SOURCE_LABELS: Record<ScriptSource, string> = { shared: '共用', private: '私有' };
const AUTO_WORKSPACE = 'auto';

type Form =
  | { kind: 'addScript' | 'addFolder'; source: ScriptSource; parentId?: string }
  | { kind: 'editNote' | 'editPath' | 'rename' | 'delete'; source: ScriptSource; id: string }
  | { kind: 'dataFolder'; source: ScriptSource };

type Selection =
  | { type: 'source'; source: ScriptSource }
  | { type: 'node'; source: ScriptSource; node: TreeNode; parentId?: string };

const view = atom<ViewState | null>(null);
const flash = atom<Flash | null>(null);
const busy = atom(false);
const form = atom<Form | null>(null);
const draft = atom('');
const formSource = atom<ScriptSource>('shared');
const selected = atom('selected', '', { persist: 'plugin' });
const expanded = atom<string[]>('expanded', ['src:shared', 'src:private'], { persist: 'plugin' });
const workspaceChoice = atom('workspace', AUTO_WORKSPACE, { persist: 'workspace' });

const sourceKey = (source: ScriptSource) => `src:${source}`;
const nodeKey = (source: ScriptSource, id: string) => `${source}:${id}`;

async function refresh(): Promise<void> {
  try {
    set(view, await plugin.request('state.get'));
  } catch (err) {
    set(flash, { tone: 'danger', text: `讀取清單失敗：${errorText(err)}` });
  }
}

/** 送出動作並套用回傳的最新狀態；動作期間鎖住按鈕，避免連點重複新增。 */
async function act(run: () => Promise<ActionResult>, closeForm = true): Promise<void> {
  set(busy, true);
  try {
    const result = await run();
    set(view, result.state);
    set(flash, result.flash ?? null);
    if (closeForm && result.flash?.tone !== 'danger') {
      set(form, null);
    }
  } catch (err) {
    set(flash, { tone: 'danger', text: errorText(err) });
  } finally {
    set(busy, false);
  }
}

export function setup(ctx: PanelContext): void {
  // 聚焦的 workspace 變了就重抓：自動選取的執行目標跟著換，也順便載入別處寫入的清單
  ctx.subscriptions.push(on('workspace.changed', () => void refresh()));
  void refresh();
}

function openForm(next: Form, initial = ''): void {
  set(form, next);
  set(draft, initial);
  if ('parentId' in next && next.parentId === undefined) {
    set(formSource, next.source);
  }
}

function findSelection(state: ViewState, key: string): Selection | null {
  for (const src of state.sources) {
    if (key === sourceKey(src.source)) {
      return { type: 'source', source: src.source };
    }
    const hit = key.startsWith(`${src.source}:`) ? findWithParent(src.roots, key.slice(src.source.length + 1), undefined) : null;
    if (hit) {
      return { type: 'node', source: src.source, ...hit };
    }
  }
  return null;
}

function findWithParent(nodes: TreeNode[], id: string, parentId: string | undefined): { node: TreeNode; parentId?: string } | null {
  for (const node of nodes) {
    if (node.id === id) {
      return { node, parentId };
    }
    if (node.kind === 'folder') {
      const hit = findWithParent(node.children, id, node.id);
      if (hit) {
        return hit;
      }
    }
  }
  return null;
}

/** 新增的目標：選到來源 = 該來源最上層、資料夾 = 移入、script = 與它同一層。 */
function addTarget(sel: Selection | null): { source: ScriptSource; parentId?: string } {
  if (!sel) {
    return { source: 'shared' };
  }
  if (sel.type === 'source') {
    return { source: sel.source };
  }
  return { source: sel.source, parentId: sel.node.kind === 'folder' ? sel.node.id : sel.parentId };
}

// 清單用 ListItem 而非 Tree：Tree 的列固定一行高，說明只能擠在名稱後面；ListItem 會把說明放到第二行小字。
// 代價是沒有 Tree 的方向鍵與 Enter／雙擊執行，執行改由下方動作區的按鈕。

/** 按未選取的項目＝選取並展開；再按已選取的來源／資料夾＝切換展開。 */
function pressBranch(key: string): void {
  const open = read(expanded);
  if (read(selected) !== key) {
    set(selected, key);
    if (!open.includes(key)) {
      set(expanded, [...open, key]);
    }
    return;
  }
  set(expanded, open.includes(key) ? open.filter((k) => k !== key) : [...open, key]);
}

/** List 只收 ListItem，展開後的子項目放不進去，所以每一列各包一個 List。 */
function entry(key: string, item: { title: string; icon: IconName; description?: string }, onPress: () => void): OrcaNode {
  return (
    <List label={item.title}>
      <ListItem
        title={item.title}
        icon={item.icon}
        current={read(selected) === key}
        onPress={onPress}
        {...(item.description ? { description: item.description } : {})}
      />
    </List>
  );
}

/** 展開中的分支：自己一列，子項目往右縮排一階。 */
function branch(key: string, row: OrcaNode, children: () => OrcaNode[]): OrcaNode {
  if (!read(expanded).includes(key)) {
    return row;
  }
  return (
    <Box gap="none">
      {row}
      <Box direction="row" gap="none">
        <Box width={12} shrink={false} />
        <Box gap="none" grow minWidth={0}>
          {children()}
        </Box>
      </Box>
    </Box>
  );
}

function nodeEntries(src: SourceView, nodes: TreeNode[]): OrcaNode[] {
  return nodes.map((node) => {
    const key = nodeKey(src.source, node.id);
    if (node.kind === 'folder') {
      const row = entry(key, { title: node.name, icon: 'folder' }, () => pressBranch(key));
      return branch(key, row, () => nodeEntries(src, node.children));
    }
    const problem = src.invalid[node.id];
    const description = [node.note, problem && `⚠ ${problem}`].filter(Boolean).join(' · ');
    return entry(key, { title: node.label, icon: problem ? 'warning' : 'terminal', description }, () => set(selected, key));
  });
}

/** 動作區卡片的標題列：標題靠左，排序與搬移控制放右側。 */
function CardHeader({ title, children }: { title: string; children?: OrcaNode }) {
  return (
    <Row justify="between" align="center" gap="xs" wrap>
      <Box grow minWidth={0}>
        <Text weight="semibold" truncate>
          {title}
        </Text>
      </Box>
      <Row gap="xs" align="center">
        {children}
      </Row>
    </Row>
  );
}

/** 「移到…」的選項：兩份清單的最上層與所有資料夾，排除自己與自己的子孫。 */
function moveOptions(state: ViewState, moving: TreeNode): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const walk = (source: ScriptSource, nodes: TreeNode[], prefix: string) => {
    for (const node of nodes) {
      if (node.kind !== 'folder' || node.id === moving.id) {
        continue;
      }
      options.push({ value: `${source}:${node.id}`, label: `${prefix}${node.name}` });
      walk(source, node.children, `${prefix}${node.name} / `);
    }
  };
  for (const src of state.sources) {
    if (src.error) {
      continue;
    }
    options.push({ value: src.source, label: `${SOURCE_LABELS[src.source]}（最上層）` });
    walk(src.source, src.roots, `${SOURCE_LABELS[src.source]} / `);
  }
  return options;
}

function runScript(source: ScriptSource, script: ScriptNode): Promise<void> {
  const choice = read(workspaceChoice);
  // plugin.request 只收 JSON：undefined 欄位會被當成 invalid_params，選填欄位要整個省略
  const input = choice === AUTO_WORKSPACE ? { source, id: script.id } : { source, id: script.id, workspaceId: choice };
  return act(() => plugin.request('script.run', input), false);
}

function FormArea({ state }: { state: ViewState }) {
  const current = read(form);
  if (!current) {
    return null;
  }
  const value = read(draft);
  const disabled = read(busy);
  const cancel = () => set(form, null);
  const sel = 'id' in current ? findSelection(state, nodeKey(current.source, current.id)) : null;
  const name = sel?.type === 'node' ? (sel.node.kind === 'folder' ? sel.node.name : sel.node.label) : '';

  if (current.kind === 'delete') {
    const isFolder = sel?.type === 'node' && sel.node.kind === 'folder';
    return (
      <Callout tone="danger" title={`確定刪除${isFolder ? '資料夾' : ' script'}「${name}」？`}>
        <Stack gap="sm">
          <Text size="sm">
            {isFolder ? '資料夾內的項目會一併從清單移除。' : '只從清單移除。'}不會動到磁碟上的實體檔案。
          </Text>
          <Row gap="xs">
            <Button
              tone="danger"
              disabled={disabled}
              onPress={() => act(() => plugin.request('node.delete', { source: current.source, id: current.id }))}
            >
              確定刪除
            </Button>
            <Button variant="ghost" onPress={cancel}>
              取消
            </Button>
          </Row>
        </Stack>
      </Callout>
    );
  }

  const spec = {
    addScript: { title: '新增 Script', label: 'Script 路徑', placeholder: '~/bin/deploy.sh 或絕對路徑' },
    addFolder: { title: '新增資料夾', label: '資料夾名稱', placeholder: '新資料夾' },
    editNote: { title: `編輯備註：${name}`, label: '備註', placeholder: '顯示在檔名後面的說明（留空清除）' },
    editPath: { title: `編輯路徑：${name}`, label: 'Script 路徑', placeholder: '~/bin/deploy.sh 或絕對路徑' },
    rename: { title: `資料夾改名：${name}`, label: '資料夾名稱', placeholder: '' },
    dataFolder: {
      title: `${SOURCE_LABELS[current.source]}清單保存位置`,
      label: '資料夾路徑',
      placeholder: '~/Dropbox/shell-scripts（留空使用預設位置）',
    },
  }[current.kind];

  const submit = (): Promise<void> => {
    switch (current.kind) {
      case 'addScript':
      case 'addFolder': {
        const source = current.parentId === undefined ? read(formSource) : current.source;
        const input = current.parentId === undefined ? { source } : { source, parentId: current.parentId };
        return current.kind === 'addScript'
          ? act(() => plugin.request('script.add', { ...input, path: value }))
          : act(() => plugin.request('folder.add', { ...input, name: value || '新資料夾' }));
      }
      case 'editNote':
        return act(() => plugin.request('script.update', { source: current.source, id: current.id, note: value }));
      case 'editPath':
        return act(() => plugin.request('script.update', { source: current.source, id: current.id, path: value }));
      case 'rename':
        return act(() => plugin.request('folder.rename', { source: current.source, id: current.id, name: value }));
      case 'dataFolder':
        return act(() => plugin.request('dataFolder.set', { source: current.source, folder: value }));
      default:
        return Promise.resolve();
    }
  };

  const askSource = (current.kind === 'addScript' || current.kind === 'addFolder') && current.parentId === undefined;
  return (
    <Card title={spec.title}>
      <Stack gap="sm">
        {askSource ? (
          <Select
            label="加到哪份清單"
            value={read(formSource)}
            options={[
              { value: 'shared', label: '共用清單' },
              { value: 'private', label: '私有清單' },
            ]}
            onChange={(v) => set(formSource, v === 'private' ? 'private' : 'shared')}
          />
        ) : null}
        <Input
          label={spec.label}
          value={value}
          placeholder={spec.placeholder}
          onChange={(v) => set(draft, v)}
          onSubmit={() => void submit()}
        />
        <Row gap="xs">
          <Button tone="accent" disabled={disabled} onPress={submit}>
            確定
          </Button>
          <Button variant="ghost" onPress={cancel}>
            取消
          </Button>
        </Row>
      </Stack>
    </Card>
  );
}

function Details({ state, sel }: { state: ViewState; sel: Selection }) {
  const disabled = read(busy);
  if (sel.type === 'source') {
    const src = state.sources.find((s) => s.source === sel.source)!;
    return (
      <Card title={`${SOURCE_LABELS[sel.source]}清單`}>
        <Stack gap="sm">
          <KeyValue items={[{ label: '保存位置', value: src.isFallback ? `${src.root}（預設）` : src.root }]} />
          <Row gap="xs" wrap>
            <Button size="sm" icon="add" disabled={disabled} onPress={() => openForm({ kind: 'addScript', source: sel.source })}>
              新增 Script
            </Button>
            <Button size="sm" icon="folder" disabled={disabled} onPress={() => openForm({ kind: 'addFolder', source: sel.source })}>
              新增資料夾
            </Button>
            <Button
              size="sm"
              variant="outline"
              icon="settings"
              onPress={() => openForm({ kind: 'dataFolder', source: sel.source }, src.isFallback ? '' : src.root)}
            >
              選擇保存位置
            </Button>
            <Button
              size="sm"
              variant="outline"
              icon="open-external"
              disabled={disabled || Boolean(src.error)}
              onPress={() => act(() => plugin.request('dataFolder.reveal', { source: sel.source }), false)}
            >
              顯示保存資料夾
            </Button>
          </Row>
        </Stack>
      </Card>
    );
  }

  const { node, source } = sel;
  const target = { source, id: node.id };
  const shift = (delta: -1 | 1) => act(() => plugin.request('node.shift', { ...target, delta }), false);
  const move = (value: string) => {
    const [toSource, folderId] = value.split(':') as [ScriptSource, string];
    return act(() => plugin.request('node.move', { ...target, toSource, toFolderId: folderId || null }), false);
  };
  // 圖示 collapse 是向上箭頭、expand 是向下箭頭
  const arrange = (
    <>
      <IconButton icon="collapse" label="上移" size="sm" disabled={disabled} onPress={() => shift(-1)} />
      <IconButton icon="expand" label="下移" size="sm" disabled={disabled} onPress={() => shift(1)} />
      <Select label="移到" labelHidden value="" placeholder="移到…" options={moveOptions(state, node)} disabled={disabled} onChange={move} />
    </>
  );
  const remove = (
    <Button size="sm" tone="danger" variant="ghost" icon="delete" onPress={() => openForm({ kind: 'delete', ...target })}>
      刪除
    </Button>
  );

  if (node.kind === 'folder') {
    const folder: FolderNode = node;
    return (
      <Card>
        <Stack gap="sm">
          <CardHeader title={folder.name}>{arrange}</CardHeader>
          <Text size="sm" muted>
            {folder.children.length} 個項目
          </Text>
          <Row gap="xs" wrap>
            <Button size="sm" icon="add" disabled={disabled} onPress={() => openForm({ kind: 'addScript', source, parentId: folder.id })}>
              新增 Script
            </Button>
            <Button size="sm" icon="folder" disabled={disabled} onPress={() => openForm({ kind: 'addFolder', source, parentId: folder.id })}>
              新增資料夾
            </Button>
            <Button size="sm" variant="outline" icon="edit" onPress={() => openForm({ kind: 'rename', ...target }, folder.name)}>
              改名
            </Button>
            {remove}
          </Row>
        </Stack>
      </Card>
    );
  }

  const script: ScriptNode = node;
  const problem = state.sources.find((s) => s.source === source)?.invalid[script.id];
  return (
    <Card>
      <Stack gap="sm">
        <CardHeader title={script.label}>{arrange}</CardHeader>
        <KeyValue
          items={[
            { label: '路徑', value: script.path },
            { label: '備註', value: script.note ?? '—' },
            { label: '狀態', value: problem ? `⚠ ${problem}` : '可執行' },
          ]}
        />
        <Row gap="xs" wrap>
          {/* Button 的 tone 只有 accent／danger 會上色，綠色改由外框 Box 的 success 底色與邊框呈現 */}
          <Box border="success" background="success" radius="md">
            <Button size="sm" variant="ghost" icon="play" disabled={disabled} onPress={() => runScript(source, script)}>
              執行
            </Button>
          </Box>
          <Button size="sm" variant="outline" icon="edit" onPress={() => openForm({ kind: 'editNote', ...target }, script.note ?? '')}>
            編輯備註
          </Button>
          <Button size="sm" variant="outline" icon="file" onPress={() => openForm({ kind: 'editPath', ...target }, script.path)}>
            編輯路徑
          </Button>
          {remove}
        </Row>
      </Stack>
    </Card>
  );
}

export default function Panel() {
  const state = read(view);
  if (!state) {
    const failure = read(flash);
    return failure ? (
      <Callout tone="danger" title="無法載入清單">
        <Stack gap="sm">
          <Text size="sm">{failure.text}</Text>
          <Button size="sm" icon="refresh" onPress={refresh}>
            重試
          </Button>
        </Stack>
      </Callout>
    ) : (
      <Spinner label="載入清單" />
    );
  }
  const sel = findSelection(state, read(selected));
  const target = addTarget(sel);
  const message = read(flash);
  const disabled = read(busy);
  const empty = state.sources.every((s) => s.roots.length === 0);
  const entries = state.sources.map((src) => {
    const key = sourceKey(src.source);
    const row = entry(
      key,
      {
        title: SOURCE_LABELS[src.source],
        icon: src.source === 'shared' ? 'cloud' : 'database',
        description: src.error ? `⚠ ${src.error}` : src.root,
      },
      () => pressBranch(key),
    );
    return branch(key, row, () => nodeEntries(src, src.roots));
  });
  const workspaceOptions = [
    {
      value: AUTO_WORKSPACE,
      label: `目前的 workspace（${state.workspaces.find((w) => w.id === state.focusedWorkspaceId)?.name ?? '無法辨識'}）`,
    },
    ...state.workspaces.map((w) => ({ value: w.id, label: w.branch ? `${w.name}（${w.branch}）` : w.name })),
  ];

  return (
    <Stack gap="md">
      <Toolbar label="Shell Scripts">
        <IconButton icon="add" label="新增 Script" tooltip="新增 Script" disabled={disabled} onPress={() => openForm({ kind: 'addScript', ...target })} />
        <IconButton icon="folder" label="新增資料夾" tooltip="新增資料夾" disabled={disabled} onPress={() => openForm({ kind: 'addFolder', ...target })} />
        <IconButton icon="refresh" label="刷新並驗證" tooltip="刷新並驗證" disabled={disabled} onPress={refresh} />
      </Toolbar>
      <Select label="執行於" value={read(workspaceChoice)} options={workspaceOptions} onChange={(v) => set(workspaceChoice, v)} />
      {message ? (
        <Callout tone={message.tone}>
          <Row justify="between" align="center">
            <Text size="sm">{message.text}</Text>
            <IconButton icon="close" label="關閉訊息" size="xs" variant="ghost" onPress={() => set(flash, null)} />
          </Row>
        </Callout>
      ) : null}
      {state.notices.map((notice) => (
        <Callout tone="warning">{notice}</Callout>
      ))}
      {state.sources
        .filter((s) => s.conflicts.length > 0)
        .map((s) => (
          <Callout tone="warning" title={`${SOURCE_LABELS[s.source]}清單有同步衝突副本`}>
            <Text size="sm">請手動整併後刪除：{s.conflicts.join('、')}</Text>
          </Callout>
        ))}
      <FormArea state={state} />
      <Box gap="none">{entries}</Box>
      {empty ? (
        <EmptyState icon="terminal" title="尚未登錄任何 script" description="用上方的「新增 Script」登錄 bash script，選取後按「執行」在終端機執行。" />
      ) : null}
      {sel ? <Details state={state} sel={sel} /> : null}
    </Stack>
  );
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
