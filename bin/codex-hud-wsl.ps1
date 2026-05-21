[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$CliArgs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. "$PSScriptRoot/windows/common.ps1"

$distro = if ($env:CODEX_HUD_WSL_DISTRO) { $env:CODEX_HUD_WSL_DISTRO } else { 'Ubuntu' }
$wslCommand = Get-WslCommand
$bashWrapper = Join-Path $PSScriptRoot 'codex-hud'
$resizeWrapper = Join-Path $PSScriptRoot 'codex-hud-resize'

function Show-Help {
    @"
codex-hud-wsl (Windows -> WSL full HUD launcher)

Usage:
  codex-hud-wsl [codex args...]

Behavior:
  - Converts current Windows directory to WSL path
  - Runs existing Bash wrapper bin/codex-hud inside WSL

Requirements:
  - WSL installed
  - Ubuntu distro installed
  - tmux/node/codex installed in WSL
"@ | Write-Host
}

$firstArg = if ($CliArgs -and $CliArgs.Count -gt 0) { $CliArgs[0] } else { $null }
if ($firstArg -eq '-h' -or $firstArg -eq '--help') {
    Show-Help
    exit 0
}

if (-not $wslCommand) {
    Write-ErrorAndExit -Message 'wsl.exe not found. Install WSL first: wsl --install -d Ubuntu' -ExitCode 1
}

if (-not (Test-WslDistroAvailable -WslCommand $wslCommand -Distro $distro)) {
    Write-ErrorAndExit -Message "WSL distro '$distro' is not available. Install with: wsl --install -d $distro" -ExitCode 1
}

if (-not (Test-Path -LiteralPath $bashWrapper)) {
    Write-ErrorAndExit -Message "Bash wrapper not found: $bashWrapper" -ExitCode 1
}

$cwdWindows = (Get-Location).Path
$cwdWsl = Convert-WindowsPathToWsl -WslCommand $wslCommand -Distro $distro -WindowsPath $cwdWindows
$wrapperWsl = Convert-WindowsPathToWsl -WslCommand $wslCommand -Distro $distro -WindowsPath $bashWrapper
$scriptDirWsl = Convert-WindowsPathToWsl -WslCommand $wslCommand -Distro $distro -WindowsPath $PSScriptRoot
$resizeWsl = $null

if (Test-Path -LiteralPath $resizeWrapper) {
    $resizeWsl = Convert-WindowsPathToWsl -WslCommand $wslCommand -Distro $distro -WindowsPath $resizeWrapper
}

# Windows checkouts often have CRLF; generate LF-only copies in WSL /tmp.
$bashArgs = Join-BashArguments -Arguments $CliArgs
$launchEnv = @("CODEX_HUD_SCRIPT_DIR=$(ConvertTo-BashSingleQuoted -Value $scriptDirWsl)")
if ($resizeWsl) {
    $launchEnv += 'CODEX_HUD_RESIZE_HELPER="$tmp_dir/codex-hud-resize"'
}
$launch = "$($launchEnv -join ' ') " + '"$tmp_dir/codex-hud"'
if ($bashArgs) { $launch = "$launch $bashArgs" }

$commandParts = @(
    'set -e',
    'tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/codex-hud-wsl.XXXXXX")',
    'cleanup() { rc=$?; rm -rf "$tmp_dir"; exit $rc; }',
    'trap cleanup EXIT',
    "cd $(ConvertTo-BashSingleQuoted -Value $cwdWsl)",
    ("tr -d '\r' < $(ConvertTo-BashSingleQuoted -Value $wrapperWsl) > " + '"$tmp_dir/codex-hud"'),
    'chmod +x "$tmp_dir/codex-hud"'
)

if ($resizeWsl) {
    $commandParts += ("tr -d '\r' < $(ConvertTo-BashSingleQuoted -Value $resizeWsl) > " + '"$tmp_dir/codex-hud-resize"')
    $commandParts += 'chmod +x "$tmp_dir/codex-hud-resize"'
}

$commandParts += $launch
$command = ($commandParts -join ' && ')

& $wslCommand -d $distro -- bash -lc $command
exit $LASTEXITCODE
