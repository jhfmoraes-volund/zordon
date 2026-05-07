// Edge Function: telegram-notify
//
// POST { notificationId } — invoked by the AFTER INSERT trigger on
// public."Notification" via pg_net. Authenticated by service-role bearer
// (the trigger pulls the key from Vault).
//
// Skips silently when:
//  - recipient has no telegramChatId
//  - kind is in telegramKindsDisabled
//  - notification was a coalesce-merge (count > 1 without batchId)
// Sends one consolidated message when:
//  - notification has batchId (intentional bulk action)
//
// On Telegram 403 (user blocked the bot) the recipient's chatId is wiped,
// so the next notification stays in-app only.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { pickQuote, type QuoteCategory } from "./quotes.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Dedicated shared secret between the AFTER INSERT trigger (reads from Vault)
// and this function. Decoupled from SUPABASE_SERVICE_ROLE_KEY to avoid
// breakage when the project's service-role key rotates independently of the
// value seeded into Vault.
const NOTIFY_AUTH_TOKEN = Deno.env.get("TELEGRAM_NOTIFY_AUTH_TOKEN")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const APP_BASE_URL =
  Deno.env.get("APP_BASE_URL") ?? "https://volund.app"; // adjust per env

const TELEGRAM_API = "https://api.telegram.org";
const MAX_RETRIES = 3;
const DAILY_TODO_LIST_LIMIT = 12;
const DAILY_TODO_BUCKET_QUOTA = 5; // soft cap per bucket; redistributed downstream

type Payload = {
  title?: string;
  snippet?: string;
  projectId?: string;
  fromStatus?: string;
  toStatus?: string;
  count?: number;
  entityIds?: string[];
  // daily_todos:
  slot?: "morning" | "evening";
  overdueCount?: number;
  todayCount?: number;
  undatedCount?: number;
  openCount?: number;
};

type NotificationRow = {
  id: string;
  recipientMemberId: string;
  kind: string;
  entityType: string;
  entityId: string;
  actorMemberId: string | null;
  batchId: string | null;
  payload: Payload;
  readAt: string | null;
  createdAt: string;
};

type MemberLite = {
  id: string;
  name: string | null;
  telegramChatId: number | null;
  telegramKindsDisabled: string[];
};

