import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(testDir, '../..');
const installer = fs.readFileSync(path.join(rootDir, 'bin/codex-hud-install.ps1'), 'utf8');
const wslScript = installer.match(/\$script\s*=\s*@'\r?\n(?<body>[\s\S]*?)\r?\n'@/)?.groups?.body;
assert.ok(wslScript, 'installer should contain the WSL provisioning script');

const pathResolver = wslScript.match(
  /resolve_native_wsl_path\(\)\s*\{(?<body>[\s\S]*?)\n\}/
);
assert.ok(pathResolver?.groups?.body, 'WSL setup should define native path ownership resolution');
const resolver = wslScript.match(
  /resolve_native_wsl_command\(\)\s*\{(?<body>[\s\S]*?)\n\}/
);
assert.ok(resolver?.groups?.body, 'WSL setup should define shared native command resolution');

const resolverFunction = `resolve_native_wsl_path() {${pathResolver.groups.body}\n}
resolve_native_wsl_command() {${resolver.groups.body}\n}`;

function bashLiteral(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function runResolver(commandName, candidates) {
  const typeOutput = candidates
    .map(({ commandPath }) => `    printf '%s\\n' ${bashLiteral(commandPath)}`)
    .join('\n');
  const readlinkCases = candidates
    .map(({ commandPath, realPath }) => {
      const action = realPath === null
        ? 'return 1'
        : `printf '%s\\n' ${bashLiteral(realPath)}`;
      return `        ${bashLiteral(commandPath)}) ${action} ;;`;
    })
    .join('\n');
  const wslpathCases = candidates
    .filter(({ realPath }) => realPath !== null)
    .map(({ realPath, windowsPath }) => {
      const action = windowsPath === null
        ? 'return 1'
        : `printf '%s\\n' ${bashLiteral(windowsPath)}`;
      return `        ${bashLiteral(realPath)}) ${action} ;;`;
    })
    .join('\n');

  const harness = `${resolverFunction}
type() {
${typeOutput}
}
function /usr/bin/readlink {
    local target="\${!#}"
    case "$target" in
${readlinkCases}
        *) return 1 ;;
    esac
}
function /usr/bin/wslpath {
    local target="\${!#}"
    case "$target" in
${wslpathCases}
        *) return 1 ;;
    esac
}
resolve_native_wsl_command "$MOCK_COMMAND_NAME"
`;

  return spawnSync('bash', ['-c', harness], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MOCK_COMMAND_NAME: commandName,
    },
  });
}

const windowsFirstNativeLater = runResolver('node', [
  {
    commandPath: '/custom/windows/node',
    realPath: '/custom/windows/node.exe',
    windowsPath: 'C:\\Program Files\\nodejs\\node.exe',
  },
  {
    commandPath: '/usr/bin/node',
    realPath: '/usr/bin/node',
    windowsPath: '\\\\wsl.localhost\\Ubuntu\\usr\\bin\\node',
  },
]);
assert.equal(windowsFirstNativeLater.status, 0, 'resolver should continue past a Windows candidate');
assert.equal(windowsFirstNativeLater.stdout.trim(), '/usr/bin/node');

const nativeMountedLinux = runResolver('npm', [
  {
    commandPath: '/mnt/linux-tools/npm',
    realPath: '/mnt/linux-tools/npm',
    windowsPath: '\\\\wsl.localhost\\Ubuntu\\mnt\\linux-tools\\npm',
  },
]);
assert.equal(nativeMountedLinux.status, 0, 'resolver should accept a mounted path owned by WSL');
assert.equal(nativeMountedLinux.stdout.trim(), '/mnt/linux-tools/npm');

const windowsOnly = runResolver('codex', [
  {
    commandPath: '/custom/windows/codex',
    realPath: '/custom/windows/codex',
    windowsPath: 'C:\\Users\\test\\AppData\\Roaming\\npm\\codex',
  },
]);
assert.notEqual(windowsOnly.status, 0, 'resolver must reject Windows-only command candidates');
assert.equal(windowsOnly.stdout, '');

