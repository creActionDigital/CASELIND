# Relance Claude Code via OmniRoute (modèles gratuits) quand les crédits Anthropic sont épuisés.
# Prérequis : OmniRoute en marche (port 20128) et sa clé API dans $env:OMNIROUTE_KEY ; $env:OMNIROUTE_MODEL = nom du combo gratuit.
param([string]$Model = $env:OMNIROUTE_MODEL)
if (-not $env:OMNIROUTE_KEY) { throw 'Définir OMNIROUTE_KEY (clé créée dans le tableau de bord OmniRoute).' }
$env:ANTHROPIC_BASE_URL = 'http://localhost:20128'
$env:ANTHROPIC_AUTH_TOKEN = $env:OMNIROUTE_KEY
if ($Model) { $env:ANTHROPIC_MODEL = $Model; $env:ANTHROPIC_SMALL_FAST_MODEL = $Model }
claude --continue
