import Link from "next/link";
import { ChevronRight, Presentation, BookOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { decks } from "@/content/decks/registry";

const KIND_ICON = {
  deck: Presentation,
  guide: BookOpen,
} as const;

const KIND_LABEL = {
  deck: "Deck",
  guide: "Guia",
} as const;

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export default function WorkflowLibraryPage() {
  const sorted = [...decks].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workflow"
        description="Biblioteca de conteúdos Volund — playbooks, decks e guias do nosso jeito de operar."
      />

      {sorted.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhum conteúdo publicado ainda.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((deck) => {
          const KindIcon = KIND_ICON[deck.kind];
          return (
            <Link
              key={deck.slug}
              href={`/workflow/${deck.slug}`}
              className="group block"
            >
              <Card className="h-full transition-colors group-hover:border-primary/50">
                <CardContent className="p-4 space-y-3 h-full flex flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-1.5 min-w-0">
                      <div className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                        <span className="h-1 w-1 rounded-full bg-primary" />
                        {deck.eyebrow}
                      </div>
                      <h3 className="text-lg font-semibold tracking-tight">
                        {deck.title}
                      </h3>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                  </div>

                  <p className="text-sm text-muted-foreground line-clamp-3 flex-1">
                    {deck.description}
                  </p>

                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {deck.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-md bg-muted/40 px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center justify-between border-t border-border/60 pt-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <KindIcon className="h-3.5 w-3.5" />
                      <span className="font-mono uppercase tracking-[0.18em]">
                        {KIND_LABEL[deck.kind]} · {deck.slideCount} slides
                      </span>
                    </span>
                    <span className="font-mono">
                      {dateFormatter.format(new Date(deck.updatedAt))}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
