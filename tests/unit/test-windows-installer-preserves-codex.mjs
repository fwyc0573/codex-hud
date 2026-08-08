import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(testDir, '../..');
const installer = fs.readFileSync(path.join(rootDir, 'bin/codex-hud-install.ps1'), 'utf8');
const readme = fs.readFileSync(path.join(rootDir, 'README.md'), 'utf8');

assert.doesNotMatch(
  installer,
  /(?:NpmArguments\s+@\(|npm\s+)['"]?uninstall['"]?[^\r\n]*@openai\/codex/i,
  'Windows and WSL installation must never uninstall an existing Codex CLI'
);

const windowsSetup = installer.match(
  /function Ensure-WindowsCodex\s*\{(?<body>[\s\S]*?)\r?\n\}\r?\n\r?\nfunction Ensure-WindowsTmux/
);
assert.ok(windowsSetup?.groups?.body, 'installer should define Ensure-WindowsCodex');
assert.match(
  windowsSetup.groups.body,
  /Get-RealCodexCommand\s+-RepoRoot\s+\$repoRoot/,
  'Windows setup should resolve an existing Codex CLI before invoking npm'
);
assert.match(
  windowsSetup.groups.body,
  /if\s*\(\$existingCodex\)\s*\{[\s\S]*?--version[\s\S]*?return[\s\S]*?\}/,
  'Windows setup should validate and preserve an existing Codex CLI'
);
assert.ok(
  windowsSetup.groups.body.indexOf('Get-RealCodexCommand')
    < windowsSetup.groups.body.indexOf("@('install', '-g', '@openai/codex@latest')"),
  'Windows setup should check for Codex before attempting installation'
);

const wslScript = installer.match(/\$script\s*=\s*@'\r?\n(?<body>[\s\S]*?)\r?\n'@/)?.groups?.body;
assert.ok(wslScript, 'installer should contain the WSL provisioning script');
assert.match(
  wslScript,
  /if codex_path="\$\(resolve_native_wsl_command codex\)"; then[\s\S]*?"\$codex_path" --version[\s\S]*?else[\s\S]*?"\$npm_path" install -g --prefix "\$install_prefix" @openai\/codex@latest[\s\S]*?resolve_native_wsl_command codex[\s\S]*?"\$codex_path" --version[\s\S]*?fi/,
  'WSL setup should preserve a working Codex CLI and install it only when missing'
);

const warning = '> **Warning:** Windows installation has not been validated on a native Windows host; back up your existing Codex installation before running it.';
assert.equal(
  readme.split(warning).length - 1,
  1,
  'README should contain exactly one concise native-Windows validation warning'
);

console.log('test-windows-installer-preserves-codex: PASS');
