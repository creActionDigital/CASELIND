# Lance une NOUVELLE conversation Claude Code sur les modèles gratuits d'OmniRoute, après avoir vérifié que tout est prêt.
# Usage (PowerShell, depuis E:\CASELIND) :  .\scripts\claude-free.ps1
# Si OmniRoute n'est pas lancé, ouvrir un autre terminal et y taper : omniroute   (attendre ~30 s, laisser ouvert)
param([string]$Model = $(if ($env:OMNIROUTE_MODEL) { $env:OMNIROUTE_MODEL } else { 'auto/coding:free' }))

if (-not $env:OMNIROUTE_KEY) { throw 'OMNIROUTE_KEY est vide dans ce terminal : fermer et rouvrir le terminal, ou la définir.' }

$base = 'http://localhost:20128'
try {
  $r = Invoke-WebRequest -Uri "$base/v1/models" -Headers @{ Authorization = "Bearer $($env:OMNIROUTE_KEY)" } -TimeoutSec 20 -UseBasicParsing
  Write-Host "OmniRoute répond (HTTP $($r.StatusCode))."
} catch {
  throw "OmniRoute ne répond pas sur $base. Dans un autre terminal, lancer : omniroute  (attendre environ 30 s), puis relancer ce script."
}

$env:ANTHROPIC_BASE_URL = $base
$env:ANTHROPIC_AUTH_TOKEN = $env:OMNIROUTE_KEY
$env:ANTHROPIC_MODEL = $Model
$env:ANTHROPIC_SMALL_FAST_MODEL = $Model
# Les modèles gratuits ont une fenêtre bien plus petite que celle supposée par Claude Code.
$env:CLAUDE_CODE_MAX_CONTEXT_TOKENS = '100000'

Write-Host "Modèle : $Model via $base. L'en-tête de Claude Code doit afficher ce modèle, PAS « Sonnet 5.5 · Claude Pro »."
claude
