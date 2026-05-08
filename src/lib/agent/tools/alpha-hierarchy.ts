import "server-only";
import { tool } from "ai";
import { z } from "zod";
import {
  getModulesForProject,
  getPersonasForProject,
  getStoryByReference,
  getStoriesForProject,
  createStory,
  updateStory,
  setStoryRefinement,
  approveProposedModule,
  createAc,
  updateAc,
  deleteAc,
  normalizeModuleName,
} from "@/lib/dal/story-hierarchy";
import { logAgentQuality } from "@/lib/agent/quality-log";
import { decodeUnicodeEscapes } from "./_text-decode";

const REFINEMENT_STATUSES = ["draft", "refined", "committed"] as const;

function normalizeTitle(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

// ─── Read ────────────────────────────────────────────────────────────────────

export function listModulesForOpsTool(projectId: string) {
  return tool({
    description:
      "Lista módulos do projeto (com flag de aprovação). Use ANTES de criar/classificar uma story para escolher um módulo existente em vez de propor um novo.",
    inputSchema: z.object({}),
    execute: async () => {
      const modules = await getModulesForProject(projectId);
      const stories = await getStoriesForProject(projectId);
      const countByModule = new Map<string, number>();
      for (const s of stories) {
        if (s.moduleId) {
          countByModule.set(s.moduleId, (countByModule.get(s.moduleId) ?? 0) + 1);
        }
      }
      return {
        success: true,
        modules: modules.map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description,
          approved: !!m.approvedAt,
          storyCount: countByModule.get(m.id) ?? 0,
        })),
      };
    },
  });
}

export function listPersonasForOpsTool(projectId: string) {
  return tool({
    description:
      "Lista personas do projeto. Use ANTES de criar uma story — você NUNCA inventa persona. Se nenhuma persona da lista cabe, pare e pergunte ao PM.",
    inputSchema: z.object({}),
    execute: async () => {
      const personas = await getPersonasForProject(projectId);
      return {
        success: true,
        personas: personas.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
        })),
      };
    },
  });
}

export function listStoriesForOpsTool(projectId: string) {
  return tool({
    description:
      "Lista user stories do projeto com module/persona/refinementStatus e counts de AC/tasks. Use ANTES de criar uma story (anti-duplicação) ou para responder 'lista as stories'.",
    inputSchema: z.object({
      moduleId: z
        .string()
        .uuid()
        .optional()
        .describe("Filtra por módulo específico."),
      refinementStatus: z
        .enum(REFINEMENT_STATUSES)
        .optional()
        .describe("Filtra por status de refinement."),
      limit: z.number().int().min(1).max(200).default(50),
    }),
    execute: async ({ moduleId, refinementStatus, limit }) => {
      const stories = await getStoriesForProject(projectId);
      const filtered = stories
        .filter((s) => (moduleId ? s.moduleId === moduleId : true))
        .filter((s) =>
          refinementStatus ? s.refinementStatus === refinementStatus : true,
        )
        .slice(0, limit);
      return {
        success: true,
        count: filtered.length,
        totalInProject: stories.length,
        stories: filtered.map((s) => ({
          id: s.id,
          reference: s.reference,
          title: s.title,
          want: s.want,
          soThat: s.soThat,
          refinementStatus: s.refinementStatus,
          module: s.module ? { id: s.module.id, name: s.module.name } : null,
          proposedModuleName: s.proposedModuleName,
          persona: s.persona ? { id: s.persona.id, name: s.persona.name } : null,
          acCount: s.acceptanceCriteria.length,
        })),
      };
    },
  });
}

