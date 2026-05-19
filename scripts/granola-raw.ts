import "dotenv/config";

async function main() {
  const key = process.env.GRANOLA_KEY?.trim();
  if (!key) throw new Error("GRANOLA_KEY missing");

  // Raw list (limit 2 to keep output small)
  const listRes = await fetch("https://public-api.granola.ai/v1/notes?limit=2", {
    headers: { Authorization: `Bearer ${key}` },
  });
  console.log("=== LIST status:", listRes.status);
  const list = await listRes.json();
  console.log(JSON.stringify(list, null, 2));

  // Take first id and fetch detail w/ transcript
  const firstId: string | undefined = list?.notes?.[0]?.id;
  if (firstId) {
    const detailRes = await fetch(
      `https://public-api.granola.ai/v1/notes/${firstId}?include=transcript`,
      { headers: { Authorization: `Bearer ${key}` } },
    );
    console.log("\n=== DETAIL status:", detailRes.status);
    const detail = await detailRes.json();
    // Print full keys but truncate transcript array
    if (detail.transcript && Array.isArray(detail.transcript)) {
      detail.transcript = detail.transcript.slice(0, 3).concat(
        detail.transcript.length > 3 ? [`…(+${detail.transcript.length - 3} lines)`] : [],
      );
    }
    console.log(JSON.stringify(detail, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
