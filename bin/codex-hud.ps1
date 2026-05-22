[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [AllowNull()]
    [AllowEmptyCollection()]
    [string[]]$CliArgs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. "$PSScriptRoot/windows/common.ps1"

$repoRoot = Get-CodexHudRepoRoot -ScriptDirectory $PSScriptRoot
$nativeWrapper = Join-Path $PSScriptRoot 'codex-hud'
$wslWrapper = Join-Path $PSScriptRoot 'codex-hud-wsl.ps1'

function Show-Help {
    @"
codex-hud (Windows wrapper)

Usage:
  codex-hud [--wsl] [codex args...]

Behavior:
  - WSL HUD is the default Windows launch path.
  - If WSL HUD is unavailable, it falls back to plain codex CLI.

Options:
  --wsl            Force WSL HUD mode
  -h, --help       Show this message
  --self-check     Show diagnostics for WSL runtime

Tip:
  Default mode is WSL HUD -> plain codex CLI.
"@ | Write-Host
}

function Get-FirstArgumentFromList {
    param([AllowNull()][AllowEmptyCollection()][string[]]$Arguments)

    if ($Arguments -and $Arguments.Count -gt 0) {
        return $Arguments[0]
    }

    return $null
}

function Get-SafeCliArguments {
    if ($null -eq $CliArgs) {
        return @()
    }

    return @($CliArgs)
}

function Remove-FirstArgument {
    param([AllowNull()][AllowEmptyCollection()][string[]]$Arguments)

    if (-not $Arguments -or $Arguments.Count -le 1) {
        return @()
    }

    return @($Arguments[1..($Arguments.Count - 1)])
}

function Resolve-LaunchRequest {
    param([AllowNull()][AllowEmptyCollection()][string[]]$Arguments)

    $safeArguments = if ($Arguments) { @($Arguments) } else { @() }
    $first = Get-FirstArgumentFromList -Arguments $safeArguments

    switch ($first) {
        '--wsl' {
            return [pscustomobject]@{
                Mode = 'wsl'
                Arguments = @(Remove-FirstArgument -Arguments $safeArguments)
            }
        }
        '--powershell' {
            return [pscustomobject]@{
                Mode = 'powershell-unsupported'
                Arguments = @(Remove-FirstArgument -Arguments $safeArguments)
            }
        }
        '--native' {
            return [pscustomobject]@{
                Mode = 'powershell-unsupported'
                Arguments = @(Remove-FirstArgument -Arguments $safeArguments)
            }
        }
        default {
            return [pscustomobject]@{
                Mode = 'auto'
                Arguments = $safeArguments
            }
        }
    }
}

function Test-BooleanEnvironmentValue {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $false
    }

    switch ($Value.Trim().ToLowerInvariant()) {
        '1' { return $true }
        'true' { return $true }
        'yes' { return $true }
        'on' { return $true }
        default { return $false }
    }
}

function Test-DirectCodexPassthrough {
    param([string]$FirstArgument)

    if ([string]::IsNullOrWhiteSpace($FirstArgument)) {
        return $false
    }

    return $FirstArgument -in @('--version', '-V')
}

function Test-NativeAttachRequest {
    param([string]$FirstArgument)

    if ([string]::IsNullOrWhiteSpace($FirstArgument)) {
        return $true
    }

    return ($FirstArgument -notin @('-h', '--help', '--self-check', '--kill', '--list', '--version', '-V'))
}

function Test-WslFallbackEligible {
    param([string]$FirstArgument)

    if ([string]::IsNullOrWhiteSpace($FirstArgument)) {
        return $true
    }

    return ($FirstArgument -notin @('-h', '--help', '--self-check', '--version', '-V'))
}

function Test-AttachPolicyMayReuseSession {
    param([string[]]$Arguments)

    foreach ($arg in $Arguments) {
        if ($arg -eq '--attach') {
            return $true
        }
    }

    return (Test-BooleanEnvironmentValue -Value $env:CODEX_HUD_AUTO_ATTACH)
}

function Write-LfScriptCopy {
    param(
        [Parameter(Mandatory = $true)][string]$SourcePath,
        [Parameter(Mandatory = $true)][string]$DestinationPath
    )

    $content = [System.IO.File]::ReadAllText($SourcePath)
    $content = $content -replace "`r`n", "`n"

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($DestinationPath, $content, $utf8NoBom)
}

