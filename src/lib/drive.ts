/**
 * Helpers da integração Google Drive (Fase 1 — listagem + índice).
 * Drive é o SSOT dos arquivos; aqui só vive parsing/normalização.
 * Ref: docs/runbooks/project-drive-runbook.md
 */

/**
 * Extrai o folder ID de uma URL do Drive ou aceita o ID puro.
 * Formatos: drive.google.com/drive/folders/<id>, .../drive/u/0/folders/<id>,
 * ...?id=<id>, ou o próprio ID.
 * Retorna null se não reconhecer.
 */
export function parseDriveFolderId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const fromUrl = trimmed.match(
    /drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?folders\/|.*[?&]id=)([\w-]+)/
  );
  if (fromUrl) return fromUrl[1];
  // ID puro: sem espaços/barras, tamanho típico de IDs do Drive
  if (/^[\w-]{10,}$/.test(trimmed)) return trimmed;
  return null;
}
