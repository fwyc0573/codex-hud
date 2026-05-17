[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

& (Join-Path $PSScriptRoot 'codex-hud-install.ps1') -Mode upgrade
exit $LASTEXITCODE
