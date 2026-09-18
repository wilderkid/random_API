$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PidFile = Join-Path $Root 'data\equal_ask.pid'
$Port = 3000
$serverMarker = [regex]::Escape((Join-Path $Root 'backend\server.js'))

$procIds = New-Object 'System.Collections.Generic.List[int]'

if (Test-Path $PidFile) {
    $raw = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    $savedId = 0
    if ($raw -and [int]::TryParse($raw.Trim(), [ref]$savedId)) {
        if (Get-Process -Id $savedId -ErrorAction SilentlyContinue) {
            $procIds.Add($savedId) | Out-Null
        }
    }
}

if ($procIds.Count -eq 0) {
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -match $serverMarker } |
        ForEach-Object { $procIds.Add([int]$_.ProcessId) | Out-Null }
}

if ($procIds.Count -eq 0) {
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object {
            $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
            if ($proc -and $proc.ProcessName -eq 'node') {
                $procIds.Add([int]$proc.Id) | Out-Null
            }
        }
}

$uniqueIds = $procIds | Select-Object -Unique
if (-not $uniqueIds) {
    Write-Host 'Equal Ask 未在运行'
    if (Test-Path $PidFile) {
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    }
    exit 0
}

foreach ($procId in $uniqueIds) {
    Write-Host "正在停止 Equal Ask (PID $procId)"
    try {
        Stop-Process -Id $procId -ErrorAction Stop
    } catch {
        Write-Host "结束进程失败: $($_.Exception.Message)"
    }
}

for ($i = 0; $i -lt 10; $i++) {
    $alive = $uniqueIds | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }
    if (-not $alive) {
        break
    }
    Start-Sleep -Milliseconds 300
}

foreach ($procId in $uniqueIds) {
    if (Get-Process -Id $procId -ErrorAction SilentlyContinue) {
        Write-Host "进程未退出，强制结束 PID $procId"
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
}

if (Test-Path $PidFile) {
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

Write-Host 'Equal Ask 已停止'
Write-Host "端口 $Port 已释放"
