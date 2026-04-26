/**
 * Parses `currentPath` from the bubble client into a structured route context.
 * The route context drives Alpha's server-side enrichment (which entity blocks
 * to inject in the system prompt) and tool scoping (which projectId/sprintId
 * to use as default filter).
 */

export type RouteContext =
  | { kind: "project"; projectId: string }
  | { kind: "sprint"; sprintId: string }
  | { kind: "meeting"; meetingId: string }
  | { kind: "list"; entity: "projects" | "sprints" | "meetings" | "clients" | "members" | "squads" }
  | { kind: "ops" }
  | { kind: "other"; path: string };

const PATH_REGEX = /^\/[a-zA-Z0-9\-/_]*(\?[a-zA-Z0-9\-=&_]*)?$/;
const MAX_LENGTH = 500;
const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const PROJECT_RE = new RegExp(`^/projects/(${UUID_RE})(?:/.*)?$`);
const SPRINT_RE = new RegExp(`^/sprints/(${UUID_RE})(?:/.*)?$`);
const MEETING_RE = new RegExp(`^/meetings/(${UUID_RE})(?:/.*)?$`);

function isValid(path: string | undefined): path is string {
  if (!path) return false;
  if (path.length > MAX_LENGTH) return false;
  return PATH_REGEX.test(path);
}

export function parseRoute(rawPath: string | undefined): RouteContext {
  if (!isValid(rawPath)) return { kind: "other", path: "/" };

  const path = rawPath.split("?")[0]; // drop query for matching

  const projectMatch = path.match(PROJECT_RE);
  if (projectMatch) return { kind: "project", projectId: projectMatch[1] };

  const sprintMatch = path.match(SPRINT_RE);
  if (sprintMatch) return { kind: "sprint", sprintId: sprintMatch[1] };

  const meetingMatch = path.match(MEETING_RE);
  if (meetingMatch) return { kind: "meeting", meetingId: meetingMatch[1] };

  if (path === "/projects") return { kind: "list", entity: "projects" };
  if (path === "/sprints") return { kind: "list", entity: "sprints" };
  if (path === "/meetings") return { kind: "list", entity: "meetings" };
  if (path === "/clients") return { kind: "list", entity: "clients" };
  if (path === "/members") return { kind: "list", entity: "members" };
  if (path === "/squads") return { kind: "list", entity: "squads" };

  if (path === "/ops" || path.startsWith("/ops/")) return { kind: "ops" };

  return { kind: "other", path };
}

/** Extracts a projectId hint for tool scoping when the route maps to a project. */
export function routeProjectId(route: RouteContext): string | undefined {
  return route.kind === "project" ? route.projectId : undefined;
}

/** Extracts a sprintId hint for tool scoping when the route maps to a sprint. */
export function routeSprintId(route: RouteContext): string | undefined {
  return route.kind === "sprint" ? route.sprintId : undefined;
}

/** Short, raw label of where the user is — used in compact "Local atual" blocks. */
export function routeLabel(route: RouteContext): string {
  switch (route.kind) {
    case "project": return `/projects/${route.projectId}`;
    case "sprint": return `/sprints/${route.sprintId}`;
    case "meeting": return `/meetings/${route.meetingId}`;
    case "list": return `/${route.entity}`;
    case "ops": return "/ops";
    case "other": return route.path;
  }
}
