import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { requireSessionAccessApi, requireSessionEditApi } from "@/lib/dal";
import { z } from "zod";
import type { Json } from "@/lib/supabase/database.types";

// Defensive shape gate for the legacy generic step endpoint.
// Goal: block junk top-level keys from entering the JSON during the
// normalization window. Top-level step schemas are .strict() (reject
// unknown keys); item schemas are .passthrough() (preserve legacy fields
// like older `painOrGainDescription` aliases without rejecting or mutating
// historical data). Empty strings/arrays are legitimate during debounced
// saves, so no .min(1) constraints.

const noteSchema = z.object({ id: z.string(), text: z.string() }).passthrough();
const notesField = z.array(noteSchema).optional();
const draftsField = z.unknown().optional();
const idText = z.object({ id: z.string(), text: z.string() }).passthrough();

const journeyStep = z
  .object({
    id: z.string().optional(),
    description: z.string().optional(),
    painOrGain: z.string().optional(),
  })
  .passthrough();

const personaItem = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    role: z.string().optional(),
    context: z.string().optional(),
    asIsSteps: z.array(journeyStep).optional(),
    toBeSteps: z.array(journeyStep).optional(),
  })
  .passthrough();

const solutionItem = z
  .object({
    id: z.string(),
    title: z.string().optional(),
    howItSolves: z.string().optional(),
    targetPersona: z.string().optional(),
  })
  .passthrough();

const priorityItem = solutionItem;

const hypothesisItem = z
  .object({
    id: z.string(),
    hypothesis: z.string().optional(),
    indicator: z.string().optional(),
    target: z.string().optional(),
    expectedResult: z.string().optional(),
  })
  .passthrough();

const riskItem = z
  .object({
    id: z.string(),
    text: z.string().optional(),
  })
  .passthrough();

const gapItem = riskItem;
const integrationItem = z.object({ id: z.string(), text: z.string().optional() }).passthrough();
const ruleItem = integrationItem;

const preWorkSchema = z
  .object({
    files: z.unknown().optional(),
    transcripts: z.unknown().optional(),
    _notes: notesField,
  })
  .strict();

const productVisionSchema = z
  .object({
    problem: z.string().optional(),
    whoSuffers: z.string().optional(),
    consequences: z.string().optional(),
    successVision: z.string().optional(),
    impactMetrics: z.string().optional(),
    _notes: notesField,
  })
  .strict();

const scopeDefinitionSchema = z
  .object({
    is: z.array(idText).default([]),
    isNot: z.array(idText).default([]),
    does: z.array(idText).default([]),
    doesNot: z.array(idText).default([]),
    _notes: notesField,
  })
  .strict();

const personasJourneysSchema = z
  .object({
    personas: z.array(personaItem).default([]),
    _notes: notesField,
  })
  .strict();

const brainstormSchema = z
  .object({
    solutions: z.array(solutionItem).default([]),
    _drafts: draftsField,
    _notes: notesField,
  })
  .strict();

const risksGapsSchema = z
  .object({
    risks: z.array(riskItem).default([]),
    gaps: z.array(gapItem).default([]),
    _notes: notesField,
  })
  .strict();

const prioritizationSchema = z
  .object({
    items: z.array(priorityItem).default([]),
    _drafts: draftsField,
    _notes: notesField,
  })
  .strict();

const technicalSpecsSchema = z
  .object({
    stack: z.string().optional(),
    performance: z.string().optional(),
    integrations: z.array(integrationItem).default([]),
    rules: z.array(ruleItem).default([]),
    _notes: notesField,
  })
  .strict();

const hypothesesSchema = z
  .object({
    hypotheses: z.array(hypothesisItem).default([]),
    _notes: notesField,
  })
  .strict();

const STEP_SCHEMAS = {
  pre_work: preWorkSchema,
  product_vision: productVisionSchema,
  scope_definition: scopeDefinitionSchema,
  personas_journeys: personasJourneysSchema,
  brainstorm: brainstormSchema,
  risks_gaps: risksGapsSchema,
  prioritization: prioritizationSchema,
  technical_specs: technicalSpecsSchema,
  hypotheses: hypothesesSchema,
} as const;

type StepKey = keyof typeof STEP_SCHEMAS;

const bodySchema = z.object({
  stepIndex: z.number().int().nonnegative().optional(),
  data: z.unknown(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; stepKey: string }> }
) {
  const { id, stepKey } = await params;
  const denied = await requireSessionAccessApi(id);
  if (denied) return denied;
  const { data: stepData } = await db()
    .from("DesignSessionStepData")
    .select("*")
    .eq("sessionId", id)
    .eq("stepKey", stepKey)
    .maybeSingle();
  if (!stepData) return NextResponse.json({ data: {} });
  return NextResponse.json({ data: stepData.data });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; stepKey: string }> }
) {
  const { id, stepKey } = await params;
  const denied = await requireSessionEditApi(id);
  if (denied) return denied;

  const schema = STEP_SCHEMAS[stepKey as StepKey];
  if (!schema) {
    return NextResponse.json({ error: `Unknown stepKey: ${stepKey}` }, { status: 400 });
  }

  const rawBody = await req.json();
  const parsedBody = bodySchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsedBody.error.issues },
      { status: 400 }
    );
  }

  const parsedData = schema.safeParse(parsedBody.data.data);
  if (!parsedData.success) {
    return NextResponse.json(
      { error: `Invalid data for ${stepKey}`, issues: parsedData.error.issues },
      { status: 400 }
    );
  }

  const { data: stepData, error } = await db()
    .from("DesignSessionStepData")
    .upsert(
      {
        id: crypto.randomUUID(),
        sessionId: id,
        stepIndex: parsedBody.data.stepIndex ?? 0,
        stepKey,
        data: parsedData.data as Json,
        updatedAt: new Date().toISOString(),
      },
      { onConflict: "sessionId,stepKey" }
    )
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: stepData.data });
}
