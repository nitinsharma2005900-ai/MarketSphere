$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
node scripts/setup-local.mjs
if (-not (Test-Path -LiteralPath 'node_modules')) { npm install }
$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
if ($dockerCommand) { docker compose up -d postgres redis mailpit minio } else { wsl --cd $projectRoot -e docker compose up -d postgres redis mailpit minio }
npm run db:generate
npm run db:migrate
uv sync --directory services/python-service --locked
$logDirectory = Join-Path $projectRoot '.runtime'
$pythonCommand = (Get-Command uv).Source
$pythonProcess = Start-Process -FilePath $pythonCommand -ArgumentList @('run','--directory','services/python-service','--env-file','../../.env','uvicorn','main:app','--host','0.0.0.0','--port','8040') -WorkingDirectory $projectRoot -RedirectStandardOutput (Join-Path $logDirectory 'python.out.log') -RedirectStandardError (Join-Path $logDirectory 'python.err.log') -WindowStyle Hidden -PassThru
for ($attempt=0; $attempt -lt 30; $attempt++) { try { Invoke-RestMethod 'http://localhost:8040/health' | Out-Null; break } catch { Start-Sleep -Seconds 1 } }
npm run db:seed
$nodeCommand = (Get-Command node).Source
$services = @(@{name='api';args=@('node_modules/tsx/dist/cli.mjs','apps/backend/src/server.ts')},@{name='worker';args=@('node_modules/tsx/dist/cli.mjs','apps/backend/src/worker.ts')},@{name='web';args=@('node_modules/next/dist/bin/next','dev','apps/frontend','-p','3040')})
$processes = @($pythonProcess.Id)
foreach ($service in $services) { $process = Start-Process -FilePath $nodeCommand -ArgumentList $service.args -WorkingDirectory $projectRoot -RedirectStandardOutput (Join-Path $logDirectory ($service.name+'.out.log')) -RedirectStandardError (Join-Path $logDirectory ($service.name+'.err.log')) -WindowStyle Hidden -PassThru; $processes += $process.Id }
$processes | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $logDirectory 'owned-processes.json')
node scripts/wait-services.mjs
Write-Host 'MarketSphere: http://localhost:3040 | Swagger: http://localhost:4040/api-docs'
