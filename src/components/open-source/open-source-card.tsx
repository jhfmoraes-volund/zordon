import { cn } from "@/lib/utils";
import type { OpenSourceCardRow } from "@/lib/dal/open-source";
import { OpenSourcePhoto } from "./open-source-photo";

function formatArchive(n: number): string {
  return `#${String(n).padStart(3, "0")}`;
}

function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "font-mono text-[10px] uppercase tracking-[0.22em] text-brand/70",
        className,
      )}
    >
      [ {children} ]
    </p>
  );
}

function Panel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/10 bg-white/[0.02] p-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Tag({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-xs text-white/80",
        className,
      )}
    >
      {children}
    </span>
  );
}

function FactList({
  facts,
}: {
  facts: { label: string; value: string }[];
}) {
  return (
    <div className="mt-4 space-y-4">
      {facts.map((f, i) => (
        <div key={i}>
          <p className="font-mono text-[10px] lowercase tracking-wide text-white/35">
            {f.label}
          </p>
          <p className="mt-0.5 text-[15px] font-semibold text-white/90">
            {f.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function EqualizerBars() {
  return (
    <span aria-hidden className="flex items-end gap-0.5 h-3.5">
      <span className="w-0.5 bg-brand/80 h-1.5" />
      <span className="w-0.5 bg-brand/80 h-3.5" />
      <span className="w-0.5 bg-brand/80 h-2" />
      <span className="w-0.5 bg-brand/80 h-3" />
    </span>
  );
}

export function OpenSourceCard({ card }: { card: OpenSourceCardRow }) {
  const attribution = card.quoteAttribution ?? card.name;

  return (
    <div className="font-sans relative mx-auto w-full max-w-[860px] overflow-hidden rounded-3xl border border-white/10 bg-[#0a0a0b] p-6 text-white shadow-2xl sm:p-8">
      {/* subtle brand glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 right-0 h-64 w-64 rounded-full bg-brand/10 blur-3xl"
      />

      <div className="relative space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-display text-3xl font-light leading-none tracking-[0.18em] text-white">
              VOLUND
            </p>
            <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.3em] text-white/35">
              By Extreme Group
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-brand/80">
              Arquivo {formatArchive(card.archiveNumber)}
            </p>
            <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.25em] text-white/35">
              {card.category}
            </p>
          </div>
        </div>

        {/* Profile */}
        <Panel className="flex items-center gap-5">
          <OpenSourcePhoto
            name={card.name}
            photoStoragePath={card.photoStoragePath}
            photoUpdatedAt={card.photoUpdatedAt}
            className="size-20 sm:size-24"
          />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-bold sm:text-3xl">
              {card.name}
            </h1>
            {card.title ? (
              <p className="mt-0.5 font-mono text-sm text-white/45">
                {`// ${card.title}`}
              </p>
            ) : null}
            {card.tags.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {card.tags.map((t, i) => (
                  <Tag key={i}>{t}</Tag>
                ))}
              </div>
            ) : null}
          </div>
        </Panel>

        {/* Quote */}
        {card.quote ? (
          <Panel className="border-l-2 border-l-brand">
            <p className="text-base leading-relaxed text-white/85 sm:text-lg">
              &ldquo;{card.quote}&rdquo;
            </p>
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
              ~ {attribution}
            </p>
          </Panel>
        ) : null}

        {/* Humano / Builder */}
        {(card.humanFacts.length > 0 || card.builderFacts.length > 0) && (
          <div className="grid gap-4 md:grid-cols-2">
            {card.humanFacts.length > 0 ? (
              <Panel>
                <SectionLabel>Humano</SectionLabel>
                <FactList facts={card.humanFacts} />
              </Panel>
            ) : null}
            {card.builderFacts.length > 0 ? (
              <Panel>
                <SectionLabel>Builder</SectionLabel>
                <FactList facts={card.builderFacts} />
              </Panel>
            ) : null}
          </div>
        )}

        {/* Pode me chamar para */}
        {card.callMeFor.length > 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/[0.92] p-5 text-neutral-900">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-neutral-500">
              [ Pode me chamar para ]
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {card.callMeFor.map((c, i) => (
                <span
                  key={i}
                  className="inline-flex items-center rounded-full border border-neutral-300 px-3 py-1 text-xs text-neutral-700"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {/* Chat / (Verdades + Soundtrack) */}
        <div className="grid gap-4 md:grid-cols-2">
          {card.chat.length > 0 ? (
            <Panel>
              <SectionLabel>Chat</SectionLabel>
              <div className="mt-4 space-y-5">
                {card.chat.map((c, i) => (
                  <div key={i} className="space-y-2">
                    <div className="max-w-[85%]">
                      <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.2em] text-white/30">
                        Pergunta
                      </p>
                      <div className="rounded-2xl rounded-tl-sm bg-white/[0.05] px-3.5 py-2.5 text-sm text-white/80">
                        {c.question}
                      </div>
                    </div>
                    <div className="ml-auto max-w-[88%]">
                      <div className="rounded-2xl rounded-br-sm border border-brand/30 bg-brand/15 px-3.5 py-2.5 text-sm text-white/90">
                        {c.answer}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}

          <div className="space-y-4">
            {card.truthsAndLie.length > 0 ? (
              <Panel>
                <SectionLabel>2 verdades e 1 mentira</SectionLabel>
                <ol className="mt-4 space-y-3">
                  {card.truthsAndLie.map((t, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="font-mono text-[11px] text-white/30">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="text-sm text-white/80">{t}</span>
                    </li>
                  ))}
                </ol>
                <p className="mt-4 font-mono text-[9px] uppercase tracking-[0.2em] text-white/25">
                  Qual é a mentira? Responde no grupo
                </p>
              </Panel>
            ) : null}

            {card.soundtrack.length > 0 ? (
              <Panel>
                <SectionLabel>Soundtrack</SectionLabel>
                <ol className="mt-4 space-y-3">
                  {card.soundtrack.map((s, i) => (
                    <li key={i} className="flex items-center gap-3">
                      <span className="font-mono text-[11px] text-white/30">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-white/90">
                          {s.title}
                        </p>
                        <p className="truncate text-xs text-white/40">
                          {s.artist}
                        </p>
                      </div>
                      {i === 0 ? <EqualizerBars /> : null}
                    </li>
                  ))}
                </ol>
              </Panel>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
