import "dotenv/config";
import { GranolaClient, transcriptToText } from "../src/lib/granola";

// ─── Args ────────────────────────────────────────────────
//   pnpm tsx scripts/granola-recent.ts                    # last 30 days
//   pnpm tsx scripts/granola-recent.ts 7                   # last 7 days
//   pnpm tsx scripts/granola-recent.ts 2026-05-15          # single day
//   pnpm tsx scripts/granola-recent.ts 30 not_xxx          # also fetch detail of one note

const RANGE_ARG = process.argv[2] || "30";
const DETAIL_ID = process.argv[3] || null;

const isSingleDay = /^\d{4}-\d{2}-\d{2}$/.test(RANGE_ARG);
const DAYS = isSingleDay ? 0 : Number(RANGE_ARG);
const SINGLE_DAY = isSingleDay ? RANGE_ARG : null;

const fmt = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});

async function main() {
  const apiKey = process.env.GRANOLA_KEY?.trim();
  if (!apiKey) {
    console.error("GRANOLA_KEY missing in .env");
    process.exit(1);
  }

  const client = new GranolaClient(apiKey);

  const sinceISO = SINGLE_DAY
    ? new Date(`${SINGLE_DAY}T00:00:00`).toISOString()
    : (() => {
        const d = new Date();
        d.setDate(d.getDate() - DAYS);
        return d.toISOString();
      })();
  const untilISO = SINGLE_DAY
    ? new Date(`${SINGLE_DAY}T23:59:59.999`).toISOString()
    : undefined;

  const range = SINGLE_DAY ? `em ${SINGLE_DAY}` : `nos últimos ${DAYS} dias`;
  console.log(`▶ Granola — listando notas ${range}…\n`);

  const notes = await client.listNotesInRange({
    since: sinceISO,
    until: untilISO,
    max: 50,
  });

  console.log(`${notes.length} nota(s) encontrada(s).\n`);

  for (const n of notes) {
    const date = fmt.format(new Date(n.created_at));
    console.log(`• ${date} — ${n.title || "Sem título"}`);
    console.log(`  owner: ${n.owner?.name ?? "—"}`);
    console.log(`  id: ${n.id}\n`);
  }

  if (DETAIL_ID) {
    console.log(`\n▶ Detalhe de ${DETAIL_ID} (com transcript)…\n`);
    const detail = await client.getNote(DETAIL_ID, { includeTranscript: true });
    console.log(`Título: ${detail.title || detail.calendar_event?.event_title || "—"}`);
    console.log(`Owner: ${detail.owner?.name ?? "—"} <${detail.owner?.email ?? "—"}>`);
    console.log(`Criada em: ${fmt.format(new Date(detail.created_at))}`);
    if (detail.calendar_event?.scheduled_start_time) {
      const s = fmt.format(new Date(detail.calendar_event.scheduled_start_time));
      const e = detail.calendar_event.scheduled_end_time
        ? fmt.format(new Date(detail.calendar_event.scheduled_end_time))
        : "—";
      console.log(`Evento: ${s} → ${e}`);
    }
    const attendees = detail.attendees ?? [];
    if (attendees.length) {
      console.log(`\nAttendees (${attendees.length}):`);
      for (const a of attendees) console.log(`  – ${a.name ?? "—"} <${a.email ?? "—"}>`);
    }
    console.log(`\nSumário:\n${detail.summary_text || "(vazio)"}\n`);
    const lines = detail.transcript ?? [];
    console.log(`Transcript — ${lines.length} linha(s):`);
    const text = transcriptToText(lines);
    console.log(text.length > 2000 ? `${text.slice(0, 2000)}\n…(truncado)` : text);
  }
}

main().catch((e) => {
  console.error("✖", e);
  process.exit(1);
});
