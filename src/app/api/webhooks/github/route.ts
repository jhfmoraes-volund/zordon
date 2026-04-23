import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

function verifySignature(body: string, signature: string | null): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret || !signature) return false;

  const expected =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(body).digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  if (process.env.GITHUB_WEBHOOK_SECRET && !verifySignature(body, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = req.headers.get("x-github-event");
  const payload = JSON.parse(body);
  const supabase = db();

  async function findTaskByPr(prNumber: number, repoOwner: string, repoName: string) {
    // First find the project by repo info
    const { data: project } = await supabase
      .from("Project")
      .select("id")
      .eq("githubRepoOwner", repoOwner)
      .eq("githubRepoName", repoName)
      .maybeSingle();
    if (!project) return null;

    const { data: task } = await supabase
      .from("Task")
      .select("*")
      .eq("githubPrNumber", prNumber)
      .eq("projectId", project.id)
      .limit(1)
      .maybeSingle();
    return task;
  }

  if (event === "pull_request") {
    const prNumber = payload.pull_request.number;
    const repoOwner = payload.repository.owner.login;
    const repoName = payload.repository.name;

    const task = await findTaskByPr(prNumber, repoOwner, repoName);
    if (!task) return NextResponse.json({ ok: true, skipped: true });

    if (payload.action === "closed" && payload.pull_request.merged) {
      await supabase
        .from("Task")
        .update({ status: "done" })
        .eq("id", task.id);
    }
  }

  if (event === "pull_request_review") {
    const prNumber = payload.pull_request.number;
    const repoOwner = payload.repository.owner.login;
    const repoName = payload.repository.name;

    const task = await findTaskByPr(prNumber, repoOwner, repoName);
    if (!task) return NextResponse.json({ ok: true, skipped: true });

    if (payload.action === "submitted") {
      const reviewState = payload.review.state;

      if (reviewState === "changes_requested" && task.status === "review") {
        await supabase
          .from("Task")
          .update({ status: "in_progress" })
          .eq("id", task.id);
      }

      if (reviewState === "approved" && task.status === "review") {
        await supabase
          .from("Task")
          .update({ status: "done" })
          .eq("id", task.id);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
