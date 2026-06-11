-- Stage canônico do arquivo no índice do Drive (runbook D1/D2).
-- Taxonomia de pastas do projeto: Comercial / Imersão / Ops / Pós-Ops.
-- Arquivos na raiz ou em pasta não-canônica ficam stage = NULL ("Geral").
ALTER TABLE "ProjectDriveFile"
  ADD COLUMN stage text CHECK (stage IN ('comercial','imersao','ops','pos_ops'));
