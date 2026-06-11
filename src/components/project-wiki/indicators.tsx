"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2, Check, X } from "lucide-react";
import { useWikiItems } from "@/hooks/use-wiki-items";
import { SectionWrapper } from "./section-wrapper";
import { indicatorStatusConfig } from "./constants";
import type { IndicatorItem, SectionProps } from "./types";

export function IndicatorsSection({
  section,
  onUpdate,
  mode = "edit",
  hideHeader,
}: SectionProps) {
  const readOnly = mode === "read";
  const { items, add, remove, updateItem, adding, setAdding } =
    useWikiItems<IndicatorItem>(section, onUpdate as (data: IndicatorItem[]) => Promise<void>);
  const [form, setForm] = useState({
    indicator: "",
    target: "",
    current: "",
    status: "on_track",
  });

  const handleAdd = () => {
    if (!form.indicator) return;
    add({ ...form });
    setForm({ indicator: "", target: "", current: "", status: "on_track" });
    setAdding(false);
  };

  return (
    <SectionWrapper
      title={section.title}
      sectionKey="success_indicators"
      onAdd={readOnly ? undefined : () => setAdding(!adding)}
      hideHeader={hideHeader}
    >
      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((ind, i) => {
            const cfg =
              indicatorStatusConfig[ind.status] ||
              indicatorStatusConfig.on_track;
            return (
              <div
                key={i}
                className="group flex items-center gap-3 surface-inset px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium">{ind.indicator}</span>
                </div>
                <div className="flex items-center gap-3 text-xs shrink-0">
                  <div className="text-muted-foreground">
                    Meta:{" "}
                    <span className="font-medium text-foreground">
                      {ind.target}
                    </span>
                  </div>
                  <div className="text-muted-foreground">
                    Atual:{" "}
                    {readOnly ? (
                      <span className="font-medium text-foreground">
                        {ind.current || "—"}
                      </span>
                    ) : (
                      <input
                        className="font-medium text-foreground bg-transparent border-b border-dashed border-muted-foreground/30 w-16 text-center focus:outline-none focus:border-primary"
                        value={ind.current}
                        onChange={(e) =>
                          updateItem(i, { current: e.target.value })
                        }
                      />
                    )}
                  </div>
                  {readOnly ? (
                    <Badge
                      variant="secondary"
                      className={`text-[10px] ${cfg.color}`}
                    >
                      {cfg.label}
                    </Badge>
                  ) : (
                    <Select
                      value={ind.status}
                      onValueChange={(v) =>
                        v && updateItem(i, { status: v })
                      }
                    >
                      <SelectTrigger className="h-6 w-[110px] text-xs">
                        <SelectValue>
                          <Badge
                            variant="secondary"
                            className={`text-[10px] ${cfg.color}`}
                          >
                            {cfg.label}
                          </Badge>
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(indicatorStatusConfig).map(
                          ([key, c]) => (
                            <SelectItem key={key} value={key}>
                              <Badge
                                variant="secondary"
                                className={`text-[10px] ${c.color}`}
                              >
                                {c.label}
                              </Badge>
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                {!readOnly && (
                  <button
                    onClick={() => remove(i)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-500" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {items.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground px-1">
          Nenhum indicador cadastrado.
        </p>
      )}

      {adding && (
        <div className="flex items-end gap-2">
          <div className="grid gap-1 flex-[2]">
            <Input
              placeholder="Indicador (ex: NPS > 80)"
              value={form.indicator}
              onChange={(e) =>
                setForm({ ...form, indicator: e.target.value })
              }
            />
          </div>
          <div className="grid gap-1 flex-1">
            <Input
              placeholder="Meta"
              value={form.target}
              onChange={(e) => setForm({ ...form, target: e.target.value })}
            />
          </div>
          <div className="grid gap-1 flex-1">
            <Input
              placeholder="Atual"
              value={form.current}
              onChange={(e) =>
                setForm({ ...form, current: e.target.value })
              }
            />
          </div>
          <Select
            value={form.status}
            onValueChange={(v) => v && setForm({ ...form, status: v })}
          >
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(indicatorStatusConfig).map(([key, c]) => (
                <SelectItem key={key} value={key}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="icon" className="h-9 w-9" onClick={handleAdd}>
            <Check className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-9 w-9"
            onClick={() => setAdding(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
    </SectionWrapper>
  );
}
