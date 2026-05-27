"use client";

import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  ArrowRight,
  Layers,
  MoreHorizontal,
  Rocket,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  BoardColumn,
  BoardLayout,
  Chip,
  StickyCard,
  type Accent,
} from "./board";

export type PriorityBucket = "mvp" | "next" | "out";

export type PrioritizedItem = {
  id: string;
  title: string;
  howItSolves: string;
  targetPersona: string;
  bucket: PriorityBucket;
  keyScreens?: string;
  userFlows?: string;
  painPointRef?: string;
  technicalNotes?: string;
};

type PriorityBoardProps = {
  items: PrioritizedItem[];
  onMove: (itemId: string, toBucket: PriorityBucket) => void;
  onDelete: (itemId: string) => void;
};

type BucketConfig = {
  title: string;
  description: string;
  accent: Accent;
  icon: typeof Rocket;
  chipTone: "emerald" | "sky" | "neutral";
};

const BUCKETS: Record<PriorityBucket, BucketConfig> = {
  mvp: {
    title: "MVP",
    description: "Entra agora. Essencial pro primeiro release.",
    accent: "emerald",
    icon: Rocket,
    chipTone: "emerald",
  },
  next: {
    title: "Next",
    description: "Proximo ciclo. Importante, mas nao pra agora.",
    accent: "sky",
    icon: Sparkles,
    chipTone: "sky",
  },
  out: {
    title: "Out",
    description: "Fora do escopo. Documentado pra futuro.",
    accent: "neutral",
    icon: XCircle,
    chipTone: "neutral",
  },
};

const BUCKET_ORDER: PriorityBucket[] = ["mvp", "next", "out"];

export function PriorityBoard({
  items,
  onMove,
  onDelete,
}: PriorityBoardProps) {
  // Read-only dialog: tracks which item is being viewed. The dialog itself
  // is rendered once at the root, sourcing its data from `items` so that
  // mutations elsewhere (move/delete) keep the dialog in sync — or close it
  // if the item is gone.
  const [viewingId, setViewingId] = useState<string | null>(null);
  const viewingItem = items.find((i) => i.id === viewingId) ?? null;

  return (
    <>
      <BoardLayout cols="triple" gap={4}>
        {BUCKET_ORDER.map((bucket) => {
          const cfg = BUCKETS[bucket];
          const Icon = cfg.icon;
          const bucketItems = items.filter((i) => i.bucket === bucket);
          const otherBuckets = BUCKET_ORDER.filter((b) => b !== bucket);

          return (
            <BoardColumn
              key={bucket}
              accent={cfg.accent}
              icon={<Icon className="size-4" />}
              title={cfg.title}
              subtitle={cfg.description}
              count={bucketItems.length}
              countLabel="item"
              emptyIcon={Layers}
              emptyTitle={`Nada ainda em ${cfg.title}`}
              emptyHint="Mova items das outras colunas pra ca."
            >
              {bucketItems.map((item) => (
                <PriorityItemCard
                  key={item.id}
                  accent={cfg.accent}
                  item={item}
                  otherBuckets={otherBuckets}
                  onOpen={() => setViewingId(item.id)}
                  onMove={(to) => onMove(item.id, to)}
                  onDelete={() => onDelete(item.id)}
                />
              ))}
            </BoardColumn>
          );
        })}
      </BoardLayout>

      <PriorityViewDialog
        item={viewingItem}
        onClose={() => setViewingId(null)}
      />
    </>
  );
}

// ─── PriorityItemCard ──────────────────────────────────────
// Always-collapsed card. Click opens the read-only dialog. Move/delete
// actions stay reachable via the top-right buttons (stopPropagation prevents
// them from opening the dialog).

