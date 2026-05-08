import type { SupabaseClient } from "@supabase/supabase-js";

const STOP_WORDS = new Set([
  "de", "da", "do", "das", "dos",
  "the", "a", "an", "of", "and",
  "e", "o", "os", "as",
]);

function lettersOnly(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

/**
 * Deriva candidato base de 4 letras a partir do nome do projeto.
 * - 2+ palavras significativas: pega iniciais (até 4); completa com letras da última palavra.
 * - 1 palavra: pega as 4 primeiras letras.
 */
export function deriveReferenceKeyBase(name: string): string {
  const words = name
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w.toLowerCase()))
    .map((w) => lettersOnly(w))
    .filter((w) => w.length > 0);

  let candidate = "";

  if (words.length >= 2) {
    for (const w of words) {
      candidate += w[0];
      if (candidate.length >= 4) break;
    }
    if (candidate.length < 4) {
      candidate += words[words.length - 1].slice(1);
    }
  } else if (words.length === 1) {
    candidate = words[0];
  }

  candidate = candidate.slice(0, 4);

  if (candidate.length < 2) {
    candidate = (candidate + "XXXX").slice(0, 4);
  }

  return candidate;
}

/**
 * Gera referenceKey único pra um projeto.
 * - Tenta o base de 4 letras.
 * - Em colisão, troca a última letra por número incremental (ZRDN → ZRD2 → ZRD3 …).
 * - Esgotando 2-9, troca os 2 últimos chars por número (ZR10, ZR11 …).
 */
export async function generateUniqueReferenceKey(
  supabase: SupabaseClient,
  name: string,
  excludeProjectId?: string,
): Promise<string> {
  const base = deriveReferenceKeyBase(name);

  const taken = await fetchTakenKeys(supabase, excludeProjectId);
  const isTaken = (key: string) => taken.has(key.toUpperCase());

  if (!isTaken(base)) return base;

  const prefix3 = base.slice(0, 3);
  for (let n = 2; n <= 9; n++) {
    const candidate = `${prefix3}${n}`;
    if (!isTaken(candidate)) return candidate;
  }

  const prefix2 = base.slice(0, 2);
  for (let n = 10; n <= 99; n++) {
    const candidate = `${prefix2}${n}`;
    if (!isTaken(candidate)) return candidate;
  }

  throw new Error(`Não foi possível gerar referenceKey único pra "${name}"`);
}

async function fetchTakenKeys(
  supabase: SupabaseClient,
  excludeProjectId?: string,
): Promise<Set<string>> {
  let query = supabase
    .from("Project")
    .select("referenceKey")
    .not("referenceKey", "is", null);

  if (excludeProjectId) {
    query = query.neq("id", excludeProjectId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return new Set(
    (data ?? [])
      .map((row: { referenceKey: string | null }) => row.referenceKey)
      .filter((k): k is string => !!k)
      .map((k) => k.toUpperCase()),
  );
}
