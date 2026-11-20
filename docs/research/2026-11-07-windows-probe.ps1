# What a Windows computer offers Banda (ADR 0090, plan step 0).
# Read-only: it changes nothing, asks for no admin rights, never runs
# wsl.exe (a stub that installs WSL), and starts no program that opens a
# window (it never runs a `claude` from WindowsApps,
# which is Claude Desktop's and opens it).
# Run in PowerShell:
#   powershell -ExecutionPolicy Bypass -File 2026-11-07-windows-probe.ps1
# Then paste everything it printed.
$ErrorActionPreference = "SilentlyContinue"

function Show($name, $value) { "{0,-36} {1}" -f $name, $value }
function Reg($path, $name) { (Get-ItemProperty -Path $path -Name $name).$name }

"--- Windows"
$os = Get-CimInstance Win32_OperatingSystem
$cv = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion"
$build = [int]$os.BuildNumber
$ubr = [int](Reg $cv "UBR")
Show "Windows" "$($os.Caption) $(Reg $cv 'DisplayVersion') build $build.$ubr"
Show "Edition" (Reg $cv "EditionID")
Show "64-bit OS" ([Environment]::Is64BitOperatingSystem)
Show "CPU arch" $env:PROCESSOR_ARCHITECTURE
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
Show "CPU" $cpu.Name
Show "RAM (GB)" ([math]::Round($os.TotalVisibleMemorySize / 1MB, 1))
Show "Virtualization in firmware" $cpu.VirtualizationFirmwareEnabled
Show "A hypervisor runs (WSL2, Hyper-V)" (Get-CimInstance Win32_ComputerSystem).HypervisorPresent

"`n--- What each part needs (True = this computer has it)"
Show "Electron 45: Windows 10+" ($build -ge 10240)
Show "ConPTY, Claude Code: 1809 (17763)" ($build -ge 17763)
Show "wsl --install: 2004 (19041)" ($build -ge 19041)
Show "Mica/acrylic: 11 22H2 (22621)" ($build -ge 22621)
$mxc = ($build -eq 26100 -and $ubr -ge 9278) -or ($build -eq 26200 -and $ubr -ge 9278) -or ($build -gt 26200)
Show "MXC: 26100.9278+ or 26200.9278+" $mxc

"`n--- The disk"
$system = Get-PSDrive -Name ($env:SystemDrive.TrimEnd(":"))
Show "Free on $($env:SystemDrive) (GB)" ([math]::Round($system.Free / 1GB, 1))
Get-PhysicalDisk | ForEach-Object { Show "Disk" "$($_.FriendlyName): $($_.MediaType), $($_.BusType), $([math]::Round($_.Size / 1GB)) GB" }
Get-Volume | Where-Object { $_.DriveLetter } | ForEach-Object {
  Show "Volume $($_.DriveLetter):" "$($_.FileSystemType) (ReFS may be a Dev Drive)"
}

"`n--- The account"
Show "User profile" $env:USERPROFILE
Show "User name has a space" ($env:USERNAME -match " ")
Show "Profile path has non-ASCII" ($env:USERPROFILE -match "[^\x00-\x7F]")
$groups = (whoami /groups) -join "`n"
Show "In Administrators (S-1-5-32-544)" ($groups -match "S-1-5-32-544")
Show "In docker-users" ($groups -match "docker-users")
$uac = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"
Show "UAC on (EnableLUA)" (Reg $uac "EnableLUA")
Show "UAC admin prompt (5 = default)" (Reg $uac "ConsentPromptBehaviorAdmin")
$cs = Get-CimInstance Win32_ComputerSystem
Show "Joined to a domain" $cs.PartOfDomain
$dsreg = (dsregcmd /status) -join "`n"
Show "Entra ID joined" ($dsreg -match "AzureAdJoined\s*:\s*YES")
Show "Managed by MDM" ($dsreg -match "MdmUrl\s*:\s*\S+")

"`n--- What may stop an unsigned program"
$sac = Reg "HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy" "VerifiedAndReputablePolicyState"
$sacName = switch ($sac) { 0 { "off" } 1 { "ON: unsigned programs are blocked" } 2 { "evaluation" } default { "unknown ($sac)" } }
Show "Smart App Control" $sacName
$mp = Get-MpComputerStatus
Show "Defender real-time protection" $mp.RealTimeProtectionEnabled
Show "Developer Mode (links)" ((Reg "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock" "AllowDevelopmentWithoutDevLicense") -eq 1)
Show "Long paths enabled" ((Reg "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" "LongPathsEnabled") -eq 1)

