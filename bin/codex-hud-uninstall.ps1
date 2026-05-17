[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. "$PSScriptRoot/windows/common.ps1"

$profilePath = Get-ProfilePath
Remove-ManagedProfileBlock -ProfilePath $profilePath
Write-Info "Removed codex-hud profile block from: $profilePath"

$wsl = Get-WslCommand
if ($wsl -and (Test-WslDistroAvailable -WslCommand $wsl -Distro 'Ubuntu')) {
    & $wsl -d Ubuntu -- bash -lc "tmux kill-server >/dev/null 2>&1 || true"
}

Write-Info 'Uninstall complete. Open a new shell (or reload your profile) to apply.'
