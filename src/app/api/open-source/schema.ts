import { z } from "zod";

const factSchema = z.object({ label: z.string(), value: z.string() });
const chatSchema = z.object({ question: z.string(), answer: z.string() });
const trackSchema = z.object({ title: z.string(), artist: z.string() });

export const cardSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório").max(120),
  title: z.string().nullable().optional(),
  category: z.string().min(1).optional(),
  archiveNumber: z.number().int().positive().optional(),
  photoStoragePath: z.string().nullable().optional(),
  photoUpdatedAt: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  quote: z.string().nullable().optional(),
  quoteAttribution: z.string().nullable().optional(),
  humanFacts: z.array(factSchema).optional(),
  builderFacts: z.array(factSchema).optional(),
  callMeFor: z.array(z.string()).optional(),
  chat: z.array(chatSchema).optional(),
  truthsAndLie: z.array(z.string()).optional(),
  soundtrack: z.array(trackSchema).optional(),
  displayOrder: z.number().int().nullable().optional(),
  isPublished: z.boolean().optional(),
});

export const cardPatchSchema = cardSchema.partial();