"`n--- The look and the keys"
$personalize = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"
Show "Transparency effects" ((Reg $personalize "EnableTransparency") -eq 1)
Show "Apps in light mode" ((Reg $personalize "AppsUseLightTheme") -eq 1)
$dpi = Reg "HKCU:\Control Panel\Desktop\WindowMetrics" "AppliedDPI"
if ($dpi) { Show "Display scale" ("{0}%" -f [math]::Round($dpi / 96 * 100)) }
$layouts = (Get-WinUserLanguageList | ForEach-Object { "$($_.LanguageTag) [$($_.InputMethodTips -join ',')]" }) -join " ; "
Show "Keyboard layouts" $layouts
$hotkey = Reg "HKCU:\Keyboard Layout\Toggle" "Language Hotkey"
$hotkeyName = switch ($hotkey) { "1" { "Left Alt+Shift" } "2" { "Ctrl+Shift" } "3" { "none" } "4" { "the grave accent" } default { "default ($hotkey)" } }
Show "Switch layout with" $hotkeyName
Show "PowerToys running (Alt+Space)" ([bool](Get-Process PowerToys* | Select-Object -First 1))

"`n--- WSL"
# Never run wsl.exe here. On Windows 11 the one in System32 is a stub:
# any command, even `wsl --version`, downloads and installs WSL and turns
# on VirtualMachinePlatform (this probe did that once, on 2026-11-07).
# The WSL that is installed lives in Program Files; its distros are in
# the registry.
Show "WSL installed" (Test-Path "$env:ProgramFiles\WSL\wsl.exe")
$distros = Get-ChildItem "HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss" |
  ForEach-Object { (Get-ItemProperty $_.PSPath).DistributionName } | Where-Object { $_ }
Show "WSL distros" ($distros -join ", ")

"`n--- Programs on PATH (found, not run)"
foreach ($p in "claude", "codex", "node", "npx", "git", "bash", "pwsh", "powershell", "winget", "code") {
  $found = Get-Command $p -All | ForEach-Object { $_.Source }
  Show $p (($found | Select-Object -Unique) -join " ; ")
}

"`n--- Where the vendors' installers put the CLIs"
$claudeHere = "$env:USERPROFILE\.local\bin\claude.exe"
$codexHere = "$env:LOCALAPPDATA\Programs\OpenAI\Codex\bin\codex.exe"
$places = @(
  $claudeHere,
  $codexHere,
  "$env:APPDATA\npm\claude.cmd",
  "$env:APPDATA\npm\codex.cmd",
  "$env:LOCALAPPDATA\Microsoft\WinGet\Links\claude.exe",
  "$env:LOCALAPPDATA\Microsoft\WindowsApps\claude.exe",
  "C:\Program Files\Git\bin\bash.exe"
)
foreach ($f in $places) { Show (Split-Path $f -Leaf) ("{0}  {1}" -f (Test-Path $f), $f) }

"`n--- Versions"
# A program from WindowsApps is never run: Claude Desktop's `Claude.exe`
# opens the app instead of printing a version.
function Runnable($name, $first) {
  if ($first -and (Test-Path $first)) { return $first }
  Get-Command $name -All | ForEach-Object { $_.Source } |
    Where-Object { $_ -and $_ -notmatch "\\WindowsApps\\" } | Select-Object -First 1
}
foreach ($p in @(@("claude", $claudeHere), @("codex", $codexHere), @("node", $null), @("git", $null), @("pwsh", $null))) {
  $program = Runnable $p[0] $p[1]
  if ($program) { Show $p[0] ((& $program --version 2>&1 | Select-Object -First 1) -join " ") }
  else { Show $p[0] "none outside WindowsApps" }
}

"`n--- Codex's own sandbox (config.toml, [windows])"
$codexConfig = "$env:USERPROFILE\.codex\config.toml"
if (Test-Path $codexConfig) {
  $lines = Get-Content $codexConfig | Where-Object { $_ -match "^\s*(\[windows\]|sandbox\s*=)" }
  if ($lines) { $lines } else { "no [windows] sandbox line" }
} else { "no $codexConfig" }

"`n--- Git's line ends (Projects check out with these)"
if (Get-Command git) {
  Show "core.autocrlf, system" (& git config --system --get core.autocrlf)
  Show "core.autocrlf, global" (& git config --global --get core.autocrlf)
  Show "core.longpaths, system" (& git config --system --get core.longpaths)
}

"`n--- User PATH in the registry (what a newly started engine would see)"
[Environment]::GetEnvironmentVariable("Path", "User") -split ";" | Where-Object { $_ }
