/**
 * Helper client-side compartilhado pelas superfícies de Insumos.
 * Sobe um arquivo como ContextSource(kind="document") — o servidor extrai o
 * texto e cacheia em fullText, e os agentes leem via read_context_source.
 * Cada superfície depois linka o sourceId retornado ao seu próprio /context/link.
 */
import { fetchOrThrow } from "@/lib/optimistic/toast";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // "data:<mime>;base64,XXX" → "XXX"
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/** Cria um ContextSource document e devolve o id. Lança em erro (HttpError). */
export async function createDocumentSource(
  projectId: string,
  file: File,
): Promise<string> {
  const base64 = await fileToBase64(file);
  const res = await fetchOrThrow("/api/context-sources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "document",
      projectId,
      title: file.name,
      file: base64,
      filename: file.name,
      mimeType: file.type || "",
    }),
  });
  const json = (await res.json()) as { id: string };
  return json.id;
}
