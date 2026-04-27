import type { EvalCase } from "../types";
import { case00SmokePersonaGrounding } from "./case-00-smoke-persona-grounding";
import { case01ContradictionDecision } from "./case-01-contradiction-decision";
import { case02CitationResearch } from "./case-02-citation-research";
import { case03MvpGateNoEvidence } from "./case-03-mvp-gate-no-evidence";
import { case04OpenQuestionVsGuess } from "./case-04-open-question-vs-guess";
import { case05ProjectMemoryLoad } from "./case-05-project-memory-load";
import { case06CrossSessionPersona } from "./case-06-cross-session-persona";
import { case07ConfidenceLabel } from "./case-07-confidence-label";
import { case08MemoryCompression } from "./case-08-memory-compression";
import { case09AutoCompactEndSession } from "./case-09-auto-compact-end-session";
import { case10DecisionDedup } from "./case-10-decision-dedup";

export const allCases: EvalCase[] = [
  case00SmokePersonaGrounding,
  case01ContradictionDecision,
  case02CitationResearch,
  case03MvpGateNoEvidence,
  case04OpenQuestionVsGuess,
  case05ProjectMemoryLoad,
  case06CrossSessionPersona,
  case07ConfidenceLabel,
  case08MemoryCompression,
  case09AutoCompactEndSession,
  case10DecisionDedup,
];
