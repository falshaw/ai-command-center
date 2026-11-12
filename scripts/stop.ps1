# Stop the server (and the terminal session inside it).
$dir = Split-Path $PSScriptRoot -Parent
$port = 3020
try { $cfg = Get-Content (Join-Path $dir 'hud.config.json') -Raw | ConvertFrom-Json; if ($cfg.port) { $port = $cfg.port } } catch {}
$conn = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($conn) { Stop-Process -Id $conn.OwningProcess -Force; 'Stopped.' } else { 'Not running.' }
