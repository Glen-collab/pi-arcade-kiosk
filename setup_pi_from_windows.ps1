# Pi Arcade Kiosk — Windows-side one-shot setup script
#
# What this does:
#   1. Confirms the Pi is reachable on the network
#   2. SCPs the project folder to the Pi
#   3. Zips up all .nes files from the F: drive collection (or a folder you specify)
#   4. SCPs the zip and extracts it on the Pi
#   5. Runs install.sh on the Pi
#   6. Starts the kiosk service and prints the URL
#
# Prerequisites:
#   - Windows 10/11 (built-in OpenSSH ssh.exe and scp.exe)
#   - Pi Zero 2 W flashed via Pi Imager with:
#       hostname: pi-arcade
#       username: pi (or pass -PiUser)
#       SSH enabled (password auth)
#       WiFi pre-configured
#   - Pi powered on and on the same network

[CmdletBinding()]
param(
    [string]$PiHost   = "pi-arcade.local",
    [string]$PiUser   = "pi",
    [string]$RomSource = "F:\3538 NES ROMS (every rom ever) with ALL Emulators\Roms\USA",
    [string]$ProjectDir = $PSScriptRoot,
    [switch]$SkipRoms,
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$start = Get-Date

function Write-Step  { param($Msg) Write-Host "`n==> $Msg" -ForegroundColor Cyan }
function Write-OK    { param($Msg) Write-Host "    OK: $Msg" -ForegroundColor Green }
function Write-Warn2 { param($Msg) Write-Host "    !! $Msg" -ForegroundColor Yellow }
function Die         { param($Msg) Write-Host "`nFAILED: $Msg" -ForegroundColor Red; exit 1 }

# 1. Reachability
Write-Step "Looking for the Pi at $PiHost"
$reachable = Test-Connection -ComputerName $PiHost -Count 2 -Quiet -ErrorAction SilentlyContinue
if (-not $reachable) {
    Write-Warn2 "$PiHost did not respond to ping."
    $PiHost = Read-Host "Enter the Pi's IP address (find in your router admin page, e.g. 192.168.1.42)"
    if (-not $PiHost) { Die "No host provided." }
    $reachable = Test-Connection -ComputerName $PiHost -Count 2 -Quiet -ErrorAction SilentlyContinue
    if (-not $reachable) { Die "Still can't reach $PiHost. Is the Pi booted and on WiFi?" }
}
Write-OK "Pi is reachable at $PiHost"

# 2. SSH sanity check
Write-Step "Testing SSH (you'll be prompted for the Pi's password)"
ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 "$PiUser@$PiHost" "echo SSH OK"
if ($LASTEXITCODE -ne 0) { Die "SSH failed. Verify username and password." }
Write-OK "SSH works"

# 3. Copy project folder
Write-Step "Copying pi_arcade_kiosk to ~/pi_arcade_kiosk on the Pi"
ssh "$PiUser@$PiHost" "mkdir -p ~/pi_arcade_kiosk/roms/nes"
if ($LASTEXITCODE -ne 0) { Die "Could not create remote folder." }

# Copy each top-level item to avoid the F: path-with-spaces confusion
$items = @("README.md", "ARCHITECTURE.md", ".gitignore", "backend", "frontend", "launcher", "install", "docs")
foreach ($item in $items) {
    $src = Join-Path $ProjectDir $item
    if (Test-Path $src) {
        scp -r -q $src "${PiUser}@${PiHost}:~/pi_arcade_kiosk/"
        if ($LASTEXITCODE -ne 0) { Die "Copy of $item failed." }
    }
}
Write-OK "Project copied"

# 4. Stage and copy ROMs
if (-not $SkipRoms) {
    Write-Step "Staging ROMs"
    if (-not (Test-Path $RomSource)) {
        Write-Warn2 "ROM source not found: $RomSource"
        Write-Warn2 "Skipping ROM upload. Re-run with -RomSource <path> later."
    } else {
        $romFiles = Get-ChildItem -Path $RomSource -Filter "*.nes" -File
        Write-Host "    Found $($romFiles.Count) .nes files"
        if ($romFiles.Count -eq 0) {
            Write-Warn2 "No .nes files in $RomSource — skipping."
        } else {
            $zipPath = Join-Path $env:TEMP "pi_arcade_nes_roms.zip"
            if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

            Write-Host "    Zipping $($romFiles.Count) ROMs to $zipPath..."
            Compress-Archive -Path "$RomSource\*.nes" -DestinationPath $zipPath -CompressionLevel Fastest
            $zipSize = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
            Write-Host "    Zip size: ${zipSize} MB"

            Write-Step "Uploading ROM zip to Pi (this takes a few minutes over WiFi)"
            scp -q $zipPath "${PiUser}@${PiHost}:~/nes_roms.zip"
            if ($LASTEXITCODE -ne 0) { Die "ROM zip upload failed." }
            Write-OK "ROM zip uploaded"

            Write-Step "Installing unzip and extracting ROMs on Pi"
            ssh -t "$PiUser@$PiHost" "sudo apt-get install -y unzip >/dev/null 2>&1 && unzip -o -q ~/nes_roms.zip -d ~/pi_arcade_kiosk/roms/nes/ && rm ~/nes_roms.zip && ls ~/pi_arcade_kiosk/roms/nes/ | wc -l | xargs echo 'ROMs in place:'"
            if ($LASTEXITCODE -ne 0) { Die "ROM extraction on Pi failed." }
            Write-OK "ROMs extracted"

            Remove-Item $zipPath -Force
        }
    }
} else {
    Write-Warn2 "ROM upload skipped (-SkipRoms)"
}

# 5. Run install.sh
if (-not $SkipInstall) {
    Write-Step "Running install.sh on the Pi (sudo password prompt)"
    ssh -t "$PiUser@$PiHost" "cd ~/pi_arcade_kiosk && chmod +x install/install.sh launcher/launch_game.sh && sudo bash install/install.sh"
    if ($LASTEXITCODE -ne 0) { Die "install.sh failed." }
    Write-OK "Install complete"

    Write-Step "Starting kiosk service"
    ssh -t "$PiUser@$PiHost" "sudo systemctl start pi-arcade && sleep 2 && sudo systemctl is-active pi-arcade"
    if ($LASTEXITCODE -ne 0) { Die "Service failed to start. Run: ssh $PiUser@$PiHost 'sudo journalctl -u pi-arcade -n 50' to debug." }
    Write-OK "Service running"
} else {
    Write-Warn2 "Install skipped (-SkipInstall)"
}

$elapsed = [math]::Round(((Get-Date) - $start).TotalMinutes, 1)
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  DONE in ${elapsed} min." -ForegroundColor Green
Write-Host ""
Write-Host "  Open this in your browser:"
Write-Host "    http://${PiHost}:8088/" -ForegroundColor White
Write-Host ""
Write-Host "  Or from the Pi locally (Chromium):"
Write-Host "    http://localhost:8088/"
Write-Host ""
Write-Host "  To enable auto-start at boot:"
Write-Host "    ssh $PiUser@$PiHost 'sudo systemctl enable pi-arcade'"
Write-Host "============================================" -ForegroundColor Green
