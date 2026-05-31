/**
 * Parser for spec.md files.
 *
 * Extracts structured sections from markdown and returns a Spec object.
 * Sections are identified by specific H2 headers:
 * - ## Problem
 * - ## Solution
 * - ## Non-goals
 * - ## User Stories
 * - ## Success Criteria
 * - ## Upstream (optional)
 */
import { readFileSync } from "node:fs";
import type { Spec, SpecStory, SuccessCriterion, UpstreamRef } from "./schema";

export type ParseError = {
  line: number;
  column: number;
  message: string;
  section?: string;
};

export type ParseResult =
  | { ok: true; spec: Spec }
  | { ok: false; errors: ParseError[] };

/**
 * Parse a spec.md file from disk.
 */
export function parseSpec(path: string): ParseResult {
  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch (err) {
    return {
      ok: false,
      errors: [{ line: 0, column: 0, message: `Failed to read file: ${err}` }],
    };
  }

  return parseSpecContent(content);
}

/**
 * Parse spec.md content from a string.
 */
export function parseSpecContent(content: string): ParseResult {
  const errors: ParseError[] = [];
  const lines = content.split("\n");

  // Extract sections by H2 headers
  const sections = extractSections(lines);

  // Check for mandatory sections
  const mandatorySections = ["problem", "solution", "non-goals", "user stories", "success criteria"];
  for (const required of mandatorySections) {
    if (!sections.has(required)) {
      errors.push({
        line: 0,
        column: 0,
        message: `Missing required section: ## ${capitalizeSection(required)}`,
        section: required,
      });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Parse each section
  const problem = sections.get("problem")?.content.trim() ?? "";
  const solution = sections.get("solution")?.content.trim() ?? "";

  const nonGoalsResult = parseListSection(sections.get("non-goals"), "non-goals");
  if (!nonGoalsResult.ok) {
    errors.push(...nonGoalsResult.errors);
  }

  const userStoriesResult = parseUserStories(sections.get("user stories"), "user stories");
  if (!userStoriesResult.ok) {
    errors.push(...userStoriesResult.errors);
  }

  const successCriteriaResult = parseSuccessCriteria(sections.get("success criteria"), "success criteria");
  if (!successCriteriaResult.ok) {
    errors.push(...successCriteriaResult.errors);
  }

  const upstreamResult = parseUpstream(sections.get("upstream"));
  if (!upstreamResult.ok) {
    errors.push(...upstreamResult.errors);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const spec: Spec = {
    problem,
    solution,
    nonGoals: nonGoalsResult.ok ? nonGoalsResult.value : [],
    userStories: userStoriesResult.ok ? userStoriesResult.value : [],
    successCriteria: successCriteriaResult.ok ? successCriteriaResult.value : [],
    upstream: upstreamResult.ok ? upstreamResult.value : undefined,
  };

  return { ok: true, spec };
}

type Section = {
  name: string;
  startLine: number;
  content: string;
};

/**
 * Extract all H2 sections from the markdown.
 * Returns a map of section name (lowercase) to { name, startLine, content }.
 */
function extractSections(lines: string[]): Map<string, Section> {
  const sections = new Map<string, Section>();
  let currentSection: Section | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h2Match = line.match(/^##\s+(.+)$/);

    if (h2Match) {
      // Save previous section
      if (currentSection) {
        sections.set(currentSection.name.toLowerCase(), currentSection);
      }

      // Start new section
      currentSection = {
        name: h2Match[1].trim(),
        startLine: i + 1,
        content: "",
      };
    } else if (currentSection) {
      currentSection.content += line + "\n";
    }
  }

  // Save last section
  if (currentSection) {
    sections.set(currentSection.name.toLowerCase(), currentSection);
  }

  return sections;
}

/**
 * Parse a simple list section (e.g., Non-goals).
 * Expects markdown list items (- or *).
 */
function parseListSection(
  section: Section | undefined,
  sectionName: string
): { ok: true; value: string[] } | { ok: false; errors: ParseError[] } {
  if (!section) {
    return {
      ok: false,
      errors: [{ line: 0, column: 0, message: `Section not found: ${sectionName}`, section: sectionName }],
    };
  }

  const items: string[] = [];
  const lines = section.content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const match = line.match(/^[-*]\s+(.+)$/);
    if (match) {
      items.push(match[1].trim());
    }
  }

  if (items.length === 0) {
    return {
      ok: false,
      errors: [
        {
          line: section.startLine,
          column: 0,
          message: `Section "${sectionName}" must contain at least one list item`,
          section: sectionName,
        },
      ],
    };
  }

  return { ok: true, value: items };
}

/**
 * Parse User Stories section.
 * Each story is a H3 (### STORY-ID: Title) followed by description, acceptance criteria, etc.
 */
function parseUserStories(
  section: Section | undefined,
  sectionName: string
): { ok: true; value: SpecStory[] } | { ok: false; errors: ParseError[] } {
  if (!section) {
    return {
      ok: false,
      errors: [{ line: 0, column: 0, message: `Section not found: ${sectionName}`, section: sectionName }],
    };
  }

  const stories: SpecStory[] = [];
  const errors: ParseError[] = [];
  const lines = section.content.split("\n");

  let currentStory: Partial<SpecStory> | null = null;
  let currentSubsection: "description" | "acceptance" | "other" | null = null;
  let acBuffer: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = section.startLine + i;

    // H3: new story
    const h3Match = line.match(/^###\s+([A-Z0-9-]+):\s*(.+)$/);
    if (h3Match) {
      // Save previous story
      if (currentStory) {
        if (acBuffer.length > 0) {
          currentStory.acceptanceCriteria = acBuffer;
        }
        stories.push(currentStory as SpecStory);
      }

      currentStory = {
        id: h3Match[1].trim(),
        title: h3Match[2].trim(),
        acceptanceCriteria: [],
      };
      currentSubsection = null;
      acBuffer = [];
      continue;
    }

    if (!currentStory) continue;

    // Subsections
    if (line.match(/^\*\*Description:\*\*/i)) {
      currentSubsection = "description";
      continue;
    }
    if (line.match(/^\*\*Acceptance Criteria:\*\*/i)) {
      currentSubsection = "acceptance";
      continue;
    }
    if (line.match(/^\*\*Estimate:\*\*/i)) {
      const estMatch = line.match(/(\d+)\s*min/i);
      if (estMatch) {
        currentStory.estimateMinutes = parseInt(estMatch[1], 10);
      }
      currentSubsection = "other";
      continue;
    }
    if (line.match(/^\*\*Depends on:\*\*/i)) {
      const depsMatch = line.match(/Depends on:\*\*\s*(.+)$/i);
      if (depsMatch) {
        currentStory.dependsOn = depsMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
      }
      currentSubsection = "other";
      continue;
    }

    // Content
    if (currentSubsection === "description") {
      if (!currentStory.description) {
        currentStory.description = "";
      }
      currentStory.description += line + "\n";
    } else if (currentSubsection === "acceptance") {
      const acMatch = line.match(/^[-*]\s+(.+)$/);
      if (acMatch) {
        acBuffer.push(acMatch[1].trim());
      }
    }
  }

  // Save last story
  if (currentStory) {
    if (acBuffer.length > 0) {
      currentStory.acceptanceCriteria = acBuffer;
    }
    stories.push(currentStory as SpecStory);
  }

  if (stories.length === 0) {
    errors.push({
      line: section.startLine,
      column: 0,
      message: `Section "${sectionName}" must contain at least one story (### STORY-ID: Title)`,
      section: sectionName,
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: stories };
}

/**
 * Parse Success Criteria section.
 * Each criterion is a list item or table row with metric, target, instrument.
 */
function parseSuccessCriteria(
  section: Section | undefined,
  sectionName: string
): { ok: true; value: SuccessCriterion[] } | { ok: false; errors: ParseError[] } {
  if (!section) {
    return {
      ok: false,
      errors: [{ line: 0, column: 0, message: `Section not found: ${sectionName}`, section: sectionName }],
    };
  }

  const criteria: SuccessCriterion[] = [];
  const lines = section.content.split("\n");

  // Try to parse as table first
  let inTable = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Table header
    if (line.startsWith("|") && line.includes("Metric")) {
      inTable = true;
      continue;
    }

    // Table separator
    if (line.match(/^\|[\s-:|]+\|$/)) {
      continue;
    }

    // Table row
    if (inTable && line.startsWith("|")) {
      const parts = line.split("|").map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 3) {
        criteria.push({
          metric: parts[0],
          target: parts[1],
          instrument: parts[2],
        });
      }
      continue;
    }

    // List item fallback: "- Metric: X | Target: Y | Instrument: Z"
    const listMatch = line.match(/^[-*]\s+(.+)$/);
    if (listMatch) {
      const content = listMatch[1];
      const kvMatch = content.match(/Metric:\s*([^|]+)\|\s*Target:\s*([^|]+)\|\s*Instrument:\s*(.+)/i);
      if (kvMatch) {
        criteria.push({
          metric: kvMatch[1].trim(),
          target: kvMatch[2].trim(),
          instrument: kvMatch[3].trim(),
        });
      }
    }
  }

  if (criteria.length === 0) {
    return {
      ok: false,
      errors: [
        {
          line: section.startLine,
          column: 0,
          message: `Section "${sectionName}" must contain at least one criterion (table or list)`,
          section: sectionName,
        },
      ],
    };
  }

  return { ok: true, value: criteria };
}

/**
 * Parse Upstream section (optional).
 * Each reference is a list item with type, id, optional url.
 */
function parseUpstream(
  section: Section | undefined
): { ok: true; value?: UpstreamRef[] } | { ok: false; errors: ParseError[] } {
  if (!section) {
    return { ok: true, value: undefined };
  }

  const refs: UpstreamRef[] = [];
  const lines = section.content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // List item: "- [type] id — description (url)"
    const match = line.match(/^[-*]\s+\[([^\]]+)\]\s+([^\s—]+)(?:\s*—\s*(.+))?$/);
    if (match) {
      const type = match[1].trim().toLowerCase() as UpstreamRef["type"];
      const id = match[2].trim();
      const rest = match[3]?.trim() ?? "";

      const urlMatch = rest.match(/\(([^)]+)\)/);
      const url = urlMatch ? urlMatch[1] : undefined;
      const description = rest.replace(/\([^)]+\)/, "").trim();

      refs.push({
        type: type as UpstreamRef["type"],
        id,
        url,
        description: description || undefined,
      });
    }
  }

  return { ok: true, value: refs.length > 0 ? refs : undefined };
}

function capitalizeSection(s: string): string {
  return s.split(" ").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}