export function getStoryForOpsTool(projectId: string) {
  return tool({
    description:
      "Retorna detalhes completos de uma story por reference (ex: ZRDN-US-002): título, want, soThat, refinementStatus, módulo, persona, AC inteiros e tasks vinculadas. Use SEMPRE antes de afirmar que uma story não existe.",
    inputSchema: z.object({
      reference: z
        .string()
        .min(3)
        .describe("Reference da story (ex: ZRDN-US-002)."),
    }),
    execute: async ({ reference }) => {
      const story = await getStoryByReference(reference);
      if (!story) {
        return {
          success: false,
          notFound: true,
          message: `Story ${reference} não encontrada. Confirme a referência ou peça ao PM.`,
        };
      }
      if (story.projectId !== projectId) {
        return {
          success: false,
          message: `Story ${reference} pertence a outro projeto.`,
        };
      }
      return {
        success: true,
        story: {
          id: story.id,
          reference: story.reference,
          title: story.title,
          want: story.want,
          soThat: story.soThat,
          refinementStatus: story.refinementStatus,
          module: story.module,
          proposedModuleName: story.proposedModuleName,
          persona: story.persona,
          acceptanceCriteria: story.acceptanceCriteria
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            .map((ac) => ({ id: ac.id, text: ac.text, order: ac.order })),
        },
      };
    },
  });
}

// ─── Write ───────────────────────────────────────────────────────────────────

export function createStoryForOpsTool(projectId: string, createdById: string) {
  return tool({
    description:
      "Cria uma UserStory no projeto (refinementStatus='draft'). Passe moduleId existente OU proposedModuleName em UPPERCASE_SNAKE. PersonaId é obrigatório — escolha da lista de personas do projeto, NUNCA invente. AC mínimo 1, máximo 8 (verificáveis e específicos).",
    inputSchema: z.object({
      title: z.string().min(3).max(200),
      want: z.string().min(3),
      soThat: z.string().optional(),
      moduleId: z
        .string()
        .uuid()
        .nullable()
        .describe("Id de um módulo existente OU null se for propor novo."),
      proposedModuleName: z
        .string()
        .optional()
        .describe(
          "UPPERCASE_SNAKE. Use SOMENTE quando moduleId é null. PM aprova depois via approve_module.",
        ),
      personaId: z
        .string()
        .uuid()
        .describe("Id de uma persona EXISTENTE do projeto."),
      acceptanceCriteria: z.array(z.string().min(3)).min(1).max(8),
      reasoning: z
        .string()
        .min(10)
        .describe("Por que essa story, esse módulo, essa persona."),
    }),
    execute: async (input) => {
      // Idempotência Alpha-only: (projectId, normalizedTitle) com refinementStatus IN ('draft','refined')
      const existing = await getStoriesForProject(projectId);
      const dup = existing.find(
        (s) =>
          normalizeTitle(s.title) === normalizeTitle(input.title) &&
          (s.refinementStatus === "draft" || s.refinementStatus === "refined"),
      );
      if (dup) {
        return {
          success: false,
          duplicate: true,
          existing: { reference: dup.reference, title: dup.title, refinementStatus: dup.refinementStatus },
          message: `Já existe story similar (${dup.reference}: "${dup.title}"). Sugira reutilizar ou estender em vez de criar nova.`,
        };
      }

      // Validar moduleId pertence ao projeto (se fornecido)
      if (input.moduleId) {
        const modules = await getModulesForProject(projectId);
        if (!modules.find((m) => m.id === input.moduleId)) {
          return {
            success: false,
            message: `moduleId ${input.moduleId} não pertence ao projeto.`,
          };
        }
      } else if (!input.proposedModuleName) {
        return {
          success: false,
          message:
            "Passe moduleId existente OU proposedModuleName (não ambos null).",
        };
      }

      // Validar personaId pertence ao projeto
      const personas = await getPersonasForProject(projectId);
      if (!personas.find((p) => p.id === input.personaId)) {
        return {
          success: false,
          message: `personaId ${input.personaId} não pertence ao projeto. Use list_personas.`,
        };
      }

      // Normalizar proposedModuleName se presente
      const proposedNormalized = input.proposedModuleName
        ? normalizeModuleName(input.proposedModuleName)
        : null;

      const story = await createStory({
        projectId,
        moduleId: input.moduleId,
        proposedModuleName: proposedNormalized,
        personaId: input.personaId,
        title: input.title,
        want: input.want,
        soThat: input.soThat ?? null,
        refinementStatus: "draft",
        acceptanceCriteria: input.acceptanceCriteria,
        createdById,
        createdByAgent: true,
      });

      // Quality log — fire-and-forget, doesn't block return
      void logAgentQuality({
        projectId,
        memberId: createdById,
        category: input.moduleId ? "story_created" : "module_proposed",
        payload: {
          storyRef: story.reference,
          moduleId: story.moduleId,
          proposedModuleName: story.proposedModuleName,
          personaId: input.personaId,
          acCount: input.acceptanceCriteria.length,
          reasoning: input.reasoning,
        },
      });

      return {
        success: true,
        story: {
          id: story.id,
          reference: story.reference,
          title: story.title,
          refinementStatus: story.refinementStatus,
          moduleId: story.moduleId,
          proposedModuleName: story.proposedModuleName,
        },
      };
    },
  });
}