function Convert-ToMsysPath {
    param([Parameter(Mandatory = $true)][string]$WindowsPath)

    $normalized = Resolve-NormalizedPath -Path $WindowsPath
    $unixPath = $normalized -replace '\\', '/'
    if ($unixPath -match '^([A-Za-z]):/(.*)$') {
        return "/$($matches[1].ToLowerInvariant())/$($matches[2])"
    }

    return $unixPath
}

function Get-ShortWindowsPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    $resolved = Resolve-NormalizedPath -Path $Path
    if (-not (Test-Path -LiteralPath $resolved)) {
        return $resolved
    }

    $cmdExe = if ($env:ComSpec) { $env:ComSpec } else { (Join-Path $env:WINDIR 'System32\cmd.exe') }
    $escapedPath = $resolved.Replace('"', '""')

    try {
        $shortPath = & $cmdExe /d /c "for %I in (""$escapedPath"") do @echo %~sI" 2>$null
        if ($LASTEXITCODE -eq 0 -and $shortPath) {
            $candidate = (Strip-NullChars -Text ($shortPath | Select-Object -First 1)).Trim()
            if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate)) {
                return $candidate
            }
        }
    } catch {
        # Fall back to the original path below.
    }

    return $resolved
}

function Test-TmuxSessionExists {
    param(
        [Parameter(Mandatory = $true)][psobject]$TmuxCommand,
        [Parameter(Mandatory = $true)][string]$SessionName,
        [string]$SocketName
    )

    $arguments = @()
    if ($SocketName) {
        $arguments += @('-L', $SocketName)
    }
    $arguments += @('has-session', '-t', $SessionName)

    return ((Invoke-NativeCommandQuiet -FilePath $TmuxCommand.Source -ArgumentList $arguments) -eq 0)
}

function Invoke-NativeCommandQuiet {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @()
    )

    $hadNativePreference = Test-Path Variable:PSNativeCommandUseErrorActionPreference
    if ($hadNativePreference) {
        $originalNativePreference = $PSNativeCommandUseErrorActionPreference
        $script:PSNativeCommandUseErrorActionPreference = $false
    }

    try {
        & $FilePath @ArgumentList 2>$null | Out-Null
        return $LASTEXITCODE
    } catch {
        return 1
    } finally {
        if ($hadNativePreference) {
            $script:PSNativeCommandUseErrorActionPreference = $originalNativePreference
        }
    }
}

function Get-TmuxSessionAttachedCount {
    param(
        [Parameter(Mandatory = $true)][psobject]$TmuxCommand,
        [Parameter(Mandatory = $true)][string]$SessionName
    )

    $hadNativePreference = Test-Path Variable:PSNativeCommandUseErrorActionPreference
    if ($hadNativePreference) {
        $originalNativePreference = $PSNativeCommandUseErrorActionPreference
        $script:PSNativeCommandUseErrorActionPreference = $false
    }

    try {
        $countValue = & $TmuxCommand.Source display-message -p -t $SessionName '#{session_attached}' 2>$null
    } catch {
        return 0
    } finally {
        if ($hadNativePreference) {
            $script:PSNativeCommandUseErrorActionPreference = $originalNativePreference
        }
    }

    if ($LASTEXITCODE -ne 0 -or -not $countValue) {
        return 0
    }

    $clean = (Strip-NullChars -Text ($countValue | Select-Object -First 1)).Trim()
    if ($clean -match '^\d+$') {
        return [int]$clean
    }

    return 0
}

function Remove-TmuxSession {
    param(
        [Parameter(Mandatory = $true)][psobject]$TmuxCommand,
        [Parameter(Mandatory = $true)][string]$SessionName
    )

    if (-not (Test-TmuxSessionExists -TmuxCommand $TmuxCommand -SessionName $SessionName)) {
        return
    }

    [void](Invoke-NativeCommandQuiet -FilePath $TmuxCommand.Source -ArgumentList @('kill-session', '-t', $SessionName))
}

