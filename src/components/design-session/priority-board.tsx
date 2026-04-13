"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Trash2 } from "lucide-react";

export type PriorityBucket = "mvp" | "next" | "out";

export type PrioritizedItem = {
  id: string;
  title: string;
  howItSolves: string;
  targetPersona: string;
  bucket: PriorityBucket;
};

type PriorityBoardProps = {
  items: PrioritizedItem[];
  onMove: (itemId: string, toBucket: PriorityBucket) => void;
  onDelete: (itemId: string) => void;
};

const bucketConfig: Record<PriorityBucket, { title: string; description: string; color: string; badgeColor: string }> = {
  mvp: {
    title: "MVP",
    description: "Entra agora. Essencial pro primeiro release.",
    color: "bg-green-500/10 border-green-500/20",
    badgeColor: "bg-green-500/20 text-green-400",
  },
  next: {
    title: "Next",
    description: "Proximo ciclo. Importante, mas nao pra agora.",
    color: "bg-blue-500/10 border-blue-500/20",
    badgeColor: "bg-blue-500/20 text-blue-400",
  },
  out: {
    title: "Out",
    description: "Fora do escopo. Documentado pra futuro.",
    color: "bg-muted/40 border-muted",
    badgeColor: "bg-muted text-muted-foreground",
  },
};

const bucketOrder: PriorityBucket[] = ["mvp", "next", "out"];

export function PriorityBoard({ items, onMove, onDelete }: PriorityBoardProps) {
  return (
    <div className="grid md:grid-cols-3 gap-4">
      {bucketOrder.map((bucket) => {
        const config = bucketConfig[bucket];
        const bucketItems = items.filter((i) => i.bucket === bucket);
        const otherBuckets = bucketOrder.filter((b) => b !== bucket);

        return (
          <Card key={bucket} className={config.color}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm">
                    <Badge className={config.badgeColor}>{config.title}</Badge>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {bucketItems.length} {bucketItems.length === 1 ? "item" : "items"}
                    </span>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">{config.description}</p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {bucketItems.map((item) => (
                <div key={item.id} className="rounded-lg bg-card ring-1 ring-foreground/5 p-3 space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium">{item.title}</p>
                      {item.targetPersona && (
                        <p className="text-xs text-muted-foreground">Persona: {item.targetPersona}</p>
                      )}
                    </div>
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => onDelete(item.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  {item.howItSolves && (
                    <p className="text-xs text-muted-foreground">{item.howItSolves}</p>
                  )}
                  <div className="flex gap-1">
                    {otherBuckets.map((target) => (
                      <Button
                        key={target}
                        variant="outline"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() => onMove(item.id, target)}
                      >
                        <ArrowRight className="h-3 w-3 mr-1" />
                        {bucketConfig[target].title}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
              {bucketItems.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">
                  Arraste solucoes aqui ou use os botoes para mover.
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