export function updateStoryForOpsTool(projectId: string) {
  return tool({
    description:
      "Atualiza campos de uma UserStory existente (title, want, soThat, moduleId, personaId). Mostre o diff em texto antes de chamar (Regra 0). NÃO altera AC nem refinementStatus — use manage_story_ac e set_story_refinement.",
    inputSchema: z.object({
      reference: z.string().min(3),
      patch: z.object({
        title: z.string().min(3).max(200).optional(),
        want: z.string().min(3).optional(),
        soThat: z.string().nullable().optional(),
        moduleId: z.string().uuid().nullable().optional(),
        personaId: z.string().uuid().optional(),
      }),
      reasoning: z.string().min(10),
    }),
    execute: async ({ reference, patch: rawPatch }) => {
      const patch = {
        ...rawPatch,
        title:
          rawPatch.title !== undefined
            ? decodeUnicodeEscapes(rawPatch.title)
            : rawPatch.title,
        want:
          rawPatch.want !== undefined
            ? decodeUnicodeEscapes(rawPatch.want)
            : rawPatch.want,
        soThat:
          typeof rawPatch.soThat === "string"
            ? decodeUnicodeEscapes(rawPatch.soThat)
            : rawPatch.soThat,
      };
      const story = await getStoryByReference(reference);
      if (!story) {
        return {
          success: false,
          notFound: true,
          message: `Story ${reference} não encontrada.`,
        };
      }
      if (story.projectId !== projectId) {
        return { success: false, message: "Story pertence a outro projeto." };
      }

      if (patch.moduleId) {
        const modules = await getModulesForProject(projectId);
        if (!modules.find((m) => m.id === patch.moduleId)) {
          return { success: false, message: "moduleId inválido." };
        }
      }
      if (patch.personaId) {
        const personas = await getPersonasForProject(projectId);
        if (!personas.find((p) => p.id === patch.personaId)) {
          return { success: false, message: "personaId inválido." };
        }
      }

      const updated = await updateStory(story.id, patch);
      return {
        success: true,
        story: {
          reference: updated.reference,
          title: updated.title,
          want: updated.want,
          soThat: updated.soThat,
          moduleId: updated.moduleId,
          personaId: updated.personaId,
        },
      };
    },
  });
}

export function setStoryRefinementForOpsTool(projectId: string) {
  return tool({
    description:
      "Transiciona o refinementStatus de uma story (draft → refined → committed). Use 'refined' apenas quando PM confirmar que AC e narrativa estão maduros. 'committed' apenas quando todas as tasks técnicas existirem.",
    inputSchema: z.object({
      reference: z.string().min(3),
      status: z.enum(["refined", "committed"]),
      reasoning: z.string().min(10),
    }),
    execute: async ({ reference, status }) => {
      const story = await getStoryByReference(reference);
      if (!story) {
        return {
          success: false,
          notFound: true,
          message: `Story ${reference} não encontrada.`,
        };
      }
      if (story.projectId !== projectId) {
        return { success: false, message: "Story pertence a outro projeto." };
      }
      const updated = await setStoryRefinement(story.id, status);
      return {
        success: true,
        story: {
          reference: updated.reference,
          previousStatus: story.refinementStatus,
          status: updated.refinementStatus,
        },
      };
    },
  });
}

