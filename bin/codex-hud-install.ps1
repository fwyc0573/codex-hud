[CmdletBinding()]
param(
    [ValidateSet('install', 'sync', 'upgrade')]
    [string]$Mode = 'install'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. "$PSScriptRoot/windows/common.ps1"

$repoRoot = Get-CodexHudRepoRoot -ScriptDirectory $PSScriptRoot
$distro = if ($env:CODEX_HUD_WSL_DISTRO) { $env:CODEX_HUD_WSL_DISTRO } else { 'Ubuntu' }
$global:WslReady = $false

function Get-NodeExecutableOrInstall {
    $node = Get-NodeExecutable
    if ($node) {
        return $node
    }

    Write-Info 'Node.js not found. Installing Node.js LTS via winget (user scope)...'
    winget install --id OpenJS.NodeJS.LTS -e --scope user --silent --accept-package-agreements --accept-source-agreements | Out-Host

    $node = Get-NodeExecutable
    if (-not $node) {
        throw 'Node.js installation did not expose node.exe in this session.'
    }

    return $node
}

function Invoke-RepoNpm {
    param(
        [Parameter(Mandatory = $true)][string]$NodeExecutable,
        [Parameter(Mandatory = $true)][string[]]$NpmArgs
    )

    $exitCode = Invoke-NpmCli -NodeExecutable $NodeExecutable -NpmArguments $NpmArgs -WorkingDirectory $repoRoot
    if ($exitCode -ne 0) {
        throw "npm command failed (exit=$exitCode): npm $($NpmArgs -join ' ')"
    }
}

function Ensure-RepoBuild {
    param([Parameter(Mandatory = $true)][string]$NodeExecutable)

    if ($env:CODEX_HUD_SKIP_BUILD -eq '1') {
        Write-Warn 'Skipping npm install/build due to CODEX_HUD_SKIP_BUILD=1.'
        return
    }

    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'node_modules'))) {
        Write-Info 'Installing project dependencies...'
        Invoke-RepoNpm -NodeExecutable $NodeExecutable -NpmArgs @('install')
    }

    Write-Info 'Building TypeScript project...'
    Invoke-RepoNpm -NodeExecutable $NodeExecutable -NpmArgs @('run', 'build')
}

function Ensure-WindowsCodex {
    param([Parameter(Mandatory = $true)][string]$NodeExecutable)

    if ($env:CODEX_HUD_SKIP_CLI_REINSTALL -eq '1') {
        Write-Warn 'Skipping Windows codex-cli setup due to CODEX_HUD_SKIP_CLI_REINSTALL=1.'
        return
    }
    if ($env:CODEX_HUD_SKIP_WINDOWS_CLI_REINSTALL -eq '1') {
        Write-Warn 'Skipping Windows codex-cli setup due to CODEX_HUD_SKIP_WINDOWS_CLI_REINSTALL=1.'
        return
    }

    $managedShim = Join-Path (Get-CmdShimDirectory) 'codex.cmd'
    $existingCodex = Get-RealCodexCommand -RepoRoot $repoRoot -ExcludedPaths @($managedShim)
    if ($existingCodex) {
        & $existingCodex.Source --version | Out-Host
        if ($LASTEXITCODE -ne 0) {
            throw 'Existing Codex CLI failed validation and was left unchanged.'
        }

        Write-Info "Using existing Codex CLI on Windows: $($existingCodex.Source)"
        return
    }

    Write-Info 'Codex CLI not found on Windows. Installing with npm (global)...'
    $installExit = Invoke-NpmCli -NodeExecutable $NodeExecutable -NpmArguments @('install', '-g', '@openai/codex@latest')
    if ($installExit -ne 0) {
        throw 'Failed to install @openai/codex globally on Windows.'
    }

    $installedCodex = Get-RealCodexCommand -RepoRoot $repoRoot -ExcludedPaths @($managedShim)
    if (-not $installedCodex) {
        throw 'Codex CLI installation completed but no executable could be resolved.'
    }

    & $installedCodex.Source --version | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw 'Installed Codex CLI failed validation.'
    }
}

