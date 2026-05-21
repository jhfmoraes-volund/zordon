"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Layers,
  MoreHorizontal,
  Rocket,
  Sparkles,
  XCircle,
} from "lucide-react";
import { BoardColumn, BoardLayout, Chip, StickyCard, type Accent } from "./board";

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
  return (
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
                onMove={(to) => onMove(item.id, to)}
                onDelete={() => onDelete(item.id)}
              />
            ))}
          </BoardColumn>
        );
      })}
    </BoardLayout>
  );
}

function PriorityItemCard({
  accent,
  item,
  otherBuckets,
  onMove,
  onDelete,
}: {
  accent: Accent;
  item: PrioritizedItem;
  otherBuckets: PriorityBucket[];
  onMove: (to: PriorityBucket) => void;
  onDelete: () => void;
}) {
  return (
    <StickyCard
      accent={accent}
      onDelete={onDelete}
      chips={
        item.targetPersona ? (
          <Chip mono truncate>
            {item.targetPersona}
          </Chip>
        ) : null
      }
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-foreground"
                aria-label="Mover"
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
                  onClick={() => onMove(target)}
                  className="gap-2 text-xs"
                >
                  <ArrowRight className="size-3" />
                  Mover pra {cfg.title}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
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
  );
}