export function approveModuleForOpsTool(projectId: string, approverId: string) {
  return tool({
    description:
      "Aprova um proposedModuleName: cria (ou reusa) o Module e re-aponta a story. Chame APENAS após PM confirmar explicitamente. proposedName é normalizado para UPPERCASE_SNAKE.",
    inputSchema: z.object({
      storyReference: z
        .string()
        .min(3)
        .describe("Reference da story que tem proposedModuleName."),
      reasoning: z.string().min(10),
    }),
    execute: async ({ storyReference, reasoning }) => {
      const story = await getStoryByReference(storyReference);
      if (!story) {
        return {
          success: false,
          notFound: true,
          message: `Story ${storyReference} não encontrada.`,
        };
      }
      if (story.projectId !== projectId) {
        return { success: false, message: "Story pertence a outro projeto." };
      }
      if (!story.proposedModuleName) {
        return {
          success: false,
          message: `Story ${storyReference} não tem proposedModuleName a aprovar.`,
        };
      }
      const result = await approveProposedModule(
        story.id,
        projectId,
        story.proposedModuleName,
        approverId,
      );

      void logAgentQuality({
        projectId,
        memberId: approverId,
        category: "module_classified",
        payload: {
          storyRef: result.story.reference,
          moduleId: result.module.id,
          moduleName: result.module.name,
          reasoning,
        },
      });

      return {
        success: true,
        module: { id: result.module.id, name: result.module.name },
        story: {
          reference: result.story.reference,
          moduleId: result.story.moduleId,
        },
      };
    },
  });
}

export function manageStoryAcForOpsTool(projectId: string) {
  return tool({
    description:
      "Adiciona, edita ou remove AC de uma story. Use durante refinement. Sempre mostre o diff em texto antes de chamar (Regra 0). Operações são aplicadas em ordem.",
    inputSchema: z.object({
      reference: z.string().min(3),
      operations: z
        .array(
          z.discriminatedUnion("op", [
            z.object({
              op: z.literal("add"),
              text: z.string().min(3),
              order: z.number().int().min(0).optional(),
            }),
            z.object({
              op: z.literal("edit"),
              acId: z.string().uuid(),
              text: z.string().min(3),
            }),
            z.object({
              op: z.literal("remove"),
              acId: z.string().uuid(),
            }),
          ]),
        )
        .min(1)
        .max(15),
      reasoning: z.string().min(10),
    }),
    execute: async ({ reference, operations: rawOps }) => {
      const operations = rawOps.map((op) =>
        op.op === "remove"
          ? op
          : { ...op, text: decodeUnicodeEscapes(op.text) },
      );
      const story = await getStoryByReference(reference);
      if (!story) {
        return {
          success: false,
          notFound: true,
          message: `Story ${reference} não encontrada.`,
        };
      }
      if (story.projectId !== projectId) {
        return { success: false, message: "Story pertence a outro projeto." };
      }

      const acIds = new Set(story.acceptanceCriteria.map((ac) => ac.id));
      const currentMaxOrder = story.acceptanceCriteria.reduce(
        (max, ac) => Math.max(max, ac.order ?? 0),
        -1,
      );
      let nextOrder = currentMaxOrder + 1;

      const applied: Array<{ op: string; acId?: string; text?: string }> = [];

      for (const op of operations) {
        if (op.op === "add") {
          const created = await createAc({
            userStoryId: story.id,
            text: op.text,
            order: op.order ?? nextOrder++,
          });
          applied.push({ op: "add", acId: created.id, text: created.text });
        } else if (op.op === "edit") {
          if (!acIds.has(op.acId)) {
            return {
              success: false,
              message: `AC ${op.acId} não pertence a story ${reference}.`,
              applied,
            };
          }
          const updated = await updateAc(op.acId, { text: op.text });
          applied.push({ op: "edit", acId: updated.id, text: updated.text });
        } else if (op.op === "remove") {
          if (!acIds.has(op.acId)) {
            return {
              success: false,
              message: `AC ${op.acId} não pertence a story ${reference}.`,
              applied,
            };
          }
          await deleteAc(op.acId);
          applied.push({ op: "remove", acId: op.acId });
        }
      }

      void logAgentQuality({
        projectId,
        category: "ac_managed",
        payload: {
          storyRef: reference,
          opCount: operations.length,
          breakdown: {
            add: operations.filter((o) => o.op === "add").length,
            edit: operations.filter((o) => o.op === "edit").length,
            remove: operations.filter((o) => o.op === "remove").length,
          },
        },
      });

      return { success: true, reference, applied };
    },
  });
}
