#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Sets up Battlefish to run on this PC: opens the firewall port, registers a
    scheduled task that starts the server at boot and restarts it if it stops,
    and registers a second task that restarts it every night so code changes
    are picked up even if the server's own code watcher misses them.

.DESCRIPTION
    Run this on the game server from an elevated PowerShell, from the server's
    local copy of the game folder (not through a \\server\share network path):

        powershell -ExecutionPolicy Bypass -File .\setup\install-windows.ps1

    The port, listening address (host) and public_url come from site.json, with
    the server's defaults when it has none (8765, every address, the computer's
    name). -Port overrides the port for the firewall rule and the address check
    only, so keep the two the same. When host is 127.0.0.1 or localhost, only
    this computer (or a reverse proxy on it) can reach the game, so no firewall
    port is opened. -RestartAt changes the nightly restart time (default
    3:00 AM), and -Uninstall removes the tasks and any Battlefish firewall rule
    (game data is kept).
#>
param(
    [int]$Port = 0,
    [string]$RestartAt = '3:00AM',
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$TaskName = 'Battlefish'
$RestartTaskName = 'Battlefish nightly restart'
$Root = Split-Path -Parent $PSScriptRoot
$Server = Join-Path $Root 'server.py'
$Site = Join-Path $Root 'site.json'

# Reads site.json the way server.py does, and works out the addresses this script needs.
function Get-SiteSettings([string]$SitePath, [int]$PortOverride) {
    $s = $null
    if (Test-Path $SitePath) { $s = Get-Content $SitePath -Raw | ConvertFrom-Json }
    $port = 8765
    $listen = '0.0.0.0'
    $publicUrl = ''
    if ($s) {
        if ($s.port) { $port = [int]$s.port }
        if ($s.host) { $listen = "$($s.host)".Trim() }
        if ($s.public_url) { $publicUrl = "$($s.public_url)".Trim().TrimEnd('/') }
    }
    if ($PortOverride) { $port = $PortOverride }
    $localOnly = @('127.0.0.1', 'localhost', '::1') -contains $listen.ToLower()
    # The readiness check runs on this computer: an all-addresses or loopback server answers on
    # localhost, but one bound to a specific address answers only there.
    $checkHost = 'localhost'
    if (-not $localOnly -and @('0.0.0.0', '::', '') -notcontains $listen) {
        $checkHost = $listen
        if ($checkHost.Contains(':')) { $checkHost = "[$checkHost]" }
    }
    # The addresses to print: public_url when there is one (it's what players type, and it's right
    # behind a reverse proxy), otherwise localhost for a this-computer-only install, or the computer's name.
    $baseUrl = $publicUrl
    if (-not $baseUrl) {
        if ($localOnly) { $baseUrl = "http://localhost:$port" }
        else { $baseUrl = "http://$($env:COMPUTERNAME):$port" }
    }
    [pscustomobject]@{
        Port      = $port
        Host      = $listen
        LocalOnly = $localOnly
        CheckUrl  = "http://$($checkHost):$port/api/rules"
        BaseUrl   = $baseUrl
    }
}

$cfg = Get-SiteSettings $Site $Port
$Port = $cfg.Port
$RuleName = "Battlefish (TCP $Port)"

if ($Uninstall) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $RestartTaskName -Confirm:$false -ErrorAction SilentlyContinue
    # Every Battlefish rule, whatever port it was made for and whatever site.json says now.
    Get-NetFirewallRule -DisplayName 'Battlefish (TCP *)' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    Write-Host 'Removed the scheduled tasks and firewall rules. The data folder was left alone.'
    return
}

if ($Root.StartsWith('\\')) {
    throw "Run this from the server's local copy of the game folder (for example D:\Battlefish), not from the network path $Root."
}

