import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const EMAIL = process.argv[2] || "jh.moraes93@gmail.com";
const FILTER = (process.argv[3] || "").toLowerCase();
// arg4: number of days back (default 30) OR a YYYY-MM-DD for a single day
const RANGE_ARG = process.argv[4] || "30";
const isSingleDay = /^\d{4}-\d{2}-\d{2}$/.test(RANGE_ARG);
const DAYS = isSingleDay ? 0 : Number(RANGE_ARG);
const SINGLE_DAY = isSingleDay ? RANGE_ARG : null;

async function main() {
  const { data: member, error: memErr } = await sb
    .from("Member")
    .select("id, name, email")
    .eq("email", EMAIL)
    .maybeSingle();
  if (memErr || !member) {
    console.error("Member not found:", EMAIL, memErr?.message);
    process.exit(1);
  }
  console.log(`Member: ${member.name} <${member.email}>`);

  const { data: token, error: tokErr } = await sb.rpc("get_member_integration_secret", {
    p_member_id: member.id,
    p_provider: "roam",
  });
  if (tokErr) {
    console.error("RPC error:", tokErr.message);
    process.exit(1);
  }
  if (!token) {
    console.error("No Roam token connected for this member.");
    process.exit(1);
  }

  // The Roam API quirk: when `after` is set with a `limit`, it pages ASC and
  // truncates the most recent items silently (sets nextCursor without surfacing it).
  // Fix: page DESC without `after`, stop when start < sinceTime.
  const sinceTime = SINGLE_DAY
    ? new Date(`${SINGLE_DAY}T00:00:00`).getTime()
    : (() => {
        const d = new Date();
        d.setDate(d.getDate() - DAYS);
        return d.getTime();
      })();
  const untilTime = SINGLE_DAY
    ? new Date(`${SINGLE_DAY}T23:59:59.999`).getTime()
    : Infinity;

  type T = {
    id: string;
    start: string;
    end: string;
    eventName?: string;
    participants: Array<{ name: string; email?: string; type: string }>;
  };
  const list: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({ limit: "50" });
    if (cursor) qs.set("cursor", cursor);
    const res = await fetch(`https://api.ro.am/v0/transcript.list?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.error(`Roam API ${res.status}:`, await res.text());
      process.exit(1);
    }
    const body = (await res.json()) as { transcripts: T[]; nextCursor?: string };
    let stop = false;
    for (const t of body.transcripts || []) {
      const ts = new Date(t.start).getTime();
      if (ts < sinceTime) { stop = true; break; }
      if (ts > untilTime) continue;
      list.push(t);
    }
    if (stop || !body.nextCursor) break;
    cursor = body.nextCursor;
  }
  const range = SINGLE_DAY ? `em ${SINGLE_DAY}` : `nos últimos ${DAYS} dias`;
  console.log(`\n${list.length} transcrição(ões) ${range}.`);

  const filtered = FILTER
    ? list.filter((t) =>
        t.participants.some((p) => p.name.toLowerCase().includes(FILTER)),
      )
    : list;

  if (FILTER) console.log(`${filtered.length} com participante "${FILTER}":\n`);
  for (const t of filtered) {
    const date = new Date(t.start).toLocaleString("pt-BR");
    const dur = Math.round(
      (new Date(t.end).getTime() - new Date(t.start).getTime()) / 60000,
    );
    const names = t.participants.map((p) => p.name).join(", ");
    console.log(`• ${date} (${dur}min) — ${t.eventName || "Sem título"}`);
    console.log(`  participantes: ${names}`);
    console.log(`  id: ${t.id}\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
