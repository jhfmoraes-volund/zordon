/**
 * Taxonomia canônica de pastas do Drive por projeto (runbook D1/D2):
 * Comercial / Imersão / Ops / Pós-Ops. Match por nome normalizado
 * (lowercase, sem acento, sem não-alfanumérico) tolera "Pós Ops",
 * "pos-ops", "Imersão" etc. Pasta fora da taxonomia → stage NULL ("Geral").
 */

export type DriveStage = "comercial" | "imersao" | "ops" | "pos_ops";

export const STAGE_ORDER: DriveStage[] = [
  "comercial",
  "imersao",
  "ops",
  "pos_ops",
];

export const STAGE_LABELS: Record<DriveStage, string> = {
  comercial: "Comercial",
  imersao: "Imersão",
  ops: "Ops",
  pos_ops: "Pós-Ops",
};

const STAGE_BY_NORMALIZED: Record<string, DriveStage> = {
  comercial: "comercial",
  imersao: "imersao",
  // 'posops' antes de 'ops' na semântica (D2) — aqui é match exato, sem prefixo.
  posops: "pos_ops",
  ops: "ops",
};

/** "Pós Ops"→pos_ops · "OPS"→ops · "Imersão"→imersao · "Design"→null (D2). */
export function folderStage(name: string): DriveStage | null {
  const normalized = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
  return STAGE_BY_NORMALIZED[normalized] ?? null;
}
