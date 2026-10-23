# Run in Windows PowerShell 5.1+ / PowerShell 7 from anywhere.
# Runs real Docker/PostgreSQL tests in an ISOLATED, TEMPORARY database.
# Does not truncate or migrate the main startup database.
[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [switch]$SkipIntegration
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $root

function DockerChecked {
    param([string[]]$DockerArgs)
    & docker @DockerArgs
    if ($LASTEXITCODE -ne 0) {
        throw "docker $($DockerArgs -join ' ') failed (exit code $LASTEXITCODE)"
    }
}

try {
    Write-Host '=== Startup Team local verification ===' -ForegroundColor Cyan
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw 'Docker CLI not found. Install/start Docker Desktop and retry.'
    }
    & docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        throw 'Docker Engine is unavailable. Open Docker Desktop, wait for Engine Running, then retry.'
    }
    if (-not (Test-Path '.env')) {
        Copy-Item '.env.example' '.env'
        Write-Warning 'Created .env from demo template. Do not expose demo secrets/passwords publicly.'
    }

    DockerChecked -DockerArgs @('compose', 'config', '--quiet')
    if ($SkipBuild) {
        DockerChecked -DockerArgs @('compose', 'up', '-d')
    } else {
        DockerChecked -DockerArgs @('compose', 'up', '--build', '-d')
    }
    DockerChecked -DockerArgs @('compose', 'ps')

    $webPort = 8080
    foreach ($line in (Get-Content '.env')) {
        if ($line -match '^\s*WEB_PORT\s*=\s*(\d+)') {
            $webPort = [int]$Matches[1]
        }
    }
    $healthUri = "http://localhost:$webPort/readyz"
    $ready = $false
    for ($i = 0; $i -lt 20; $i++) {
        try {
            $response = Invoke-RestMethod -Uri $healthUri -TimeoutSec 4 -ErrorAction Stop
            if ($response.status -eq 'ok') { $ready = $true; break }
        } catch { Start-Sleep -Seconds 2 }
    }
    if (-not $ready) {
        Write-Host '=== API logs ==='
        & docker compose logs --tail=100 api
        throw "API did not become healthy at $healthUri"
    }
    Write-Host "PASS: $healthUri" -ForegroundColor Green

    Write-Host '=== Contract / static tests in actual API image ==='
    DockerChecked -DockerArgs @('compose', 'exec', '-T', 'api', 'pytest', '-q',
        '/app/backend/tests/test_contract.py',
        '/app/backend/tests/test_review_contract.py')

    if (-not $SkipIntegration) {
        # The test fixtures TRUNCATE their database. NEVER reuse a real database.
        $dbName = 'startup_test_' + ([guid]::NewGuid().ToString('N').Substring(0, 12))
        Write-Host "=== Creating isolated disposable test database $dbName ==="
        $created = $false
        try {
            DockerChecked -DockerArgs @('compose','exec','-T','db','psql','-U','startup','-d','postgres',
                '-v','ON_ERROR_STOP=1','-c',"CREATE DATABASE $dbName")
            $created = $true

            $testPython = @'
import os, subprocess
from sqlalchemy.engine import make_url
url = make_url(os.environ['DATABASE_URL']).set(database=os.environ['INTEGRATION_DB_NAME'])
# Both database URLs point only to the newly created disposable database.
os.environ['DATABASE_URL'] = url.render_as_string(hide_password=False)
os.environ['TEST_DATABASE_URL'] = os.environ['DATABASE_URL']
subprocess.run(['alembic','-c','/app/backend/alembic.ini','upgrade','head'],check=True)
subprocess.run(['pytest','-q',
 '/app/backend/tests'],check=True)
'@
            DockerChecked -DockerArgs @('compose','exec','-T','-e',"INTEGRATION_DB_NAME=$dbName",'api',
                'python','-c',$testPython)
        } finally {
            if ($created) {
                Write-Host '=== Cleaning up disposable test database ==='
                & docker compose exec -T db psql -U startup -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $dbName WITH (FORCE)"
                if ($LASTEXITCODE -ne 0) { Write-Warning "Cleanup FAILED for disposable database $dbName" }
            }
        }
    } else {
        Write-Warning 'Integration tests skipped by explicit -SkipIntegration parameter.'
    }

    Write-Host "PASS: Docker image, UI served, API health, and requested tests. Open http://localhost:$webPort" -ForegroundColor Green
    Write-Host 'Next step: manually test two demo users through the browser.'
} catch {
    Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host 'Share this error and `docker compose logs --tail=100 api` (remove secrets from logs first).'
    exit 1
} finally {
    Pop-Location
}
