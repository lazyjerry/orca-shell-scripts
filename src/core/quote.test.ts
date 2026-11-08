import { assert, test } from 'orca/testing';
import { launcherScript } from './quote.ts';

test('啟動器切到 script 目錄後以 bash 執行', () => {
  assert.equal(launcherScript("/a/it's.sh", '/a'), `#!/bin/bash\ncd '/a' || exit 1\nexec bash '/a/it'\\''s.sh'\n`);
});
