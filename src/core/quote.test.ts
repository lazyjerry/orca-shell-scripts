import { assert, test } from 'orca/testing';
import { isPosixShell, isShellNeutralPath, launcherScript, posixRunCommand } from './quote.ts';

test('POSIX 指令把路徑中的單引號跳脫掉', () => {
  assert.equal(posixRunCommand("/a/it's.sh", '/a'), `cd '/a' && bash '/a/it'\\''s.sh'`);
});

test('fish、PowerShell 不算 POSIX shell，改走啟動器', () => {
  assert.equal(isPosixShell('/bin/zsh'), true);
  assert.equal(isPosixShell('/opt/homebrew/bin/fish'), false);
  assert.equal(isPosixShell('pwsh.exe'), false);
  assert.equal(isPosixShell(null), false);
});

test('只有不需引號的路徑才能直接送給非 POSIX shell', () => {
  assert.equal(isShellNeutralPath('/var/folders/ab/T/orca-shell-scripts-501/0123abcd.sh'), true);
  assert.equal(isShellNeutralPath('/tmp/a b.sh'), false);
  assert.equal(isShellNeutralPath("/tmp/a'b.sh"), false);
  assert.equal(isShellNeutralPath('/tmp/$(x).sh'), false);
});

test('啟動器切到 script 目錄後以 bash 執行', () => {
  assert.equal(launcherScript("/a/it's.sh", '/a'), `#!/bin/bash\ncd '/a' || exit 1\nexec bash '/a/it'\\''s.sh'\n`);
});
