param(
  [switch]$SkipBuild,
  [switch]$NoLaunch,
  [switch]$Bundle
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$appExe = Join-Path $repoRoot "src-tauri\target\debug\rust-diffforge.exe"
$scheme = "diffforge"
$schemeRegistryPath = "HKCU:\Software\Classes\$scheme"
$commandRegistryPath = Join-Path $schemeRegistryPath "shell\open\command"

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
  }
}

function Get-DefaultRegistryValue {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }

  return (Get-Item -LiteralPath $Path).GetValue("")
}

function Test-CommandReferencesExe {
  param(
    [AllowNull()][string]$Command,
    [Parameter(Mandatory = $true)][string]$ExePath
  )

  if ([string]::IsNullOrWhiteSpace($Command)) {
    return $false
  }

  $normalizedCommand = $Command.Replace("\\?\", "")
  $normalizedExe = (Resolve-Path -LiteralPath $ExePath).Path.Replace("\\?\", "")

  return $normalizedCommand.IndexOf($normalizedExe, [StringComparison]::OrdinalIgnoreCase) -ge 0
}

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
  throw "This launcher is only for Windows."
}

Push-Location $repoRoot
try {
  if (-not $SkipBuild) {
    $npx = Get-Command npx.cmd -ErrorAction SilentlyContinue
    if (-not $npx) {
      $npx = Get-Command npx -ErrorAction SilentlyContinue
    }
    if (-not $npx) {
      throw "npx is required to build the Tauri app."
    }

    if ($Bundle) {
      Invoke-CheckedCommand $npx.Source tauri build --debug --bundles nsis
    } else {
      Invoke-CheckedCommand $npx.Source tauri build --debug --no-bundle
    }
  }
} finally {
  Pop-Location
}

if (-not (Test-Path -LiteralPath $appExe)) {
  throw "Missing debug app executable: $appExe"
}

if ($NoLaunch) {
  Write-Host "Built $appExe"
  Write-Host "Skipped launch and registry verification."
  exit 0
}

$process = Start-Process -FilePath $appExe -WorkingDirectory $repoRoot -PassThru
$registeredCommand = $null
$deadline = (Get-Date).AddSeconds(20)

do {
  Start-Sleep -Milliseconds 500
  $registeredCommand = Get-DefaultRegistryValue $commandRegistryPath
} while (
  -not (Test-CommandReferencesExe $registeredCommand $appExe) -and
  (Get-Date) -lt $deadline
)

if (-not (Test-Path -LiteralPath $schemeRegistryPath)) {
  throw "Diff Forge AI launched, but HKCU:\Software\Classes\$scheme was not created."
}

$urlProtocol = (Get-Item -LiteralPath $schemeRegistryPath).GetValue("URL Protocol")
if ($null -eq $urlProtocol) {
  throw "Diff Forge AI launched, but the $scheme registry key is missing the URL Protocol marker."
}

if (-not (Test-CommandReferencesExe $registeredCommand $appExe)) {
  throw @"
Diff Forge AI launched, but ${scheme}:// is not registered to the debug executable.
Current registry command: $registeredCommand
Expected executable: $appExe

Close any other running Diff Forge AI app and retry this script.
"@
}

Write-Host "Launched $appExe"
Write-Host "Process ID: $($process.Id)"
Write-Host "Registered ${scheme}:// command: $registeredCommand"
Write-Host "Windows should now route diffforge:// URLs to this debug build."