function Test-TmuxCanLaunchShell {
    param(
        [Parameter(Mandatory = $true)][psobject]$TmuxCommand,
        [Parameter(Mandatory = $true)][string]$BashExecutable
    )

    $socketName = 'codex-hud-probe-' + [guid]::NewGuid().ToString('N')
    $sessionName = $socketName

    try {
        $launchExitCode = Invoke-NativeCommandQuiet -FilePath $TmuxCommand.Source -ArgumentList @('-L', $socketName, 'new-session', '-d', '-s', $sessionName, $BashExecutable, '-lc', 'sleep 1')
        if ($launchExitCode -ne 0) {
            return $false
        }

        Start-Sleep -Milliseconds 150
        return (Test-TmuxSessionExists -TmuxCommand $TmuxCommand -SessionName $sessionName -SocketName $socketName)
    } catch {
        return $false
    } finally {
        try {
            [void](Invoke-NativeCommandQuiet -FilePath $TmuxCommand.Source -ArgumentList @('-L', $socketName, 'kill-server'))
        } catch {
            # Ignore cleanup failures for probe sessions.
        }
    }
}

function Resolve-TmuxBashExecutable {
    param(
        [Parameter(Mandatory = $true)][psobject]$BashCommand,
        [Parameter(Mandatory = $true)][psobject]$TmuxCommand,
        [switch]$ProbeLaunch
    )

    $candidates = New-Object 'System.Collections.Generic.List[string]'
    $resolved = Resolve-NormalizedPath -Path $BashCommand.Source
    if (-not [string]::IsNullOrWhiteSpace($resolved)) {
        [void]$candidates.Add($resolved)
    }

    $short = Get-ShortWindowsPath -Path $resolved
    if (-not [string]::IsNullOrWhiteSpace($short) -and
        -not $candidates.Contains($short)) {
        $candidates.Insert(0, $short)
    }

    if (-not $ProbeLaunch) {
        foreach ($candidate in $candidates) {
            if ($candidate -notmatch '\s') {
                return $candidate
            }
        }

        if ($candidates.Count -gt 0) {
            return $candidates[0]
        }

        return $null
    }

    foreach ($candidate in $candidates) {
        if (Test-TmuxCanLaunchShell -TmuxCommand $TmuxCommand -BashExecutable $candidate) {
            return $candidate
        }
    }

    return $null
}

function Resolve-NativeHudRuntime {
    param([switch]$ProbeTmuxShell)

    $issues = New-Object 'System.Collections.Generic.List[string]'
    if ($env:CODEX_HUD_SKIP_NATIVE_HUD -eq '1') {
        [void]$issues.Add('CODEX_HUD_SKIP_NATIVE_HUD=1')
    }

    if (-not (Test-Path -LiteralPath $nativeWrapper)) {
        [void]$issues.Add("missing wrapper: $nativeWrapper")
    }

    $bash = Get-NativeBashCommand
    if (-not $bash) {
        [void]$issues.Add('native bash not found')
    }

    $tmux = Get-WindowsTmuxCommand
    if (-not $tmux) {
        [void]$issues.Add('tmux.exe not found')
    }

    $node = Get-NodeExecutable
    if (-not $node) {
        [void]$issues.Add('node.exe not found')
    }

    $tmuxBash = $null
    if ($bash -and $tmux) {
        $tmuxBash = Resolve-TmuxBashExecutable -BashCommand $bash -TmuxCommand $tmux -ProbeLaunch:$ProbeTmuxShell
        if (-not $tmuxBash) {
            [void]$issues.Add('tmux cannot launch the selected bash executable')
        }
    }

    return [pscustomobject]@{
        Ready = ($issues.Count -eq 0)
        Bash = $bash
        Tmux = $tmux
        Node = $node
        TmuxBash = $tmuxBash
        Issues = @($issues)
    }
}

function Get-NativeQuickExitSeconds {
    $raw = $env:CODEX_HUD_NATIVE_QUICK_EXIT_SECONDS
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return 2.0
    }

    try {
        $value = [double]::Parse($raw, [System.Globalization.CultureInfo]::InvariantCulture)
        if ($value -le 0) {
            return 2.0
        }

        return $value
    } catch {
        return 2.0
    }
}

function Invoke-TmuxAttachViaCmd {
    param(
        [Parameter(Mandatory = $true)][psobject]$TmuxCommand,
        [Parameter(Mandatory = $true)][string]$SessionName
    )

    $cmdExe = if ($env:ComSpec) { $env:ComSpec } else { (Join-Path $env:WINDIR 'System32\cmd.exe') }
    $quotedTmux = '"' + $TmuxCommand.Source.Replace('"', '""') + '"'
    $quotedSession = '"' + $SessionName.Replace('"', '""') + '"'
    $commandLine = "$quotedTmux attach-session -t $quotedSession"
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

    & $cmdExe /d /c $commandLine
    $exitCode = $LASTEXITCODE
    $stopwatch.Stop()

    return [pscustomobject]@{
        ExitCode = $exitCode
        DurationSeconds = $stopwatch.Elapsed.TotalSeconds
        Mode = 'cmd'
    }
}

