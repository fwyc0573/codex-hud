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

function Reinstall-WindowsCodex {
    param([Parameter(Mandatory = $true)][string]$NodeExecutable)

    if ($env:CODEX_HUD_SKIP_CLI_REINSTALL -eq '1') {
        Write-Warn 'Skipping Windows codex-cli reinstall due to CODEX_HUD_SKIP_CLI_REINSTALL=1.'
        return
    }
    if ($env:CODEX_HUD_SKIP_WINDOWS_CLI_REINSTALL -eq '1') {
        Write-Warn 'Skipping Windows codex-cli reinstall due to CODEX_HUD_SKIP_WINDOWS_CLI_REINSTALL=1.'
        return
    }

    Write-Info 'Reinstalling codex-cli on Windows (npm global)...'
    [void](Invoke-NpmCli -NodeExecutable $NodeExecutable -NpmArguments @('uninstall', '-g', '@openai/codex'))

    $installExit = Invoke-NpmCli -NodeExecutable $NodeExecutable -NpmArguments @('install', '-g', '@openai/codex@latest')
    if ($installExit -ne 0) {
        throw 'Failed to install @openai/codex globally on Windows.'
    }
}

function Ensure-WindowsTmux {
    if ($env:CODEX_HUD_SKIP_NATIVE_TMUX_SETUP -eq '1') {
        Write-Warn 'Skipping Windows tmux setup due to CODEX_HUD_SKIP_NATIVE_TMUX_SETUP=1.'
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

function Reinstall-WslCodex {
    if ($env:CODEX_HUD_SKIP_CLI_REINSTALL -eq '1') {
        Write-Warn 'Skipping WSL codex-cli reinstall due to CODEX_HUD_SKIP_CLI_REINSTALL=1.'
        return
    }
    if ($env:CODEX_HUD_SKIP_WSL_CLI_REINSTALL -eq '1') {
        Write-Warn 'Skipping WSL codex-cli reinstall due to CODEX_HUD_SKIP_WSL_CLI_REINSTALL=1.'
        return
    }

    if (-not $global:WslReady) {
        Write-Warn 'WSL distro not ready; skipping WSL codex-cli reinstall for now.'
        return
    }

    $wsl = Get-WslCommand
    if (-not $wsl) {
        Write-Warn 'wsl.exe missing unexpectedly; skipping WSL codex reinstall.'
        return
    }

    Write-Info 'Installing nodejs/npm/tmux in WSL and reinstalling codex-cli...'
    $cmd = @(
        'set -euo pipefail',
        'manual_cmd="sudo apt-get update && sudo apt-get install -y ca-certificates curl tmux && curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs && sudo npm install -g @openai/codex@latest"',
        'if [ "$(id -u)" -eq 0 ]; then SUDO_CMD=""; elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then SUDO_CMD="sudo"; else echo "codex-hud WSL provisioning requires root or passwordless sudo." >&2; echo "Run inside WSL: $manual_cmd" >&2; exit 70; fi',
        'run_root() { if [ -n "$SUDO_CMD" ]; then sudo "$@"; else "$@"; fi; }',
        'run_root_env() { if [ -n "$SUDO_CMD" ]; then sudo -E "$@"; else "$@"; fi; }',
        'get_node_major() { node --version 2>/dev/null | sed -E "s/^v([0-9]+).*/\1/" || true; }',
        'run_root apt-get update',
        'run_root env DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl tmux',
        'node_major="$(get_node_major)"',
        'if [ -z "$node_major" ] || [ "$node_major" -lt 18 ]; then curl -fsSL https://deb.nodesource.com/setup_lts.x | run_root_env bash -; run_root env DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs; fi',
        'node_major="$(get_node_major)"',
        'if [ -z "$node_major" ] || [ "$node_major" -lt 18 ]; then echo "Node.js >=18 is required in WSL after provisioning." >&2; exit 71; fi',
        'command -v npm >/dev/null 2>&1 || { echo "npm is required in WSL after provisioning." >&2; exit 72; }',
        'run_root npm uninstall -g @openai/codex || true',
        'run_root npm install -g @openai/codex@latest',
        'codex --version'
    ) -join '; '

    & $wsl -d $distro -- bash -lc $cmd
    if ($LASTEXITCODE -ne 0) {
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
    Reinstall-WindowsCodex -NodeExecutable $nodeExe
}

Ensure-UbuntuDistro
if ($Mode -eq 'install') {
    Reinstall-WslCodex
}

Ensure-RepoBuild -NodeExecutable $nodeExe

$realCodex = Get-RealCodexCommand -RepoRoot $repoRoot
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