function Ensure-WindowsTmux {
    if ($env:CODEX_HUD_SKIP_NATIVE_TMUX_SETUP -eq '1') {
        Write-Warn 'Skipping Windows tmux setup due to CODEX_HUD_SKIP_NATIVE_TMUX_SETUP=1.'
        return $null
    }
    if ($env:CODEX_HUD_ENABLE_UNSUPPORTED_NATIVE_TMUX_SETUP -ne '1') {
        Write-Warn 'Skipping Windows tmux setup because native PowerShell HUD is not supported; WSL HUD is the Windows default.'
        return $null
    }

    $tmux = Get-WindowsTmuxCommand
    if (-not $tmux) {
        Write-Info 'tmux not found on Windows. Installing tmux-windows via winget (user scope)...'
        winget install --id arndawg.tmux-windows -e --scope user --silent --accept-package-agreements --accept-source-agreements | Out-Host
        $installExit = $LASTEXITCODE

        $tmux = Get-WindowsTmuxCommand
        if (-not $tmux) {
            throw "Failed to install tmux on Windows (exit=$installExit)."
        }
    }

    $tmuxDir = Split-Path -Parent $tmux.Source
    Ensure-UserPathStartsWith -PathEntry $tmuxDir

    $pathParts = @($env:Path -split ';' | Where-Object { $_ })
    $hasTmuxDir = $false
    foreach ($item in $pathParts) {
        if ($item.TrimEnd('\').Equals($tmuxDir.TrimEnd('\'), [System.StringComparison]::OrdinalIgnoreCase)) {
            $hasTmuxDir = $true
            break
        }
    }

    if (-not $hasTmuxDir) {
        $env:Path = "$tmuxDir;$env:Path"
    }

    Write-Info "Windows tmux ready: $($tmux.Source)"
    return $tmux.Source
}

function Ensure-UbuntuDistro {
    if ($env:CODEX_HUD_SKIP_WSL_SETUP -eq '1') {
        Write-Warn 'Skipping WSL setup due to CODEX_HUD_SKIP_WSL_SETUP=1.'
        $global:WslReady = $false
        return
    }

    $wsl = Get-WslCommand
    if (-not $wsl) {
        Write-Warn 'wsl.exe not found. Install WSL manually: wsl --install -d Ubuntu'
        $global:WslReady = $false
        return
    }

    if (Test-WslDistroAvailable -WslCommand $wsl -Distro $distro) {
        $global:WslReady = $true
        return
    }

    Write-Info "Installing WSL distro '$distro'..."
    & $wsl --install -d $distro
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "wsl --install returned exit code $LASTEXITCODE. You may need admin permissions and a reboot."
        $global:WslReady = $false
        return
    }

    if (Test-WslDistroAvailable -WslCommand $wsl -Distro $distro) {
        $global:WslReady = $true
        return
    }

    Write-Warn "WSL distro '$distro' still unavailable. Finish setup after reboot."
    $global:WslReady = $false
}

