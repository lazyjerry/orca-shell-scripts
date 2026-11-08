import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { assert, mockHost, mountWorker, test } from 'orca/testing';
import * as main from './worker.ts';
import type { ViewState } from './protocol.ts';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-scripts-test-'));
  const shared = path.join(dir, 'shared');
  const priv = path.join(dir, 'private');
  const script = path.join(dir, "it's here.sh");
  fs.writeFileSync(script, 'echo hi\n');
  return { dir, shared, priv, script };
}

async function mount(settings: Record<string, string>) {
  const host = mockHost({ settings });
  return { host, worker: await mountWorker(main, { host }) };
}

const scriptsOf = (state: ViewState, source: 'shared' | 'private') =>
  state.sources.find((s) => s.source === source)!.roots;

test('新增的 script 以 VS Code 版相同格式寫進共用資料夾', async () => {
  const f = fixture();
  const { worker } = await mount({ dataFolder: f.shared, privateDataFolder: f.priv });
  const result = await worker.request('script.add', { source: 'shared', path: f.script });
  assert.equal(result.flash?.tone, 'success');
  // Orca 拒收含 undefined 欄位的回應，mountWorker 不檢查這點
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  const refresh = await worker.request('folder.add', { source: 'shared', name: 'x' });
  assert.deepEqual(JSON.parse(JSON.stringify(refresh)), refresh);
  const onDisk = JSON.parse(fs.readFileSync(path.join(f.shared, 'scripts.json'), 'utf8'));
  assert.equal(onDisk.version, 1);
  assert.equal(onDisk.roots[0].kind, 'script');
  assert.equal(onDisk.roots[0].label, "it's here.sh");
  assert.ok(fs.existsSync(path.join(f.shared, '.shell-scripts.json')));
  assert.equal(fs.existsSync(path.join(f.priv, 'scripts.json')), false);
  await worker.deactivate();
});

test('驗證失敗的 script 標出原因，執行被擋下且不開終端機', async () => {
  const f = fixture();
  const notBash = path.join(f.dir, 'tool.py');
  fs.writeFileSync(notBash, '#!/usr/bin/env python3\n');
  const { worker } = await mount({ dataFolder: f.shared, privateDataFolder: f.priv });
  const { state } = await worker.request('script.add', { source: 'shared', path: notBash });
  const id = scriptsOf(state, 'shared')[0].id;
  assert.match(state.sources[0].invalid[id], /不是 bash 檔/);
  const run = await worker.request('script.run', { source: 'shared', id });
  assert.equal(run.flash?.tone, 'danger');
  assert.match(run.flash?.text ?? '', /無法執行/);
  await worker.deactivate();
});

test('私有資料夾與共用相同時拒絕寫入私有清單', async () => {
  const f = fixture();
  const { worker } = await mount({ dataFolder: f.shared, privateDataFolder: f.shared });
  const result = await worker.request('folder.add', { source: 'private', name: 'x' });
  assert.equal(result.flash?.tone, 'danger');
  assert.ok(result.state.sources[1].error);
  assert.equal(fs.existsSync(path.join(f.shared, 'scripts.json')), false);
  await worker.deactivate();
});

test('跨清單搬移資料夾：連同內容移到私有清單，共用清單移除', async () => {
  const f = fixture();
  const { worker } = await mount({ dataFolder: f.shared, privateDataFolder: f.priv });
  let { state } = await worker.request('folder.add', { source: 'shared', name: '部署' });
  const folderId = scriptsOf(state, 'shared')[0].id;
  await worker.request('script.add', { source: 'shared', parentId: folderId, path: f.script });
  ({ state } = await worker.request('node.move', { source: 'shared', id: folderId, toSource: 'private', toFolderId: null }));
  assert.equal(scriptsOf(state, 'shared').length, 0);
  const moved = scriptsOf(state, 'private')[0];
  assert.equal(moved.kind === 'folder' && moved.children.length, 1);
  await worker.deactivate();
});

test('外部寫入的 scripts.json 在下次讀取時就生效', async () => {
  const f = fixture();
  const { worker } = await mount({ dataFolder: f.shared, privateDataFolder: f.priv });
  await worker.request('state.get');
  fs.writeFileSync(
    path.join(f.shared, 'scripts.json'),
    JSON.stringify({ version: 1, roots: [{ kind: 'folder', id: 'x', name: '從 Dropbox 來的', children: [] }] }),
  );
  const state = await worker.request('state.get');
  assert.equal(scriptsOf(state, 'shared')[0].kind, 'folder');
  await worker.deactivate();
});

test('建立至快速命令：回傳要貼的標籤與 cd + bash 命令；驗證失敗的 script 擋下', async () => {
  const f = fixture();
  const { worker } = await mount({ dataFolder: f.shared, privateDataFolder: f.priv });
  const { state } = await worker.request('script.add', { source: 'shared', path: f.script });
  const id = scriptsOf(state, 'shared')[0].id;
  const result = await worker.request('quickCommand.prepare', { source: 'shared', id });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  assert.equal(result.guide?.label, "it's here.sh");
  assert.equal(result.guide?.command, `cd '${f.dir}' && bash '${f.dir}/it'\\''s here.sh'`);

  fs.rmSync(f.script);
  const blocked = await worker.request('quickCommand.prepare', { source: 'shared', id });
  assert.equal(blocked.guide, undefined);
  assert.equal(blocked.flash?.tone, 'danger');
  await worker.deactivate();
});
