# Start the server hidden (if it is not running) and open it as a chromeless app window (Chrome/Edge --app).
$dir = Split-Path $PSScriptRoot -Parent
$port = 3020
try { $cfg = Get-Content (Join-Path $dir 'hud.config.json') -Raw | ConvertFrom-Json; if ($cfg.port) { $port = $cfg.port } } catch {}
$url = "http://127.0.0.1:$port"
function Test-Hud { try { (Invoke-WebRequest "$url/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { $false } }
if (-not (Test-Hud)) {
  New-Item -ItemType Directory -Force (Join-Path $dir 'logs') | Out-Null
  Start-Process -FilePath 'node' -ArgumentList 'server.mjs' -WorkingDirectory $dir -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $dir 'logs\hud.log') -RedirectStandardError (Join-Path $dir 'logs\hud.err.log')
  for ($i = 0; $i -lt 20 -and -not (Test-Hud); $i++) { Start-Sleep -Milliseconds 500 }
}
$browsers = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe")
$exe = $browsers | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($exe) { Start-Process -FilePath $exe -ArgumentList "--app=$url", '--start-maximized' } else { Start-Process $url }
