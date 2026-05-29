import type { EvalScenario } from "../types";
import { case01CapacityOverflow } from "./case-01-capacity-overflow";
import { case02DecisionContradiction } from "./case-02-decision-contradiction";
import { case03SpreadsheetTotals } from "./case-03-spreadsheet-totals";
import { case04TranscriptLong } from "./case-04-transcript-long";
import { case05SourceEmpty } from "./case-05-source-empty";
import { case06MultiSource } from "./case-06-multi-source";
import { case07ScopeCreep } from "./case-07-scope-creep";
import { case08EditProposal } from "./case-08-edit-proposal";
import { case09Deletion } from "./case-09-deletion";
import { case10ForecastPrecommit } from "./case-10-forecast-precommit";

export const allScenarios: EvalScenario[] = [
  case01CapacityOverflow,
  case02DecisionContradiction,
  case03SpreadsheetTotals,
  case04TranscriptLong,
  case05SourceEmpty,
  case06MultiSource,
  case07ScopeCreep,
  case08EditProposal,
  case09Deletion,
  case10ForecastPrecommit,
];
