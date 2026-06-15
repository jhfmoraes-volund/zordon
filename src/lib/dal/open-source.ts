import "server-only";
import { db } from "@/lib/db";

// Manual types until database.types.ts is regenerated (needs live DB access).
// Mirrors the opportunities DAL pattern.

export type OpenSourceFact = { label: string; value: string };
export type OpenSourceChatItem = { question: string; answer: string };
export type OpenSourceTrack = { title: string; artist: string };

export type OpenSourceCardRow = {
  id: string;
  archiveNumber: number;
  category: string;
  name: string;
  title: string | null;
  photoStoragePath: string | null;
  photoUpdatedAt: string | null;
  tags: string[];
  quote: string | null;
  quoteAttribution: string | null;
  humanFacts: OpenSourceFact[];
  builderFacts: OpenSourceFact[];
  callMeFor: string[];
  chat: OpenSourceChatItem[];
  truthsAndLie: string[];
  soundtrack: OpenSourceTrack[];
  displayOrder: number | null;
  isPublished: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OpenSourceCardInput = {
  name: string;
  title?: string | null;
  category?: string;
  archiveNumber?: number;
  photoStoragePath?: string | null;
  photoUpdatedAt?: string | null;
  tags?: string[];
  quote?: string | null;
  quoteAttribution?: string | null;
  humanFacts?: OpenSourceFact[];
  builderFacts?: OpenSourceFact[];
  callMeFor?: string[];
  chat?: OpenSourceChatItem[];
  truthsAndLie?: string[];
  soundtrack?: OpenSourceTrack[];
  displayOrder?: number | null;
  isPublished?: boolean;
};

export type UpdateOpenSourceCardInput = Partial<OpenSourceCardInput>;

function table() {
  // Table not yet in database.types.ts — loosen typing on the query builder.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db() as any).from("OpenSourceCard");
}

/** All cards, ordered by displayOrder (nulls last) then archive number. */
export async function list(): Promise<OpenSourceCardRow[]> {
  const { data, error } = await table()
    .select("*")
    .order("displayOrder", { ascending: true, nullsFirst: false })
    .order("archiveNumber", { ascending: true });

  if (error) throw error;
  return (data ?? []) as OpenSourceCardRow[];
}

/** Single card by id. */
export async function getById(id: string): Promise<OpenSourceCardRow | null> {
  const { data, error } = await table().select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data ?? null) as OpenSourceCardRow | null;
}

/** Next sequential archive number (max + 1, starting at 1). */
export async function getNextArchiveNumber(): Promise<number> {
  const { data, error } = await table()
    .select("archiveNumber")
    .order("archiveNumber", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  const max = (data as { archiveNumber?: number } | null)?.archiveNumber ?? 0;
  return max + 1;
}

/** Create a card. Auto-assigns archiveNumber when not provided. */
export async function create(
  input: OpenSourceCardInput,
  createdBy: string | null,
): Promise<OpenSourceCardRow> {
  const archiveNumber = input.archiveNumber ?? (await getNextArchiveNumber());

  const { data, error } = await table()
    .insert({
      archiveNumber,
      category: input.category ?? "ENDOMARKETING",
      name: input.name,
      title: input.title ?? null,
      photoStoragePath: input.photoStoragePath ?? null,
      photoUpdatedAt: input.photoUpdatedAt ?? null,
      tags: input.tags ?? [],
      quote: input.quote ?? null,
      quoteAttribution: input.quoteAttribution ?? null,
      humanFacts: input.humanFacts ?? [],
      builderFacts: input.builderFacts ?? [],
      callMeFor: input.callMeFor ?? [],
      chat: input.chat ?? [],
      truthsAndLie: input.truthsAndLie ?? [],
      soundtrack: input.soundtrack ?? [],
      displayOrder: input.displayOrder ?? null,
      isPublished: input.isPublished ?? true,
      createdBy,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as OpenSourceCardRow;
}

/** Patch an existing card. */
export async function update(
  id: string,
  patch: UpdateOpenSourceCardInput,
): Promise<OpenSourceCardRow> {
  const { data, error } = await table()
    .update({ ...patch, updatedAt: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data as OpenSourceCardRow;
}

/** Hard delete a card. */
export async function remove(id: string): Promise<void> {
  const { error } = await table().delete().eq("id", id);
  if (error) throw error;
}
