# ===================================================================
# Local verification harness -- run the whole SQL suite on this machine
# ===================================================================
# WHAT THIS DOES, in plain words
#
#   Builds a throwaway database on your own computer, applies the fake
#   Supabase setup, then all sixteen migrations one at a time, then every
#   security test, and prints how many passed. Nothing here touches a real
#   project, and nothing here is deleted from anywhere.
#
# WHY IT EXISTS
#
#   The alternative is emailing 17 SQL files to whoever owns the project
#   and asking them to report back. They cannot tell a genuine security
#   hole from a typo in a column name -- they would only know something
#   went red. Running it here first means the only thing left for them to
#   check is whether Supabase's own database behaves the same way, which
#   is the one thing this cannot prove.
#
# WHAT IT NEEDS
#
#   PostgreSQL 18 installed locally, and Node (already needed to build the
#   app). No account, no network, no credit card.
#
# HOW TO RUN (from the GenApp folder):
#
#   .\supabase\verify\run_all.ps1
#
# Exit code 0 means every check passed. Anything else means it did not,
# and the failing file and its errors are printed.
#
# WHY SINGLE-USER MODE
#
#   Normally you would start the server and connect with psql. On the
#   machine this was written on the server starts happily, then every
#   child process it spawns dies or hangs before answering a single
#   query, so no client can ever connect -- and there is no error to
#   explain it, just a connection that never completes.
#
#   Single-user mode runs each file in ONE process with no children at
#   all, which sidesteps that completely. It is a supported PostgreSQL
#   mode, not a trick.
#
#   One honest difference, and how the suite copes with it: single-user
#   mode bypasses RLS ROW FILTERING even for non-superuser roles (its
#   superuser() check is unconditional), so a bare count sees every row.
#   Grants, schema usage, EXECUTE and triggers DO still enforce, which
#   is what produces the genuine permission-denied errors in these logs.
#   The row-count tests (1, 2, 4, 5, 6, 7, 8, 12) run through
#   public.rls_count(), which on a live server does a plain count (RLS
#   filters) and in single-user mode rebuilds the same filter from
#   pg_policy -- so the numbers mean the same thing in both places.
#   Everything else in the suite is genuine in both transports.
#
# WHY THERE IS A FLATTENING STEP
#
#   Single-user mode reads its input one line at a time and treats each
#   line as a whole statement. Our SQL has many-statement blocks that run
#   across many lines (`do $$ ... $$;` in particular), so fed straight in
#   they are chopped up at every newline and produce hundreds of fake
#   syntax errors. flatten-sql.mjs rewrites each file so that every
#   statement sits on one line, following the SQL lexer's own rules for
#   strings, dollar quotes and comments. See the header of that file for
#   why a naive `join(' ')` would corrupt the SQL.
# ===================================================================

param(
    # Where PostgreSQL is installed.
    [string]$PgBin = 'C:\Program Files\PostgreSQL\18\bin',
    # Where the throwaway database is built. Rebuilt from scratch every run.
    [string]$DataDir = (Join-Path $env:TEMP 'opencode\genapp_pgdata'),
    # Where the per-file logs are kept, for reading after a failure.
    [string]$LogDir = (Join-Path $env:TEMP 'opencode\genapp_verify'),
    # Keep the throwaway database behind so it can be poked at by hand.
    [switch]$Keep
)

$ErrorActionPreference = 'Stop'

function Say([string]$m) { Write-Host $m }

$repo       = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # supabase/verify -> repo
$stub       = Join-Path $PSScriptRoot '00_stub_supabase.sql'
$flatten    = Join-Path $PSScriptRoot 'flatten-sql.mjs'
$migrations = @(Get-ChildItem (Join-Path $repo 'supabase\migrations') -Filter '*.sql' | Sort-Object Name)
$tests      = Join-Path $repo 'supabase\tests\rls_tests.sql'
$postgres   = Join-Path $PgBin 'postgres.exe'

foreach ($need in @($postgres, $stub, $flatten, $tests)) {
    if (-not (Test-Path $need)) { Say "ERROR: missing $need"; exit 2 }
}
if ($migrations.Count -eq 0) { Say "ERROR: no migrations found."; exit 2 }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Say 'ERROR: node is not on PATH.'; exit 2 }

# -------------------------------------------------------------------
# Clean up anything left over from a previous run
# -------------------------------------------------------------------
# A stray postgres process holds a shared-memory segment named after the
# data directory, and the next run then dies with "pre-existing shared
# memory block is still in use". Killing them first is not optional.
Get-Process -Name 'postgres' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
if (Test-Path $DataDir) { Remove-Item $DataDir -Recurse -Force }
if (Test-Path $LogDir)  { Remove-Item $LogDir  -Recurse -Force }
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

Say "Building a fresh database in $DataDir ..."
& (Join-Path $PgBin 'initdb.exe') -D $DataDir -U postgres -A trust -E UTF8 --no-locale | Out-Null
if ($LASTEXITCODE -ne 0) { Say 'ERROR: initdb failed.'; exit 2 }

