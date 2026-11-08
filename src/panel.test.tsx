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
  workspaces: [{ id: 'ws-1', name: 'api', branch: 'main' }],
  focusedWorkspaceId: 'ws-1',
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

test('選取 script 後按執行，以自動 workspace 送出執行請求', async () => {
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
