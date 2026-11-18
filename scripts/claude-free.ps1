# Lance une NOUVELLE conversation Claude Code sur les modèles gratuits de FreeLLMAPI (installé dans C:\Users\HP\tools\freellmapi).
# Prérequis : le serveur tourne (dans un autre terminal : cd C:\Users\HP\tools\freellmapi ; $env:HOST='127.0.0.1' ; node server\dist\index.js)
#             et la clé unifiée « freellmapi-... » (page Keys du tableau de bord http://localhost:3001) est dans $env:FREELLMAPI_KEY.
# Usage (PowerShell, depuis E:\CASELIND) :  .\scripts\claude-free.ps1
# `launch` n'écrit rien dans ~/.claude : les identifiants ne vivent que dans le processus Claude Code lancé.
$base = 'http://localhost:3001'
if (-not $env:FREELLMAPI_KEY) { throw 'FREELLMAPI_KEY est vide : copier la clé unifiée (page Keys du tableau de bord) puis : $env:FREELLMAPI_KEY = "freellmapi-..."' }
try {
  $null = Invoke-WebRequest -Uri "$base/" -TimeoutSec 15 -UseBasicParsing
} catch {
  throw "FreeLLMAPI ne répond pas sur $base. Le démarrer dans un autre terminal : cd C:\Users\HP\tools\freellmapi ; `$env:HOST='127.0.0.1' ; node server\dist\index.js"
}
Write-Host "FreeLLMAPI répond. L'en-tête de Claude Code ne doit PAS afficher « Claude Pro »."
node C:\Users\HP\tools\freellmapi\cli\dist\index.js launch --url $base --api-key $env:FREELLMAPI_KEY
