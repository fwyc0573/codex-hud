Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-NormalizedPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path
    )

    try {
        return (Resolve-Path -LiteralPath $Path).Path
    } catch {
        return $Path
    }
}

function Get-CodexHudRepoRoot {
    param(
        [Parameter(Mandatory = $true)][string]$ScriptDirectory
    )

    return Resolve-NormalizedPath -Path (Join-Path $ScriptDirectory '..')
}

function Get-ManagedProfileMarkers {
    return @{
        Start = '# >>> codex-hud windows >>>'
        End = '# <<< codex-hud windows <<<'
    }
}

function Strip-NullChars {
    param([string]$Text)

    if ($null -eq $Text) {
        return ''
    }

    return $Text -replace "`0", ''
}

function Write-Info {
    param([string]$Message)

    Write-Host "[codex-hud] $Message"
}

function Write-Warn {
    param([string]$Message)

    Write-Warning "[codex-hud] $Message"
}

function Write-ErrorAndExit {
    param(
        [string]$Message,
        [int]$ExitCode = 1
    )

    Write-Error "[codex-hud] $Message"
    exit $ExitCode
}

function Get-WslCommand {
    if ($env:CODEX_HUD_WSL_COMMAND) {
        return $env:CODEX_HUD_WSL_COMMAND
    }

    $wslExe = Get-Command wsl.exe -ErrorAction SilentlyContinue
    if ($wslExe) {
        return $wslExe.Source
    }

    $wsl = Get-Command wsl -ErrorAction SilentlyContinue
    if ($wsl) {
        return $wsl.Source
    }

    return $null
}

function Test-IsWslBashLauncher {
    param([string]$CommandPath)

    if (-not $CommandPath) {
        return $false
    }

    $normalizedPath = Resolve-NormalizedPath -Path $CommandPath
    $system32Bash = Resolve-NormalizedPath -Path (Join-Path $env:WINDIR 'System32\bash.exe')

    return $normalizedPath.Equals($system32Bash, [System.StringComparison]::OrdinalIgnoreCase)
}

function Get-NativeBashCommand {
    if ($env:CODEX_HUD_BASH) {
        $configured = Resolve-NormalizedPath -Path $env:CODEX_HUD_BASH
        if ((Test-Path -LiteralPath $configured) -and -not (Test-IsWslBashLauncher -CommandPath $configured)) {
            return [pscustomobject]@{ Source = $configured }
        }
    }

    $preferredPaths = @(
        'C:\Program Files\Git\bin\bash.exe',
        'C:\Program Files\Git\usr\bin\bash.exe'
    )

    foreach ($candidate in $preferredPaths) {
        if (Test-Path -LiteralPath $candidate) {
            $resolved = Resolve-NormalizedPath -Path $candidate
            return [pscustomobject]@{ Source = $resolved }
        }
    }

    $commands = @(Get-Command bash -All -ErrorAction SilentlyContinue)
    foreach ($command in $commands) {
        if (-not $command.Source) {
            continue
        }

        $source = Resolve-NormalizedPath -Path $command.Source
        if (Test-IsWslBashLauncher -CommandPath $source) {
            continue
        }

        return [pscustomobject]@{ Source = $source }
    }

    return $null
}

function Get-WindowsTmuxCommand {
    if ($env:CODEX_HUD_TMUX) {
        $configured = Resolve-NormalizedPath -Path $env:CODEX_HUD_TMUX
        if (Test-Path -LiteralPath $configured) {
            return [pscustomobject]@{ Source = $configured }
        }
    }

    $tmux = Get-Command tmux -ErrorAction SilentlyContinue
    if ($tmux -and $tmux.Source) {
        return [pscustomobject]@{ Source = (Resolve-NormalizedPath -Path $tmux.Source) }
    }

    $linkPath = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\tmux.exe'
    if (Test-Path -LiteralPath $linkPath) {
        return [pscustomobject]@{ Source = (Resolve-NormalizedPath -Path $linkPath) }
    }

    $packagesRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    if (-not (Test-Path -LiteralPath $packagesRoot)) {
        return $null
    }

    $candidate = Get-ChildItem -Path $packagesRoot -Directory -Filter 'arndawg.tmux-windows*' -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $candidate) {
        return $null
    }

    $tmuxExe = Join-Path $candidate.FullName 'tmux.exe'
    if (Test-Path -LiteralPath $tmuxExe) {
        return [pscustomobject]@{ Source = (Resolve-NormalizedPath -Path $tmuxExe) }
    }

    return $null
}

