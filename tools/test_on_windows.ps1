# Windows PowerShell 5.1+ / PowerShell 7; isolated disposable Compose verification.
# Existing default/prod/Telegram Compose projects, .env and volumes are never reused.
[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [switch]$SkipIntegration
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$composeFile = Join-Path $root 'compose.yaml'
$tempEnv = $null
$projectName = $null
$started = $false
$exitCode = 0
$originalEnvironment = @{}
$overrideNames = @(
    'POSTGRES_PASSWORD', 'CSRF_SECRET', 'WEB_PORT', 'COOKIE_SECURE',
    'ALLOW_DEMO_LOGIN', 'SEED_DEMO_ACCOUNTS', 'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_AUTH_MAX_AGE_SECONDS', 'COMPOSE_FILE', 'COMPOSE_PROFILES'
)

function Invoke-DockerChecked {
    param([string[]]$DockerArgs)
    & docker @DockerArgs
    if ($LASTEXITCODE -ne 0) {
        throw "docker command failed (exit code $LASTEXITCODE)"
    }
}

function Invoke-VerificationCompose {
    param([string[]]$ComposeArgs)
    Invoke-DockerChecked -DockerArgs (@('compose', '--env-file', $script:tempEnv,
        '-f', $script:composeFile, '-p', $script:projectName) + $ComposeArgs)
}

function New-RandomHex {
    param([int]$ByteCount)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $bytes = New-Object byte[] $ByteCount
        $rng.GetBytes($bytes)
        return [System.BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
    } finally {
        $rng.Dispose()
    }
}

Push-Location $root
try {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw 'Docker CLI is missing.'
    }
    & docker info *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Docker Engine is unavailable.' }
    Invoke-DockerChecked -DockerArgs @('compose', 'version')

    $suffix = New-RandomHex 6
    $projectName = "startup_team_verify_$suffix"
    $testDb = "startup_test_$suffix"
    if ($projectName -notmatch '^startup_team_verify_[a-f0-9]{12}$') {
        throw 'Invalid generated Compose project.'
    }

    # Detect any extremely unlikely collision before running or cleaning up.
    $previous = & docker ps -aq --filter "label=com.docker.compose.project=$projectName"
    if ($LASTEXITCODE -ne 0) { throw 'Failed to inspect existing containers.' }
    $previousVolumes = & docker volume ls -q --filter "label=com.docker.compose.project=$projectName"
    if ($LASTEXITCODE -ne 0) { throw 'Failed to inspect existing volumes.' }
    if ($previous -or $previousVolumes) {
        throw "Refusing to reuse Compose project $projectName"
    }

    # Choose an unoccupied local port without changing a running app.
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        $webPort = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
    } finally {
        $listener.Stop()
    }

    $password = New-RandomHex 24
    $csrfSecret = New-RandomHex 32
    $tempEnv = Join-Path ([System.IO.Path]::GetTempPath()) (
        'startup-team-verify-' + [guid]::NewGuid().ToString('N') + '.env'
    )
    @(
        "POSTGRES_PASSWORD=$password"
        "CSRF_SECRET=$csrfSecret"
        "WEB_PORT=$webPort"
        'COOKIE_SECURE=false'
        'ALLOW_DEMO_LOGIN=true'
        'SEED_DEMO_ACCOUNTS=true'
        'TELEGRAM_BOT_TOKEN='
        'TELEGRAM_AUTH_MAX_AGE_SECONDS=300'
    ) | Set-Content -LiteralPath $tempEnv -Encoding ASCII

    # User environment variables take precedence over --env-file in Compose;
    # temporarily override and restore every security-relevant interpolation.
    foreach ($name in $overrideNames) {
        $originalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    }
    $values = @{
        POSTGRES_PASSWORD = $password; CSRF_SECRET = $csrfSecret
        WEB_PORT = "$webPort"; COOKIE_SECURE = 'false'
        ALLOW_DEMO_LOGIN = 'true'; SEED_DEMO_ACCOUNTS = 'true'
        TELEGRAM_BOT_TOKEN = ''; TELEGRAM_AUTH_MAX_AGE_SECONDS = '300'
        COMPOSE_FILE = $null; COMPOSE_PROFILES = $null
    }
    foreach ($name in $overrideNames) {
        [Environment]::SetEnvironmentVariable($name, $values[$name], 'Process')
    }

    Write-Host "=== Isolated Windows test project: $projectName (127.0.0.1:$webPort) ==="
    Invoke-VerificationCompose -ComposeArgs @('config', '--quiet')
    # Even a failed 'up' may have allocated its disposable volume.
    $started = $true
    if ($SkipBuild) {
        Invoke-VerificationCompose -ComposeArgs @('up', '-d')
    } else {
        Invoke-VerificationCompose -ComposeArgs @('up', '-d', '--build')
    }

    $healthUri = "http://127.0.0.1:$webPort/readyz"
    $ready = $false
    for ($i = 0; $i -lt 45; $i++) {
        try {
            $response = Invoke-RestMethod -Uri $healthUri -TimeoutSec 3 -ErrorAction Stop
            if ($response.status -eq 'ok') { $ready = $true; break }
        } catch {
            Start-Sleep -Seconds 2
        }
    }
    if (-not $ready) {
        Invoke-VerificationCompose -ComposeArgs @('ps')
        throw "Isolated API did not become database-ready at $healthUri"
    }

    Invoke-VerificationCompose -ComposeArgs @(
        'exec', '-T', 'api', 'pytest', '-q',
        '/app/backend/tests/test_contract.py',
        '/app/backend/tests/test_review_contract.py'
    )

    if (-not $SkipIntegration) {
        Write-Host "=== Disposable PostgreSQL test database: $testDb ==="
        Invoke-VerificationCompose -ComposeArgs @(
            'exec', '-T', 'db', 'psql', '-U', 'startup', '-d', 'postgres',
            '-v', 'ON_ERROR_STOP=1', '-c', "CREATE DATABASE $testDb;"
        )
        $testPython = @'
import os, subprocess
from sqlalchemy.engine import make_url
db_name = os.environ["INTEGRATION_DB_NAME"]
assert db_name.startswith("startup_test_") and len(db_name) == 25
url = make_url(os.environ["DATABASE_URL"]).set(database=db_name)
os.environ["DATABASE_URL"] = url.render_as_string(hide_password=False)
os.environ["TEST_DATABASE_URL"] = os.environ["DATABASE_URL"]
subprocess.run(["alembic", "-c", "/app/backend/alembic.ini", "upgrade", "head"], check=True)
subprocess.run(["pytest", "-q", "/app/backend/tests"], check=True)
'@
        Invoke-VerificationCompose -ComposeArgs @(
            'exec', '-T', '-e', "INTEGRATION_DB_NAME=$testDb",
            'api', 'python', '-c', $testPython
        )
    } else {
        Write-Warning 'Integration tests skipped by explicit -SkipIntegration.'
    }
    Write-Host "PASS: isolated Windows verification; removing $projectName and its volumes."
} catch {
    Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
    $exitCode = 1
} finally {
    if ($started) {
        Write-Host "=== Removing ONLY disposable Compose project $projectName ==="
        try {
            Invoke-VerificationCompose -ComposeArgs @('down', '-v', '--remove-orphans')
        } catch {
            Write-Warning "Cleanup failed for $projectName : $($_.Exception.Message)"
            $exitCode = 1
        }
    }
    foreach ($name in $originalEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $originalEnvironment[$name], 'Process')
    }
    if ($tempEnv -and (Test-Path -LiteralPath $tempEnv)) {
        Remove-Item -LiteralPath $tempEnv -Force
    }
    Pop-Location
}
if ($exitCode -ne 0) { exit $exitCode }
