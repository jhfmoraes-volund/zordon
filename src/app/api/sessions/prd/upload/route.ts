import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUser, getMemberId, requireProjectEditSessionsApi } from "@/lib/dal";
import { createPrdSessionUpload } from "@/lib/sessions/prd-session/dal";

const MAX_FILES = 10;
const MAX_FILE_SIZE_KB = 200;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_KB * 1024;

const uploadSchema = z.object({
  projectId: z.string().uuid(),
  files: z
    .array(
      z.object({
        filename: z.string().min(1).max(255),
        content: z.string().max(MAX_FILE_SIZE_BYTES, {
          message: `File content exceeds ${MAX_FILE_SIZE_KB}KB limit`,
        }),
      }),
    )
    .min(1, { message: "At least one file is required" })
    .max(MAX_FILES, { message: `Maximum ${MAX_FILES} files allowed` }),
});

export async function POST(req: NextRequest) {
  // Auth check
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const memberId = await getMemberId();
  if (!memberId) {
    return new NextResponse("Member not found", { status: 403 });
  }

  // Parse and validate body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parsed = uploadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  }

  const { projectId, files } = parsed.data;

  // Check project access (must be able to edit sessions)
  const denied = await requireProjectEditSessionsApi(projectId);
  if (denied) return denied;

  // Create session + PRDs
  try {
    const result = await createPrdSessionUpload({
      projectId,
      files,
      actorMemberId: memberId,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Error creating PRD session:", error);
    return NextResponse.json(
      {
        error: "Failed to create PRD session",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
