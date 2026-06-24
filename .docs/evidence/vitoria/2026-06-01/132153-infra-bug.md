# Capture · vitoria · infra-bug

**Captured:** 2026-06-01T16:21:53Z
**Severity:** high
**Runbook ref:** (none)

## User prompt

```
(fluxo) concluir planning aplica as propostas de create
```

## Observed behavior

Tasks criadas pela planning perdem TODOS os acceptance criteria ao aplicar. Executor lê AC como {text} mas Vitoria grava array de strings -> validAcs vazio -> nada persiste. Silencioso.

## Expected behavior

AC persistem ao concluir: executor normaliza string -> {text} (mesmo mismatch já corrigido na sheet de proposta).

## Context links

- Planning:  193e0ea2-7203-4def-81a6-f582c575d866
- Session:   —
- Meeting:   —
- Thread:    —
- Project:   04ab7f36-f076-4d5f-9a03-6e3f1dcd9067
- Screenshot: —

