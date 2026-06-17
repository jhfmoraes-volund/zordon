#!/bin/bash
# Regenera src/lib/supabase/database.types.ts a partir do schema remoto do Supabase.
#
# Escreve num arquivo temporário e só promove pro destino se (1) o gen saiu 0 E
# (2) o conteúdo parece TypeScript válido. Sem isso, um gen que falha — falta de
# SUPABASE_ACCESS_TOKEN, rede, etc — zera o arquivo de tipos: o CLI cospe um JSON
# de erro e o `> file` direto sobrescreve as ~8500 linhas de tipos. Aprendido na
# marra. NUNCA volte pro `> file` direto.
set -euo pipefail

PROJECT_ID="${SUPABASE_PROJECT_ID:-ugvqlmapqlobigkjboae}"
OUT="src/lib/supabase/database.types.ts"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

if ! npx supabase gen types typescript --project-id "$PROJECT_ID" > "$TMP"; then
  echo "✗ supabase gen types falhou (exit != 0). Tipos preservados em $OUT." >&2
  echo "  Provável: falta SUPABASE_ACCESS_TOKEN — rode 'supabase login' ou exporte o token." >&2
  exit 1
fi

# O gen às vezes sai 0 mas escreve JSON de erro no stdout — checa que é TS de verdade.
if ! grep -q "export type Database" "$TMP"; then
  echo "✗ Saída do gen não parece tipos válidos (sem 'export type Database'). Tipos preservados em $OUT." >&2
  echo "  Início da saída: $(head -c 200 "$TMP")" >&2
  exit 1
fi

mv "$TMP" "$OUT"
trap - EXIT
echo "✓ $OUT regenerado ($(wc -l < "$OUT") linhas)."
