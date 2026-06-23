-- HITz: backfill dos 2 contratos com os valores reais das propostas (.assets/).
-- Op Especial = Contrato A (fixed_scope, fee fixo R$58.687; PF contado no final →
-- o dono loga a entrega de FP em junho/go-live depois, daí a receita aparece).
-- Squad = Contrato B (R$86.366,41/mês). Remove o entry recorrente "blended"
-- (R$86.366,42 × abr-jun) que era simplificação da planilha → squad passa a ser
-- a fonte única da receita recorrente (SSOT). Datas dos contratos mantidas (do dono).
-- Resultado validado em dry-run: abr/mai = R$0, jun-set = R$86.366,41, sem double-count.
-- Rodar via: psql "$DIRECT_URL" -f supabase/migrations/20260623j_hitz_backfill_contracts.sql

begin;

-- Contrato A (Op Especial): só o valor global; contracted_fp/entrega o dono põe depois.
update finance.contract
   set total_value_cents = 5868700,
       note = 'Operação Especial — fee fixo R$58.687 (50/50 por marco); PF contado no final. Ref VOL-2026/HITZ-GLF-001'
 where project_id = '6913475e-ba90-4aca-8f30-6c34334a95fc'
   and billing_type = 'fixed_scope';

-- Contrato B (Squad): mensalidade. Cláusula 3º mês (R$72.640,92) fica como override a aplicar depois.
update finance.contract
   set monthly_fee_cents = 8636641,
       note = 'Squad as a Service — R$86.366,41/mês, mín 3 meses. Cláusula 3º mês part-time R$72.640,92 (a definir até 40º dia).'
 where project_id = '6913475e-ba90-4aca-8f30-6c34334a95fc'
   and billing_type = 'squad';

-- Remove o entry recorrente blended (receita recorrente agora vem do contrato squad).
delete from finance.entry e using finance.category c
 where e.category_id = c.id
   and e.project_id = '6913475e-ba90-4aca-8f30-6c34334a95fc'
   and c.kind = 'revenue'
   and e.recurrence = 'monthly';

commit;