const brokenFirstNativeLater = runResolver('npm', [
  {
    commandPath: '/broken/npm',
    realPath: null,
    windowsPath: null,
  },
  {
    commandPath: '/usr/bin/npm',
    realPath: '/usr/share/nodejs/npm/bin/npm-cli.js',
    windowsPath: '\\\\wsl$\\Ubuntu\\usr\\share\\nodejs\\npm\\bin\\npm-cli.js',
  },
]);
assert.equal(brokenFirstNativeLater.status, 0, 'resolver should skip an unresolved candidate');
assert.equal(
  brokenFirstNativeLater.stdout.trim(),
  '/usr/share/nodejs/npm/bin/npm-cli.js',
  'resolver should return the canonical path that passed provenance validation'
);

const nativeSymlink = runResolver('codex', [
  {
    commandPath: '/usr/local/bin/codex',
    realPath: '/opt/codex/bin/codex.js',
    windowsPath: '\\\\wsl.localhost\\Ubuntu\\opt\\codex\\bin\\codex.js',
  },
]);
assert.equal(nativeSymlink.status, 0, 'resolver should accept a native symlink target');
assert.equal(nativeSymlink.stdout.trim(), '/opt/codex/bin/codex.js');

const missingCommand = runResolver('codex', []);
assert.notEqual(missingCommand.status, 0, 'resolver should report a missing native command');
assert.equal(missingCommand.stdout, '');

const runRoot = wslScript.match(/(?<function>run_root\(\)\s*\{[\s\S]*?\n\})\n\nrun_root_env/)?.groups?.function;
assert.ok(runRoot, 'WSL setup should define privileged command execution');
const codexFlow = wslScript.match(
  /(?<flow>if codex_path="\$\(resolve_native_wsl_command codex\)"; then[\s\S]*?\nfi)\n\nALIAS_MARKER/
)?.groups?.flow;
assert.ok(codexFlow, 'WSL setup should contain the native Codex preservation/install flow');

function runCodexFlow({ existingCodex, codexExit, useSudo }) {
  const harness = `set -euo pipefail
${runRoot}
SUDO_CMD=${useSudo ? 'sudo' : "''"}
CODEX_INSTALLED=${existingCodex ? '1' : '0'}
NPM_CALLS=0
function /native/npm-wrapper {
    printf 'npm-target:/native/npm-wrapper\\n'
    printf 'npm-args:%s\\n' "$*"
    NPM_CALLS=$((NPM_CALLS + 1))
    CODEX_INSTALLED=1
}
function /native/codex {
    printf 'codex-version-check\\n'
    return "$MOCK_CODEX_EXIT"
}
sudo() {
    printf 'sudo-target:%s\\n' "$1"
    "$@"
}
function /usr/bin/env {
    if [[ "$1" == PATH=* ]]; then
        shift
    fi
    "$@"
}
resolve_native_wsl_command() {
    case "$1" in
        node) printf '/native/node\\n' ;;
        npm) printf '/native/npm-wrapper\\n' ;;
        codex)
            if [ "$CODEX_INSTALLED" -eq 1 ]; then
                printf '/native/codex\\n'
            else
                return 1
            fi
            ;;
        *) return 1 ;;
    esac
}
npm_path="$(resolve_native_wsl_command npm)"
node_path="$(resolve_native_wsl_command node)"
native_node_dir="\${node_path%/*}"
install_prefix="/usr/local"
${codexFlow}
printf 'npm-calls:%s\\n' "$NPM_CALLS"
`;

  return spawnSync('bash', ['-c', harness], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MOCK_CODEX_EXIT: String(codexExit),
    },
  });
}

