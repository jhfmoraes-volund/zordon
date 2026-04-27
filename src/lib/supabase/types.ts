import type { Database } from "./database.types";

// ─── Table Row types ───

type Tables = Database["public"]["Tables"];

export type Client = Tables["Client"]["Row"];
export type Project = Tables["Project"]["Row"];
export type Squad = Tables["Squad"]["Row"];
export type Member = Tables["Member"]["Row"];
export type Sprint = Tables["Sprint"]["Row"];
export type Task = Tables["Task"]["Row"];
export type TaskAssignment = Tables["TaskAssignment"]["Row"];
export type TaskIteration = Tables["TaskIteration"]["Row"];
export type SprintDeploy = Tables["SprintDeploy"]["Row"];
export type DesignSession = Tables["DesignSession"]["Row"];
export type DesignSessionParticipant = Tables["DesignSessionParticipant"]["Row"];
export type DesignSessionStepData = Tables["DesignSessionStepData"]["Row"];
export type DesignSessionItem = Tables["DesignSessionItem"]["Row"];
export type ProjectWikiSection = Tables["ProjectWikiSection"]["Row"];
export type Meeting = Tables["Meeting"]["Row"];
export type MeetingProjectReview = Tables["MeetingProjectReview"]["Row"];
export type Todo = Tables["Todo"]["Row"];
export type MeetingAttendee = Tables["MeetingAttendee"]["Row"];
export type MeetingProjectLink = Tables["MeetingProjectLink"]["Row"];
export type ProjectSquad = Tables["ProjectSquad"]["Row"];
export type ProjectMember = Tables["ProjectMember"]["Row"];
export type SquadMember = Tables["SquadMember"]["Row"];
// ─── Insert types ───

export type ClientInsert = Tables["Client"]["Insert"];
export type ProjectInsert = Tables["Project"]["Insert"];
export type MemberInsert = Tables["Member"]["Insert"];
export type TaskInsert = Tables["Task"]["Insert"];
export type SprintInsert = Tables["Sprint"]["Insert"];
export type DesignSessionInsert = Tables["DesignSession"]["Insert"];
export type MeetingInsert = Tables["Meeting"]["Insert"];

// ─── Update types ───

export type ClientUpdate = Tables["Client"]["Update"];
export type ProjectUpdate = Tables["Project"]["Update"];
export type MemberUpdate = Tables["Member"]["Update"];
export type TaskUpdate = Tables["Task"]["Update"];
export type SprintUpdate = Tables["Sprint"]["Update"];

// ─── View types ───

type Views = Database["public"]["Views"];

export type MemberCapacityOverview = Views["member_capacity_overview"]["Row"];
