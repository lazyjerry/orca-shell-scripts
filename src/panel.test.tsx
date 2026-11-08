import { assert, mockHost, mount, test } from 'orca/testing';
import * as panel from './panel.tsx';
import type { ViewState } from './protocol.ts';

const STATE: ViewState = {
  sources: [
    {
      source: 'shared',
      root: '~/Dropbox/scripts',
      isFallback: false,
      roots: [
        {
          kind: 'folder',
          id: 'f1',
          name: '部署',
          children: [{ kind: 'script', id: 's1', label: 'deploy.sh', path: '~/bin/deploy.sh', note: '正式機' }],
        },
        { kind: 'script', id: 's2', label: 'broken', path: '~/bin/broken' },
      ],
      invalid: { s2: '檔案不存在' },
      conflicts: [],
    },
    { source: 'private', root: '~/.orca-shell-scripts/private', isFallback: true, roots: [], invalid: {}, conflicts: [] },
  ],
  notices: [],
};

function host(calls: { name: string; input: unknown }[]) {
  const record = (name: string) => (input: unknown) => {
    calls.push({ name, input });
    return { state: STATE, flash: { tone: 'success' as const, text: `${name} ok` } };
  };
  return mockHost({
    requests: {
      'state.get': () => STATE,
      'script.run': record('script.run'),
      'node.delete': record('node.delete'),
    },
  });
}

test('選取 script 後按執行，送出執行請求', async () => {
  const calls: { name: string; input: unknown }[] = [];
  const view = await mount(panel, { host: host(calls) });
  await view.press({ type: 'ListItem', label: '部署' });
  await view.press({ type: 'ListItem', label: 'deploy.sh' });
  await view.press({ text: '執行' });
  assert.deepEqual(calls, [{ name: 'script.run', input: { source: 'shared', id: 's1' } }]);
  assert.ok(view.find({ text: 'script.run ok' }));
  assert.deepEqual(view.errors, []);
  assert.deepEqual(view.refusals, []);
  await view.unmount();
});

test('按資料夾會選取並展開，再按一次收合，都不會執行', async () => {
  const calls: { name: string; input: unknown }[] = [];
  const view = await mount(panel, { host: host(calls) });
  assert.equal(view.find({ type: 'ListItem', label: 'deploy.sh' }), null);
  await view.press({ type: 'ListItem', label: '部署' });
  assert.ok(view.find({ type: 'ListItem', label: 'deploy.sh' }));
  assert.ok(view.find({ text: '1 個項目' }));
  await view.press({ type: 'ListItem', label: '部署' });
  assert.equal(view.find({ type: 'ListItem', label: 'deploy.sh' }), null);
  assert.deepEqual(calls, []);
  await view.unmount();
});

test('刪除要先確認才送出', async () => {
  const calls: { name: string; input: unknown }[] = [];
  const view = await mount(panel, { host: host(calls) });
  await view.press({ type: 'ListItem', label: 'broken' });
  await view.press({ text: '刪除' });
  assert.equal(calls.length, 0);
  assert.ok(view.summary().some((line) => line.includes('確定刪除 script「broken」？')), view.summary().join('\n'));
  await view.press({ text: '確定刪除' });
  assert.deepEqual(calls, [{ name: 'node.delete', input: { source: 'shared', id: 's2' } }]);
  await view.unmount();
});

test('建立至快速命令中：通過檢查就顯示步驟，複製鈕送出要貼的文字', async () => {
  const calls: { name: string; input: unknown }[] = [];
  const command = `cd '/home/bin' && bash '/home/bin/deploy.sh'`;
  const view = await mount(panel, {
    host: mockHost({
      requests: {
        'state.get': () => STATE,
        'quickCommand.prepare': (input: unknown) => {
          calls.push({ name: 'quickCommand.prepare', input });
          return { state: STATE, guide: { label: 'deploy.sh', command, checked: true } };
        },
        'clipboard.copy': (input: unknown) => {
          calls.push({ name: 'clipboard.copy', input });
          return { flash: { tone: 'success' as const, text: '已複製命令' } };
        },
      },
    }),
  });
  await view.press({ type: 'ListItem', label: '部署' });
  await view.press({ type: 'ListItem', label: 'deploy.sh' });
  await view.press({ text: '建立至快速命令中' });
  assert.ok(view.find({ text: '1. 在 Orca 終端機上按右鍵，選「快速命令」→「新增快速命令…」。' }));
  await view.press({ text: '複製命令' });
  assert.deepEqual(calls, [
    { name: 'quickCommand.prepare', input: { source: 'shared', id: 's1' } },
    { name: 'clipboard.copy', input: { text: command, what: '命令' } },
  ]);
  assert.ok(view.find({ text: '已複製命令' }));
  assert.deepEqual(view.errors, []);
  assert.deepEqual(view.refusals, []);
  await view.unmount();
});

test('建立至快速命令中：已有相同 bash 時只顯示阻擋訊息', async () => {
  const view = await mount(panel, {
    host: mockHost({
      requests: {
        'state.get': () => STATE,
        'quickCommand.prepare': () => ({ state: STATE, flash: { tone: 'danger' as const, text: '快速命令已有「部署」執行同一支 script，不重複建立' } }),
      },
    }),
  });
  await view.press({ type: 'ListItem', label: '部署' });
  await view.press({ type: 'ListItem', label: 'deploy.sh' });
  await view.press({ text: '建立至快速命令中' });
  assert.ok(view.find({ text: '快速命令已有「部署」執行同一支 script，不重複建立' }));
  assert.equal(view.find({ text: '複製命令' }), null);
  await view.unmount();
});

test('表單跟著動作區：換選取別的項目時關閉', async () => {
  const view = await mount(panel, { host: host([]) });
  await view.press({ type: 'ListItem', label: 'broken' });
  await view.press({ text: '刪除' });
  assert.ok(view.find({ text: '確定刪除' }));
  await view.press({ type: 'ListItem', label: '部署' });
  assert.equal(view.find({ text: '確定刪除' }), null);
  await view.unmount();
});