# -------------------------------------------------------------------
# Run one SQL file, and return its output
# -------------------------------------------------------------------
function Invoke-SingleUser([string]$SqlFile, [string]$LogPath) {
    # Supabase's sessions all run with `extensions` on the search path,
    # which is why `gen_salt('bf')` resolves with no qualification in the
    # dashboard SQL editor. A vanilla PostgreSQL only puts `"$user", public`
    # on the path, and single-user mode skips the role-level `alter role ...
    # set search_path` that the stub sets up -- so the session has to be
    # told directly. One SET statement prepended to a copy of the file is
    # exactly the difference between Supabase and a vanilla install, and it
    # is harmless to the migrations (their function bodies declare their
    # own search paths anyway).
    $combined = "$SqlFile.preamble.sql"
    $preamble = "set search_path = public, extensions;`r`n"
    [System.IO.File]::WriteAllText(
        $combined,
        $preamble + [System.IO.File]::ReadAllText($SqlFile),
        (New-Object System.Text.UTF8Encoding($false)))

    # Redirect through cmd.exe so the child inherits real file handles.
    # A bare PowerShell pipeline deadlocks on a large script.
    cmd /c "`"$postgres`" --single -D `"$DataDir`" -c listen_addresses= postgres < `"$combined`" > `"$LogPath`" 2>&1" | Out-Null
    if (-not (Test-Path $LogPath)) { return @() }
    return @(Get-Content $LogPath)
}

function Get-Errors($lines)  { @($lines | Where-Object { $_ -match '\bERROR:' }) }
function Get-Fails($lines)   { @($lines | Where-Object { $_ -match 'FAIL -' }) }
function Get-Passes($lines)  { @($lines | Where-Object { $_ -match 'PASS -' }) }

# Flatten a source file to one-statement-per-line, ready to be fed in.
function Convert-ToFlattened([string]$SourceFile, [string]$Tag) {
    $raw  = Join-Path $LogDir "$Tag.raw.sql"
    $flat = Join-Path $LogDir "$Tag.flat.sql"
    Copy-Item $SourceFile $raw -Force

    # Deliberately run through cmd.exe rather than as a PowerShell native
    # command. With $ErrorActionPreference = 'Stop', anything Node writes
    # to stderr becomes a TERMINATING error and the whole harness dies on
    # the first informational message -- which is exactly what happened
    # the first time this ran. Redirecting in cmd keeps stderr a file.
    $notes = Join-Path $LogDir "$Tag.flatten.txt"
    cmd /c "node `"$flatten`" `"$raw`" `"$flat`" > `"$notes`" 2>&1"
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $flat)) {
        Say "ERROR: could not flatten $SourceFile"
        Get-Content $notes -ErrorAction SilentlyContinue | ForEach-Object { Say "  $_" }
        exit 2
    }
    # Only surfaced when flattening actually had something to say --
    # today that means a COMMENT ON text spanning two lines.
    $said = @(Get-Content $notes -ErrorAction SilentlyContinue | Where-Object { $_ -like 'NOTE:*' })
    foreach ($n in $said) { Say "    $Tag : $n" }
    return $flat
}

# -------------------------------------------------------------------
# Apply: stub, then each migration, then the tests
# -------------------------------------------------------------------
$plan = @(,@{ Label = 'stub (fake Supabase)'; Source = $stub; Tag = '00_stub' })
foreach ($m in $migrations) {
    $plan += , @{ Label = $m.Name; Source = $m.FullName; Tag = $m.BaseName }
}
$plan += , @{ Label = 'rls_tests.sql (the test suite)'; Source = $tests; Tag = '99_tests' }

$totalPass = 0
$allFails  = New-Object System.Collections.Generic.List[string]

foreach ($step in $plan) {
    $flat = Convert-ToFlattened $step.Source $step.Tag
    $log  = Join-Path $LogDir "$($step.Tag).log"
    $out  = Invoke-SingleUser $flat $log

    $errs  = Get-Errors $out
    $fails = Get-Fails  $out
    $passes = Get-Passes $out
    $totalPass += $passes.Count

    # Tests report failures with `raise warning 'FAIL - ...'`, which is a
    # FAILED CHECK, not a broken file. The two are kept apart because the
    # fix for one is a wrong rule and the fix for the other is a typo.
    if ($errs.Count -gt 0) {
        Say ''
        Say '==================================================================='
        Say "  STOPPED IN: $($step.Label)"
        Say '==================================================================='
        Say ''
        Say 'The SQL in this file was rejected, so it was not applied and'
        Say 'everything after it did not run at all:'
        Say ''
        $errs | ForEach-Object { Say "  $_" }
        Say ''
        Say "Full log: $log"
        Say ''
        Say "Checks passed before this point: $totalPass"
        exit 1
    }

    foreach ($f in $fails) { $allFails.Add($f) }
    $mark = if ($step.Tag -eq '99_tests') { "$($passes.Count) checks" } else { 'applied' }
    Say ("  {0,-40} {1}" -f $step.Label, $mark)
}

# -------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------
Say ''
Say '==================================================================='
Say "  Migrations applied : $($migrations.Count) of $($migrations.Count)"
Say "  PASS                : $totalPass"
Say "  FAIL                : $($allFails.Count)"
Say "  ERROR               : 0"
Say '==================================================================='

if ($allFails.Count -gt 0) {
    Say ''
    Say 'FAILED CHECKS (the SQL ran fine; a rule did not hold):'
    $allFails | ForEach-Object { Say "  $_" }
    Say ''
    Say "Logs: $LogDir"
    exit 1
}

Say ''
Say 'Every check passed. The security rules hold as written.'
Say ''
Say 'This proves the SQL is correct on PostgreSQL 18. It does NOT prove'
Say 'Supabase agrees: only running these same files against the real'
Say 'project can show that.'

Get-Process -Name 'postgres' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
if (-not $Keep) {
    Start-Sleep -Seconds 1
    Remove-Item $DataDir -Recurse -Force -ErrorAction SilentlyContinue
} else {
    Say ''
    Say "Database kept at: $DataDir"
}
exit 0