function PriorityItemCard({
  accent,
  item,
  otherBuckets,
  onOpen,
  onMove,
  onDelete,
}: {
  accent: Accent;
  item: PrioritizedItem;
  otherBuckets: PriorityBucket[];
  onOpen: () => void;
  onMove: (to: PriorityBucket) => void;
  onDelete: () => void;
}) {
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="cursor-pointer rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <StickyCard
        accent={accent}
        chips={
          item.targetPersona ? (
            <Chip mono truncate>
              {item.targetPersona}
            </Chip>
          ) : null
        }
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground hover:text-foreground"
                    aria-label="Mover"
                    // The dropdown trigger itself swallows the click; wrap
                    // anyway so any bubbling from inner Slot doesn't reopen.
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  >
                    <MoreHorizontal className="size-3.5" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="text-xs">
                {otherBuckets.map((target) => {
                  const cfg = BUCKETS[target];
                  return (
                    <DropdownMenuItem
                      key={target}
                      onClick={stop(() => onMove(target))}
                      className="gap-2 text-xs"
                    >
                      <ArrowRight className="size-3" />
                      Mover pra {cfg.title}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-destructive"
              onClick={stop(onDelete)}
              aria-label="Excluir"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </>
        }
        collapsed={
          <div className="space-y-1.5">
            <p className="text-sm font-medium leading-snug text-foreground/90">
              {item.title || (
                <span className="italic text-muted-foreground">(sem titulo)</span>
              )}
            </p>
            {item.howItSolves ? (
              <p className="line-clamp-2 text-xs text-muted-foreground">
                {item.howItSolves}
              </p>
            ) : null}
          </div>
        }
      />
    </div>
  );
}

// ─── PriorityViewDialog ────────────────────────────────────
// Read-only dialog showing the full item content. No inputs. Pulls source
// data (title, howItSolves, persona, optional details) from a single item
// reference — when the parent mutates the item (move/delete), this either
// updates or closes via the parent setting viewingId back to null.

function PriorityViewDialog({
  item,
  onClose,
}: {
  item: PrioritizedItem | null;
  onClose: () => void;
}) {
  const open = item !== null;
  const bucketCfg = item ? BUCKETS[item.bucket] : null;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <ResponsiveDialogContent className="sm:max-w-2xl">
        {item && bucketCfg ? (
          <div className="flex flex-col gap-5 p-2 sm:p-4">
            {/* Bucket chip + (optional) persona chip on top */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip tone={bucketCfg.chipTone}>{bucketCfg.title}</Chip>
              {item.targetPersona ? (
                <Chip mono>{item.targetPersona}</Chip>
              ) : null}
            </div>

            {/* Notion-style large title (read-only) */}
            <ResponsiveDialogTitle className="font-heading text-3xl font-bold leading-tight">
              {item.title || (
                <span className="italic text-muted-foreground">
                  (sem titulo)
                </span>
              )}
            </ResponsiveDialogTitle>

            {item.howItSolves ? (
              <ReadOnlyField label="Como resolve">
                {item.howItSolves}
              </ReadOnlyField>
            ) : null}

            {item.painPointRef ? (
              <ReadOnlyField label="Dor que resolve (jornada AS-IS)">
                {item.painPointRef}
              </ReadOnlyField>
            ) : null}

            {item.keyScreens ? (
              <ReadOnlyField label="Telas / Views">
                {item.keyScreens}
              </ReadOnlyField>
            ) : null}

            {item.userFlows ? (
              <ReadOnlyField label="Fluxos do usuario">
                {item.userFlows}
              </ReadOnlyField>
            ) : null}

            {item.technicalNotes ? (
              <ReadOnlyField label="Consideracoes tecnicas">
                {item.technicalNotes}
              </ReadOnlyField>
            ) : null}

            {!item.howItSolves &&
            !item.painPointRef &&
            !item.keyScreens &&
            !item.userFlows &&
            !item.technicalNotes ? (
              <p className="text-sm italic text-muted-foreground">
                Esse item nao tem detalhes preenchidos. Volte ao Brainstorm pra
                completar.
              </p>
            ) : null}
          </div>
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function ReadOnlyField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
        {children}
      </p>
    </div>
  );
}
