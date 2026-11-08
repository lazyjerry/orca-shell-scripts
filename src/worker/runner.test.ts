import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { assert, test } from 'orca/testing';
import { runScript, writeLauncher } from './runner.ts';

const script = (scriptPath: string) => ({ kind: 'script' as const, id: 's1', label: 'x.sh', path: scriptPath });

test('執行時把可執行的 .command 啟動器交給預設程式開啟', async () => {
  const opened: string[] = [];
  const outcome = await runScript(script("/tmp/it's here.sh"), async (file) => void opened.push(file), 'darwin');
  assert.deepEqual(outcome, { ok: true });
  assert.equal(opened.length, 1);
  assert.ok(opened[0].endsWith('.command'), opened[0]);
  assert.equal(fs.statSync(opened[0]).mode & 0o777, 0o700);
  assert.match(fs.readFileSync(opened[0], 'utf8'), /exec bash '\/tmp\/it'\\''s here\.sh'/);
});

test('重寫既有啟動器時仍保持可執行', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-scripts-runner-'));
  const first = writeLauncher(script('/a/one.sh'), '/a/one.sh', base);
  fs.chmodSync(first, 0o600);
  const again = writeLauncher(script('/a/two.sh'), '/a/two.sh', base);
  assert.equal(again, first);
  assert.equal(fs.statSync(again).mode & 0o777, 0o700);
  assert.match(fs.readFileSync(again, 'utf8'), /two\.sh/);
});

test('開啟失敗、非 macOS、路徑含控制字元都回報原因', async () => {
  const failing = await runScript(script('/tmp/a.sh'), async () => {
    throw new Error('boom');
  }, 'darwin');
  assert.equal(failing.ok, false);
  assert.equal((await runScript(script('/tmp/a.sh'), async () => {}, 'linux')).ok, false);
  assert.equal((await runScript(script('/tmp/a\nb.sh'), async () => {}, 'darwin')).ok, false);
});
