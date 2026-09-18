$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $Root 'backend'
$PidFile = Join-Path $Root 'data\equal_ask.pid'
$Port = 3000

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host '未找到 node，请先安装 Node.js'
    exit 1
}

if (-not (Test-Path (Join-Path $Backend 'server.js'))) {
    Write-Host '未找到 backend\server.js'
    exit 1
}

New-Item -ItemType Directory -Force -Path (Join-Path $Root 'data') | Out-Null

function Get-SavedProcess {
    if (-not (Test-Path $PidFile)) {
        return $null
    }
    $raw = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if (-not $raw) {
        return $null
    }
    $procId = 0
    if (-not [int]::TryParse($raw.Trim(), [ref]$procId)) {
        return $null
    }
    return Get-Process -Id $procId -ErrorAction SilentlyContinue
}

$existing = Get-SavedProcess
if ($existing) {
    Write-Host "Equal Ask 已在运行 (PID $($existing.Id))  http://localhost:$Port"
    exit 0
}

$listenPid = $null
try {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
    if ($listener) {
        $listenPid = $listener.OwningProcess
    }
} catch {
    $netstat = netstat -ano | Select-String -Pattern ":$Port\s+.*LISTENING"
    if ($netstat) {
        $listenPid = ($netstat.ToString().Trim() -split '\s+')[-1]
    }
}

if ($listenPid) {
    Write-Host "端口 $Port 已被占用 (PID $listenPid)"
    exit 1
}

$node = (Get-Command node).Source
$created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = "`"$node`" `"$(Join-Path $Backend 'server.js')`""
    CurrentDirectory = $Backend
}

if ($created.ReturnValue -ne 0 -or -not $created.ProcessId) {
    Write-Host "启动失败 (Win32_Process.Create 返回 $($created.ReturnValue))"
    exit 1
}

$procId = [int]$created.ProcessId
Set-Content -Path $PidFile -Value $procId -Encoding ascii
Start-Sleep -Milliseconds 600

if (-not (Get-Process -Id $procId -ErrorAction SilentlyContinue)) {
    Write-Host '启动失败，进程已退出'
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    exit 1
}

Write-Host "Equal Ask 已启动 (PID $procId)"
Write-Host "http://localhost:$Port"
