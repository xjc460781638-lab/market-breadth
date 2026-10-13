$ErrorActionPreference='Stop'
$project=Split-Path -Parent $PSScriptRoot
$python=Join-Path $project '.venv\Scripts\python.exe'
$cache=Join-Path $project '.cache\ifind'
New-Item -ItemType Directory -Force -Path $cache | Out-Null
$env:PYTHONUTF8='1'
$env:PYTHONWARNINGS='ignore::DeprecationWarning'
$worker=Start-Process -FilePath $python -ArgumentList @('-u','-m','collector.ifind_worker') -WorkingDirectory $project -WindowStyle Hidden -RedirectStandardOutput (Join-Path $cache 'worker.log') -RedirectStandardError (Join-Path $cache 'worker-error.log') -PassThru
$worker.Id | Set-Content -LiteralPath (Join-Path $cache 'worker.pid')
Write-Output 'iFinD local worker started. Keep this computer awake and connected for website refresh.'
