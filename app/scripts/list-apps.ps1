# Lists every app installed on this Windows laptop, in a format MAX can read.
#
# Run it from PowerShell (no admin needed):
#   powershell -ExecutionPolicy Bypass -File scripts\list-apps.ps1
#
# It writes max-apps.txt to your Desktop and opens it. Send that file over and the
# app table in MAX gets rebuilt to exactly match this machine.

$ErrorActionPreference = "SilentlyContinue"
$out = Join-Path ([Environment]::GetFolderPath("Desktop")) "max-apps.txt"

function Section($title) {
  "" | Out-File -FilePath $out -Append -Encoding utf8
  "== $title ==" | Out-File -FilePath $out -Append -Encoding utf8
}

"# MAX app scan" | Out-File -FilePath $out -Encoding utf8
"# Computer: $env:COMPUTERNAME · User: $env:USERNAME · Windows: $([Environment]::OSVersion.Version)" |
  Out-File -FilePath $out -Append -Encoding utf8

# 1. Everything in the Start menu, desktop apps and Microsoft Store apps alike.
Section "START MENU (name | AppID)"
Get-StartApps |
  Sort-Object Name |
  ForEach-Object { "$($_.Name) | $($_.AppID)" } |
  Out-File -FilePath $out -Append -Encoding utf8

# 2. Classic installs, straight from the uninstall registry.
Section "INSTALLED PROGRAMS (name | version | location)"
$keys = @(
  "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
  "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
  "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
)
Get-ItemProperty $keys |
  Where-Object { $_.DisplayName } |
  Select-Object -Unique DisplayName, DisplayVersion, InstallLocation |
  Sort-Object DisplayName |
  ForEach-Object { "$($_.DisplayName) | $($_.DisplayVersion) | $($_.InstallLocation)" } |
  Out-File -FilePath $out -Append -Encoding utf8

# 3. App Paths — how Office, Chrome, Edge and VS Code register their .exe.
Section "APP PATHS (exe | full path)"
$appPathRoots = @(
  "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths",
  "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths",
  "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths"
)
Get-ChildItem $appPathRoots |
  Sort-Object PSChildName -Unique |
  ForEach-Object { "$($_.PSChildName) | $((Get-ItemProperty $_.PSPath).'(default)')" } |
  Out-File -FilePath $out -Append -Encoding utf8

# 4. Browsers and editors, resolved the same way MAX resolves them.
Section "KNOWN EXECUTABLES"
$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe",
  "$env:ProgramFiles\Microsoft VS Code\Code.exe",
  "$env:LOCALAPPDATA\Kingsoft\WPS Office",
  "$env:LOCALAPPDATA\WhatsApp\WhatsApp.exe"
)
foreach ($candidate in $candidates) {
  $matches = Get-ChildItem -Path $candidate -ErrorAction SilentlyContinue
  if ($matches) {
    foreach ($match in $matches) { "$($match.FullName) | FOUND" | Out-File -FilePath $out -Append -Encoding utf8 }
  } else {
    "$candidate | missing" | Out-File -FilePath $out -Append -Encoding utf8
  }
}

# 5. Default handler for the two things MAX opens by protocol.
Section "DEFAULT BROWSER"
$progId = (Get-ItemProperty "HKCU:\SOFTWARE\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice").ProgId
"https -> $progId" | Out-File -FilePath $out -Append -Encoding utf8

Write-Host ""
Write-Host "Saved: $out" -ForegroundColor Green
Write-Host "Open it, then send the file over so MAX can match this laptop exactly." -ForegroundColor Cyan
Start-Process notepad.exe $out