const existingNativeCodex = runCodexFlow({ existingCodex: true, codexExit: 0, useSudo: false });
assert.equal(existingNativeCodex.status, 0, 'working native Codex should be preserved');
assert.match(existingNativeCodex.stdout, /npm-calls:0/, 'working native Codex must not trigger npm');
assert.doesNotMatch(existingNativeCodex.stdout, /npm-target:/, 'working native Codex must not invoke npm');

const invalidNativeCodex = runCodexFlow({ existingCodex: true, codexExit: 9, useSudo: false });
assert.equal(invalidNativeCodex.status, 73, 'invalid existing native Codex should fail fast');
assert.doesNotMatch(invalidNativeCodex.stdout, /npm-target:/, 'invalid existing Codex must remain unchanged');

const rootInstall = runCodexFlow({ existingCodex: false, codexExit: 0, useSudo: false });
assert.equal(rootInstall.status, 0, 'root installation should complete through native npm');
assert.match(rootInstall.stdout, /npm-target:\/native\/npm-wrapper/, 'root installation should invoke the validated npm wrapper');
assert.match(rootInstall.stdout, /npm-args:install -g --prefix \/usr\/local @openai\/codex@latest/, 'root installation should pin the WSL-owned global prefix');
assert.match(rootInstall.stdout, /npm-calls:1/, 'root installation should invoke npm exactly once');

const sudoInstall = runCodexFlow({ existingCodex: false, codexExit: 0, useSudo: true });
assert.equal(sudoInstall.status, 0, 'sudo installation should complete through native npm');
assert.match(sudoInstall.stdout, /sudo-target:\/usr\/bin\/env/, 'sudo should receive the absolute native env path');
assert.match(sudoInstall.stdout, /npm-target:\/native\/npm-wrapper/, 'sudo should invoke the validated npm wrapper');
assert.match(sudoInstall.stdout, /npm-args:install -g --prefix \/usr\/local @openai\/codex@latest/, 'sudo installation should pin the WSL-owned global prefix');
assert.match(sudoInstall.stdout, /npm-calls:1/, 'sudo installation should invoke npm exactly once');

assert.match(
  wslScript,
  /node_path="\$\(resolve_native_wsl_command node\)"/,
  'Node version validation should use a resolved native executable'
);
assert.match(
  wslScript,
  /npm_path="\$\(resolve_native_wsl_command npm\)"/,
  'npm validation should use a resolved native executable'
);
assert.match(
  wslScript,
  /run_root \/usr\/bin\/env "PATH=\$native_node_dir:\$PATH" "\$npm_path" install -g --prefix "\$install_prefix" @openai\/codex@latest/,
  'privileged Codex installation should invoke a validated npm wrapper with native Node PATH and WSL-owned prefix'
);
assert.match(
  wslScript,
  /codex_path="\$\(resolve_native_wsl_command codex\)"/,
  'Codex validation should use shared native command resolution'
);
assert.doesNotMatch(wslScript, /\brun_root npm install\b/, 'WSL setup must not invoke npm by bare name');
assert.doesNotMatch(wslScript, /\bcommand -v npm\b/, 'WSL setup must not accept Windows npm by name');
assert.doesNotMatch(wslScript, /\|\s*sed -E\b/, 'Node version parsing should not invoke an unqualified sed command');
assert.match(wslScript, /\/usr\/bin\/readlink -f --/, 'path ownership should use the absolute native readlink path');
assert.match(wslScript, /\/usr\/bin\/wslpath -w/, 'path ownership should use the absolute native wslpath path');
assert.match(
  wslScript,
  /install_prefix="\$\(resolve_native_wsl_path \/usr\/local\)"/,
  'global Codex installation should validate its WSL-owned prefix'
);
assert.match(
  wslScript,
  /SUDO_CMD="\/usr\/bin\/sudo"[\s\S]*?"\$SUDO_CMD" "\$@"/,
  'privileged WSL commands should invoke native sudo through its absolute path'
);

console.log('test-wsl-codex-origin: PASS');