function Invoke-NativeTmuxAttach {
    param(
        [Parameter(Mandatory = $true)][psobject]$TmuxCommand,
        [Parameter(Mandatory = $true)][string]$SessionName
    )

    if (-not (Test-TmuxSessionExists -TmuxCommand $TmuxCommand -SessionName $SessionName)) {
        return [pscustomobject]@{
            Success = $false
            ExitCode = 1
            Mode = 'native'
            Reason = 'session-missing'
        }
    }

    $quickExitSeconds = Get-NativeQuickExitSeconds
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $processExitCode = 1

    $tmuxExtension = [System.IO.Path]::GetExtension($TmuxCommand.Source)
    if ($tmuxExtension -and $tmuxExtension.ToLowerInvariant() -in @('.cmd', '.bat')) {
        $stopwatch.Stop()
        $cmdResult = Invoke-TmuxAttachViaCmd -TmuxCommand $TmuxCommand -SessionName $SessionName
        $sessionStillExists = Test-TmuxSessionExists -TmuxCommand $TmuxCommand -SessionName $SessionName
        $attachedCount = if ($sessionStillExists) { Get-TmuxSessionAttachedCount -TmuxCommand $TmuxCommand -SessionName $SessionName } else { 0 }
        $cmdQuickNoClient = ($cmdResult.DurationSeconds -lt $quickExitSeconds -and $sessionStillExists -and $attachedCount -eq 0)

        if ($cmdResult.ExitCode -eq 0 -and -not $cmdQuickNoClient) {
            return [pscustomobject]@{
                Success = $true
                ExitCode = 0
                Mode = 'cmd'
                Reason = 'attached'
            }
        }

        if ($sessionStillExists) {
            Write-Warn 'native tmux attach returned before a client stayed attached; retrying via cmd.exe.'
            $retryResult = Invoke-TmuxAttachViaCmd -TmuxCommand $TmuxCommand -SessionName $SessionName
            $sessionStillExists = Test-TmuxSessionExists -TmuxCommand $TmuxCommand -SessionName $SessionName
            $attachedCount = if ($sessionStillExists) { Get-TmuxSessionAttachedCount -TmuxCommand $TmuxCommand -SessionName $SessionName } else { 0 }
            $retryQuickNoClient = ($retryResult.DurationSeconds -lt $quickExitSeconds -and $sessionStillExists -and $attachedCount -eq 0)

            if ($retryResult.ExitCode -eq 0 -and -not $retryQuickNoClient) {
                return [pscustomobject]@{
                    Success = $true
                    ExitCode = 0
                    Mode = 'cmd'
                    Reason = 'attached'
                }
            }

            return [pscustomobject]@{
                Success = $false
                ExitCode = $retryResult.ExitCode
                Mode = 'cmd'
                Reason = if ($retryQuickNoClient) { 'quick-exit-no-client' } else { 'attach-failed' }
            }
        }

        return [pscustomobject]@{
            Success = ($cmdResult.ExitCode -eq 0)
            ExitCode = $cmdResult.ExitCode
            Mode = 'cmd'
            Reason = if ($cmdResult.ExitCode -eq 0) { 'session-exited' } else { 'attach-failed' }
        }
    }

    try {
        $process = Start-Process -FilePath $TmuxCommand.Source -ArgumentList @('attach-session', '-t', $SessionName) -NoNewWindow -Wait -PassThru
        $processExitCode = $process.ExitCode
    } catch {
        $stopwatch.Stop()
        return [pscustomobject]@{
            Success = $false
            ExitCode = 1
            Mode = 'native'
            Reason = 'start-process-failed'
        }
    }

    $stopwatch.Stop()
    $durationSeconds = $stopwatch.Elapsed.TotalSeconds
    $sessionStillExists = Test-TmuxSessionExists -TmuxCommand $TmuxCommand -SessionName $SessionName
    $attachedCount = if ($sessionStillExists) { Get-TmuxSessionAttachedCount -TmuxCommand $TmuxCommand -SessionName $SessionName } else { 0 }
    $quickNoClient = ($durationSeconds -lt $quickExitSeconds -and $sessionStillExists -and $attachedCount -eq 0)

    if ($processExitCode -eq 0 -and -not $quickNoClient) {
        return [pscustomobject]@{
            Success = $true
            ExitCode = 0
            Mode = 'native'
            Reason = 'attached'
        }
    }

    if ($sessionStillExists) {
        Write-Warn 'native tmux attach returned before a client stayed attached; retrying via cmd.exe.'
        $cmdResult = Invoke-TmuxAttachViaCmd -TmuxCommand $TmuxCommand -SessionName $SessionName
        $sessionStillExists = Test-TmuxSessionExists -TmuxCommand $TmuxCommand -SessionName $SessionName
        $attachedCount = if ($sessionStillExists) { Get-TmuxSessionAttachedCount -TmuxCommand $TmuxCommand -SessionName $SessionName } else { 0 }
        $cmdQuickNoClient = ($cmdResult.DurationSeconds -lt $quickExitSeconds -and $sessionStillExists -and $attachedCount -eq 0)

        if ($cmdResult.ExitCode -eq 0 -and -not $cmdQuickNoClient) {
            return [pscustomobject]@{
                Success = $true
                ExitCode = 0
                Mode = 'cmd'
                Reason = 'attached'
            }
        }

        return [pscustomobject]@{
            Success = $false
            ExitCode = $cmdResult.ExitCode
            Mode = 'cmd'
            Reason = if ($cmdQuickNoClient) { 'quick-exit-no-client' } else { 'attach-failed' }
        }
    }

    return [pscustomobject]@{
        Success = ($processExitCode -eq 0)
        ExitCode = $processExitCode
        Mode = 'native'
        Reason = if ($processExitCode -eq 0) { 'session-exited' } else { 'attach-failed' }
    }
}

