# Uses the installed Windows VS Code in a new isolated user-data directory.
# Does not install extensions or change the user's VS Code profile.
param(
  [string]$CodeExe = "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe",
  [string]$ReportDirectory = (Join-Path $PSScriptRoot '..\..\verification'),
  [string]$SourceDirectory = '',
  [switch]$SkipNotebook,
  [switch]$NotebookOnly
)
$ErrorActionPreference = 'Stop'
$harness = (Resolve-Path (Join-Path $PSScriptRoot '..')).ProviderPath
$source = if ($SourceDirectory) { (Resolve-Path $SourceDirectory).ProviderPath } else { $harness }
$ReportDirectory = [System.IO.Path]::GetFullPath($ReportDirectory)
New-Item -ItemType Directory -Force $ReportDirectory | Out-Null
$temp = Join-Path $env:TEMP ('latex-notebook-host-' + [Guid]::NewGuid().ToString('N'))
$extension = Join-Path $temp 'extension'
$extensions = Join-Path $temp 'extensions'
$userData = Join-Path $temp 'user-data'
New-Item -ItemType Directory -Force $extension,$extensions,(Join-Path $userData 'User') | Out-Null
Copy-Item -Path (Join-Path $source '*') -Destination $extension -Recurse -Force
Copy-Item -Path (Join-Path $harness 'test\host-entry.js') -Destination (Join-Path $extension 'test\host-entry.js') -Force
Copy-Item -Path (Join-Path $harness 'test\host-regression.js') -Destination (Join-Path $extension 'test\host-regression.js') -Force
Copy-Item -Path (Join-Path $harness 'test\fixtures-extension') -Destination (Join-Path $extensions 'local-latex.smart-tab-test-fixtures-0.0.0') -Recurse -Force
$settings = @{
  'editor.tabCompletion' = 'onlySnippets'
  'editor.snippetSuggestions' = 'none'
  'editor.acceptSuggestionOnEnter' = 'on'
  'editor.autoClosingBrackets' = 'always'
  'editor.autoClosingQuotes' = 'always'
  'workbench.startupEditor' = 'none'
  'window.restoreWindows' = 'none'
  'security.workspace.trust.enabled' = $false
  'extensions.autoUpdate' = $false
  'extensions.autoCheckUpdates' = $false
}
[System.IO.File]::WriteAllText((Join-Path $userData 'User\settings.json'), ($settings | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Remove-Item Env:VSCODE_IPC_HOOK_CLI -ErrorAction SilentlyContinue
Remove-Item Env:VSCODE_ESM_ENTRYPOINT -ErrorAction SilentlyContinue
Get-ChildItem Env: | Where-Object { $_.Name -like 'VSCODE*' } | ForEach-Object { Remove-Item ('Env:' + $_.Name) -ErrorAction SilentlyContinue }
$localReports = Join-Path $temp 'reports'
New-Item -ItemType Directory -Force $localReports | Out-Null
$env:SMART_TAB_REPORT = Join-Path $localReports 'windows-host-results.json'
$env:SMART_TAB_NOTEBOOK_REPORT = Join-Path $localReports 'windows-notebook-host-results.json'
$env:SMART_TAB_PHYSICAL = '0'
$env:SMART_TAB_SKIP_NOTEBOOK = if ($SkipNotebook) { '1' } else { '0' }
$env:SMART_TAB_NOTEBOOK_ONLY = if ($NotebookOnly) { '1' } else { '0' }
$arguments = @(
  '--new-window', '--verbose', '--log', 'trace', '--disable-gpu', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust',
  '--user-data-dir', ('"' + $userData + '"'), '--extensions-dir', ('"' + $extensions + '"'),
  ('--extensionDevelopmentPath="' + $extension + '"'),
  ('--extensionTestsPath="' + (Join-Path $extension 'test\host-entry.js') + '"')
)
@{ source=$source; isolatedRoot=$temp; executable=$CodeExe; physicalKeys=$false; skipNotebook=[bool]$SkipNotebook; notebookOnly=[bool]$NotebookOnly; launchedAt=(Get-Date).ToString('o') } |
  ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $ReportDirectory 'windows-host-launch.json')
$process = Start-Process -FilePath $CodeExe -ArgumentList $arguments -PassThru `
  -RedirectStandardOutput (Join-Path $ReportDirectory 'windows-host-stdout.log') `
  -RedirectStandardError (Join-Path $ReportDirectory 'windows-host-stderr.log')
$process.Handle | Out-Null
# Give the isolated development window OS foreground focus before command tests.
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class LatexHostWindow {
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int mode);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, int flags);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
 public struct Rect {public int Left;public int Top;public int Right;public int Bottom;}
}
'@
for ($attempt=0; $attempt -lt 100 -and -not $process.HasExited; $attempt++) {
 $process.Refresh()
 if ($process.MainWindowHandle -ne [IntPtr]::Zero) { break }
 Start-Sleep -Milliseconds 100
}
if ($process.MainWindowHandle -ne [IntPtr]::Zero) {
 [LatexHostWindow]::ShowWindow($process.MainWindowHandle, 9) | Out-Null
 [LatexHostWindow]::SetForegroundWindow($process.MainWindowHandle) | Out-Null
 $shell=New-Object -ComObject WScript.Shell
 $activated=$shell.AppActivate($process.Id)
 Start-Sleep -Milliseconds 500
 Add-Type -AssemblyName System.Drawing
 $rectangle=New-Object LatexHostWindow+Rect
 if ([LatexHostWindow]::GetWindowRect($process.MainWindowHandle,[ref]$rectangle)) {
  $bitmap=New-Object System.Drawing.Bitmap ($rectangle.Right-$rectangle.Left),($rectangle.Bottom-$rectangle.Top)
  $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
  $dc=$graphics.GetHdc()
  [LatexHostWindow]::PrintWindow($process.MainWindowHandle,$dc,2) | Out-Null
  $graphics.ReleaseHdc($dc)
  $bitmap.Save((Join-Path $ReportDirectory 'windows-host-window.png'),[System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose();$bitmap.Dispose()
 }
}
$process.WaitForExit()
$process.Refresh()
if ($process.ExitCode -eq 0) {
 Remove-Item (Join-Path $ReportDirectory 'windows-host-fatal.json'),(Join-Path $ReportDirectory 'windows-host-results.json.fatal.json') -Force -ErrorAction SilentlyContinue
}
Copy-Item -Path (Join-Path $localReports '*.json') -Destination $ReportDirectory -Force -ErrorAction SilentlyContinue
if (Test-Path (Join-Path $extension 'host-fatal.json')) { Copy-Item (Join-Path $extension 'host-fatal.json') (Join-Path $ReportDirectory 'windows-host-fatal.json') -Force }
Write-Output ('VS Code exit code: ' + $process.ExitCode)
Write-Output ('Reports: ' + $ReportDirectory)
# Keep isolated logs for diagnosis. Delete isolatedRoot from windows-host-launch.json after review.
exit $process.ExitCode