function Ensure-WslCodex {
    if ($env:CODEX_HUD_SKIP_CLI_REINSTALL -eq '1') {
        Write-Warn 'Skipping WSL codex-cli setup due to CODEX_HUD_SKIP_CLI_REINSTALL=1.'
        return
    }
    if ($env:CODEX_HUD_SKIP_WSL_CLI_REINSTALL -eq '1') {
        Write-Warn 'Skipping WSL codex-cli setup due to CODEX_HUD_SKIP_WSL_CLI_REINSTALL=1.'
        return
    }

    if (-not $global:WslReady) {
        Write-Warn 'WSL distro not ready; skipping WSL codex-cli setup for now.'
        return
    }

    $wsl = Get-WslCommand
    if (-not $wsl) {
        Write-Warn 'wsl.exe missing unexpectedly; skipping WSL codex-cli setup.'
        return
    }

    Write-Info 'Installing nodejs/npm/tmux in WSL and ensuring codex-cli is available...'
    $script = @'
set -euo pipefail

repo_root="${1:?Repository root WSL path is required}"
manual_cmd='/usr/bin/sudo /usr/bin/apt-get update && /usr/bin/sudo /usr/bin/apt-get install -y ca-certificates curl tmux && /usr/bin/curl -fsSL https://deb.nodesource.com/setup_lts.x | /usr/bin/sudo -E /bin/bash - && /usr/bin/sudo /usr/bin/apt-get install -y nodejs && /usr/bin/sudo /usr/bin/env PATH=/usr/local/bin:/usr/bin:/bin /usr/bin/npm install -g --prefix /usr/local @openai/codex@latest'

if [ "$(/usr/bin/id -u)" -eq 0 ]; then
    SUDO_CMD=""
elif [ -x /usr/bin/sudo ] && /usr/bin/sudo -n true 2>/dev/null; then
    SUDO_CMD="/usr/bin/sudo"
else
    echo "codex-hud WSL provisioning requires root or passwordless sudo." >&2
    echo "Run inside WSL: $manual_cmd" >&2
    exit 70
fi

run_root() {
    if [ -n "$SUDO_CMD" ]; then
        "$SUDO_CMD" "$@"
    else
        "$@"
    fi
}

run_root_env() {
    if [ -n "$SUDO_CMD" ]; then
        "$SUDO_CMD" -E "$@"
    else
        "$@"
    fi
}

resolve_native_wsl_path() {
    local input_path="${1:?WSL path is required}"
    local resolved_path
    local windows_path

    if ! resolved_path="$(/usr/bin/readlink -f -- "$input_path" 2>/dev/null)"; then
        return 1
    fi
    if [ -z "$resolved_path" ]; then
        return 1
    fi

    if ! windows_path="$(/usr/bin/wslpath -w "$resolved_path" 2>/dev/null)"; then
        return 1
    fi

    if [[ "${windows_path,,}" =~ ^\\\\wsl(\.localhost|\$)\\ ]]; then
        printf '%s\n' "$resolved_path"
        return 0
    fi

    return 1
}

resolve_native_wsl_command() {
    local command_name="${1:?Native WSL command name is required}"
    local command_path
    local resolved_path

    while IFS= read -r command_path; do
        if [ -z "$command_path" ]; then
            continue
        fi

        if resolved_path="$(resolve_native_wsl_path "$command_path")"; then
            printf '%s\n' "$resolved_path"
            return 0
        fi
    done < <(type -a -P "$command_name" 2>/dev/null || true)

    return 1
}

get_node_major() {
    local node_path
    local node_version
    if ! node_path="$(resolve_native_wsl_command node)"; then
        return 0
    fi

    if ! node_version="$("$node_path" --version 2>/dev/null)"; then
        return 0
    fi
    if [[ "$node_version" =~ ^v([0-9]+) ]]; then
        printf '%s\n' "${BASH_REMATCH[1]}"
    fi
}

run_root /usr/bin/apt-get update
run_root /usr/bin/env DEBIAN_FRONTEND=noninteractive /usr/bin/apt-get install -y ca-certificates curl tmux

node_major="$(get_node_major)"
if [ -z "$node_major" ] || [ "$node_major" -lt 18 ]; then
    /usr/bin/curl -fsSL https://deb.nodesource.com/setup_lts.x | run_root_env /bin/bash -
    run_root /usr/bin/env DEBIAN_FRONTEND=noninteractive /usr/bin/apt-get install -y nodejs
fi

node_major="$(get_node_major)"
if [ -z "$node_major" ] || [ "$node_major" -lt 18 ]; then
    echo "Node.js >=18 is required in WSL after provisioning." >&2
    exit 71
fi

if ! node_path="$(resolve_native_wsl_command node)"; then
    echo "Native Node.js executable could not be resolved in WSL." >&2
    exit 71
fi

if ! npm_path="$(resolve_native_wsl_command npm)"; then
    echo "npm is required in WSL after provisioning." >&2
    exit 72
fi

if ! install_prefix="$(resolve_native_wsl_path /usr/local)"; then
    echo "The WSL global npm prefix is not owned by the WSL filesystem: /usr/local" >&2
    exit 75
fi

native_node_dir="${node_path%/*}"
if codex_path="$(resolve_native_wsl_command codex)"; then
    if ! PATH="$native_node_dir:$PATH" "$codex_path" --version; then
        echo "Existing Codex CLI failed validation and was left unchanged." >&2
        exit 73
    fi
else
    run_root /usr/bin/env "PATH=$native_node_dir:$PATH" "$npm_path" install -g --prefix "$install_prefix" @openai/codex@latest
    if ! codex_path="$(resolve_native_wsl_command codex)"; then
        echo "Codex CLI installation completed but no native WSL executable could be resolved." >&2
        exit 74
    fi
    PATH="$native_node_dir:$PATH" "$codex_path" --version
fi

ALIAS_MARKER="# codex-hud alias"
SOURCE_MARKER="# codex-hud: load bashrc"
rc_file="$HOME/.bashrc"
bash_profile="$HOME/.bash_profile"

touch "$rc_file"
if grep -qF "$ALIAS_MARKER" "$rc_file" 2>/dev/null; then
    sed -i '\|# codex-hud alias|d' "$rc_file"
fi

append_alias() {
    local name="$1"
    local target="$2"
    printf "alias %s=%q  %s\n" "$name" "$target" "$ALIAS_MARKER" >> "$rc_file"
}

printf "\n" >> "$rc_file"
append_alias codex "$repo_root/bin/codex-hud"
append_alias codex-resume "$repo_root/bin/codex-hud resume"
append_alias codex-hud-install "$repo_root/bin/codex-hud-install"
append_alias codex-hud-sync "$repo_root/bin/codex-hud-sync"
append_alias codex-hud-upgrade "$repo_root/bin/codex-hud-upgrade"
append_alias codex-hud-uninstall "$repo_root/bin/codex-hud-uninstall"

touch "$bash_profile"
if ! grep -qF "$SOURCE_MARKER" "$bash_profile" 2>/dev/null; then
    {
        printf "\n%s\n" "$SOURCE_MARKER"
        printf "if [ -f \"%s\" ]; then\n" "$rc_file"
        printf "  . \"%s\"\n" "$rc_file"
        printf "fi\n"
    } >> "$bash_profile"
fi
'@

    $tempScript = Join-Path ([System.IO.Path]::GetTempPath()) ("codex-hud-wsl-provision-{0}.sh" -f ([guid]::NewGuid().ToString('N')))
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $scriptLf = (($script -replace "`r`n", "`n") -replace "`r", "`n")
    [System.IO.File]::WriteAllText($tempScript, $scriptLf, $utf8NoBom)

    try {
        $tempScriptWsl = Convert-WindowsPathToWsl -WslCommand $wsl -Distro $distro -WindowsPath $tempScript
        $repoRootWsl = Convert-WindowsPathToWsl -WslCommand $wsl -Distro $distro -WindowsPath $repoRoot
        & $wsl -d $distro -- bash $tempScriptWsl $repoRootWsl
        $provisionExitCode = $LASTEXITCODE
    } finally {
        if (Test-Path -LiteralPath $tempScript) {
            Remove-Item -LiteralPath $tempScript -Force
        }
    }

    if ($provisionExitCode -ne 0) {
        throw 'Failed to provision WSL codex-cli automatically. See the WSL output above for root cause and manual commands.'
    }
}

