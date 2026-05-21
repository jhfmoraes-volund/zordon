// One-shot: cria bucket público `persona-avatars` e sobe as 4 PNGs
// originais (das assets do ChatGPT) como persona-1..4.png.
//
// Uso: node scripts/upload-persona-avatars.mjs
// Requer: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY no .env

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { config } from "dotenv";

config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE env vars (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const BUCKET = "persona-avatars";

const ASSETS_DIR = ".claude/skills/supabase/assets";
const files = [
  { src: `${ASSETS_DIR}/ChatGPT Image May 21, 2026, 01_33_10 PM.png`, dest: "persona-1.png" },
  { src: `${ASSETS_DIR}/ChatGPT Image May 21, 2026, 01_33_14 PM.png`, dest: "persona-2.png" },
  { src: `${ASSETS_DIR}/ChatGPT Image May 21, 2026, 01_33_19 PM.png`, dest: "persona-3.png" },
  { src: `${ASSETS_DIR}/ChatGPT Image May 21, 2026, 01_33_26 PM.png`, dest: "persona-4.png" },
];

async function ensureBucket() {
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) throw listErr;
  const exists = buckets?.some((b) => b.name === BUCKET);
  if (exists) {
    console.log(`[bucket] '${BUCKET}' already exists — ensuring public + limits`);
    const { error: updErr } = await supabase.storage.updateBucket(BUCKET, {
      public: true,
      fileSizeLimit: 5 * 1024 * 1024,
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    });
    if (updErr) throw updErr;
    return;
  }
  console.log(`[bucket] creating '${BUCKET}' (public)`);
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 5 * 1024 * 1024,
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
  });
  if (error) throw error;
}

async function uploadAll() {
  const results = [];
  for (const f of files) {
    const body = readFileSync(f.src);
    const { error } = await supabase.storage.from(BUCKET).upload(f.dest, body, {
      contentType: "image/png",
      upsert: true,
      cacheControl: "31536000",
    });
    if (error) {
      console.error(`[upload] FAIL ${f.dest}:`, error.message);
      throw error;
    }
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(f.dest);
    console.log(`[upload] OK   ${f.dest} -> ${data.publicUrl}`);
    results.push({ dest: f.dest, url: data.publicUrl });
  }
  return results;
}

async function verify(results) {
  for (const r of results) {
    const res = await fetch(r.url, { method: "HEAD" });
    console.log(
      `[verify] ${r.dest}: HTTP ${res.status} (${res.headers.get("content-type")}, ${res.headers.get("content-length")} bytes)`,
    );
  }
}

await ensureBucket();
const results = await uploadAll();
await verify(results);
console.log("\nDONE");
