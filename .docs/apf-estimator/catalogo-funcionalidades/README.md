# Catálogo de Funcionalidades (Fase A do V3)

Lista de **ações do usuário** extraídas do repo, em linguagem de produto. Saída intermediária do pipeline V3 — entra como entrada da Fase B (tabela PF). **Sem código** — markdown puro.

Plano canônico: [../../apf-estimator-plan-v3.md](../../features/estimation/apf-estimator-plan-v3.md).

## Granularidade

Uma ação = **uma coisa que o usuário dispara e que produz resultado funcional**:
- "Listar OSs migráveis" ✅
- "Filtrar lista de OSs por gerência" ❌ (filtro é refinamento da mesma ação)
- "Criar OS + adicionar 5 itens" ❌ (são 2 ações)
- "Exportar calendário em XLSX" ✅ (export é ação separada)

Esperado: 30-60 ações no SEPLAG-CE.

## Formato (template)

```markdown
### A12. Listar OSs migráveis (HH→PF)

**Tipo provável:** CE
**Rotas:** `src/pages/migracao/index.tsx`
**Tabelas envolvidas:** `os`, `os_item` (leitura)
**Disparo:** entra na tela "Migração HH→PF"
**Descrição:** lista OSs em status `aberta` que têm itens convertíveis de HH pra PF. Filtros por gerência e período.
**Sinais técnicos:**
- Query: `supabase.from('os').select('...').eq('status', 'aberta')`
- Componente: `<MigracaoListPage>`
**Análogo provável (referencial):** `Listar_OSs_Migraveis_HHPF` (Riple M6) → CE Alta 6 PF
**needs_review:** false
```

## Como Claude monta

Lê `src/pages/**` (file-system routing) + `supabase/migrations/` + `supabase/functions/`. Pra cada rota, identifica queries/mutations/exports, separa em ações distintas. Aplica regra anti-double-count do V2 §2.3 (write tem RPC + edge + cliente direto → conta na camada mais próxima do banco).

## O que João revisa

- Ação faz sentido como "coisa que o usuário faz" ou é artefato técnico que não devia contar?
- Tipo provável (CE/SE/EE/AIE/ALI) parece certo?
- Análogo apontado na biblioteca é razoável?
- Faltou alguma ação óbvia?

Revisão = comentários inline (`<!-- João: isso é PAG, não CE -->`) ou edição direta no .md.

## Status

- [x] `seplag-ce.md` v0 — gerado 2026-05-05. **38 ações** (A01-A38) + **12 ALIs** (D01-D12) + **9 backend-only** (B01-B09) + **4 não-mensuráveis** (Z01-Z04). Estimativa provisória: ~290-330 PF.
- [ ] revisão João — pendente.