function Ensure-PathPriority {
    param([Parameter(Mandatory = $true)][string]$NodeExecutable)

    $npmPrefix = Get-NpmGlobalPrefix -NodeExecutable $NodeExecutable
    Ensure-UserPathStartsWith -PathEntry $npmPrefix

    if (-not $env:Path.Split(';').Where({ $_.TrimEnd('\\').Equals($npmPrefix.TrimEnd('\\'), [System.StringComparison]::OrdinalIgnoreCase) }, 'First').Count) {
        $env:Path = "$npmPrefix;$env:Path"
    }

    return $npmPrefix
}

function Build-ProfileBlock {
    param(
        [Parameter(Mandatory = $true)][string]$NpmPrefix,
        [Parameter(Mandatory = $true)][string]$RealCodexPath,
        [string]$WindowsTmuxPath
    )

    $escape = {
        param([string]$value)
        return $value.Replace("'", "''")
    }

    $paths = @{
        CodexHud = (Join-Path $PSScriptRoot 'codex-hud.ps1')
        CodexHudWsl = (Join-Path $PSScriptRoot 'codex-hud-wsl.ps1')
        Install = (Join-Path $PSScriptRoot 'codex-hud-install.ps1')
        Sync = (Join-Path $PSScriptRoot 'codex-hud-sync.ps1')
        Upgrade = (Join-Path $PSScriptRoot 'codex-hud-upgrade.ps1')
        Uninstall = (Join-Path $PSScriptRoot 'codex-hud-uninstall.ps1')
    }

    foreach ($key in @($paths.Keys)) {
        $paths[$key] = Resolve-NormalizedPath -Path $paths[$key]
    }

    $npmPrefixEscaped = & $escape $NpmPrefix
    $realCodexEscaped = & $escape $RealCodexPath
    $distroEscaped = & $escape $distro
    $tmuxDir = ''
    if ($WindowsTmuxPath) {
        $tmuxDir = Split-Path -Parent $WindowsTmuxPath
    }
    $tmuxDirEscaped = & $escape $tmuxDir

    $body = @"
`$codexHudPath = '$(& $escape $paths.CodexHud)'
`$codexHudWslPath = '$(& $escape $paths.CodexHudWsl)'
`$codexHudInstallPath = '$(& $escape $paths.Install)'
`$codexHudSyncPath = '$(& $escape $paths.Sync)'
`$codexHudUpgradePath = '$(& $escape $paths.Upgrade)'
`$codexHudUninstallPath = '$(& $escape $paths.Uninstall)'
`$codexHudNpmPrefix = '$npmPrefixEscaped'
`$codexHudTmuxDir = '$tmuxDirEscaped'

if (-not ((`$env:Path -split ';') -contains `$codexHudNpmPrefix)) {
    `$env:Path = "`$codexHudNpmPrefix;`$env:Path"
}

if (`$codexHudTmuxDir -and -not ((`$env:Path -split ';') -contains `$codexHudTmuxDir)) {
    `$env:Path = "`$codexHudTmuxDir;`$env:Path"
}

`$env:CODEX_HUD_REAL_CODEX = '$realCodexEscaped'
`$env:CODEX_HUD_WSL_DISTRO = '$distroEscaped'

function codex { & `$codexHudPath @args }
function codex-resume { & `$codexHudPath resume @args }
function codex-hud-wsl { & `$codexHudWslPath @args }
function codex-hud-install { & `$codexHudInstallPath @args }
function codex-hud-sync { & `$codexHudSyncPath @args }
function codex-hud-upgrade { & `$codexHudUpgradePath @args }
function codex-hud-uninstall { & `$codexHudUninstallPath @args }
"@

    return $body
}

function Assert-CmdShimValueSafe {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Value
    )

    if ($Value.Contains('"')) {
        throw "$Name contains a double quote, which cannot be safely represented in a cmd shim: $Value"
    }
}

function Write-CmdShim {
    param(
        [Parameter(Mandatory = $true)][string]$ShimPath,
        [Parameter(Mandatory = $true)][string]$TargetScript,
        [Parameter(Mandatory = $true)][string]$RealCodexPath,
        [string[]]$PrefixArgs = @()
    )

    $resolvedScript = Resolve-NormalizedPath -Path $TargetScript
    $resolvedCodex = Resolve-NormalizedPath -Path $RealCodexPath
    Assert-CmdShimValueSafe -Name 'TargetScript' -Value $resolvedScript
    Assert-CmdShimValueSafe -Name 'RealCodexPath' -Value $resolvedCodex

    $prefix = ''
    if ($PrefixArgs -and $PrefixArgs.Count -gt 0) {
        foreach ($arg in $PrefixArgs) {
            Assert-CmdShimValueSafe -Name 'PrefixArg' -Value $arg
        }
        $prefix = ' ' + (($PrefixArgs | ForEach-Object { '"' + $_ + '"' }) -join ' ')
    }

    $content = @"
@echo off
setlocal
set "CODEX_HUD_REAL_CODEX=$resolvedCodex"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$resolvedScript"$prefix %*
exit /b %ERRORLEVEL%
"@

    Set-Content -Path $ShimPath -Value $content -Encoding ascii
}

function Install-CmdShims {
    param([Parameter(Mandatory = $true)][string]$RealCodexPath)

    $shimDir = Get-CmdShimDirectory
    if (-not (Test-Path -LiteralPath $shimDir)) {
        New-Item -ItemType Directory -Path $shimDir -Force | Out-Null
    }

    $scripts = @{
        'codex.cmd' = @{
            Target = Join-Path $PSScriptRoot 'codex-hud.ps1'
            Args = @()
        }
        'codex-resume.cmd' = @{
            Target = Join-Path $PSScriptRoot 'codex-hud.ps1'
            Args = @('resume')
        }
        'codex-hud-wsl.cmd' = @{
            Target = Join-Path $PSScriptRoot 'codex-hud-wsl.ps1'
            Args = @()
        }
        'codex-hud-install.cmd' = @{
            Target = Join-Path $PSScriptRoot 'codex-hud-install.ps1'
            Args = @()
        }
        'codex-hud-sync.cmd' = @{
            Target = Join-Path $PSScriptRoot 'codex-hud-sync.ps1'
            Args = @()
        }
        'codex-hud-upgrade.cmd' = @{
            Target = Join-Path $PSScriptRoot 'codex-hud-upgrade.ps1'
            Args = @()
        }
        'codex-hud-uninstall.cmd' = @{
            Target = Join-Path $PSScriptRoot 'codex-hud-uninstall.ps1'
            Args = @()
        }
    }

    foreach ($name in @($scripts.Keys)) {
        $shimPath = Join-Path $shimDir $name
        Write-CmdShim -ShimPath $shimPath -TargetScript $scripts[$name].Target -RealCodexPath $RealCodexPath -PrefixArgs $scripts[$name].Args
    }

    Ensure-UserPathStartsWith -PathEntry $shimDir
    if (-not $env:Path.Split(';').Where({ $_.TrimEnd('\').Equals($shimDir.TrimEnd('\'), [System.StringComparison]::OrdinalIgnoreCase) }, 'First').Count) {
        $env:Path = "$shimDir;$env:Path"
    }

    return $shimDir
}

function Upgrade-Checkout {
    $git = Get-GitCommand
    if (-not $git) {
        throw 'git is required for codex-hud-upgrade on Windows.'
    }

    Push-Location $repoRoot
    try {
        & $git.Source rev-parse --is-inside-work-tree | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Directory is not a git checkout: $repoRoot"
        }

        $status = @(@(& $git.Source status --short) | Where-Object {
            $_ -and -not [string]::IsNullOrWhiteSpace($_.ToString())
        })
        if ($status.Count -gt 0) {
            throw 'Upgrade requires a clean git worktree.'
        }

        Write-Info 'Pulling latest repository changes...'
        & $git.Source pull --ff-only
        if ($LASTEXITCODE -ne 0) {
            throw 'git pull --ff-only failed.'
        }
    } finally {
        Pop-Location
    }
}

switch ($Mode) {
    'upgrade' {
        Upgrade-Checkout
    }
}

$nodeExe = Get-NodeExecutableOrInstall
$npmPrefix = Ensure-PathPriority -NodeExecutable $nodeExe
$windowsTmux = Ensure-WindowsTmux

if ($Mode -eq 'install') {
    Ensure-WindowsCodex -NodeExecutable $nodeExe
}

Ensure-UbuntuDistro
if ($Mode -eq 'install') {
    Ensure-WslCodex
}

Ensure-RepoBuild -NodeExecutable $nodeExe

$managedCodexShim = Join-Path (Get-CmdShimDirectory) 'codex.cmd'
$realCodex = Get-RealCodexCommand -RepoRoot $repoRoot -ExcludedPaths @($managedCodexShim)
if (-not $realCodex) {
    throw 'Unable to resolve codex executable after setup.'
}

$profilePath = Get-ProfilePath
$profileBlock = Build-ProfileBlock -NpmPrefix $npmPrefix -RealCodexPath (Resolve-NormalizedPath -Path $realCodex.Source) -WindowsTmuxPath $windowsTmux
Set-ManagedProfileBlock -ProfilePath $profilePath -BlockBody $profileBlock
$cmdShimDir = Install-CmdShims -RealCodexPath (Resolve-NormalizedPath -Path $realCodex.Source)

Write-Info "Profile updated: $profilePath"
Write-Info "cmd.exe shims updated: $cmdShimDir"
Write-Info 'Open a new PowerShell session (or reload your profile) to use codex-hud aliases.'

if (-not $global:WslReady) {
    Write-Warn "WSL distro '$distro' is not ready yet. Complete WSL setup, then run codex-hud-install again."
}
