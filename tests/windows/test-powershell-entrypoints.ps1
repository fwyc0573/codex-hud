Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("codex-hud-win-tests-" + [guid]::NewGuid().ToString('N'))
$fakeBin = Join-Path $tempRoot 'bin'
$codexArgsLog = Join-Path $tempRoot 'codex-args.txt'
$wslLog = Join-Path $tempRoot 'wsl-command.txt'
$gitLog = Join-Path $tempRoot 'git-command.txt'
$profilePath = Join-Path $tempRoot 'profile.ps1'
$tmuxLog = Join-Path $tempRoot 'tmux-log.txt'
$tmuxCommandLog = Join-Path $tempRoot 'tmux-command-log.txt'
$tmuxState = Join-Path $tempRoot 'tmux-session.txt'
$nativeArgLog = Join-Path $tempRoot 'native-args.txt'
$localAppData = Join-Path $tempRoot 'local-app-data'
$cmdShimDir = Join-Path $localAppData 'codex-hud\bin'

New-Item -ItemType Directory -Force -Path $fakeBin | Out-Null

function Assert-True {
    param(
        [Parameter(Mandatory = $true)][bool]$Condition,
        [Parameter(Mandatory = $true)][string]$Message
    )

    if (-not $Condition) {
        throw "Assertion failed: $Message"
    }
}

function Assert-Contains {
    param(
        [Parameter(Mandatory = $true)][string]$Text,
        [Parameter(Mandatory = $true)][string]$Needle,
        [Parameter(Mandatory = $true)][string]$Message
    )

    if (-not $Text.Contains($Needle)) {
        throw "Assertion failed: $Message`nExpected to find: $Needle`nActual: $Text"
    }
}

$originalPath = $env:Path
$originalSkipHud = $env:CODEX_HUD_SKIP_NATIVE_HUD
$originalWslCommand = $env:CODEX_HUD_WSL_COMMAND
$originalProfile = $env:CODEX_HUD_PROFILE_PATH
$originalSkipReinstall = $env:CODEX_HUD_SKIP_CLI_REINSTALL
$originalSkipWindowsReinstall = $env:CODEX_HUD_SKIP_WINDOWS_CLI_REINSTALL
$originalSkipWslReinstall = $env:CODEX_HUD_SKIP_WSL_CLI_REINSTALL
$originalSkipWsl = $env:CODEX_HUD_SKIP_WSL_SETUP
$originalSkipBuild = $env:CODEX_HUD_SKIP_BUILD
$originalSkipNativeTmux = $env:CODEX_HUD_SKIP_NATIVE_TMUX_SETUP
$originalRealCodex = $env:CODEX_HUD_REAL_CODEX
$originalTestCodex = $env:CODEX_HUD_TEST_REAL_CODEX
$originalWslLog = $env:CODEX_HUD_TEST_WSL_LOG
$originalNativeQuickExit = $env:CODEX_HUD_NATIVE_QUICK_EXIT_SECONDS
$originalBash = $env:CODEX_HUD_BASH
$originalTmux = $env:CODEX_HUD_TMUX
$originalTmuxLog = $env:CODEX_HUD_TEST_TMUX_LOG
$originalTmuxState = $env:CODEX_HUD_TEST_TMUX_STATE
$originalTmuxAttachMode = $env:CODEX_HUD_TEST_TMUX_ATTACH_MODE
$originalTerm = $env:TERM
$originalColorTerm = $env:COLORTERM
$originalLocalAppData = $env:LOCALAPPDATA
$originalUserPath = [Environment]::GetEnvironmentVariable('Path', 'User')

try {
    $fakeCodexCmd = Join-Path $fakeBin 'codex.cmd'
@"
@echo off
setlocal EnableDelayedExpansion
echo %* > "$codexArgsLog"
exit /b 0
"@ | Set-Content -Path $fakeCodexCmd -Encoding ascii

    $fakeGitCmd = Join-Path $fakeBin 'git.cmd'
@"
@echo off
setlocal
>>"$gitLog" echo %*
if "%1"=="rev-parse" exit /b 0
if "%1"=="status" exit /b 0
if "%1"=="pull" exit /b 0
exit /b 0
"@ | Set-Content -Path $fakeGitCmd -Encoding ascii

    $fakeWslCmd = Join-Path $tempRoot 'fake-wsl.ps1'
    $fakeWslNativeCmd = Join-Path $tempRoot 'fake-wsl.cmd'
@"
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$fakeWslCmd" %*
exit /b %ERRORLEVEL%
"@ | Set-Content -Path $fakeWslNativeCmd -Encoding ascii

    @"
`$WslArgs = @(`$args)

