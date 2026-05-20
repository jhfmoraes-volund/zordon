"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Lock, Check, Loader2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

/**
 * Per-member private notes attached to a meeting.
 *
 * Strictly private by design — the underlying table's RLS allows only the
 * acting member to read/write their own row, and the route also gates by
 * canViewMeeting(). No admin bypass.
 *
 * UX: single textarea, autosize-ish (rows=6 default; grows with content via
 * field-sizing where supported). Autosaves on a 900ms debounce; status
 * indicator collapses to "Salvo" when idle, "Salvando…" while in-flight.
 */

const AUTOSAVE_DEBOUNCE_MS = 900;

type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export function PersonalNoteCard({ meetingId }: { meetingId: string }) {
  const [content, setContent] = useState<string>("");
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const lastSavedRef = useRef<string>("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/meetings/${meetingId}/personal-note`);
        if (!res.ok) {
          if (!cancelled) setInitialLoaded(true);
          return;
        }
        const data = (await res.json()) as { content: string; updatedAt: string | null };
        if (cancelled) return;
        setContent(data.content ?? "");
        lastSavedRef.current = data.content ?? "";
        setUpdatedAt(data.updatedAt);
        setInitialLoaded(true);
      } catch {
        if (!cancelled) setInitialLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  const persist = useCallback(
    async (next: string) => {
      setStatus("saving");
      try {
        const res = await fetch(`/api/meetings/${meetingId}/personal-note`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: next }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { content: string; updatedAt: string };
        lastSavedRef.current = data.content;
        setUpdatedAt(data.updatedAt);
        setStatus("saved");
      } catch {
        setStatus("error");
      }
    },
    [meetingId],
  );

  // Debounced autosave on content change. Skipped before the initial fetch
  // finishes to avoid an empty PUT race.
  useEffect(() => {
    if (!initialLoaded) return;
    if (content === lastSavedRef.current) return;
    setStatus("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void persist(content);
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [content, initialLoaded, persist]);

  // Flush on tab/window blur — prevents losing the last keystroke if the user
  // closes the tab before the debounce fires.
  useEffect(() => {
    const flush = () => {
      if (content !== lastSavedRef.current) void persist(content);
    };
    window.addEventListener("blur", flush);
    return () => window.removeEventListener("blur", flush);
  }, [content, persist]);

  const indicator = renderStatus(status, updatedAt);

  return (
    <div className="surface p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Lock className="h-3.5 w-3.5 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Minhas notas</h2>
        </div>
        <div className="text-xs text-muted-foreground">{indicator}</div>
      </div>

      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={6}
        placeholder="Anotações pessoais — só você vê. Nem o admin enxerga."
        disabled={!initialLoaded}
        className="resize-y"
      />
    </div>
  );
}

function renderStatus(status: SaveStatus, updatedAt: string | null): React.ReactNode {
  if (status === "saving") {
    return (
      <span className="inline-flex items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin" /> Salvando…
      </span>
    );
  }
  if (status === "dirty") return <span>Editando…</span>;
  if (status === "error") return <span className="text-destructive">Erro ao salvar</span>;
  if (status === "saved" || updatedAt) {
    return (
      <span className="inline-flex items-center gap-1">
        <Check className="h-3 w-3 text-green-600" /> Salvo
      </span>
    );
  }
  return null;
}
