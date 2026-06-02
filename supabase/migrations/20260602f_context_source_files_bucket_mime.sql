-- O bucket context-source-files estava restrito a CSV
-- ({text/csv,text/plain,application/vnd.ms-excel}). O insumo "Documento"
-- aceita PDF/DOCX/HTML/XLSX/MD/TXT/JSON/YAML — e o browser manda MIME
-- inconsistente (.md → "text/markdown" ou vazio). O upload já é gated pela
-- API (/api/context-sources kind='document' + extractTextFromBuffer), e o
-- bucket é privado, então liberamos qualquer tipo. Limite alinhado ao extrator (25MB).
update storage.buckets
set allowed_mime_types = null,
    file_size_limit = 26214400
where id = 'context-source-files';