function Invoke-NativeHudWrapper {
    param(
        [Parameter(Mandatory = $true)][psobject]$Runtime,
        [switch]$DeferFinalAttach,
        [AllowNull()][AllowEmptyCollection()][string[]]$Arguments = @()
    )

    $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("codex-hud-native-" + [guid]::NewGuid().ToString('N'))
    $wrapperLf = Join-Path $tempDir 'codex-hud'
    $resizeSource = Join-Path $PSScriptRoot 'codex-hud-resize'
    $resizeLf = Join-Path $tempDir 'codex-hud-resize'
    $sessionNameFile = Join-Path $tempDir 'session-name.txt'

    $originalScriptDir = $env:CODEX_HUD_SCRIPT_DIR
    $originalResizeHelper = $env:CODEX_HUD_RESIZE_HELPER
    $originalWindowsBash = $env:CODEX_HUD_WINDOWS_BASH_EXE
    $originalDeferAttach = $env:CODEX_HUD_WINDOWS_DEFER_ATTACH
    $originalSessionNameFile = $env:CODEX_HUD_SESSION_NAME_FILE
    $originalTerm = [Environment]::GetEnvironmentVariable('TERM', 'Process')
    $originalColorTerm = [Environment]::GetEnvironmentVariable('COLORTERM', 'Process')

    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    try {
        if ([string]::IsNullOrWhiteSpace($originalTerm) -or $originalTerm.Equals('dumb', [System.StringComparison]::OrdinalIgnoreCase)) {
            $env:TERM = 'xterm-256color'
        }

        if ([string]::IsNullOrWhiteSpace($originalColorTerm)) {
            $env:COLORTERM = 'truecolor'
        }

        Write-LfScriptCopy -SourcePath $nativeWrapper -DestinationPath $wrapperLf
        if (Test-Path -LiteralPath $resizeSource) {
            Write-LfScriptCopy -SourcePath $resizeSource -DestinationPath $resizeLf
            $env:CODEX_HUD_RESIZE_HELPER = Convert-ToMsysPath -WindowsPath $resizeLf
        } else {
            Remove-Item Env:CODEX_HUD_RESIZE_HELPER -ErrorAction SilentlyContinue
        }

        $env:CODEX_HUD_SCRIPT_DIR = Convert-ToMsysPath -WindowsPath $PSScriptRoot
        if ($Runtime.TmuxBash) {
            $env:CODEX_HUD_WINDOWS_BASH_EXE = Convert-ToMsysPath -WindowsPath $Runtime.TmuxBash
        } else {
            Remove-Item Env:CODEX_HUD_WINDOWS_BASH_EXE -ErrorAction SilentlyContinue
        }

        if ($DeferFinalAttach) {
            $env:CODEX_HUD_WINDOWS_DEFER_ATTACH = '1'
            $env:CODEX_HUD_SESSION_NAME_FILE = Convert-ToMsysPath -WindowsPath $sessionNameFile
        } else {
            Remove-Item Env:CODEX_HUD_WINDOWS_DEFER_ATTACH -ErrorAction SilentlyContinue
            Remove-Item Env:CODEX_HUD_SESSION_NAME_FILE -ErrorAction SilentlyContinue
        }

        $tmuxDir = Split-Path -Parent $Runtime.Tmux.Source
        if ($tmuxDir -and -not (($env:Path -split ';') -contains $tmuxDir)) {
            $env:Path = "$tmuxDir;$env:Path"
        }

        $wrapperLfForBash = Convert-ToMsysPath -WindowsPath $wrapperLf
        $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        & $Runtime.Bash.Source $wrapperLfForBash @Arguments | Out-Host
        $exitCode = $LASTEXITCODE
        $stopwatch.Stop()

        $sessionName = $null
        if ($DeferFinalAttach -and (Test-Path -LiteralPath $sessionNameFile)) {
            $sessionName = (Get-Content -LiteralPath $sessionNameFile -Raw -ErrorAction SilentlyContinue).Trim()
            if ([string]::IsNullOrWhiteSpace($sessionName)) {
                $sessionName = $null
            }
        }

        return [pscustomobject]@{
            ExitCode = $exitCode
            DurationSeconds = $stopwatch.Elapsed.TotalSeconds
            SessionName = $sessionName
        }
    } finally {
        if ($null -ne $originalTerm) {
            $env:TERM = $originalTerm
        } else {
            Remove-Item Env:TERM -ErrorAction SilentlyContinue
        }

        if ($null -ne $originalColorTerm) {
            $env:COLORTERM = $originalColorTerm
        } else {
            Remove-Item Env:COLORTERM -ErrorAction SilentlyContinue
        }

        if ($null -ne $originalScriptDir) {
            $env:CODEX_HUD_SCRIPT_DIR = $originalScriptDir
        } else {
            Remove-Item Env:CODEX_HUD_SCRIPT_DIR -ErrorAction SilentlyContinue
        }

        if ($null -ne $originalResizeHelper) {
            $env:CODEX_HUD_RESIZE_HELPER = $originalResizeHelper
        } else {
            Remove-Item Env:CODEX_HUD_RESIZE_HELPER -ErrorAction SilentlyContinue
        }

        if ($null -ne $originalWindowsBash) {
            $env:CODEX_HUD_WINDOWS_BASH_EXE = $originalWindowsBash
        } else {
            Remove-Item Env:CODEX_HUD_WINDOWS_BASH_EXE -ErrorAction SilentlyContinue
        }

        if ($null -ne $originalDeferAttach) {
            $env:CODEX_HUD_WINDOWS_DEFER_ATTACH = $originalDeferAttach
        } else {
            Remove-Item Env:CODEX_HUD_WINDOWS_DEFER_ATTACH -ErrorAction SilentlyContinue
        }

        if ($null -ne $originalSessionNameFile) {
            $env:CODEX_HUD_SESSION_NAME_FILE = $originalSessionNameFile
        } else {
            Remove-Item Env:CODEX_HUD_SESSION_NAME_FILE -ErrorAction SilentlyContinue
        }

        if (Test-Path -LiteralPath $tempDir) {
            Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

function Invoke-NativeHudAttempt {
    param(
        [Parameter(Mandatory = $true)][psobject]$Runtime,
        [AllowNull()][AllowEmptyCollection()][string[]]$Arguments = @()
    )

    $firstArgument = Get-FirstArgumentFromList -Arguments $Arguments
    $nativeAttach = Test-NativeAttachRequest -FirstArgument $firstArgument

    if ($nativeAttach) {
        $launchResult = Invoke-NativeHudWrapper -Runtime $Runtime -DeferFinalAttach -Arguments $Arguments
        if ($launchResult.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($launchResult.SessionName)) {
            $attachResult = Invoke-NativeTmuxAttach -TmuxCommand $Runtime.Tmux -SessionName $launchResult.SessionName
            if ($attachResult.Success) {
                return [pscustomobject]@{
                    Success = $true
                    ExitCode = $attachResult.ExitCode
                    Reason = 'attached'
                }
            }

            if (-not (Test-AttachPolicyMayReuseSession -Arguments $Arguments)) {
                Remove-TmuxSession -TmuxCommand $Runtime.Tmux -SessionName $launchResult.SessionName
            }

            return [pscustomobject]@{
                Success = $false
                ExitCode = $attachResult.ExitCode
                Reason = "native PowerShell HUD attach failed ($($attachResult.Reason))"
            }
        }

        if ($launchResult.ExitCode -eq 0) {
            return [pscustomobject]@{
                Success = $false
                ExitCode = 1
                Reason = 'native PowerShell HUD launch did not report a tmux session'
            }
        }

        return [pscustomobject]@{
            Success = $false
            ExitCode = $launchResult.ExitCode
            Reason = "native PowerShell HUD launch failed (exit=$($launchResult.ExitCode))"
        }
    }

    $nativeResult = Invoke-NativeHudWrapper -Runtime $Runtime -Arguments $Arguments
    if ($nativeResult.ExitCode -eq 0) {
        return [pscustomobject]@{
            Success = $true
            ExitCode = 0
            Reason = 'command-complete'
        }
    }

    return [pscustomobject]@{
        Success = $false
        ExitCode = $nativeResult.ExitCode
        Reason = "native PowerShell HUD command failed (exit=$($nativeResult.ExitCode))"
    }
}

function Write-WslFallbackBanner {
    param([Parameter(Mandatory = $true)][string]$Reason)

    Write-Warn '============================================================'
    Write-Warn 'WSL HUD is the supported Windows launch mode.'
    Write-Warn "Reason: $Reason"
    Write-Warn 'Use codex or codex --wsl to start the WSL HUD.'
    Write-Warn '============================================================'
}

function Invoke-WslHudFallback {
    param([AllowNull()][AllowEmptyCollection()][string[]]$Arguments = @())

    $wsl = Get-WslCommand
    if (-not $wsl) {
        return [pscustomobject]@{
            Attempted = $false
            ExitCode = 1
            Reason = 'wsl-not-found'
        }
    }

    $distro = if ($env:CODEX_HUD_WSL_DISTRO) { $env:CODEX_HUD_WSL_DISTRO } else { 'Ubuntu' }
    if (-not (Test-WslDistroAvailable -WslCommand $wsl -Distro $distro)) {
        return [pscustomobject]@{
            Attempted = $false
            ExitCode = 1
            Reason = 'wsl-distro-missing'
        }
    }

    if (-not (Test-Path -LiteralPath $wslWrapper)) {
        return [pscustomobject]@{
            Attempted = $false
            ExitCode = 1
            Reason = 'wsl-wrapper-missing'
        }
    }

    & $wslWrapper @Arguments | Out-Host
    return [pscustomobject]@{
        Attempted = $true
        ExitCode = $LASTEXITCODE
        Reason = if ($LASTEXITCODE -eq 0) { 'ok' } else { 'wsl-wrapper-failed' }
    }
}

function Invoke-PlainCodex {
    param([AllowNull()][AllowEmptyCollection()][string[]]$Arguments = @())

    $codex = Get-RealCodexCommand -RepoRoot $repoRoot -ExcludedPaths @($PSCommandPath)
    if (-not $codex) {
        Write-ErrorAndExit -Message 'codex CLI not found. Install with npm install -g @openai/codex@latest.' -ExitCode 1
    }

    & $codex.Source @Arguments | Out-Host
    return $LASTEXITCODE
}

function Get-WslFailureMessage {
    param([Parameter(Mandatory = $true)][psobject]$WslResult)

    if ($WslResult.Attempted) {
        return "WSL HUD launch failed (exit=$($WslResult.ExitCode))"
    }

    switch ($WslResult.Reason) {
        'wsl-not-found' {
            return 'wsl.exe not found. Install WSL first: wsl --install -d Ubuntu'
        }
        'wsl-distro-missing' {
            $distro = if ($env:CODEX_HUD_WSL_DISTRO) { $env:CODEX_HUD_WSL_DISTRO } else { 'Ubuntu' }
            return "WSL distro '$distro' is not ready. Install or register it with: wsl --install -d $distro"
        }
        'wsl-wrapper-missing' {
            return "codex-hud-wsl.ps1 is missing: $wslWrapper"
        }
        default {
            return "WSL HUD unavailable: $($WslResult.Reason)"
        }
    }
}

function Get-FailureExitCode {
    param([int]$ExitCode)

    if ($ExitCode -ne 0) {
        return $ExitCode
    }

    return 1
}

function Invoke-SelfCheck {
    Write-Host '[OK] Windows default launch mode: WSL HUD.' -ForegroundColor Green

    $realCodex = Get-RealCodexCommand -RepoRoot $repoRoot -ExcludedPaths @($PSCommandPath)
    if ($realCodex) {
        Write-Host "[OK] codex target: $($realCodex.Source)" -ForegroundColor Green
    } else {
        Write-Host '[WARN] No codex executable found for plain fallback mode.' -ForegroundColor Yellow
    }

    $wsl = Get-WslCommand
    if (-not $wsl) {
        Write-Host '[WARN] wsl.exe not found. codex-hud-wsl will not work.' -ForegroundColor Yellow
        return 1
    }

    $distro = if ($env:CODEX_HUD_WSL_DISTRO) { $env:CODEX_HUD_WSL_DISTRO } else { 'Ubuntu' }
    if (Test-WslDistroAvailable -WslCommand $wsl -Distro $distro) {
        Write-Host "[OK] WSL distro $distro detected." -ForegroundColor Green
        return 0
    }

    Write-Host "[WARN] $distro distro not found. Run: wsl --install -d $distro" -ForegroundColor Yellow
    return 1
}

$launchRequest = Resolve-LaunchRequest -Arguments (Get-SafeCliArguments)
$safeCliArgs = @($launchRequest.Arguments)
$firstArg = Get-FirstArgumentFromList -Arguments $safeCliArgs

if ($launchRequest.Mode -eq 'powershell-unsupported') {
    Write-ErrorAndExit -Message 'PowerShell HUD is not supported on Windows yet. Use WSL HUD with codex or codex --wsl.' -ExitCode 1
}

if ($launchRequest.Mode -eq 'auto' -and ($firstArg -eq '-h' -or $firstArg -eq '--help')) {
    Show-Help
    exit 0
}

if ($launchRequest.Mode -eq 'auto' -and $firstArg -eq '--self-check') {
    $status = Invoke-SelfCheck
    exit $status
}

if ($launchRequest.Mode -eq 'wsl') {
    $wslResult = Invoke-WslHudFallback -Arguments $safeCliArgs
    if ($wslResult.Attempted -and $wslResult.ExitCode -eq 0) {
        exit 0
    }

    $message = Get-WslFailureMessage -WslResult $wslResult
    Write-ErrorAndExit -Message "Explicit WSL HUD mode failed: $message. Native PowerShell HUD is not supported." -ExitCode $wslResult.ExitCode
}

if ($launchRequest.Mode -eq 'auto' -and (Test-DirectCodexPassthrough -FirstArgument $firstArg)) {
    exit (Invoke-PlainCodex -Arguments $safeCliArgs)
}

$wslEligible = Test-WslFallbackEligible -FirstArgument $firstArg

if ($wslEligible) {
    $wslResult = Invoke-WslHudFallback -Arguments $safeCliArgs
    if ($wslResult.Attempted -and $wslResult.ExitCode -eq 0) {
        exit 0
    }

    if ($wslResult.Attempted) {
        Write-Warn "WSL HUD launch failed (exit=$($wslResult.ExitCode)); falling back to codex CLI."
    } else {
        switch ($wslResult.Reason) {
            'wsl-not-found' {
                Write-Warn 'WSL is not installed; falling back to codex CLI.'
            }
            'wsl-distro-missing' {
                $distro = if ($env:CODEX_HUD_WSL_DISTRO) { $env:CODEX_HUD_WSL_DISTRO } else { 'Ubuntu' }
                Write-Warn "WSL distro '$distro' is not ready; falling back to codex CLI."
            }
            'wsl-wrapper-missing' {
                Write-Warn 'codex-hud-wsl.ps1 is missing; falling back to codex CLI.'
            }
        }
    }
}

Write-Warn 'WSL HUD launch failed; falling back to codex CLI.'
exit (Invoke-PlainCodex -Arguments $safeCliArgs)