# Find a Python 3.9+ install. Running it and asking for sys.executable gives the real
# python.exe: on a fresh Windows, "python" in WindowsApps is only a Microsoft Store
# shortcut, which prints nothing here and is skipped. The task runs as SYSTEM, so an
# all-users install is safest; a per-user one (in someone's AppData) works with a warning.
$python = $null
foreach ($cmd in @(@('py', '-3'), @('python'))) {
    if (-not (Get-Command "$($cmd[0]).exe" -ErrorAction SilentlyContinue)) { continue }
    try {
        $cmdArgs = @($cmd | Select-Object -Skip 1) + @('-c', 'import sys; print(sys.executable)')
        $out = & $cmd[0] @cmdArgs 2>$null
        if ($LASTEXITCODE -eq 0 -and $out) { $python = "$out".Trim(); break }
    } catch { }
}
if (-not $python) { throw 'Python 3 was not found. Install it as DEPLOY.md section 3a describes (python.org''s standalone installer, for all users, with "Add python.exe to PATH"), then run this again.' }
if ($python -like '*\WindowsApps\*') {
    throw "Found Python from the Microsoft Store at $python. Store apps can't run as a SYSTEM service; install Python from python.org as DEPLOY.md section 3a describes, then run this again."
}

# Windows PowerShell strips double quotes from native-command arguments, so this check avoids quotes.
$parts = & $python -c 'import sys; print(sys.version_info[0]); print(sys.version_info[1])'
$version = "$($parts[0]).$($parts[1])"
if ([version]$version -lt [version]'3.9') { throw "Found Python $version at $python; Battlefish needs 3.9 or newer." }

# pythonw runs without a console window.
$pythonw = Join-Path (Split-Path $python) 'pythonw.exe'
if (-not (Test-Path $pythonw)) { $pythonw = $python }
Write-Host "Using Python $version at $pythonw"
if ($pythonw -like '*\AppData\*') {
    Write-Warning ("This Python is installed for one user only (for example by the Python Install Manager). " +
        "The game will run, but the task points at that exact path: if the runtime is uninstalled, moved or " +
        "replaced, or that user's profile is removed, the game stops. Run this script again after any change " +
        "to that Python, or install Python for all users (DEPLOY.md section 3a).")
}

# Replace any earlier Battlefish rule, including one for an old port.
Get-NetFirewallRule -DisplayName 'Battlefish (TCP *)' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
if ($cfg.LocalOnly) {
    Write-Host "site.json's host is $($cfg.Host), so only this computer can reach the game. No firewall port was opened."
} else {
    New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow `
        -Profile Domain, Private | Out-Null
    Write-Host "Opened TCP port $Port for the domain and private networks."
}

# No --port: the server takes its address and port from site.json.
$action = New-ScheduledTaskAction -Execute $pythonw -Argument "`"$Server`"" -WorkingDirectory $Root
# The server exits by itself to load new code. The every-minute trigger starts it again whether or not
# Task Scheduler counts that exit as a failure; IgnoreNew means it never starts a second copy.
$triggers = @(
    (New-ScheduledTaskTrigger -AtStartup),
    (New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1))
)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Principal $principal `
    -Settings $settings -Force | Out-Null

# Nightly restart, as a backup for the server's own code watcher.
$restartAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ("-NoProfile -NonInteractive -Command " +
    "`"Stop-ScheduledTask -TaskName '$TaskName'; Start-Sleep -Seconds 5; Start-ScheduledTask -TaskName '$TaskName'`"")
$restartSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName $RestartTaskName -Action $restartAction -Trigger (New-ScheduledTaskTrigger -Daily -At $RestartAt) `
    -Principal $principal -Settings $restartSettings -Force | Out-Null
Write-Host "The server restarts every night at $RestartAt, and on its own within a few minutes of a code change."
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3

try {
    Invoke-WebRequest -UseBasicParsing $cfg.CheckUrl -TimeoutSec 5 | Out-Null
    Write-Host ''
    Write-Host "Battlefish is running."
    Write-Host "  Aquarium: $($cfg.BaseUrl)/"
    Write-Host "  Editor:   $($cfg.BaseUrl)/editor"
    Write-Host "  Admin:    $($cfg.BaseUrl)/admin"
} catch {
    Write-Warning "The task started but the server isn't answering yet. Check $Root\data\server.log."
}
