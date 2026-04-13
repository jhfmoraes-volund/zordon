import { prisma } from "@/lib/prisma";
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

  // Verify webhook signature
  if (process.env.GITHUB_WEBHOOK_SECRET && !verifySignature(body, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = req.headers.get("x-github-event");
  const payload = JSON.parse(body);

  // Find task by PR number + repo
  async function findTaskByPr(prNumber: number, repoOwner: string, repoName: string) {
    return prisma.task.findFirst({
      where: {
        githubPrNumber: prNumber,
        project: {
          githubRepoOwner: repoOwner,
          githubRepoName: repoName,
        },
      },
    });
  }

  if (event === "pull_request") {
    const prNumber = payload.pull_request.number;
    const repoOwner = payload.repository.owner.login;
    const repoName = payload.repository.name;

    const task = await findTaskByPr(prNumber, repoOwner, repoName);
    if (!task) return NextResponse.json({ ok: true, skipped: true });

    // PR merged → task done
    if (payload.action === "closed" && payload.pull_request.merged) {
      await prisma.task.update({
        where: { id: task.id },
        data: { status: "done" },
      });
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
        await prisma.task.update({
          where: { id: task.id },
          data: { status: "changes_requested" },
        });
      }

      if (reviewState === "approved" && task.status === "review") {
        await prisma.task.update({
          where: { id: task.id },
          data: { status: "approved" },
        });
      }
    }
  }

  return NextResponse.json({ ok: true });
}