if (`$WslArgs.Count -ge 2 -and `$WslArgs[0] -eq '--list' -and `$WslArgs[1] -eq '--quiet') {
    Write-Output 'Ubuntu'
    exit 0
}

if (`$WslArgs -contains 'wslpath' -and `$WslArgs -contains '-a') {
    `$pathArg = `$WslArgs[`$WslArgs.Count - 1]
    `$leaf = Split-Path -Leaf `$WslArgs[`$WslArgs.Count - 1]
    if (`$pathArg -like '*/bin/codex-hud-resize') {
        Write-Output '/mnt/c/repo/bin/codex-hud-resize'
        exit 0
    }
    if (`$pathArg -like '*/bin/codex-hud') {
        Write-Output '/mnt/c/repo/bin/codex-hud'
        exit 0
    }
    if (`$leaf -eq 'bin') {
        Write-Output '/mnt/c/repo/bin'
        exit 0
    }
    if (`$leaf -eq 'codex-hud') {
        Write-Output '/mnt/c/repo'
        exit 0
    }
    if (`$leaf -like 'codex-hud-wsl-provision-*.sh') {
        Write-Output `$WslArgs[`$WslArgs.Count - 1]
        exit 0
    }

    Write-Output '/mnt/c/repo'
    exit 0
}

if (`$WslArgs -contains 'bash' -and `$WslArgs -contains '-s') {
    Set-Content -Path `$env:CODEX_HUD_TEST_WSL_LOG -Value ('ARGS:' + (`$WslArgs -join ' ')) -Encoding utf8
    Add-Content -Path `$env:CODEX_HUD_TEST_WSL_LOG -Value 'STDIN:' -Encoding utf8
    Add-Content -Path `$env:CODEX_HUD_TEST_WSL_LOG -Value ([Console]::In.ReadToEnd()) -Encoding utf8
    exit 0
}

if (`$WslArgs -contains 'bash' -and `$WslArgs -contains '-lc') {
    Set-Content -Path `$env:CODEX_HUD_TEST_WSL_LOG -Value (`$WslArgs -join ' ') -Encoding utf8
    exit 0
}

if (`$WslArgs -contains 'bash') {
    Set-Content -Path `$env:CODEX_HUD_TEST_WSL_LOG -Value ('ARGS:' + (`$WslArgs -join ' ')) -Encoding utf8
    `$bashIndex = [array]::IndexOf(`$WslArgs, 'bash')
    `$scriptPath = `$WslArgs[`$bashIndex + 1]
    if (Test-Path -LiteralPath `$scriptPath) {
        Add-Content -Path `$env:CODEX_HUD_TEST_WSL_LOG -Value 'SCRIPT:' -Encoding utf8
        Add-Content -Path `$env:CODEX_HUD_TEST_WSL_LOG -Value (Get-Content -Path `$scriptPath -Raw) -Encoding utf8
    }
    exit 0
}

Add-Content -Path `$env:CODEX_HUD_TEST_WSL_LOG -Value ('unexpected:' + (`$WslArgs -join ' ')) -Encoding utf8
exit 1
"@ | Set-Content -Path $fakeWslCmd -Encoding ascii

    $env:Path = "$fakeBin;$env:Path"
    $env:CODEX_HUD_REAL_CODEX = $null
    $env:LOCALAPPDATA = $localAppData

    # Test 1: WSL-unavailable wrapper falls back to codex and forwards args.
    $env:CODEX_HUD_SKIP_NATIVE_HUD = '1'
    $env:CODEX_HUD_WSL_COMMAND = 'Z:\missing\wsl.exe'
    & (Join-Path $repoRoot 'bin\codex-hud.ps1') --model gpt-5 'hello-world'
    Assert-True -Condition ($LASTEXITCODE -eq 0) -Message 'codex-hud.ps1 fallback should exit 0'

    $forwarded = (Get-Content -Path $codexArgsLog -Raw).Trim()
    Assert-Contains -Text $forwarded -Needle '--model gpt-5 hello-world' -Message 'fallback should preserve cli args'

    # Test 2: WSL wrapper should construct bash command against bin/codex-hud.
    $env:CODEX_HUD_WSL_COMMAND = $fakeWslCmd
    $env:CODEX_HUD_TEST_WSL_LOG = $wslLog

    & (Join-Path $repoRoot 'bin\codex-hud-wsl.ps1') --model 'gpt 5' "quote's test" -- 'literal value'
    Assert-True -Condition ($LASTEXITCODE -eq 0) -Message 'codex-hud-wsl.ps1 should exit 0 with fake wsl'

    $wslCommand = (Get-Content -Path $wslLog -Raw)
    Assert-Contains -Text $wslCommand -Needle 'mktemp -d' -Message 'wsl command should create temp files under WSL /tmp'
    Assert-Contains -Text $wslCommand -Needle "CODEX_HUD_SCRIPT_DIR='/mnt/c/repo/bin'" -Message 'wsl command should keep repo script dir separate from temp wrapper'
    Assert-Contains -Text $wslCommand -Needle 'CODEX_HUD_RESIZE_HELPER=' -Message 'wsl command should set resize helper for LF-safe execution'
    $escapedQuoteArg = [string][char]39 + 'quote' + [string][char]39 + [string][char]34 + [string][char]39 + [string][char]34 + [string][char]39 + 's test' + [string][char]39
    Assert-Contains -Text $wslCommand -Needle $escapedQuoteArg -Message 'wsl command should preserve single quotes in CLI args'
    Assert-True -Condition (-not $wslCommand.Contains('.wsltmp')) -Message 'wsl command should not create repo-local .wsltmp files'

    # Test 3: Windows entrypoint should default to WSL and reject PowerShell/native HUD mode.
    $nativeTermLog = Join-Path $tempRoot 'native-term.txt'
    $fakeNativeBash = Join-Path $fakeBin 'bash.cmd'
