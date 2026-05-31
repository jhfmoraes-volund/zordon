"use client";

import { useEffect, useState } from "react";

type DiffData = {
  patch: string;
  files: string[];
};

export function DiffTab({ taskId }: { taskId: string }) {
  const [data, setData] = useState<DiffData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchDiff() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/forge/tasks/${taskId}/diff`);

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        const json = await res.json();

        if (mounted) {
          setData(json);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    fetchDiff();

    return () => {
      mounted = false;
    };
  }, [taskId]);

  if (loading) {
    return (
      <div className="grid h-full place-items-center px-6 py-8 text-center text-sm text-muted-foreground">
        Carregando diff…
      </div>
    );
  }

  if (error) {
    return (
      <div className="grid h-full place-items-center px-6 py-8 text-center text-sm text-destructive">
        Erro ao carregar diff: {error}
      </div>
    );
  }

  if (!data || data.patch.length === 0) {
    return (
      <div className="grid h-full place-items-center px-6 py-8 text-center text-sm text-muted-foreground">
        Nenhuma mudança detectada ainda.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-6 py-4">
      {data.files.length > 0 && (
        <div className="mb-4 space-y-1">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Arquivos modificados ({data.files.length})
          </div>
          <ul className="space-y-0.5">
            {data.files.map((file) => (
              <li
                key={file}
                className="font-mono text-xs text-muted-foreground"
              >
                {file}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
        Diff
      </div>
      <pre className="overflow-x-auto rounded-md border border-border/60 bg-muted/20 p-3 font-mono text-[11px] leading-relaxed">
        {data.patch}
      </pre>
    </div>
  );
}
