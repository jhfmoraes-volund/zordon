import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireMinLevelApi } from "@/lib/dal";
import { MANAGER } from "@/lib/roles";
import { applyApprovedActions } from "@/lib/meetings/task-action-executor";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireMinLevelApi(MANAGER);
  if (denied) return denied;

  const { id } = await params;

  try {
    const result = await applyApprovedActions(db(), id);
    return NextResponse.json(result);
  } catch (error) {
    console.error("apply actions failed:", error);
    return NextResponse.json(
      { error: "Failed to apply actions", details: String(error) },
      { status: 500 }
    );
  }
}