const KIND_HEADER: Record<string, string> = {
  mention: "🟢 Você foi mencionado",
  assigned: "🔵 Tarefa atribuída",
  status_changed: "🟡 Status mudou",
  sprint_started: "🚀 Sprint iniciada",
  sprint_ended: "🏁 Sprint encerrada",
  agent_task_change: "🤖 Alpha atualizou tasks",
  daily_todos: "🔔 Volund",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function entityHref(payload: Payload): string {
  if (payload.projectId) return `${APP_BASE_URL}/projects/${payload.projectId}`;
  return APP_BASE_URL;
}

type Rendered = { text: string; keyboard: InlineKeyboard | null };

function formatMessage(
  notification: NotificationRow,
  actorName: string | null,
): Rendered {
  const header = KIND_HEADER[notification.kind] ?? "🔔 Volund";
  const payload = notification.payload ?? {};
  const title = escapeHtml(payload.title ?? "—");
  const actor = actorName ? escapeHtml(actorName) : "Alpha";
  const link = entityHref(payload);

  const lines: string[] = [`<b>${header}</b>`];

  switch (notification.kind) {
    case "mention":
      lines.push(`${actor} mencionou você em <b>${title}</b>`);
      if (payload.snippet) {
        const snippet = escapeHtml(payload.snippet.slice(0, 240));
        lines.push(`<i>"${snippet}"</i>`);
      }
      break;
    case "assigned":
      lines.push(`${actor} atribuiu <b>${title}</b> pra você`);
      break;
    case "status_changed": {
      const from = escapeHtml(payload.fromStatus ?? "—");
      const to = escapeHtml(payload.toStatus ?? "—");
      lines.push(`${actor} moveu <b>${title}</b>`);
      lines.push(`<code>${from} → ${to}</code>`);
      break;
    }
    case "sprint_started":
      lines.push(`<b>${title}</b> começou.`);
      break;
    case "sprint_ended":
      lines.push(`<b>${title}</b> foi encerrada.`);
      break;
    case "agent_task_change": {
      const count = payload.count ?? payload.entityIds?.length ?? 1;
      if (notification.batchId && count > 1) {
        lines.push(`Alpha atualizou <b>${count} tasks</b>.`);
      } else {
        lines.push(`Alpha atualizou <b>${title}</b>.`);
      }
      if (payload.fromStatus && payload.toStatus) {
        lines.push(
          `<code>${escapeHtml(payload.fromStatus)} → ${escapeHtml(
            payload.toStatus,
          )}</code>`,
        );
      }
      break;
    }
    default:
      lines.push(title);
  }

  return {
    text: lines.join("\n"),
    keyboard: [[{ label: "Abrir no Volund", url: link }]],
  };
}

type TodoRow = {
  id: string;
  description: string;
  dueDate: string | null;
};

async function formatDailyTodos(
  supabase: SupabaseClient,
  notification: NotificationRow,
  memberName: string | null,
): Promise<Rendered> {
  const payload = notification.payload ?? {};
  const slot = payload.slot ?? "morning";

  // "Today" anchor in America/Sao_Paulo. We work entirely in YYYY-MM-DD
  // strings so timezone-naive timestamps from Postgres compare cleanly.
  const todayISO = brtTodayISO();
  const sundayISO = endOfWeekSundayISO(todayISO);

  // Pull todos directly so we can render real titles.
  const { data: todoRows } = await supabase
    .from("Todo")
    .select("id, description, dueDate")
    .eq("assigneeId", notification.recipientMemberId)
    .is("resolvedAt", null)
    .neq("status", "done")
    .order("dueDate", { ascending: true, nullsFirst: false })
    .limit(200);

  const todos = (todoRows ?? []) as TodoRow[];

  // Bucket by date. dueDateOnly() collapses the timestamp to YYYY-MM-DD so a
  // string compare against todayISO works regardless of HH:MM stored.
  const overdue: TodoRow[] = [];
  const dueToday: TodoRow[] = [];
  const thisWeek: TodoRow[] = [];
  const others: TodoRow[] = [];
  for (const t of todos) {
    const due = dueDateOnly(t.dueDate);
    if (!due) {
      others.push(t);
    } else if (due < todayISO) {
      overdue.push(t);
    } else if (due === todayISO) {
      dueToday.push(t);
    } else if (due <= sundayISO) {
      thisWeek.push(t);
    } else {
      others.push(t);
    }
  }

  const totalCount =
    overdue.length + dueToday.length + thisWeek.length + others.length;

  // Quota redistribution: each bucket gets up to DAILY_TODO_BUCKET_QUOTA, but
  // unused slots cascade to the next bucket — never go past the global limit.
  const buckets = [
    { items: overdue, used: 0 },
    { items: dueToday, used: 0 },
    { items: thisWeek, used: 0 },
    { items: others, used: 0 },
  ];
  let leftover = DAILY_TODO_LIST_LIMIT;
  for (const b of buckets) {
    const take = Math.min(b.items.length, DAILY_TODO_BUCKET_QUOTA, leftover);
    b.used = take;
    leftover -= take;
  }
  // Second pass: redistribute leftover slots from earliest unfilled bucket.
  for (const b of buckets) {
    if (leftover <= 0) break;
    const extra = Math.min(b.items.length - b.used, leftover);
    b.used += extra;
    leftover -= extra;
  }

  const greeting =
    slot === "morning"
      ? `☀️ Bom dia${memberName ? `, ${memberName}` : ""}!`
      : `🌙 Boa noite${memberName ? `, ${memberName}` : ""}!`;

  const category: QuoteCategory =
    slot === "morning"
      ? overdue.length > 0
        ? "morning_overdue"
        : "morning_clean"
      : overdue.length > 0
        ? "evening_overdue"
        : "evening_clean";
  const seed = `${slot}-${todayISO}-${notification.recipientMemberId}`;
  const quote = pickQuote(category, seed);

  const lines: string[] = [
    `<b>${greeting}</b>`,
    ``,
    `<i>"${escapeHtml(quote)}"</i>`,
  ];

  // ─── Render buckets ────────────────────────────────────────────────────
  if (overdue.length > 0 && buckets[0].used > 0) {
    lines.push(
      ``,
      `<b>⚠️ ${overdue.length} atrasada${overdue.length === 1 ? "" : "s"}</b>`,
    );
    for (const t of overdue.slice(0, buckets[0].used)) {
      const due = dueDateOnly(t.dueDate)!;
      lines.push(
        `• ${escapeHtml(t.description)} ${formatOverdueAge(due, todayISO)}`,
      );
    }
  }

  if (dueToday.length > 0 && buckets[1].used > 0) {
    lines.push(
      ``,
      `<b>📅 ${dueToday.length} vence${dueToday.length === 1 ? "" : "m"} hoje</b>`,
    );
    for (const t of dueToday.slice(0, buckets[1].used)) {
      lines.push(`• ${escapeHtml(t.description)}`);
    }
  }

  if (thisWeek.length > 0 && buckets[2].used > 0) {
    lines.push(
      ``,
      `<b>📆 ${thisWeek.length} esta semana</b>`,
    );
    for (const t of thisWeek.slice(0, buckets[2].used)) {
      const due = dueDateOnly(t.dueDate)!;
      lines.push(
        `• ${escapeHtml(t.description)} <i>· ${weekdayLabel(due)}</i>`,
      );
    }
  }

  if (others.length > 0 && buckets[3].used > 0) {
    lines.push(``, `<b>📝 ${others.length} outras</b>`);
    for (const t of others.slice(0, buckets[3].used)) {
      const due = dueDateOnly(t.dueDate);
      const suffix = due
        ? ` <i>· ${formatFutureDate(due)}</i>`
        : ` <i>· sem prazo</i>`;
      lines.push(`• ${escapeHtml(t.description)}${suffix}`);
    }
  }

  // Surface count of items we trimmed off.
  const shown =
    buckets[0].used + buckets[1].used + buckets[2].used + buckets[3].used;
  if (totalCount > shown) {
    lines.push(``, `<i>+${totalCount - shown} outras…</i>`);
  }

  return {
    text: lines.join("\n"),
    keyboard: [[{ label: "Ver to-dos no Volund", url: `${APP_BASE_URL}/profile` }]],
  };
}

// ─── Date helpers (BRT-anchored, string-based) ─────────────────────────────

/** Collapse a Postgres timestamp ("YYYY-MM-DDTHH:MM:SS[Z]") to YYYY-MM-DD. */
function dueDateOnly(value: string | null): string | null {
  if (!value) return null;
  return value.slice(0, 10);
}

/** Today in America/Sao_Paulo as YYYY-MM-DD. */
function brtTodayISO(): string {
  // toLocaleString with sv-SE happens to format as "YYYY-MM-DD HH:MM:SS",
  // so slicing the first 10 chars gives the local date directly — no Date
  // round-trip needed.
  return new Date().toLocaleString("sv-SE", {
    timeZone: "America/Sao_Paulo",
  }).slice(0, 10);
}

/** Sunday of the week that contains todayISO, in YYYY-MM-DD. Week is Mon→Sun. */
function endOfWeekSundayISO(todayISO: string): string {
  const d = new Date(todayISO + "T00:00:00Z");
  // getUTCDay: Sun=0, Mon=1, …, Sat=6. We want days until Sun (inclusive).
  const dow = d.getUTCDay();
  const daysUntilSun = dow === 0 ? 0 : 7 - dow;
  d.setUTCDate(d.getUTCDate() + daysUntilSun);
  return d.toISOString().slice(0, 10);
}

const WEEKDAYS_PT = [
  "domingo",
  "segunda",
  "terça",
  "quarta",
  "quinta",
  "sexta",
  "sábado",
];

function weekdayLabel(dateISO: string): string {
  const d = new Date(dateISO + "T00:00:00Z");
  return WEEKDAYS_PT[d.getUTCDay()];
}

/** "12/05" — short numeric date for items beyond this week. */
function formatFutureDate(dateISO: string): string {
  return `${dateISO.slice(8, 10)}/${dateISO.slice(5, 7)}`;
}

function formatOverdueAge(dueDateISO: string, todayISO: string): string {
  const due = new Date(dueDateISO + "T00:00:00Z").getTime();
  const today = new Date(todayISO + "T00:00:00Z").getTime();
  const days = Math.round((today - due) / 86_400_000);
  if (days <= 0) return "";
  if (days === 1) return `<i>(venceu ontem)</i>`;
  return `<i>(venceu há ${days} dias)</i>`;
}

type InlineButton = { label: string; url: string };
type InlineKeyboard = InlineButton[][];

async function sendTelegram(
  chatId: number,
  text: string,
  keyboard: InlineKeyboard | null,
): Promise<{ ok: boolean; status: number; retryAfter?: number; data: unknown }> {
  const reply_markup = keyboard
    ? {
        inline_keyboard: keyboard.map((row) =>
          row.map((b) => ({ text: b.label, url: b.url })),
        ),
      }
    : undefined;

  const res = await fetch(
    `${TELEGRAM_API}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup,
      }),
    },
  );
  const data = await res.json().catch(() => ({}));
  const retryAfter =
    res.status === 429
      ? (data as { parameters?: { retry_after?: number } }).parameters
          ?.retry_after
      : undefined;
  return { ok: res.ok, status: res.status, retryAfter, data };
}

async function sendWithRetry(
  chatId: number,
  text: string,
  keyboard: InlineKeyboard | null,
) {
  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    const r = await sendTelegram(chatId, text, keyboard);
    if (r.ok) return r;
    if (r.status === 429 && r.retryAfter !== undefined) {
      await new Promise((res) =>
        setTimeout(res, Math.min(r.retryAfter! * 1000, 10_000)),
      );
      attempt++;
      continue;
    }
    return r;
  }
  return { ok: false, status: 429, data: { description: "exhausted retries" } };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Authenticate: only the DB trigger may invoke. Both sides share a token
  // stored in Vault (DB) and Edge secrets (function); rotating it is a
  // coordinated update of the two values.
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${NOTIFY_AUTH_TOKEN}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  let notificationId: string;
  try {
    const body = await req.json();
    if (typeof body.notificationId !== "string") throw new Error();
    notificationId = body.notificationId;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Pull notification + recipient in parallel-friendly fashion.
  const { data: notif, error: notifErr } = await supabase
    .from("Notification")
    .select(
      "id, recipientMemberId, kind, entityType, entityId, actorMemberId, batchId, payload, readAt, createdAt",
    )
    .eq("id", notificationId)
    .maybeSingle();

  if (notifErr || !notif) {
    return new Response(
      JSON.stringify({ skip: "notification_not_found" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  const notification = notif as unknown as NotificationRow;

  const { data: member } = await supabase
    .from("Member")
    .select("id, name, telegramChatId, telegramKindsDisabled")
    .eq("id", notification.recipientMemberId)
    .maybeSingle<MemberLite>();

  if (!member?.telegramChatId) {
    return Response.json({ skip: "no_chat_id" });
  }

  if (member.telegramKindsDisabled?.includes(notification.kind)) {
    return Response.json({ skip: "kind_disabled" });
  }

  // Suppress coalesce merges. Heuristic: count > 1 AND no batchId means the
  // DAL merged into an existing row within the 60s window — first notif
  // already went out; further pings would just flood. Bulk actions (with
  // batchId) DO send because they represent one intentional operation.
  const count = notification.payload?.count ?? 1;
  if (count > 1 && !notification.batchId) {
    return Response.json({ skip: "coalesced_merge" });
  }

  // Resolve actor name for the message body.
  let actorName: string | null = null;
  if (notification.actorMemberId) {
    const { data: actor } = await supabase
      .from("Member")
      .select("name")
      .eq("id", notification.actorMemberId)
      .maybeSingle();
    actorName = actor?.name ?? null;
  }

  const rendered: Rendered =
    notification.kind === "daily_todos"
      ? await formatDailyTodos(supabase, notification, member.name)
      : formatMessage(notification, actorName);
  const result = await sendWithRetry(
    member.telegramChatId,
    rendered.text,
    rendered.keyboard,
  );

  if (!result.ok) {
    // 403 = user blocked the bot or deleted the chat. Drop the chatId so we
    // stop trying — they reconnect through Settings if they want it back.
    if (result.status === 403) {
      await supabase
        .from("Member")
        .update({
          telegramChatId: null,
          telegramConnectedAt: null,
        })
        .eq("id", member.id);
      return Response.json({ skip: "blocked", action: "chat_id_wiped" });
    }
    console.error("[telegram-notify] sendMessage failed", {
      status: result.status,
      data: result.data,
    });
    return Response.json(
      { error: "send_failed", status: result.status },
      { status: 200 }, // 200 so pg_net doesn't retry on logical failures
    );
  }

  return Response.json({ ok: true });
});