function Get-WslDistros {
    param([string]$WslCommand)

    if (-not $WslCommand) {
        return @()
    }

    try {
        $lines = & $WslCommand --list --quiet 2>$null
        if ($LASTEXITCODE -ne 0) {
            return @()
        }

        return @($lines | ForEach-Object { Strip-NullChars -Text $_ } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    } catch {
        return @()
    }
}

function Test-WslDistroAvailable {
    param(
        [string]$WslCommand,
        [string]$Distro = 'Ubuntu'
    )

    $distros = Get-WslDistros -WslCommand $WslCommand
    foreach ($item in $distros) {
        if ($item.Equals($Distro, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
    }

    return $false
}

function ConvertTo-BashSingleQuoted {
    param([string]$Value)

    if ($null -eq $Value) {
        return "''"
    }

    $replacement = "'" + '"' + "'" + '"' + "'"
    $escaped = $Value.Replace("'", $replacement)
    return "'$escaped'"
}

function Join-BashArguments {
    param([string[]]$Arguments)

    if (-not $Arguments -or $Arguments.Count -eq 0) {
        return ''
    }

    $quoted = @()
    foreach ($arg in $Arguments) {
        $quoted += ConvertTo-BashSingleQuoted -Value $arg
    }

    return ($quoted -join ' ')
}

function Convert-WindowsPathToWsl {
    param(
        [Parameter(Mandatory = $true)][string]$WslCommand,
        [Parameter(Mandatory = $true)][string]$Distro,
        [Parameter(Mandatory = $true)][string]$WindowsPath
    )

    $normalizedWindowsPath = $WindowsPath -replace '\\', '/'
    $converted = & $WslCommand -d $Distro -- wslpath -a $normalizedWindowsPath 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $converted) {
        throw "Failed to convert Windows path to WSL path: $WindowsPath"
    }

    return (Strip-NullChars -Text ($converted | Select-Object -First 1)).Trim()
}

function Get-NodeInstallationFromWinget {
    $packagesRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    if (-not (Test-Path -LiteralPath $packagesRoot)) {
        return $null
    }

    $candidate = Get-ChildItem -Path $packagesRoot -Directory -Filter 'OpenJS.NodeJS.LTS*' -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $candidate) {
        return $null
    }

    $nodeExe = Get-ChildItem -Path $candidate.FullName -Recurse -File -Filter 'node.exe' -ErrorAction SilentlyContinue | Where-Object {
        $_.FullName -like '*node-v*-win-x64*'
    } | Select-Object -First 1

    if (-not $nodeExe) {
        return $null
    }

    return $nodeExe.FullName
}

function Get-NodeExecutable {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node -and $node.Source) {
        return $node.Source
    }

    return Get-NodeInstallationFromWinget
}

function Get-GitCommand {
    if ($env:CODEX_HUD_GIT) {
        $configured = Resolve-NormalizedPath -Path $env:CODEX_HUD_GIT
        if (Test-Path -LiteralPath $configured) {
            return [pscustomobject]@{ Source = $configured }
        }
    }

    $git = Get-Command git -ErrorAction SilentlyContinue
    if ($git -and $git.Source) {
        return [pscustomobject]@{ Source = (Resolve-NormalizedPath -Path $git.Source) }
    }

    $gitExe = Get-Command git.exe -ErrorAction SilentlyContinue
    if ($gitExe -and $gitExe.Source) {
        return [pscustomobject]@{ Source = (Resolve-NormalizedPath -Path $gitExe.Source) }
    }

    $preferredPaths = @(
        'C:\Program Files\Git\cmd\git.exe',
        'C:\Program Files\Git\bin\git.exe'
    )

    foreach ($candidate in $preferredPaths) {
        if (Test-Path -LiteralPath $candidate) {
            return [pscustomobject]@{ Source = (Resolve-NormalizedPath -Path $candidate) }
        }
    }

    return $null
}

function Get-NpmCliPath {
    param([Parameter(Mandatory = $true)][string]$NodeExecutable)

    $nodeRoot = Split-Path -Parent $NodeExecutable
    $npmCli = Join-Path $nodeRoot 'node_modules\npm\bin\npm-cli.js'
    if (Test-Path -LiteralPath $npmCli) {
        return $npmCli
    }

    throw "npm-cli.js not found under Node root: $nodeRoot"
}

function Invoke-NpmCli {
    param(
        [Parameter(Mandatory = $true)][string]$NodeExecutable,
        [Parameter(Mandatory = $true)][string[]]$NpmArguments,
        [string]$WorkingDirectory
    )

    $npmCli = Get-NpmCliPath -NodeExecutable $NodeExecutable

    if ($WorkingDirectory) {
        Push-Location $WorkingDirectory
        try {
            # Stream npm output to the host and return only numeric exit code.
            & $NodeExecutable $npmCli @NpmArguments | Out-Host
            return $LASTEXITCODE
        } finally {
            Pop-Location
        }
    }

    & $NodeExecutable $npmCli @NpmArguments | Out-Host
    return $LASTEXITCODE
}

function Get-NpmGlobalPrefix {
    param([Parameter(Mandatory = $true)][string]$NodeExecutable)

    $npmCli = Get-NpmCliPath -NodeExecutable $NodeExecutable
    $prefix = & $NodeExecutable $npmCli config get prefix
    if ($LASTEXITCODE -ne 0 -or -not $prefix) {
        throw 'Failed to query npm global prefix.'
    }

    return (Strip-NullChars -Text ($prefix | Select-Object -First 1)).Trim()
}

