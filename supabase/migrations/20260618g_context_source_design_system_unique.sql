-- Um único design_system ContextSource por projeto (a API faz replace:
-- delete o anterior + insere o novo). O índice parcial trava duplicata no DB.
-- Roda em arquivo separado do ADD VALUE: o enum já está commitado antes daqui
-- (senão o predicado WHERE kind='design_system' falharia — "unsafe use of new value").
CREATE UNIQUE INDEX IF NOT EXISTS context_source_design_system_unique
  ON "ContextSource" ("projectId")
  WHERE kind = 'design_system';
