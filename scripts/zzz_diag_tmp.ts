import { createAdminClient } from "@/lib/supabase/admin";

async function main() {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("ContextSource")
    .select("id", { count: "exact", head: true })
    .eq("projectId", "2bba2f4b-fae3-4465-b03f-0c3842ef47ec"); // Riple 1
  console.log("PROBE OK — Riple 1 ContextSource count:", count, "err:", error?.message ?? "none");
}
main().then(() => process.exit(0)).catch((e) => { console.error("PROBE FAIL:", e); process.exit(1); });
