"use client";

import { useCallback, useEffect, useState } from "react";
import { Play, Pause, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useForge, useForgeSlice } from "@/hooks/use-forge-store";
import type { ForgeState } from "@/lib/forge/types";

const selectStatus = (s: ForgeState) => s.run?.status ?? null;

export function ForgeControls() {
  const { source, store } = useForge();
  const status = useForgeSlice(selectStatus);
  const [speed, setSpeed] = useState(1);
  const [isPaused, setIsPaused] = useState(false);

  const start = useCallback(() => {
    store.reset();
    source.reset();
    source.setSpeed(speed);
    source.start();
    setIsPaused(false);
  }, [source, store, speed]);

  const togglePause = useCallback(() => {
    if (!source.isRunning() && !isPaused) return;
    if (isPaused) {
      source.resume();
      setIsPaused(false);
    } else {
      source.pause();
      setIsPaused(true);
    }
  }, [source, isPaused]);

  const reset = useCallback(() => {
    source.reset();
    store.reset();
    setIsPaused(false);
  }, [source, store]);

  const cycleSpeed = useCallback(() => {
    const next = speed === 1 ? 2 : speed === 2 ? 4 : 1;
    setSpeed(next);
    source.setSpeed(next);
  }, [source, speed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement) {
        const tag = e.target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        togglePause();
      } else if (e.key === "r" || e.key === "R") {
        reset();
      } else if (e.key === "1" || e.key === "2" || e.key === "4") {
        const v = Number(e.key);
        setSpeed(v);
        source.setSpeed(v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePause, reset, source]);

  const hasRun = status !== null;
  const canPause = hasRun && status === "running";

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={start}>
        <Play />
        Start
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={togglePause}
        disabled={!canPause && !isPaused}
      >
        <Pause />
        {isPaused ? "Resume" : "Pause"}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={reset}
        disabled={!hasRun}
      >
        <RotateCcw />
        Reset
      </Button>
      <button
        type="button"
        onClick={cycleSpeed}
        className="ml-1 inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-1 transition-colors hover:bg-muted/60"
      >
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Speed
        </span>
        <span className="font-mono text-xs tabular-nums">{speed}×</span>
      </button>
    </div>
  );
}
