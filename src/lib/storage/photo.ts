/**
 * Helpers de foto no Supabase Storage — compartilhados entre features que
 * sobem retrato (open-source cards, foto de perfil de Member, …).
 *
 * - `publicPhotoUrl` é pura (constrói a URL pública do env, sem client) — segura
 *   em render e até server-side. Buckets precisam ser públicos.
 * - `uploadResizedPhoto` / `removePhoto` rodam só no browser (canvas/File) e
 *   criam o client por chamada (em ação do usuário, não em render).
 */

import { createClient } from "@/lib/supabase/client";

export const MEMBER_PHOTO_BUCKET = "member-photos";

export const PHOTO_ACCEPTED_MIME = ["image/png", "image/jpeg", "image/webp"];
export const PHOTO_MAX_BYTES = 3 * 1024 * 1024; // 3 MB
const PHOTO_MAX_DIMENSION = 768;

/** Erro de validação de arquivo (mime/tamanho) — mensagem pronta pra toast. */
export class PhotoValidationError extends Error {}

/**
 * URL pública (com cache-bust por `updatedAt`) de uma foto no Storage.
 * Endpoint estável do Storage: `/storage/v1/object/public/<bucket>/<path>`.
 * Retorna null se não houver path ou env.
 */
export function publicPhotoUrl(
  bucket: string,
  path: string | null,
  updatedAt: string | null,
): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const url = `${base}/storage/v1/object/public/${bucket}/${encoded}`;
  return updatedAt ? `${url}?v=${encodeURIComponent(updatedAt)}` : url;
}

function extensionFor(file: File): string {
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "jpg";
}

/** Redimensiona um raster pro maior lado <= PHOTO_MAX_DIMENSION (canvas, browser). */
async function resizeRaster(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const scale = Math.min(
      1,
      PHOTO_MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight),
    );
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context indisponível");
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("toBlob falhou"))),
        file.type,
        0.9,
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Valida (mime + tamanho), redimensiona e sobe a foto pro bucket.
 * `dir` namespaceia o path (`<dir>/<uuid>.<ext>`) — usado pela RLS pra amarrar
 * a foto ao dono. Sem `dir`, sobe na raiz do bucket. Devolve o storage path
 * salvo; NÃO persiste em tabela nenhuma (o caller decide quando salvar).
 */
export async function uploadResizedPhoto({
  bucket,
  file,
  dir,
}: {
  bucket: string;
  file: File;
  dir?: string;
}): Promise<{ path: string }> {
  if (!PHOTO_ACCEPTED_MIME.includes(file.type)) {
    throw new PhotoValidationError("Formato não suportado. Use PNG, JPG ou WEBP.");
  }
  if (file.size > PHOTO_MAX_BYTES) {
    throw new PhotoValidationError("Arquivo maior que 3 MB.");
  }
  const name = `${crypto.randomUUID()}.${extensionFor(file)}`;
  const path = dir ? `${dir}/${name}` : name;
  const body = await resizeRaster(file);
  const { error } = await createClient()
    .storage.from(bucket)
    .upload(path, body, {
      upsert: false,
      contentType: file.type,
      cacheControl: "3600",
    });
  if (error) throw new Error(error.message);
  return { path };
}

/** Remove um objeto do bucket (cleanup de órfão). Best-effort. */
export async function removePhoto(bucket: string, path: string): Promise<void> {
  await createClient().storage.from(bucket).remove([path]);
}