@"
@echo off
setlocal EnableDelayedExpansion
echo Info: fake native bash launch
>"$nativeArgLog" echo %*
>"$nativeTermLog" echo TERM=%TERM%
>>"$nativeTermLog" echo COLORTERM=%COLORTERM%
>>"$nativeTermLog" echo WINDOWS_BASH=%CODEX_HUD_WINDOWS_BASH_EXE%
if not "%CODEX_HUD_SESSION_NAME_FILE%"=="" (
  set "SESSION_FILE=%CODEX_HUD_SESSION_NAME_FILE%"
  set "SESSION_FILE=!SESSION_FILE:/=\!"
  if /I "!SESSION_FILE:~0,3!"=="\c\" set "SESSION_FILE=C:!SESSION_FILE:~2!"
  if /I "!SESSION_FILE:~0,3!"=="/c/" set "SESSION_FILE=C:\!SESSION_FILE:~3!"
  >"!SESSION_FILE!" echo codex-hud-test-session
  >"%CODEX_HUD_TEST_TMUX_STATE%" echo codex-hud-test-session
)
exit /b 0
"@ | Set-Content -Path $fakeNativeBash -Encoding ascii

    $fakeTmux = Join-Path $fakeBin 'tmux.cmd'
@"
@echo off
setlocal EnableDelayedExpansion
:parse
if "%1"=="-L" (
  shift
  shift
  goto parse
)
if "%1"=="new-session" (
  >"%CODEX_HUD_TEST_TMUX_STATE%" echo codex-hud-test-session
  exit /b 0
)
if "%1"=="kill-server" (
  if exist "%CODEX_HUD_TEST_TMUX_STATE%" del "%CODEX_HUD_TEST_TMUX_STATE%" >nul 2>nul
  exit /b 0
)
if "%1"=="has-session" (
  if exist "%CODEX_HUD_TEST_TMUX_STATE%" exit /b 0
  exit /b 1
)
if "%1"=="list-sessions" (
  if not exist "%CODEX_HUD_TEST_TMUX_STATE%" exit /b 1
  set COUNT=0
  if exist "%CODEX_HUD_TEST_TMUX_STATE%.attached" set COUNT=1
  echo codex-hud-test-session^|!COUNT!
  exit /b 0
)
if "%1"=="display-message" (
  if not exist "%CODEX_HUD_TEST_TMUX_STATE%" exit /b 1
  set COUNT=0
  if exist "%CODEX_HUD_TEST_TMUX_STATE%.attached" set COUNT=1
  echo !COUNT!
  exit /b 0
)
if "%1"=="pipe-pane" (
  >>"$tmuxCommandLog" echo %*
  exit /b 0
)
if "%1"=="kill-session" (
  if exist "%CODEX_HUD_TEST_TMUX_STATE%" del "%CODEX_HUD_TEST_TMUX_STATE%" >nul 2>nul
  if exist "%CODEX_HUD_TEST_TMUX_STATE%.attached" del "%CODEX_HUD_TEST_TMUX_STATE%.attached" >nul 2>nul
  if exist "%CODEX_HUD_TEST_TMUX_STATE%.firstattach" del "%CODEX_HUD_TEST_TMUX_STATE%.firstattach" >nul 2>nul
  exit /b 0
)
if "%1"=="attach-session" (
  >>"%CODEX_HUD_TEST_TMUX_LOG%" echo %*
  if /I "%CODEX_HUD_TEST_TMUX_ATTACH_MODE%"=="quick-then-attach" (
    if not exist "%CODEX_HUD_TEST_TMUX_STATE%.firstattach" (
      >"%CODEX_HUD_TEST_TMUX_STATE%.firstattach" echo 1
      exit /b 0
    )
    >"%CODEX_HUD_TEST_TMUX_STATE%.attached" echo 1
    exit /b 0
  )
  if /I "%CODEX_HUD_TEST_TMUX_ATTACH_MODE%"=="always-quick" exit /b 0
  if /I "%CODEX_HUD_TEST_TMUX_ATTACH_MODE%"=="always-fail" exit /b 1
  >"%CODEX_HUD_TEST_TMUX_STATE%.attached" echo 1
  exit /b 0
)
exit /b 0
"@ | Set-Content -Path $fakeTmux -Encoding ascii

    $fakeNode = Join-Path $fakeBin 'node.cmd'
