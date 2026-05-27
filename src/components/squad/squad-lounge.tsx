"use client";

/**
 * Squad lounge — the squad's mural. Members pin written notes (post-its) to a
 * corkboard; others give kudos. Header banner + standard Big Numbers sit on top
 * for context.
 *
 * Phase 1 is a MOCK: posts live in local state, no persistence. Once the visual
 * is approved, the mural wires to a `SquadPost` table (write = squad member,
 * read = Builder+) and Supabase Realtime. Markers below: // TODO(SquadPost).
 */

import { useEffect, useMemo, useState } from "react";
import { PageTitle } from "@/components/app-shell/page-title/page-title";
import { Badge } from "@/components/ui/badge";
import { PixelHud } from "@/components/ui/pixel-bar";
import { BoardColumn } from "@/components/design-session/board";
import { FolderOpen, StickyNote } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { SquadBigNumbers, type SquadMetrics } from "./big-numbers";
import { MuralPost, type MuralPostData } from "./mural-post";

type Payload = {
  squad: {
    id: string;
    name: string;
    projectSquads: { id: string; project: { id: string; name: string } | null }[];
    members: { id: string; member: { id: string; name: string } | null }[];
  };
  metrics: SquadMetrics;
};

/** Mock seed so the corkboard isn't empty during the prototype. */
function seedPosts(): MuralPostData[] {
  const now = Date.now();
  return [
    {
      id: "seed-1",
      body: "subimos o deploy de sexta sem rollback 🚀 boa, time!",
      authorName: "Ana",
      createdAt: new Date(now - 8 * 60_000).toISOString(),
      kudos: 3,
      kudosByMe: false,
    },
    {
      id: "seed-2",
      body: "alguém pega o review da PR #214 hoje? tá travando o sprint",
      authorName: "Bruno",
      createdAt: new Date(now - 95 * 60_000).toISOString(),
      kudos: 1,
      kudosByMe: false,
    },
    {
      id: "seed-3",
      body: "café novo na cozinha ☕",
      authorName: "Carla",
      createdAt: new Date(now - 26 * 60 * 60_000).toISOString(),
      kudos: 5,
      kudosByMe: true,
    },
  ];
}

export function SquadLounge({ squadId }: { squadId: string }) {
  const { member } = useAuth();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  // MOCK state — replace with fetched SquadPost rows + optimistic mutate.
  const [posts, setPosts] = useState<MuralPostData[]>(seedPosts);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/squads/${squadId}`);
        if (!res.ok) {
          const d = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(d.error || "Falha ao carregar squad");
        }
        const json = (await res.json()) as Payload;
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [squadId]);

  // Only squad members may post. In the mock we approximate membership by
  // matching the current member against the squad roster.
  const canPost = useMemo(() => {
    if (!data || !member) return false;
    return data.squad.members.some((sm) => sm.member?.id === member.id);
  }, [data, member]);

  const submit = (text: string) => {
    const body = text.trim();
    if (!body || !member) return;
    // TODO(SquadPost): POST /api/squads/[id]/posts + optimistic mutate.
    const next: MuralPostData = {
      id: `local-${Date.now()}`,
      body,
      authorName: member.name,
      createdAt: new Date().toISOString(),
      kudos: 0,
      kudosByMe: false,
    };
    setPosts((p) => [next, ...p]);
  };

  const toggleKudos = (id: string) => {
    // TODO(SquadPost): POST/DELETE /api/squads/[id]/posts/[postId]/kudos.
    setPosts((p) =>
      p.map((post) =>
        post.id === id
          ? {
              ...post,
              kudosByMe: !post.kudosByMe,
              kudos: post.kudos + (post.kudosByMe ? -1 : 1),
            }
          : post,
      ),
    );
  };

  if (error) return <p className="p-6 text-sm text-red-600">{error}</p>;
  if (!data)
    return <p className="p-6 text-sm text-muted-foreground">Carregando…</p>;

  const { squad, metrics } = data;
  const projects = (squad.projectSquads ?? [])
    .map((ps) => ps.project)
    .filter((p): p is { id: string; name: string } => Boolean(p));
  const memberCount = (squad.members ?? []).filter((sm) => sm.member).length;

  return (
    <div className="space-y-6">
      <PageTitle title={squad.name} subtitle="Lounge do squad" backHref="/squads" />

      {/* Banner */}
      <div className="rounded-lg border bg-gradient-to-br from-muted/60 to-background p-5">
        <h1 className="text-2xl font-bold leading-tight">{squad.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <PixelHud size="xs" tone="muted">
            {memberCount} membro{memberCount === 1 ? "" : "s"}
          </PixelHud>
          <span className="text-muted-foreground/40">·</span>
          {projects.length > 0 ? (
            projects.map((p) => (
              <Badge key={p.id} variant="secondary" className="text-xs">
                <FolderOpen className="mr-1 h-3 w-3" />
                {p.name}
              </Badge>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">Sem projetos</span>
          )}
        </div>
      </div>

      <SquadBigNumbers metrics={metrics} />

      {/* The mural — board column (DS kanban frame) holding written post-its.
          BoardColumn renders the header/count, the empty-state, and the
          add-row footer; only squad members get the add-row (canPost). */}
      <BoardColumn
        accent="amber"
        icon={<StickyNote className="size-4" />}
        eyebrow="Lounge"
        title="Mural"
        subtitle="Recados do squad"
        count={posts.length}
        countLabel="recado"
        emptyIcon={StickyNote}
        emptyTitle="Mural vazio"
        emptyHint="Seja o primeiro a deixar um recado no mural do squad."
        onAdd={canPost ? submit : undefined}
        addPlaceholder="Deixe um recado no mural…"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post, i) => (
            <MuralPost
              key={post.id}
              post={post}
              index={i}
              onKudos={toggleKudos}
            />
          ))}
        </div>
      </BoardColumn>

      {!canPost ? (
        <p className="text-center text-xs text-muted-foreground">
          Só membros deste squad podem escrever no mural.
        </p>
      ) : null}
    </div>
  );
}