function Ensure-UserPathStartsWith {
    param([Parameter(Mandatory = $true)][string]$PathEntry)

    $normalizedEntry = $PathEntry.TrimEnd('\')
    $currentUserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $currentUserPath) {
        [Environment]::SetEnvironmentVariable('Path', $normalizedEntry, 'User')
        return
    }

    $parts = @($currentUserPath -split ';' | Where-Object { $_ })
    $hasEntry = $false
    foreach ($item in $parts) {
        if ($item.TrimEnd('\\').Equals($normalizedEntry, [System.StringComparison]::OrdinalIgnoreCase)) {
            $hasEntry = $true
            break
        }
    }

    if (-not $hasEntry) {
        $newPath = "$normalizedEntry;$currentUserPath"
        [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    }
}

function Get-ProfilePath {
    if ($env:CODEX_HUD_PROFILE_PATH) {
        return Resolve-NormalizedPath -Path $env:CODEX_HUD_PROFILE_PATH
    }

    return $PROFILE.CurrentUserAllHosts
}

function Ensure-ProfileFile {
    param([Parameter(Mandatory = $true)][string]$ProfilePath)

    $profileDir = Split-Path -Parent $ProfilePath
    if (-not (Test-Path -LiteralPath $profileDir)) {
        New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
    }

    if (-not (Test-Path -LiteralPath $ProfilePath)) {
        New-Item -ItemType File -Path $ProfilePath -Force | Out-Null
    }
}

function Set-ManagedProfileBlock {
    param(
        [Parameter(Mandatory = $true)][string]$ProfilePath,
        [Parameter(Mandatory = $true)][string]$BlockBody
    )

    Ensure-ProfileFile -ProfilePath $ProfilePath
    $markers = Get-ManagedProfileMarkers

    $content = Get-Content -Path $ProfilePath -Raw -ErrorAction SilentlyContinue
    if (-not $content) {
        $content = ''
    }

    $startEscaped = [regex]::Escape($markers.Start)
    $endEscaped = [regex]::Escape($markers.End)
    $pattern = "(?ms)^$startEscaped.*?^$endEscaped\r?\n?"
    $clean = [regex]::Replace($content, $pattern, '')
    $clean = $clean.TrimEnd("`r", "`n")

    $block = @($markers.Start, $BlockBody.TrimEnd(), $markers.End) -join "`r`n"

    $newContent = if ([string]::IsNullOrWhiteSpace($clean)) {
        "$block`r`n"
    } else {
        "$clean`r`n`r`n$block`r`n"
    }

    Set-Content -Path $ProfilePath -Value $newContent -Encoding utf8 -NoNewline
}

function Remove-ManagedProfileBlock {
    param([Parameter(Mandatory = $true)][string]$ProfilePath)

    if (-not (Test-Path -LiteralPath $ProfilePath)) {
        return
    }

    $markers = Get-ManagedProfileMarkers
    $content = Get-Content -Path $ProfilePath -Raw -ErrorAction SilentlyContinue
    if (-not $content) {
        return
    }

    $startEscaped = [regex]::Escape($markers.Start)
    $endEscaped = [regex]::Escape($markers.End)
    $pattern = "(?ms)^$startEscaped.*?^$endEscaped\r?\n?"
    $clean = [regex]::Replace($content, $pattern, '')
    $clean = $clean.TrimEnd("`r", "`n")

    if ($clean.Length -gt 0) {
        $clean += "`r`n"
    }

    Set-Content -Path $ProfilePath -Value $clean -Encoding utf8 -NoNewline
}

function Get-RealCodexCommand {
    param(
        [string]$RepoRoot,
        [string[]]$ExcludedPaths = @()
    )

    if ($env:CODEX_HUD_REAL_CODEX) {
        $configured = Resolve-NormalizedPath -Path $env:CODEX_HUD_REAL_CODEX
        if (Test-Path -LiteralPath $configured) {
            return [pscustomobject]@{ Source = $configured }
        }
    }

    if ($env:CODEX_HUD_TEST_REAL_CODEX) {
        $testPath = Resolve-NormalizedPath -Path $env:CODEX_HUD_TEST_REAL_CODEX
        if (Test-Path -LiteralPath $testPath) {
            return [pscustomobject]@{ Source = $testPath }
        }
    }

    $excludeSet = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($item in $ExcludedPaths) {
        if (-not [string]::IsNullOrWhiteSpace($item)) {
            [void]$excludeSet.Add((Resolve-NormalizedPath -Path $item))
        }
    }

    $normalizedRoot = if ($RepoRoot) { Resolve-NormalizedPath -Path $RepoRoot } else { $null }

    $commands = @(Get-Command codex -All -ErrorAction SilentlyContinue)
    foreach ($command in $commands) {
        if ($command.CommandType -ne 'Application' -and $command.CommandType -ne 'ExternalScript') {
            continue
        }

        if (-not $command.Source) {
            continue
        }

        $source = Resolve-NormalizedPath -Path $command.Source
        if ($excludeSet.Contains($source)) {
            continue
        }

        if ($normalizedRoot -and $source.StartsWith($normalizedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            continue
        }

        return $command
    }

    return $null
}