@"
@echo off
exit /b 0
"@ | Set-Content -Path $fakeNode -Encoding ascii

    $env:CODEX_HUD_SKIP_NATIVE_HUD = $null
    $env:CODEX_HUD_NATIVE_QUICK_EXIT_SECONDS = '5'
    $env:CODEX_HUD_BASH = $fakeNativeBash
    $env:CODEX_HUD_TMUX = $fakeTmux
    $env:CODEX_HUD_TEST_TMUX_LOG = $tmuxLog
    $env:CODEX_HUD_TEST_TMUX_STATE = $tmuxState
    $env:TERM = 'dumb'
    Remove-Item Env:COLORTERM -ErrorAction SilentlyContinue

    function Reset-NativeHarness {
        Remove-Item -LiteralPath $tmuxLog -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $tmuxCommandLog -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $tmuxState -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $nativeArgLog -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath "$tmuxState.attached" -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath "$tmuxState.firstattach" -Force -ErrorAction SilentlyContinue
    }

    # Test 3a: default launch should use WSL directly and skip native PowerShell.
    Reset-NativeHarness
    Remove-Item -LiteralPath $wslLog -Force -ErrorAction SilentlyContinue
    $env:CODEX_HUD_WSL_COMMAND = $fakeWslCmd
    $env:CODEX_HUD_TEST_WSL_LOG = $wslLog
    & (Join-Path $repoRoot 'bin\codex-hud.ps1')
    Assert-True -Condition ($LASTEXITCODE -eq 0) -Message 'codex-hud.ps1 default launch should exit 0 with fake WSL'
    Assert-True -Condition (Test-Path -LiteralPath $wslLog) -Message 'codex-hud.ps1 default launch should call WSL'
    Assert-True -Condition (-not (Test-Path -LiteralPath $nativeArgLog)) -Message 'codex-hud.ps1 default launch should skip native PowerShell'

    # Test 3b: default WSL launch should preserve Codex CLI args.
    Reset-NativeHarness
    Remove-Item -LiteralPath $wslLog -Force -ErrorAction SilentlyContinue
    & (Join-Path $repoRoot 'bin\codex-hud.ps1') --model gpt-5 default-wsl
    Assert-True -Condition ($LASTEXITCODE -eq 0) -Message 'codex-hud.ps1 default WSL launch should exit 0 with args'
    $defaultWslCommand = Get-Content -Path $wslLog -Raw
    Assert-Contains -Text $defaultWslCommand -Needle '--model' -Message 'default WSL launch should preserve Codex CLI flags'
    Assert-Contains -Text $defaultWslCommand -Needle 'default-wsl' -Message 'default WSL launch should forward prompt args'
    Assert-True -Condition (-not (Test-Path -LiteralPath $nativeArgLog)) -Message 'default WSL launch should not call native PowerShell'

    # Test 3c: if WSL is unavailable, wrapper should fall back to plain Codex CLI without native PowerShell.
    Reset-NativeHarness
    Remove-Item -LiteralPath $codexArgsLog -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $wslLog -Force -ErrorAction SilentlyContinue
    $env:CODEX_HUD_WSL_COMMAND = 'Z:\missing\wsl.exe'

    & (Join-Path $repoRoot 'bin\codex-hud.ps1') 'wsl-failure-test'
    Assert-True -Condition ($LASTEXITCODE -eq 0) -Message 'codex-hud.ps1 should fall back to codex CLI when WSL is unavailable'

    $fallbackArgs = (Get-Content -Path $codexArgsLog -Raw).Trim()
    Assert-Contains -Text $fallbackArgs -Needle 'wsl-failure-test' -Message 'plain codex fallback should preserve original CLI args'
    Assert-True -Condition (-not (Test-Path -LiteralPath $nativeArgLog)) -Message 'WSL-unavailable fallback should not call native PowerShell'

    # Test 3d: explicit WSL mode should skip native PowerShell launch and strip the wrapper flag.
    Reset-NativeHarness
    Remove-Item -LiteralPath $wslLog -Force -ErrorAction SilentlyContinue
    $env:CODEX_HUD_WSL_COMMAND = $fakeWslCmd
    $env:CODEX_HUD_TEST_WSL_LOG = $wslLog
    $env:CODEX_HUD_TEST_TMUX_ATTACH_MODE = 'quick-then-attach'

    & (Join-Path $repoRoot 'bin\codex-hud.ps1') --wsl --model gpt-5 forced-wsl
    Assert-True -Condition ($LASTEXITCODE -eq 0) -Message 'codex-hud.ps1 --wsl should exit 0 with fake wsl'
    Assert-True -Condition (-not (Test-Path -LiteralPath $nativeArgLog)) -Message 'codex-hud.ps1 --wsl should skip native PowerShell launch'
    $explicitWslCommand = Get-Content -Path $wslLog -Raw
    Assert-Contains -Text $explicitWslCommand -Needle '--model' -Message 'explicit WSL mode should preserve Codex CLI args'
    Assert-Contains -Text $explicitWslCommand -Needle 'forced-wsl' -Message 'explicit WSL mode should forward prompt args'
    Assert-True -Condition (-not $explicitWslCommand.Contains('--wsl')) -Message 'explicit WSL mode should not pass the wrapper flag into Codex'

    # Test 3e: explicit PowerShell mode should fail fast as unsupported and skip both WSL and native launch.
    Reset-NativeHarness
    Remove-Item -LiteralPath $wslLog -Force -ErrorAction SilentlyContinue
    $explicitNativeStdout = Join-Path $tempRoot 'explicit-native-stdout.txt'
    $explicitNativeStderr = Join-Path $tempRoot 'explicit-native-stderr.txt'
    $explicitNativeProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        (Join-Path $repoRoot 'bin\codex-hud.ps1'),
        '--powershell',
        'forced-native'
    ) -Wait -PassThru -RedirectStandardOutput $explicitNativeStdout -RedirectStandardError $explicitNativeStderr
    $explicitNativeExitCode = $explicitNativeProcess.ExitCode
    $explicitNativeOutput = @(
        (Get-Content -Path $explicitNativeStdout -Raw -ErrorAction SilentlyContinue),
        (Get-Content -Path $explicitNativeStderr -Raw -ErrorAction SilentlyContinue)
    ) -join "`n"
    Assert-True -Condition ($explicitNativeExitCode -ne 0) -Message 'codex-hud.ps1 --powershell should fail because PowerShell HUD is unsupported'
    Assert-Contains -Text $explicitNativeOutput -Needle 'PowerShell HUD is not supported on Windows yet' -Message 'explicit PowerShell failure should explain unsupported status'
    Assert-Contains -Text $explicitNativeOutput -Needle 'Use WSL HUD with codex or codex --wsl.' -Message 'explicit PowerShell failure should guide users to WSL'
    Assert-True -Condition (-not (Test-Path -LiteralPath $wslLog)) -Message 'codex-hud.ps1 --powershell should not call WSL'
    Assert-True -Condition (-not (Test-Path -LiteralPath $nativeArgLog)) -Message 'codex-hud.ps1 --powershell should not call native PowerShell'

    # Test 3f: --native alias should also fail fast as unsupported.
    Reset-NativeHarness
    $explicitNativeAliasStdout = Join-Path $tempRoot 'explicit-native-alias-stdout.txt'
    $explicitNativeAliasStderr = Join-Path $tempRoot 'explicit-native-alias-stderr.txt'
    $explicitNativeAliasProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        (Join-Path $repoRoot 'bin\codex-hud.ps1'),
        '--native',
        'alias-native-test'
    ) -Wait -PassThru -RedirectStandardOutput $explicitNativeAliasStdout -RedirectStandardError $explicitNativeAliasStderr
    $explicitNativeAliasOutput = @(
        (Get-Content -Path $explicitNativeAliasStdout -Raw -ErrorAction SilentlyContinue),
        (Get-Content -Path $explicitNativeAliasStderr -Raw -ErrorAction SilentlyContinue)
    ) -join "`n"
    Assert-True -Condition ($explicitNativeAliasProcess.ExitCode -ne 0) -Message 'codex-hud.ps1 --native should fail because PowerShell HUD is unsupported'
    Assert-Contains -Text $explicitNativeAliasOutput -Needle 'PowerShell HUD is not supported on Windows yet' -Message 'explicit native alias failure should explain unsupported status'
    Assert-True -Condition (-not (Test-Path -LiteralPath $nativeArgLog)) -Message 'codex-hud.ps1 --native should not call native PowerShell'

    # Test 3g: help should expose only WSL mode, not PowerShell/native startup flags.
    $helpOutput = (& (Join-Path $repoRoot 'bin\codex-hud.ps1') --help *>&1 | Out-String)
    Assert-Contains -Text $helpOutput -Needle 'Default mode is WSL HUD' -Message 'help should describe WSL as the default Windows mode'
    Assert-Contains -Text $helpOutput -Needle '--wsl' -Message 'help should document explicit WSL mode'
    Assert-True -Condition (-not $helpOutput.Contains('--powershell')) -Message 'help should not expose explicit PowerShell mode'
    Assert-True -Condition (-not $helpOutput.Contains('--native')) -Message 'help should not expose explicit native mode'

    # Test 3h: --powershell --self-check should be rejected before any diagnostics run.
    $explicitNativeSelfCheckStdout = Join-Path $tempRoot 'explicit-native-self-check-stdout.txt'
    $explicitNativeSelfCheckStderr = Join-Path $tempRoot 'explicit-native-self-check-stderr.txt'
    $explicitNativeSelfCheckProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        (Join-Path $repoRoot 'bin\codex-hud.ps1'),
        '--powershell',
        '--self-check'
    ) -Wait -PassThru -RedirectStandardOutput $explicitNativeSelfCheckStdout -RedirectStandardError $explicitNativeSelfCheckStderr
    $explicitNativeSelfCheck = @(
        (Get-Content -Path $explicitNativeSelfCheckStdout -Raw -ErrorAction SilentlyContinue),
        (Get-Content -Path $explicitNativeSelfCheckStderr -Raw -ErrorAction SilentlyContinue)
    ) -join "`n"
    Assert-True -Condition ($explicitNativeSelfCheckProcess.ExitCode -ne 0) -Message 'codex-hud.ps1 --powershell --self-check should fail because PowerShell HUD is unsupported'
    Assert-Contains -Text $explicitNativeSelfCheck -Needle 'PowerShell HUD is not supported on Windows yet' -Message 'explicit PowerShell self-check failure should explain unsupported status'

    Remove-Item -LiteralPath $fakeNode -Force
    Remove-Item Env:CODEX_HUD_BASH -ErrorAction SilentlyContinue
    Remove-Item Env:CODEX_HUD_TMUX -ErrorAction SilentlyContinue
    Remove-Item Env:CODEX_HUD_NATIVE_QUICK_EXIT_SECONDS -ErrorAction SilentlyContinue
    Remove-Item Env:CODEX_HUD_TEST_TMUX_LOG -ErrorAction SilentlyContinue
    Remove-Item Env:CODEX_HUD_TEST_TMUX_STATE -ErrorAction SilentlyContinue
    Remove-Item Env:CODEX_HUD_TEST_TMUX_ATTACH_MODE -ErrorAction SilentlyContinue

    # Test 4: WSL provisioning should use sudo/root checks and Node LTS setup.
    Remove-Item -LiteralPath $wslLog -Force -ErrorAction SilentlyContinue
    $env:CODEX_HUD_PROFILE_PATH = $profilePath
    $env:CODEX_HUD_SKIP_WINDOWS_CLI_REINSTALL = '1'
    Remove-Item Env:CODEX_HUD_SKIP_CLI_REINSTALL -ErrorAction SilentlyContinue
    Remove-Item Env:CODEX_HUD_SKIP_WSL_CLI_REINSTALL -ErrorAction SilentlyContinue
    Remove-Item Env:CODEX_HUD_SKIP_WSL_SETUP -ErrorAction SilentlyContinue
    $env:CODEX_HUD_SKIP_BUILD = '1'
    $env:CODEX_HUD_SKIP_NATIVE_TMUX_SETUP = '1'
    $env:CODEX_HUD_WSL_COMMAND = $fakeWslNativeCmd
    $env:CODEX_HUD_TEST_REAL_CODEX = $fakeCodexCmd

    & (Join-Path $repoRoot 'bin\codex-hud-install.ps1') -Mode install
    Assert-True -Condition ($LASTEXITCODE -eq 0) -Message 'codex-hud-install.ps1 should provision WSL with fake wsl'

    $provisionCommand = Get-Content -Path $wslLog -Raw
    Assert-Contains -Text $provisionCommand -Needle 'ARGS:-d Ubuntu -- bash ' -Message 'WSL provisioning should execute an LF-only temp script file to avoid argv quote and stdin encoding corruption'
    Assert-Contains -Text $provisionCommand -Needle 'codex-hud-wsl-provision-' -Message 'WSL provisioning script path should use a dedicated temp filename'
    Assert-Contains -Text $provisionCommand -Needle 'SCRIPT:' -Message 'WSL provisioning fake should observe the generated script content'
    Assert-Contains -Text $provisionCommand -Needle 'sudo -n true' -Message 'WSL provisioning should verify passwordless sudo when not root'
    Assert-Contains -Text $provisionCommand -Needle 'https://deb.nodesource.com/setup_lts.x' -Message 'WSL provisioning should install Node.js LTS when needed'
    Assert-Contains -Text $provisionCommand -Needle 'node --version' -Message 'WSL provisioning should validate Node version'
    Assert-Contains -Text $provisionCommand -Needle 'npm install -g @openai/codex@latest' -Message 'WSL provisioning should reinstall codex-cli in WSL'
    Assert-Contains -Text $provisionCommand -Needle 'ALIAS_MARKER="# codex-hud alias"' -Message 'WSL provisioning should configure codex-hud aliases in the WSL shell rc file'
    Assert-Contains -Text $provisionCommand -Needle 'append_alias codex "$repo_root/bin/codex-hud"' -Message 'WSL provisioning should add a managed codex alias'
    Assert-Contains -Text $provisionCommand -Needle 'codex-hud-sync' -Message 'WSL provisioning should add management command aliases'

    # Test 5: install/sync/upgrade/uninstall should manage profile marker block and wrappers.
    $env:CODEX_HUD_PROFILE_PATH = $profilePath
    $env:CODEX_HUD_SKIP_CLI_REINSTALL = '1'
    Remove-Item Env:CODEX_HUD_SKIP_WINDOWS_CLI_REINSTALL -ErrorAction SilentlyContinue
    $env:CODEX_HUD_SKIP_WSL_SETUP = '1'
    $env:CODEX_HUD_SKIP_BUILD = '1'
    $env:CODEX_HUD_SKIP_NATIVE_TMUX_SETUP = '1'
    $env:CODEX_HUD_TEST_REAL_CODEX = $fakeCodexCmd

    & (Join-Path $repoRoot 'bin\codex-hud-install.ps1') -Mode install
    Assert-True -Condition ($LASTEXITCODE -eq 0) -Message 'codex-hud-install.ps1 should exit 0 in test mode'

    $profileContent = Get-Content -Path $profilePath -Raw
    $profileMarkerStart = '# ' + '>>>' + ' codex-hud windows ' + '>>>'
    Assert-Contains -Text $profileContent -Needle $profileMarkerStart -Message 'install should add profile marker start'
    Assert-Contains -Text $profileContent -Needle 'function codex-hud-wsl' -Message 'install should add codex-hud-wsl alias function'

    $cmdShim = Join-Path $cmdShimDir 'codex.cmd'
    Assert-True -Condition (Test-Path -LiteralPath $cmdShim) -Message 'install should create codex.cmd shim for cmd.exe users'
    $cmdShimContent = Get-Content -Path $cmdShim -Raw
    Assert-Contains -Text $cmdShimContent -Needle 'codex-hud.ps1' -Message 'codex.cmd shim should invoke the PowerShell entrypoint'
    Assert-Contains -Text $cmdShimContent -Needle 'CODEX_HUD_REAL_CODEX' -Message 'codex.cmd shim should pin the real codex executable'

    Remove-Item -LiteralPath $codexArgsLog -Force -ErrorAction SilentlyContinue
    $env:CODEX_HUD_SKIP_NATIVE_HUD = '1'
    $env:CODEX_HUD_WSL_COMMAND = 'Z:\missing\wsl.exe'
    $cmdExe = if ($env:ComSpec) { $env:ComSpec } else { (Join-Path $env:WINDIR 'System32\cmd.exe') }
    & $cmdExe /d /c "`"$cmdShim`" cmd-shim-test"
    Assert-True -Condition ($LASTEXITCODE -eq 0) -Message 'codex.cmd shim should be executable from cmd.exe'
    $cmdShimArgs = (Get-Content -Path $codexArgsLog -Raw).Trim()
    Assert-Contains -Text $cmdShimArgs -Needle 'cmd-shim-test' -Message 'codex.cmd shim should preserve CLI args'

    & (Join-Path $repoRoot 'bin\codex-hud-sync.ps1')
    Assert-True -Condition ($LASTEXITCODE -eq 0) -Message 'codex-hud-sync.ps1 should exit 0'

    & (Join-Path $repoRoot 'bin\codex-hud-upgrade.ps1')
    Assert-True -Condition ($LASTEXITCODE -eq 0) -Message 'codex-hud-upgrade.ps1 should exit 0'

    $gitCommandLog = Get-Content -Path $gitLog -Raw
    Assert-Contains -Text $gitCommandLog -Needle 'status --short' -Message 'upgrade should check for a clean worktree'
    Assert-Contains -Text $gitCommandLog -Needle 'pull --ff-only' -Message 'upgrade should fast-forward pull latest changes'

    & (Join-Path $repoRoot 'bin\codex-hud-uninstall.ps1')
    Assert-True -Condition ($LASTEXITCODE -eq 0) -Message 'codex-hud-uninstall.ps1 should exit 0'

    $profileAfter = Get-Content -Path $profilePath -Raw -ErrorAction SilentlyContinue
    if ($null -eq $profileAfter) {
        $profileAfter = ''
    }
    Assert-True -Condition (-not $profileAfter.Contains($profileMarkerStart)) -Message 'uninstall should remove managed profile block'
    Assert-True -Condition (-not (Test-Path -LiteralPath $cmdShim)) -Message 'uninstall should remove managed cmd shim'

    Write-Host 'test-powershell-entrypoints: PASS'
} finally {
    $env:Path = $originalPath
    $env:CODEX_HUD_SKIP_NATIVE_HUD = $originalSkipHud
    $env:CODEX_HUD_WSL_COMMAND = $originalWslCommand
    $env:CODEX_HUD_PROFILE_PATH = $originalProfile
    $env:CODEX_HUD_SKIP_CLI_REINSTALL = $originalSkipReinstall
    $env:CODEX_HUD_SKIP_WINDOWS_CLI_REINSTALL = $originalSkipWindowsReinstall
    $env:CODEX_HUD_SKIP_WSL_CLI_REINSTALL = $originalSkipWslReinstall
    $env:CODEX_HUD_SKIP_WSL_SETUP = $originalSkipWsl
    $env:CODEX_HUD_SKIP_BUILD = $originalSkipBuild
    $env:CODEX_HUD_SKIP_NATIVE_TMUX_SETUP = $originalSkipNativeTmux
    $env:CODEX_HUD_REAL_CODEX = $originalRealCodex
    $env:CODEX_HUD_TEST_REAL_CODEX = $originalTestCodex
    $env:CODEX_HUD_TEST_WSL_LOG = $originalWslLog
    $env:CODEX_HUD_NATIVE_QUICK_EXIT_SECONDS = $originalNativeQuickExit
    $env:CODEX_HUD_BASH = $originalBash
    $env:CODEX_HUD_TMUX = $originalTmux
    $env:CODEX_HUD_TEST_TMUX_LOG = $originalTmuxLog
    $env:CODEX_HUD_TEST_TMUX_STATE = $originalTmuxState
    $env:CODEX_HUD_TEST_TMUX_ATTACH_MODE = $originalTmuxAttachMode
    $env:TERM = $originalTerm
    $env:COLORTERM = $originalColorTerm
    $env:LOCALAPPDATA = $originalLocalAppData
    [Environment]::SetEnvironmentVariable('Path', $originalUserPath, 'User')

    if ($null -eq $originalColorTerm) {
        Remove-Item Env:COLORTERM -ErrorAction SilentlyContinue
    }
    if ($null -eq $originalTerm) {
        Remove-Item Env:TERM -ErrorAction SilentlyContinue
    }

    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force
    }
}
