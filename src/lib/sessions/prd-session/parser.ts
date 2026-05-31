/**
 * parsePrdMarkdown — extrai title, oneLiner, problem, acceptanceCriteria de markdown.
 * Permissivo (D5): aceita PRDs sem schema perfeito, retorna warnings.
 */

export type ParsedPrd = {
  title: string;
  oneLiner?: string;
  problem?: string;
  acceptanceCriteria: string[];
  warnings: string[];
};

/**
 * Parse a PRD markdown string and extract structured fields.
 *
 * Extraction rules:
 * - title: first H1 (# Title)
 * - oneLiner: content from section "## 2 · Solução em uma frase" or similar
 * - problem: content from section "## 1 · Problema" or similar
 * - acceptanceCriteria: list items from any section containing "Acceptance Criteria" (case-insensitive)
 * - warnings: accumulated when required fields are missing
 */
export function parsePrdMarkdown(text: string): ParsedPrd {
  const warnings: string[] = [];
  const lines = text.split("\n");

  // Extract title from first H1
  let title = "";
  for (const line of lines) {
    const h1Match = line.match(/^#\s+(.+)$/);
    if (h1Match) {
      title = h1Match[1].trim();
      break;
    }
  }

  if (!title) {
    warnings.push("Missing title (no H1 found)");
    title = "Untitled PRD";
  }

  // Extract sections by H2 headers
  const sections = extractSections(lines);

  // Extract oneLiner from "Solução em uma frase" or similar
  let oneLiner: string | undefined;
  const solutionSection = findSection(sections, ["solução em uma frase", "solution in one sentence", "solution"]);
  if (solutionSection) {
    oneLiner = solutionSection.content.trim();
  }

  // Extract problem from "Problema" or "Problem" section
  let problem: string | undefined;
  const problemSection = findSection(sections, ["problema", "problem"]);
  if (problemSection) {
    problem = problemSection.content.trim();
  }

  // Extract acceptance criteria from any section containing "Acceptance Criteria"
  const acceptanceCriteria: string[] = [];

  // Look through all sections for acceptance criteria
  for (const section of sections.values()) {
    if (section.name.toLowerCase().includes("acceptance criteria") ||
        section.name.toLowerCase().includes("critérios de aceitação")) {
      const items = extractListItems(section.content);
      acceptanceCriteria.push(...items);
    }
  }

  // Also look for acceptance criteria within story sections
  if (acceptanceCriteria.length === 0) {
    // Try to find in subsections marked with **Acceptance Criteria:**
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.match(/^\*\*Acceptance Criteria:?\*\*/i) ||
          line.match(/^\*\*Critérios de Aceitação:?\*\*/i)) {
        // Extract list items following this marker
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j].trim();
          if (!nextLine) continue;

          // Stop at next subsection marker or heading
          if (nextLine.match(/^\*\*[A-Z]/i) || nextLine.match(/^#{1,6}\s/)) {
            break;
          }

          const listMatch = nextLine.match(/^[-*]\s+(.+)$/);
          if (listMatch) {
            acceptanceCriteria.push(listMatch[1].trim());
          }
        }
      }
    }
  }

  return {
    title,
    oneLiner,
    problem,
    acceptanceCriteria,
    warnings,
  };
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
 * Find a section by one of several possible names (case-insensitive).
 */
function findSection(sections: Map<string, Section>, names: string[]): Section | undefined {
  for (const name of names) {
    const section = sections.get(name.toLowerCase());
    if (section) return section;

    // Try fuzzy match: section name contains the search term
    for (const [key, value] of sections.entries()) {
      if (key.includes(name.toLowerCase())) {
        return value;
      }
    }
  }
  return undefined;
}

/**
 * Extract list items (- or *) from markdown content.
 */
function extractListItems(content: string): string[] {
  const items: string[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(/^[-*]\s+(.+)$/);
    if (match) {
      items.push(match[1].trim());
    }
  }

  return items;
}
