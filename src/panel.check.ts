// `orca plugin check` 以真的 worker 渲染面板。資料夾指向暫存目錄，不在家目錄留下預設資料夾。
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { defineCheck } from 'orca/testing';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-scripts-check-'));
const filled = path.join(base, 'filled');
const script = path.join(base, 'deploy.sh');
fs.mkdirSync(filled, { recursive: true });
fs.writeFileSync(script, '#!/bin/bash\necho deploy\n');
fs.writeFileSync(
  path.join(filled, 'scripts.json'),
  JSON.stringify({
    version: 1,
    roots: [
      {
        kind: 'folder',
        id: 'f1',
        name: '部署',
        children: [{ kind: 'script', id: 's1', label: 'deploy.sh', path: script, note: '正式機' }],
      },
      { kind: 'script', id: 's2', label: 'gone.sh', path: path.join(base, 'gone.sh') },
    ],
  }),
);

export default defineCheck({
  empty: { settings: { dataFolder: path.join(base, 'empty'), privateDataFolder: path.join(base, 'empty-private') } },
  filled: { settings: { dataFolder: filled, privateDataFolder: path.join(base, 'filled-private') } },
  sameFolder: { settings: { dataFolder: filled, privateDataFolder: filled } },
});
