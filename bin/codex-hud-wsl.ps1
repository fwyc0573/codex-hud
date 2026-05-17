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
$wrapperWslLf = "$wrapperWsl.wsltmp"
$resizeWsl = $null
$resizeWslLf = $null

if (Test-Path -LiteralPath $resizeWrapper) {
    $resizeWsl = Convert-WindowsPathToWsl -WslCommand $wslCommand -Distro $distro -WindowsPath $resizeWrapper
    $resizeWslLf = "$resizeWsl.wsltmp"
}

# Windows checkouts often have CRLF; generate an LF-only sibling copy for WSL execution.
$bashArgs = Join-BashArguments -Arguments $CliArgs
$launch = "$(ConvertTo-BashSingleQuoted -Value $wrapperWslLf)"
if ($resizeWslLf) {
    $launch = "CODEX_HUD_RESIZE_HELPER=$(ConvertTo-BashSingleQuoted -Value $resizeWslLf) $launch"
}
if ($bashArgs) { $launch = "$launch $bashArgs" }

$commandParts = @(
    "cd $(ConvertTo-BashSingleQuoted -Value $cwdWsl)",
    "tr -d '\r' < $(ConvertTo-BashSingleQuoted -Value $wrapperWsl) > $(ConvertTo-BashSingleQuoted -Value $wrapperWslLf)",
    "chmod +x $(ConvertTo-BashSingleQuoted -Value $wrapperWslLf)"
)

$cleanupTargets = @($wrapperWslLf)
if ($resizeWslLf) {
    $commandParts += "tr -d '\r' < $(ConvertTo-BashSingleQuoted -Value $resizeWsl) > $(ConvertTo-BashSingleQuoted -Value $resizeWslLf)"
    $commandParts += "chmod +x $(ConvertTo-BashSingleQuoted -Value $resizeWslLf)"
    $cleanupTargets += $resizeWslLf
}

$commandParts += $launch
$command = ($commandParts -join ' && ')
$cleanupCommand = 'rm -f ' + (($cleanupTargets | ForEach-Object { ConvertTo-BashSingleQuoted -Value $_ }) -join ' ')
$command = "$command; rc=`$?; $cleanupCommand; exit `$rc"

& $wslCommand -d $distro -- bash -lc $command
exit $LASTEXITCODE
