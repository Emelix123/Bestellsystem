# Installiert den Druck-Agenten des Bestellsystems unter Windows 10/11.
#
# In einer PowerShell "Als Administrator ausfuehren":
#   iwr -UseBasicParsing http://SERVER:8080/downloads/install-agent.ps1 -OutFile $env:TEMP\install-agent.ps1
#   powershell -ExecutionPolicy Bypass -File $env:TEMP\install-agent.ps1 -ServerUrl http://SERVER:8080 -Token TOKEN
#
# Der Agent laeuft danach als geplante Aufgabe unter dem SYSTEM-Konto, startet
# beim Hochfahren automatisch (auch ohne Anmeldung) und verbindet sich selbst
# neu, wenn Netz oder Server kurz weg sind.
# Hinweis: Meldungen bewusst ohne Umlaute, damit sie in jeder Konsole lesbar sind.

param(
  [Parameter(Mandatory = $true)][string]$ServerUrl,
  [Parameter(Mandatory = $true)][string]$Token
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$identity = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Bitte PowerShell mit Rechtsklick -> "Als Administrator ausfuehren" starten.'
}

$ServerUrl = $ServerUrl.TrimEnd('/')
$dir = Join-Path $env:ProgramData 'Bestellsystem-Agent'
$taskName = 'Bestellsystem Druck-Agent'

function Get-NodeMajor {
  try { return [int](& node -p "process.versions.node.split('.')[0]") } catch { return 0 }
}

function Update-PathFromRegistry {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

# --- Node.js ---------------------------------------------------------------
if (-not (Get-Command node -ErrorAction SilentlyContinue) -or (Get-NodeMajor) -lt 18) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host 'Installiere Node.js (LTS) mit winget ...'
    winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements | Out-Host
    Update-PathFromRegistry
  }
}
if (-not (Get-Command node -ErrorAction SilentlyContinue) -or (Get-NodeMajor) -lt 18) {
  throw 'Node.js 18 oder neuer fehlt. Bitte von https://nodejs.org die LTS-Version installieren und dieses Skript erneut ausfuehren.'
}
$node = (Get-Command node).Source
Write-Host "Node.js gefunden: $node ($(& node -v))"

# --- Dateien ---------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$agentFile = Join-Path $dir 'agent.mjs'
$configFile = Join-Path $dir 'agent.json'
$logFile = Join-Path $dir 'agent.log'

# Laufenden Agenten vor dem Aktualisieren stoppen.
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
}

Write-Host "Lade Agent von $ServerUrl ..."
Invoke-WebRequest -UseBasicParsing -Uri "$ServerUrl/downloads/agent.mjs" -OutFile $agentFile

$config = [ordered]@{ serverUrl = $ServerUrl; token = $Token; logFile = $logFile } | ConvertTo-Json
[IO.File]::WriteAllText($configFile, $config, (New-Object Text.UTF8Encoding($false)))
# Token nur fuer SYSTEM und Administratoren lesbar.
icacls $configFile /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null

# --- Dienst (geplante Aufgabe) -------------------------------------------
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$agentFile`" --config `"$configFile`"" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

Write-Host ''
Write-Host 'Gefundene Drucker:'
& $node $agentFile --list
Write-Host ''
Write-Host 'Fertig. Der Agent sollte im Admin-Bereich unter "Drucker" als verbunden erscheinen.'
Write-Host "Protokoll: $logFile"
Write-Host "Testdruck ohne Server: node `"$agentFile`" --test `"<Druckername>`" --width 48"
