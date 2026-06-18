-- Add 'design_system' to context_source_kind enum.
-- Um documento de design system (HTML/PDF) anexado nas settings do projeto.
-- Singular por projeto (índice UNIQUE parcial na migration companheira). Lido
-- pelos agentes (Forge/Vitor) via read_context_source pra gerar UI batendo com
-- os tokens/componentes do projeto. O HTML é guardado CRU em fullText (o
-- extrator stripa <style>/<script> — aqui preservamos os tokens).
-- NOTE: ALTER TYPE ... ADD VALUE roda fora de transação; arquivo standalone via psql.
ALTER TYPE context_source_kind ADD VALUE IF NOT EXISTS 'design_system';
