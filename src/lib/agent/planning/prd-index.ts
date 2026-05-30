/**
 * PRD Index Builder
 *
 * Reads PRD markdown files from docs/prd/{backlog,ready}/, parses frontmatter,
 * extracts §1-§3 summaries and §16 metadata, and caches by SHA of concatenated file contents.
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import matter from 'gray-matter';

export interface PrdIndexEntry {
  slug: string;                    // e.g., "planning-session"
  filePath: string;                // absolute path to the markdown file
  title: string;                   // from frontmatter or §0 heading
  oneLiner: string;                // §2 "Solução em uma frase"
  problemSummary: string;          // §1 "Problema" first paragraph
  dependsOn: string[];             // from §16 metadata (PRD slugs)
  estimateMinutesTotal: number;    // sum of all story estimates in §16
  personaIds: string[];            // extracted from §4 "Personas e jornada"
  riskLevel: 'low' | 'medium' | 'high'; // inferred from §12 "Riscos"
  frontmatter: Record<string, unknown>; // raw YAML frontmatter
}

/**
 * Build PRD index by reading all prd-*.md files from docs/prd/{backlog,ready}/
 * Caches result by SHA of concatenated file contents.
 */
export async function buildPrdIndex(repoRoot: string = process.cwd()): Promise<PrdIndexEntry[]> {
  const cacheDir = '/tmp/volund-prd-index';
  await fs.mkdir(cacheDir, { recursive: true });

  // Collect all PRD files from backlog/ and ready/
  const prdDirs = [
    path.join(repoRoot, 'docs/prd/backlog'),
    path.join(repoRoot, 'docs/prd/ready'),
  ];

  const prdFiles: string[] = [];
  for (const dir of prdDirs) {
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        if (file.startsWith('prd-') && file.endsWith('.md')) {
          prdFiles.push(path.join(dir, file));
        }
      }
    } catch {
      // Directory might not exist, skip
    }
  }

  if (prdFiles.length === 0) {
    return [];
  }

  // Read all files and compute SHA of concatenated contents
  const fileContents = await Promise.all(
    prdFiles.map(async (filePath) => ({
      path: filePath,
      content: await fs.readFile(filePath, 'utf-8'),
    }))
  );

  const concatenated = fileContents.map(f => f.content).join('\n---\n');
  const sha = crypto.createHash('sha256').update(concatenated).digest('hex').slice(0, 12);
  const cacheFile = path.join(cacheDir, `${sha}.json`);

  // Check cache
  try {
    const cached = await fs.readFile(cacheFile, 'utf-8');
    console.log(`[buildPrdIndex] Cache HIT: ${cacheFile}`);
    return JSON.parse(cached);
  } catch {
    // Cache miss, proceed to parse
  }

  // Parse each PRD
  const entries: PrdIndexEntry[] = [];
  for (const { path: filePath, content } of fileContents) {
    try {
      const entry = await parsePrdFile(filePath, content);
      entries.push(entry);
    } catch (err) {
      console.error(`[buildPrdIndex] Failed to parse ${filePath}:`, err);
    }
  }

  // Write cache
  await fs.writeFile(cacheFile, JSON.stringify(entries, null, 2), 'utf-8');
  console.log(`[buildPrdIndex] Cache MISS: wrote ${cacheFile} with ${entries.length} entries`);

  return entries;
}

/**
 * Parse a single PRD markdown file
 */
async function parsePrdFile(filePath: string, content: string): Promise<PrdIndexEntry> {
  // Parse frontmatter
  const { data: frontmatter, content: bodyContent } = matter(content);

  // Extract slug from filename (e.g., "prd-planning-session.md" -> "planning-session")
  const filename = path.basename(filePath);
  const slug = filename.replace(/^prd-/, '').replace(/\.md$/, '');

  // Extract title from frontmatter or from first heading
  let title = '';
  const titleMatch = bodyContent.match(/^#\s+(.+)$/m);
  if (titleMatch) {
    title = titleMatch[1].replace(/^PRD\s*—\s*/i, '').trim();
  }

  // Extract §1 "Problema" summary (first paragraph after the heading)
  let problemSummary = '';
  const problemMatch = bodyContent.match(/##\s*1\.\s*Problema\s*\n+([\s\S]+?)(?=\n##|\n---|\n```|$)/i);
  if (problemMatch) {
    const firstPara = problemMatch[1].trim().split('\n\n')[0];
    problemSummary = firstPara.replace(/```[\s\S]*?```/g, '').trim().slice(0, 300);
  }

  // Extract §2 "Solução em uma frase"
  let oneLiner = '';
  const solutionMatch = bodyContent.match(/##\s*2\.\s*Solução em uma frase\s*\n+([\s\S]+?)(?=\n##|\n---|\n```|$)/i);
  if (solutionMatch) {
    oneLiner = solutionMatch[1].trim().replace(/^\*\*/, '').replace(/\*\*$/, '').slice(0, 500);
  }

  // Extract §4 personas (just extract headings like "### 4.1 Owner (João)")
  const personaMatches = bodyContent.matchAll(/###\s*4\.\d+\s+(\w+)\s*\(/g);
  const personaIds: string[] = [];
  for (const match of personaMatches) {
    personaIds.push(match[1].toLowerCase()); // e.g., "owner", "vitoria", "builder"
  }

  // Extract §12 "Riscos" to infer risk level
  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  const risksMatch = bodyContent.match(/##\s*12\.\s*Riscos\s*\n+([\s\S]+?)(?=\n##|\n---|\n```|$)/i);
  if (risksMatch) {
    const risksText = risksMatch[1].toLowerCase();
    // Simple heuristic: count high/medium risk mentions
    const highCount = (risksText.match(/\bhigh\b/gi) || []).length;
    const mediumCount = (risksText.match(/\bmedium\b/gi) || []).length;
    if (highCount > 0) {
      riskLevel = 'high';
    } else if (mediumCount > 0) {
      riskLevel = 'medium';
    }
  }

  // Extract §16 "Stories implementáveis" to get dependsOn and estimateMinutesTotal
  const dependsOnSet = new Set<string>();
  let estimateMinutesTotal = 0;

  const storiesMatch = bodyContent.match(/##\s*16\.\s*Stories implementáveis\s*\n+([\s\S]+?)(?=\n##|$)/i);
  if (storiesMatch) {
    const storiesSection = storiesMatch[1];

    // Extract all estimateMinutes values
    const estimateMatches = storiesSection.matchAll(/estimateMinutes:\s*(\d+)/g);
    for (const match of estimateMatches) {
      estimateMinutesTotal += parseInt(match[1], 10);
    }

    // Extract dependsOn references (PRD slugs, not story IDs)
    // Look for patterns like "dependsOn: [prd-foo, prd-bar]" or references to other PRDs
    const depsMatches = storiesSection.matchAll(/dependsOn:\s*\[([^\]]+)\]/g);
    for (const match of depsMatches) {
      const deps = match[1].split(',').map(d => d.trim());
      for (const dep of deps) {
        // If it's a PRD reference (not a story ID like "PLAN-001"), add it
        if (dep.startsWith('prd-')) {
          dependsOnSet.add(dep.replace(/^prd-/, ''));
        }
      }
    }
  }

  return {
    slug,
    filePath,
    title,
    oneLiner,
    problemSummary,
    dependsOn: Array.from(dependsOnSet),
    estimateMinutesTotal,
    personaIds,
    riskLevel,
    frontmatter,
  };
}
