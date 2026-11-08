import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { assert, test } from 'orca/testing';
import { findDuplicate, locateProfileDb, parseQuickCommands, quickCommandText, readQuickCommands } from './quickCommands.ts';

test('命令先切到 script 目錄再以 bash 執行，路徑一律單引號跳脫', () => {
  assert.equal(quickCommandText("/tmp/it's here.sh"), `cd '/tmp' && bash '/tmp/it'\\''s here.sh'`);
});

test('只取終端機類型的快速命令，格式不對回 null', () => {
  const payload = JSON.stringify({
    terminalQuickCommands: [
      { id: 'a', label: 'dev', action: 'terminal-command', command: 'npm run dev', appendEnter: true, scope: { type: 'global' } },
      { id: 'b', label: 'ask', action: 'agent-prompt', agent: 'claude', prompt: 'bash /a.sh', scope: { type: 'global' } },
    ],
  });
  assert.deepEqual(parseQuickCommands(payload), [{ label: 'dev', command: 'npm run dev' }]);
  assert.equal(parseQuickCommands('{}'), null);
  assert.equal(parseQuickCommands('not json'), null);
});

test('同一支 script 判定為重複：完全相同、手寫的絕對路徑或 ~ 路徑', () => {
  const abs = path.join(os.homedir(), 'bin', 'deploy.sh');
  const same = { label: '部署', command: quickCommandText(abs) };
  assert.equal(findDuplicate([same], abs), same);
  assert.ok(findDuplicate([{ label: 'x', command: `bash ${abs}` }], abs));
  assert.ok(findDuplicate([{ label: 'x', command: 'cd ~/bin; bash ~/bin/deploy.sh' }], abs));
});

test('路徑只是其他路徑的一部分時不算重複', () => {
  const abs = '/a/run.sh';
  assert.equal(findDuplicate([{ label: 'x', command: 'bash /x/a/run.sh' }], abs), null);
  assert.equal(findDuplicate([{ label: 'x', command: 'bash /a/run.sh.bak' }], abs), null);
  assert.equal(findDuplicate([], abs), null);
});

test('從 profile 索引找到資料庫並唯讀取出快速命令；找不到就回 null', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-scripts-qc-'));
  assert.equal(await locateProfileDb(home), null);
  const userData = path.join(home, 'Library', 'Application Support', 'orca');
  fs.mkdirSync(path.join(userData, 'profiles', 'p1'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'orca-profile-index.json'), JSON.stringify({ activeProfileId: 'p1' }));
  const dbPath = await locateProfileDb(home);
  assert.equal(dbPath, path.join(userData, 'profiles', 'p1', 'profile-state.db'));

  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath!);
  db.exec('CREATE TABLE profile_state_documents (domain TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL)');
  db.prepare('INSERT INTO profile_state_documents VALUES (?, ?)').run(
    'settings',
    JSON.stringify({ terminalQuickCommands: [{ label: 'dev', action: 'terminal-command', command: 'npm run dev' }] }),
  );
  db.close();
  assert.deepEqual(await readQuickCommands(dbPath), [{ label: 'dev', command: 'npm run dev' }]);
  assert.equal(await readQuickCommands(path.join(home, 'missing.db')), null);

  fs.writeFileSync(path.join(userData, 'orca-profile-index.json'), JSON.stringify({ activeProfileId: '../evil' }));
  assert.equal(await locateProfileDb(home), null);
});
