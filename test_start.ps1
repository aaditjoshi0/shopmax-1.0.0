$ErrorActionPreference = "Stop"
$logFile = "C:\Users\Bhargav Joshi\Desktop\SHOPMAX\shopmax-1.0.0\server_test.log"
$pidFile = "C:\Users\Bhargav Joshi\Desktop\SHOPMAX\shopmax-1.0.0\server_test.pid"

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "node"
$psi.Arguments = "server.js"
$psi.WorkingDirectory = "C:\Users\Bhargav Joshi\Desktop\SHOPMAX\shopmax-1.0.0"
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true

$p = [System.Diagnostics.Process]::Start($psi)
$p.Id | Out-File -FilePath $pidFile -Force

# Wait for server to be ready or crash
Start-Sleep -Seconds 4

# Check if still running
if (-not $p.HasExited) {
    Write-Output "Server running on PID $($p.Id)"
} else {
    Write-Output "Server exited with code $($p.ExitCode)"
    $stdout = $p.StandardOutput.ReadToEnd()
    $stderr = $p.StandardError.ReadToEnd()
    if ($stdout) { Write-Output "STDOUT: $stdout" }
    if ($stderr) { Write-Output "STDERR: $stderr" }
}
