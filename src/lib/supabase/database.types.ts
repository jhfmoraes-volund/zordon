export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      AcceptanceCriterion: {
        Row: {
          checkedAt: string | null
          checkedBy: string | null
          createdAt: string
          id: string
          order: number
          taskId: string | null
          text: string
          updatedAt: string
          userStoryId: string | null
        }
        Insert: {
          checkedAt?: string | null
          checkedBy?: string | null
          createdAt?: string
          id?: string
          order?: number
          taskId?: string | null
          text: string
          updatedAt?: string
          userStoryId?: string | null
        }
        Update: {
          checkedAt?: string | null
          checkedBy?: string | null
          createdAt?: string
          id?: string
          order?: number
          taskId?: string | null
          text?: string
          updatedAt?: string
          userStoryId?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "AcceptanceCriterion_checkedBy_fkey"
            columns: ["checkedBy"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AcceptanceCriterion_checkedBy_fkey"
            columns: ["checkedBy"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AcceptanceCriterion_checkedBy_fkey"
            columns: ["checkedBy"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AcceptanceCriterion_checkedBy_fkey"
            columns: ["checkedBy"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AcceptanceCriterion_taskId_fkey"
            columns: ["taskId"]
            isOneToOne: false
            referencedRelation: "Task"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AcceptanceCriterion_userStoryId_fkey"
            columns: ["userStoryId"]
            isOneToOne: false
            referencedRelation: "user_story_overview"
            referencedColumns: ["userStoryId"]
          },
          {
            foreignKeyName: "AcceptanceCriterion_userStoryId_fkey"
            columns: ["userStoryId"]
            isOneToOne: false
            referencedRelation: "UserStory"
            referencedColumns: ["id"]
          },
        ]
      }
      Agent: {
        Row: {
          capabilities: Json
          createdAt: string
          description: string | null
          id: string
          isActive: boolean
          modelId: string
          name: string
          slug: string
          systemPrompt: string
          updatedAt: string
        }
        Insert: {
          capabilities?: Json
          createdAt?: string
          description?: string | null
          id?: string
          isActive?: boolean
          modelId?: string
          name: string
          slug: string
          systemPrompt?: string
          updatedAt?: string
        }
        Update: {
          capabilities?: Json
          createdAt?: string
          description?: string | null
          id?: string
          isActive?: boolean
          modelId?: string
          name?: string
          slug?: string
          systemPrompt?: string
          updatedAt?: string
        }
        Relationships: []
      }
      AgentCalibrationCapture: {
        Row: {
          agentSlug: string
          capturedAt: string
          capturedById: string | null
          category: string
          chatDump: string | null
          createdAt: string
          designSessionId: string | null
          duplicateOfId: string | null
          evalCaseAdded: boolean
          evalCaseFile: string | null
          expectedBehavior: string | null
          id: string
          meetingId: string | null
          notes: string | null
          observedBehavior: string
          planningCeremonyId: string | null
          projectId: string | null
          runbookScenarioRef: string | null
          screenshotPath: string | null
          severity: string
          status: string
          threadId: string | null
          updatedAt: string
          userPrompt: string
        }
        Insert: {
          agentSlug: string
          capturedAt?: string
          capturedById?: string | null
          category: string
          chatDump?: string | null
          createdAt?: string
          designSessionId?: string | null
          duplicateOfId?: string | null
          evalCaseAdded?: boolean
          evalCaseFile?: string | null
          expectedBehavior?: string | null
          id?: string
          meetingId?: string | null
          notes?: string | null
          observedBehavior: string
          planningCeremonyId?: string | null
          projectId?: string | null
          runbookScenarioRef?: string | null
          screenshotPath?: string | null
          severity?: string
          status?: string
          threadId?: string | null
          updatedAt?: string
          userPrompt: string
        }
        Update: {
          agentSlug?: string
          capturedAt?: string
          capturedById?: string | null
          category?: string
          chatDump?: string | null
          createdAt?: string
          designSessionId?: string | null
          duplicateOfId?: string | null
          evalCaseAdded?: boolean
          evalCaseFile?: string | null
          expectedBehavior?: string | null
          id?: string
          meetingId?: string | null
          notes?: string | null
          observedBehavior?: string
          planningCeremonyId?: string | null
          projectId?: string | null
          runbookScenarioRef?: string | null
          screenshotPath?: string | null
          severity?: string
          status?: string
          threadId?: string | null
          updatedAt?: string
          userPrompt?: string
        }
        Relationships: [
          {
            foreignKeyName: "AgentCalibrationCapture_capturedById_fkey"
            columns: ["capturedById"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AgentCalibrationCapture_capturedById_fkey"
            columns: ["capturedById"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AgentCalibrationCapture_capturedById_fkey"
            columns: ["capturedById"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AgentCalibrationCapture_capturedById_fkey"
            columns: ["capturedById"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AgentCalibrationCapture_designSessionId_fkey"
            columns: ["designSessionId"]
            isOneToOne: false
            referencedRelation: "design_session_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AgentCalibrationCapture_designSessionId_fkey"
            columns: ["designSessionId"]
            isOneToOne: false
            referencedRelation: "DesignSession"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AgentCalibrationCapture_duplicateOfId_fkey"
            columns: ["duplicateOfId"]
            isOneToOne: false
            referencedRelation: "AgentCalibrationCapture"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AgentCalibrationCapture_meetingId_fkey"
            columns: ["meetingId"]
            isOneToOne: false
            referencedRelation: "Meeting"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AgentCalibrationCapture_planningCeremonyId_fkey"
            columns: ["planningCeremonyId"]
            isOneToOne: false
            referencedRelation: "PlanningCeremony"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AgentCalibrationCapture_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AgentCalibrationCapture_threadId_fkey"
            columns: ["threadId"]
            isOneToOne: false
            referencedRelation: "ChatThread"
            referencedColumns: ["id"]
          },
        ]
      }
      AgentCalibrationFix: {
        Row: {
          agentSlug: string
          appliedAt: string
          appliedById: string | null
          captureId: string
          commitHash: string | null
          description: string
          filesChanged: string[]
          fixKind: string
          id: string
          scenarioPassedAfter: boolean | null
          scenarioPassedBefore: boolean | null
          scoreAfter: Json | null
          scoreBefore: Json | null
        }
        Insert: {
          agentSlug: string
          appliedAt?: string
          appliedById?: string | null
          captureId: string
          commitHash?: string | null
          description: string
          filesChanged?: string[]
          fixKind: string
          id?: string
          scenarioPassedAfter?: boolean | null
          scenarioPassedBefore?: boolean | null
          scoreAfter?: Json | null
          scoreBefore?: Json | null
        }
        Update: {
          agentSlug?: string
          appliedAt?: string
          appliedById?: string | null
          captureId?: string
          commitHash?: string | null
          description?: string
          filesChanged?: string[]
          fixKind?: string
          id?: string
          scenarioPassedAfter?: boolean | null
          scenarioPassedBefore?: boolean | null
          scoreAfter?: Json | null
          scoreBefore?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "AgentCalibrationFix_appliedById_fkey"
            columns: ["appliedById"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AgentCalibrationFix_appliedById_fkey"
            columns: ["appliedById"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AgentCalibrationFix_appliedById_fkey"
            columns: ["appliedById"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AgentCalibrationFix_appliedById_fkey"
            columns: ["appliedById"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AgentCalibrationFix_captureId_fkey"
            columns: ["captureId"]
            isOneToOne: false
            referencedRelation: "AgentCalibrationCapture"
            referencedColumns: ["id"]
          },
        ]
      }
      AgentCalibrationScoreboard: {
        Row: {
          agentSlug: string
          costUsd: number | null
          createdAt: string
          fixtureRef: string | null
          id: string
          maxScore: number
          passRate: number | null
          regressionFromPrior: boolean
          regressionNotes: string | null
          runDurationMs: number | null
          scenariosBlocked: number
          scenariosFailed: number
          scenariosPassed: number
          scores: Json
          snapshotDate: string
          totalScore: number | null
        }
        Insert: {
          agentSlug: string
          costUsd?: number | null
          createdAt?: string
          fixtureRef?: string | null
          id?: string
          maxScore: number
          passRate?: number | null
          regressionFromPrior?: boolean
          regressionNotes?: string | null
          runDurationMs?: number | null
          scenariosBlocked?: number
          scenariosFailed?: number
          scenariosPassed?: number
          scores: Json
          snapshotDate: string
          totalScore?: number | null
        }
        Update: {
          agentSlug?: string
          costUsd?: number | null
          createdAt?: string
          fixtureRef?: string | null
          id?: string
          maxScore?: number
          passRate?: number | null
          regressionFromPrior?: boolean
          regressionNotes?: string | null
          runDurationMs?: number | null
          scenariosBlocked?: number
          scenariosFailed?: number
          scenariosPassed?: number
          scores?: Json
          snapshotDate?: string
          totalScore?: number | null
        }
        Relationships: []
      }
      AgentConfig: {
        Row: {
          agentId: string
          description: string | null
          id: string
          key: string
          updatedAt: string
          value: Json
        }
        Insert: {
          agentId: string
          description?: string | null
          id?: string
          key: string
          updatedAt?: string
          value: Json
        }
        Update: {
          agentId?: string
          description?: string | null
          id?: string
          key?: string
          updatedAt?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "AgentConfig_agentId_fkey"
            columns: ["agentId"]
            isOneToOne: false
            referencedRelation: "Agent"
            referencedColumns: ["id"]
          },
        ]
      }
      AgentHeuristic: {
        Row: {
          agentId: string
          body: string
          category: string | null
          description: string
          id: string
          isActive: boolean
          name: string
          title: string
          updatedAt: string
        }
        Insert: {
          agentId: string
          body: string
          category?: string | null
          description: string
          id?: string
          isActive?: boolean
          name: string
          title: string
          updatedAt?: string
        }
        Update: {
          agentId?: string
          body?: string
          category?: string | null
          description?: string
          id?: string
          isActive?: boolean
          name?: string
          title?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "AgentHeuristic_agentId_fkey"
            columns: ["agentId"]
            isOneToOne: false
            referencedRelation: "Agent"
            referencedColumns: ["id"]
          },
        ]
      }
      AgentMode: {
        Row: {
          agentSlug: string
          mode: string
          updatedAt: string
          userId: string
        }
        Insert: {
          agentSlug: string
          mode?: string
          updatedAt?: string
          userId: string
        }
        Update: {
          agentSlug?: string
          mode?: string
          updatedAt?: string
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "AgentMode_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AgentMode_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AgentMode_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AgentMode_userId_fkey"
            columns: ["userId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      AgentProposalOutcome: {
        Row: {
          agentName: string
          callKind: string
          createdAt: string
          decidedAt: string
          decision: string
          editsJson: Json | null
          fpEstimated: number | null
          fpReal: number | null
          id: string
          proposalId: string
        }
        Insert: {
          agentName: string
          callKind?: string
          createdAt?: string
          decidedAt?: string
          decision: string
          editsJson?: Json | null
          fpEstimated?: number | null
          fpReal?: number | null
          id?: string
          proposalId: string
        }
        Update: {
          agentName?: string
          callKind?: string
          createdAt?: string
          decidedAt?: string
          decision?: string
          editsJson?: Json | null
          fpEstimated?: number | null
          fpReal?: number | null
          id?: string
          proposalId?: string
        }
        Relationships: [
          {
            foreignKeyName: "AgentProposalOutcome_proposalId_fkey"
            columns: ["proposalId"]
            isOneToOne: false
            referencedRelation: "MeetingTaskAction"
            referencedColumns: ["id"]
          },
        ]
      }
      AgentQualityLog: {
        Row: {
          agentSlug: string
          category: string
          createdAt: string
          humanVerdict: string | null
          id: string
          memberId: string | null
          payload: Json
          projectId: string | null
          threadId: string | null
          verdictAt: string | null
          verdictSource: string | null
        }
        Insert: {
          agentSlug?: string
          category: string
          createdAt?: string
          humanVerdict?: string | null
          id?: string
          memberId?: string | null
          payload: Json
          projectId?: string | null
          threadId?: string | null
          verdictAt?: string | null
          verdictSource?: string | null
        }
        Update: {
          agentSlug?: string
          category?: string
          createdAt?: string
          humanVerdict?: string | null
          id?: string
          memberId?: string | null
          payload?: Json
          projectId?: string | null
          threadId?: string | null
          verdictAt?: string | null
          verdictSource?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "AgentQualityLog_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AgentQualityLog_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AgentQualityLog_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AgentQualityLog_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AgentQualityLog_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AgentQualityLog_threadId_fkey"
            columns: ["threadId"]
            isOneToOne: false
            referencedRelation: "ChatThread"
            referencedColumns: ["id"]
          },
        ]
      }
      AgentUsage: {
        Row: {
          agentName: string
          cachedPromptTokens: number | null
          callKind: string
          completionTokens: number
          costUsd: number
          createdAt: string
          generationId: string | null
          id: string
          latencyMs: number | null
          memberId: string | null
          modelId: string
          projectId: string | null
          promptTokens: number
          rawUsage: Json | null
          reasoningTokens: number | null
          threadId: string | null
          totalTokens: number
        }
        Insert: {
          agentName: string
          cachedPromptTokens?: number | null
          callKind?: string
          completionTokens?: number
          costUsd?: number
          createdAt?: string
          generationId?: string | null
          id?: string
          latencyMs?: number | null
          memberId?: string | null
          modelId: string
          projectId?: string | null
          promptTokens?: number
          rawUsage?: Json | null
          reasoningTokens?: number | null
          threadId?: string | null
          totalTokens?: number
        }
        Update: {
          agentName?: string
          cachedPromptTokens?: number | null
          callKind?: string
          completionTokens?: number
          costUsd?: number
          createdAt?: string
          generationId?: string | null
          id?: string
          latencyMs?: number | null
          memberId?: string | null
          modelId?: string
          projectId?: string | null
          promptTokens?: number
          rawUsage?: Json | null
          reasoningTokens?: number | null
          threadId?: string | null
          totalTokens?: number
        }
        Relationships: [
          {
            foreignKeyName: "AgentUsage_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AgentUsage_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AgentUsage_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AgentUsage_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AgentUsage_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AgentUsage_threadId_fkey"
            columns: ["threadId"]
            isOneToOne: false
            referencedRelation: "ChatThread"
            referencedColumns: ["id"]
          },
        ]
      }
      AgentVersion: {
        Row: {
          agentId: string
          config: Json
          createdAt: string
          createdBy: string | null
          heuristics: Json
          id: string
          modelId: string
          notes: string | null
          systemPrompt: string
          tag: string
        }
        Insert: {
          agentId: string
          config: Json
          createdAt?: string
          createdBy?: string | null
          heuristics: Json
          id?: string
          modelId: string
          notes?: string | null
          systemPrompt: string
          tag: string
        }
        Update: {
          agentId?: string
          config?: Json
          createdAt?: string
          createdBy?: string | null
          heuristics?: Json
          id?: string
          modelId?: string
          notes?: string | null
          systemPrompt?: string
          tag?: string
        }
        Relationships: [
          {
            foreignKeyName: "AgentVersion_agentId_fkey"
            columns: ["agentId"]
            isOneToOne: false
            referencedRelation: "Agent"
            referencedColumns: ["id"]
          },
        ]
      }
      ChatMessage: {
        Row: {
          actions: Json | null
          content: string
          createdAt: string
          feedback: number | null
          id: string
          parts: Json | null
          role: string
          threadId: string
          toolCalls: Json | null
          toolResults: Json | null
        }
        Insert: {
          actions?: Json | null
          content?: string
          createdAt?: string
          feedback?: number | null
          id?: string
          parts?: Json | null
          role: string
          threadId: string
          toolCalls?: Json | null
          toolResults?: Json | null
        }
        Update: {
          actions?: Json | null
          content?: string
          createdAt?: string
          feedback?: number | null
          id?: string
          parts?: Json | null
          role?: string
          threadId?: string
          toolCalls?: Json | null
          toolResults?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "ChatMessage_threadId_fkey"
            columns: ["threadId"]
            isOneToOne: false
            referencedRelation: "ChatThread"
            referencedColumns: ["id"]
          },
        ]
      }
      ChatThread: {
        Row: {
          agentId: string | null
          agentName: string | null
          agentVersionId: string | null
          ccSessionId: string | null
          channel: string
          createdAt: string
          createdBy: string | null
          id: string
          lastCompactAt: string | null
          lastSummary: string | null
          sessionId: string | null
          title: string | null
          turnsSinceCompact: number
          updatedAt: string
        }
        Insert: {
          agentId?: string | null
          agentName?: string | null
          agentVersionId?: string | null
          ccSessionId?: string | null
          channel?: string
          createdAt?: string
          createdBy?: string | null
          id?: string
          lastCompactAt?: string | null
          lastSummary?: string | null
          sessionId?: string | null
          title?: string | null
          turnsSinceCompact?: number
          updatedAt?: string
        }
        Update: {
          agentId?: string | null
          agentName?: string | null
          agentVersionId?: string | null
          ccSessionId?: string | null
          channel?: string
          createdAt?: string
          createdBy?: string | null
          id?: string
          lastCompactAt?: string | null
          lastSummary?: string | null
          sessionId?: string | null
          title?: string | null
          turnsSinceCompact?: number
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "ChatThread_agentId_fkey"
            columns: ["agentId"]
            isOneToOne: false
            referencedRelation: "Agent"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ChatThread_agentVersionId_fkey"
            columns: ["agentVersionId"]
            isOneToOne: false
            referencedRelation: "AgentVersion"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ChatThread_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ChatThread_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ChatThread_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ChatThread_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ChatThread_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "design_session_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ChatThread_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "DesignSession"
            referencedColumns: ["id"]
          },
        ]
      }
      ChatTurn: {
        Row: {
          agentSlug: string
          claimedBy: string | null
          costUsd: number | null
          createdAt: string
          endedAt: string | null
          errorReason: string | null
          id: string
          mode: string
          responseMessageId: string | null
          startedAt: string | null
          status: string
          systemPrompt: string
          threadId: string
          tokensIn: number | null
          tokensOut: number | null
          userMessageId: string
        }
        Insert: {
          agentSlug: string
          claimedBy?: string | null
          costUsd?: number | null
          createdAt?: string
          endedAt?: string | null
          errorReason?: string | null
          id?: string
          mode: string
          responseMessageId?: string | null
          startedAt?: string | null
          status?: string
          systemPrompt: string
          threadId: string
          tokensIn?: number | null
          tokensOut?: number | null
          userMessageId: string
        }
        Update: {
          agentSlug?: string
          claimedBy?: string | null
          costUsd?: number | null
          createdAt?: string
          endedAt?: string | null
          errorReason?: string | null
          id?: string
          mode?: string
          responseMessageId?: string | null
          startedAt?: string | null
          status?: string
          systemPrompt?: string
          threadId?: string
          tokensIn?: number | null
          tokensOut?: number | null
          userMessageId?: string
        }
        Relationships: [
          {
            foreignKeyName: "ChatTurn_claimedBy_fkey"
            columns: ["claimedBy"]
            isOneToOne: false
            referencedRelation: "ForgeDaemon"
            referencedColumns: ["daemonId"]
          },
          {
            foreignKeyName: "ChatTurn_responseMessageId_fkey"
            columns: ["responseMessageId"]
            isOneToOne: false
            referencedRelation: "ChatMessage"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ChatTurn_threadId_fkey"
            columns: ["threadId"]
            isOneToOne: false
            referencedRelation: "ChatThread"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ChatTurn_userMessageId_fkey"
            columns: ["userMessageId"]
            isOneToOne: false
            referencedRelation: "ChatMessage"
            referencedColumns: ["id"]
          },
        ]
      }
      ChatTurnEvent: {
        Row: {
          kind: string
          payload: Json | null
          seq: number
          ts: string
          turnId: string
        }
        Insert: {
          kind: string
          payload?: Json | null
          seq: number
          ts?: string
          turnId: string
        }
        Update: {
          kind?: string
          payload?: Json | null
          seq?: number
          ts?: string
          turnId?: string
        }
        Relationships: [
          {
            foreignKeyName: "ChatTurnEvent_turnId_fkey"
            columns: ["turnId"]
            isOneToOne: false
            referencedRelation: "ChatTurn"
            referencedColumns: ["id"]
          },
        ]
      }
      Client: {
        Row: {
          createdAt: string
          email: string | null
          id: string
          logoStoragePath: string | null
          logoUpdatedAt: string | null
          name: string
          notes: string | null
          phone: string | null
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          email?: string | null
          id?: string
          logoStoragePath?: string | null
          logoUpdatedAt?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          updatedAt: string
        }
        Update: {
          createdAt?: string
          email?: string | null
          id?: string
          logoStoragePath?: string | null
          logoUpdatedAt?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          updatedAt?: string
        }
        Relationships: []
      }
      ClientInsight: {
        Row: {
          clientId: string
          costUsdCents: number
          createdAt: string
          errorRelational: string | null
          errorTechnical: string | null
          generatedAt: string
          generatedBy: string
          id: string
          inputMeetingsCount: number
          inputProjectsCount: number
          modelRelational: string | null
          modelTechnical: string | null
          relationalHealth: string | null
          relationalSignals: Json
          relationalSummary: string | null
          relationalWatch: Json
          technicalHealth: string | null
          technicalRisks: Json
          technicalSummary: string | null
          technicalWatch: Json
          triggeredByMemberId: string | null
          updatedAt: string
        }
        Insert: {
          clientId: string
          costUsdCents?: number
          createdAt?: string
          errorRelational?: string | null
          errorTechnical?: string | null
          generatedAt?: string
          generatedBy: string
          id?: string
          inputMeetingsCount?: number
          inputProjectsCount?: number
          modelRelational?: string | null
          modelTechnical?: string | null
          relationalHealth?: string | null
          relationalSignals?: Json
          relationalSummary?: string | null
          relationalWatch?: Json
          technicalHealth?: string | null
          technicalRisks?: Json
          technicalSummary?: string | null
          technicalWatch?: Json
          triggeredByMemberId?: string | null
          updatedAt?: string
        }
        Update: {
          clientId?: string
          costUsdCents?: number
          createdAt?: string
          errorRelational?: string | null
          errorTechnical?: string | null
          generatedAt?: string
          generatedBy?: string
          id?: string
          inputMeetingsCount?: number
          inputProjectsCount?: number
          modelRelational?: string | null
          modelTechnical?: string | null
          relationalHealth?: string | null
          relationalSignals?: Json
          relationalSummary?: string | null
          relationalWatch?: Json
          technicalHealth?: string | null
          technicalRisks?: Json
          technicalSummary?: string | null
          technicalWatch?: Json
          triggeredByMemberId?: string | null
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "ClientInsight_clientId_fkey"
            columns: ["clientId"]
            isOneToOne: true
            referencedRelation: "Client"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ClientInsight_clientId_fkey"
            columns: ["clientId"]
            isOneToOne: true
            referencedRelation: "client_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ClientInsight_triggeredByMemberId_fkey"
            columns: ["triggeredByMemberId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ClientInsight_triggeredByMemberId_fkey"
            columns: ["triggeredByMemberId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ClientInsight_triggeredByMemberId_fkey"
            columns: ["triggeredByMemberId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ClientInsight_triggeredByMemberId_fkey"
            columns: ["triggeredByMemberId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      ContextSource: {
        Row: {
          actionItems: Json | null
          byline: string | null
          capturedAt: string | null
          createdAt: string
          createdBy: string | null
          endedAt: string | null
          externalId: string | null
          externalUrl: string | null
          fullText: string | null
          id: string
          kind: Database["public"]["Enums"]["context_source_kind"]
          meetingId: string | null
          participants: Json | null
          payload: Json
          projectId: string | null
          source: string | null
          sourceId: string | null
          storagePath: string | null
          summary: string | null
          title: string
          updatedAt: string
        }
        Insert: {
          actionItems?: Json | null
          byline?: string | null
          capturedAt?: string | null
          createdAt?: string
          createdBy?: string | null
          endedAt?: string | null
          externalId?: string | null
          externalUrl?: string | null
          fullText?: string | null
          id?: string
          kind: Database["public"]["Enums"]["context_source_kind"]
          meetingId?: string | null
          participants?: Json | null
          payload?: Json
          projectId?: string | null
          source?: string | null
          sourceId?: string | null
          storagePath?: string | null
          summary?: string | null
          title: string
          updatedAt?: string
        }
        Update: {
          actionItems?: Json | null
          byline?: string | null
          capturedAt?: string | null
          createdAt?: string
          createdBy?: string | null
          endedAt?: string | null
          externalId?: string | null
          externalUrl?: string | null
          fullText?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["context_source_kind"]
          meetingId?: string | null
          participants?: Json | null
          payload?: Json
          projectId?: string | null
          source?: string | null
          sourceId?: string | null
          storagePath?: string | null
          summary?: string | null
          title?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "ContextSource_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ContextSource_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ContextSource_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ContextSource_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ContextSource_meetingId_fkey"
            columns: ["meetingId"]
            isOneToOne: false
            referencedRelation: "Meeting"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ContextSource_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
        ]
      }
      CsatResponse: {
        Row: {
          clientId: string
          contactName: string | null
          createdAt: string
          csatScore: number
          id: string
          interviewedAt: string
          interviewedBy: string | null
          methodologyScore: number
          npsScore: number
          teamScore: number
          updatedAt: string
          whatsGood: string | null
          whatsToImprove: string | null
        }
        Insert: {
          clientId: string
          contactName?: string | null
          createdAt?: string
          csatScore: number
          id?: string
          interviewedAt?: string
          interviewedBy?: string | null
          methodologyScore: number
          npsScore: number
          teamScore: number
          updatedAt?: string
          whatsGood?: string | null
          whatsToImprove?: string | null
        }
        Update: {
          clientId?: string
          contactName?: string | null
          createdAt?: string
          csatScore?: number
          id?: string
          interviewedAt?: string
          interviewedBy?: string | null
          methodologyScore?: number
          npsScore?: number
          teamScore?: number
          updatedAt?: string
          whatsGood?: string | null
          whatsToImprove?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "CsatResponse_clientId_fkey"
            columns: ["clientId"]
            isOneToOne: false
            referencedRelation: "Client"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "CsatResponse_clientId_fkey"
            columns: ["clientId"]
            isOneToOne: false
            referencedRelation: "client_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "CsatResponse_interviewedBy_fkey"
            columns: ["interviewedBy"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "CsatResponse_interviewedBy_fkey"
            columns: ["interviewedBy"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "CsatResponse_interviewedBy_fkey"
            columns: ["interviewedBy"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "CsatResponse_interviewedBy_fkey"
            columns: ["interviewedBy"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      DesignDecision: {
        Row: {
          confidence: string
          createdAt: string
          createdBy: string
          id: string
          projectId: string
          rationale: string
          sessionId: string
          statement: string
          status: string
          supersededBy: string | null
          tags: string[] | null
          updatedAt: string
        }
        Insert: {
          confidence: string
          createdAt?: string
          createdBy: string
          id?: string
          projectId: string
          rationale: string
          sessionId: string
          statement: string
          status?: string
          supersededBy?: string | null
          tags?: string[] | null
          updatedAt?: string
        }
        Update: {
          confidence?: string
          createdAt?: string
          createdBy?: string
          id?: string
          projectId?: string
          rationale?: string
          sessionId?: string
          statement?: string
          status?: string
          supersededBy?: string | null
          tags?: string[] | null
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "DesignDecision_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignDecision_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "design_session_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignDecision_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "DesignSession"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignDecision_supersededBy_fkey"
            columns: ["supersededBy"]
            isOneToOne: false
            referencedRelation: "DesignDecision"
            referencedColumns: ["id"]
          },
        ]
      }
      DesignOpenQuestion: {
        Row: {
          answer: string | null
          answeredAt: string | null
          blocksWhat: string | null
          createdAt: string
          id: string
          projectId: string
          question: string
          sessionId: string
          status: string
        }
        Insert: {
          answer?: string | null
          answeredAt?: string | null
          blocksWhat?: string | null
          createdAt?: string
          id?: string
          projectId: string
          question: string
          sessionId: string
          status?: string
        }
        Update: {
          answer?: string | null
          answeredAt?: string | null
          blocksWhat?: string | null
          createdAt?: string
          id?: string
          projectId?: string
          question?: string
          sessionId?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "DesignOpenQuestion_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignOpenQuestion_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "design_session_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignOpenQuestion_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "DesignSession"
            referencedColumns: ["id"]
          },
        ]
      }
      DesignSession: {
        Row: {
          actualDurationMin: number | null
          archivedAt: string | null
          briefingFirstMessageAt: string | null
          briefingSubPhase: string | null
          briefingTargetStoryId: string | null
          completedAt: string | null
          createdAt: string
          createdBy: string | null
          currentStep: number
          description: string | null
          facilitatorId: string | null
          firstAnalysisStatus: string
          id: string
          isMain: boolean
          launcherBrief: string | null
          memoryAbstract: string | null
          memoryMd: string | null
          memoryUpdatedAt: string | null
          memoryVersion: number
          projectId: string
          scheduledAt: string | null
          selectedSteps: string[] | null
          status: string
          subKind: string | null
          title: string
          totalSteps: number
          type: string
          updatedAt: string
          visibility: string
        }
        Insert: {
          actualDurationMin?: number | null
          archivedAt?: string | null
          briefingFirstMessageAt?: string | null
          briefingSubPhase?: string | null
          briefingTargetStoryId?: string | null
          completedAt?: string | null
          createdAt?: string
          createdBy?: string | null
          currentStep?: number
          description?: string | null
          facilitatorId?: string | null
          firstAnalysisStatus?: string
          id?: string
          isMain?: boolean
          launcherBrief?: string | null
          memoryAbstract?: string | null
          memoryMd?: string | null
          memoryUpdatedAt?: string | null
          memoryVersion?: number
          projectId: string
          scheduledAt?: string | null
          selectedSteps?: string[] | null
          status?: string
          subKind?: string | null
          title: string
          totalSteps?: number
          type?: string
          updatedAt: string
          visibility?: string
        }
        Update: {
          actualDurationMin?: number | null
          archivedAt?: string | null
          briefingFirstMessageAt?: string | null
          briefingSubPhase?: string | null
          briefingTargetStoryId?: string | null
          completedAt?: string | null
          createdAt?: string
          createdBy?: string | null
          currentStep?: number
          description?: string | null
          facilitatorId?: string | null
          firstAnalysisStatus?: string
          id?: string
          isMain?: boolean
          launcherBrief?: string | null
          memoryAbstract?: string | null
          memoryMd?: string | null
          memoryUpdatedAt?: string | null
          memoryVersion?: number
          projectId?: string
          scheduledAt?: string | null
          selectedSteps?: string[] | null
          status?: string
          subKind?: string | null
          title?: string
          totalSteps?: number
          type?: string
          updatedAt?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "DesignSession_briefingTargetStoryId_fkey"
            columns: ["briefingTargetStoryId"]
            isOneToOne: false
            referencedRelation: "user_story_overview"
            referencedColumns: ["userStoryId"]
          },
          {
            foreignKeyName: "DesignSession_briefingTargetStoryId_fkey"
            columns: ["briefingTargetStoryId"]
            isOneToOne: false
            referencedRelation: "UserStory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSession_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSession_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSession_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSession_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSession_facilitatorId_fkey"
            columns: ["facilitatorId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSession_facilitatorId_fkey"
            columns: ["facilitatorId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSession_facilitatorId_fkey"
            columns: ["facilitatorId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSession_facilitatorId_fkey"
            columns: ["facilitatorId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSession_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
        ]
      }
      DesignSessionBrainstormFeature: {
        Row: {
          archived: boolean
          bucket: string | null
          createdAt: string
          howItSolves: string | null
          id: string
          keyScreens: string | null
          moduleHint: string | null
          orderIndex: number
          painPointRef: string | null
          sessionId: string
          targetPersona: string | null
          technicalNotes: string | null
          title: string
          updatedAt: string
          userFlows: string | null
        }
        Insert: {
          archived?: boolean
          bucket?: string | null
          createdAt?: string
          howItSolves?: string | null
          id: string
          keyScreens?: string | null
          moduleHint?: string | null
          orderIndex?: number
          painPointRef?: string | null
          sessionId: string
          targetPersona?: string | null
          technicalNotes?: string | null
          title: string
          updatedAt?: string
          userFlows?: string | null
        }
        Update: {
          archived?: boolean
          bucket?: string | null
          createdAt?: string
          howItSolves?: string | null
          id?: string
          keyScreens?: string | null
          moduleHint?: string | null
          orderIndex?: number
          painPointRef?: string | null
          sessionId?: string
          targetPersona?: string | null
          technicalNotes?: string | null
          title?: string
          updatedAt?: string
          userFlows?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "DesignSessionBrainstormFeature_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "design_session_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSessionBrainstormFeature_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "DesignSession"
            referencedColumns: ["id"]
          },
        ]
      }
      DesignSessionExportLog: {
        Row: {
          byteSize: number
          createdAt: string
          format: string
          id: string
          memberId: string | null
          sessionId: string
          stepCount: number
          userId: string
        }
        Insert: {
          byteSize: number
          createdAt?: string
          format?: string
          id?: string
          memberId?: string | null
          sessionId: string
          stepCount: number
          userId: string
        }
        Update: {
          byteSize?: number
          createdAt?: string
          format?: string
          id?: string
          memberId?: string | null
          sessionId?: string
          stepCount?: number
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "DesignSessionExportLog_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSessionExportLog_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSessionExportLog_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSessionExportLog_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSessionExportLog_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "design_session_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSessionExportLog_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "DesignSession"
            referencedColumns: ["id"]
          },
        ]
      }
      DesignSessionFile: {
        Row: {
          createdAt: string
          extractedText: string | null
          extractionStatus: string
          id: string
          mimeType: string
          name: string
          sessionId: string
          size: number
          storagePath: string
          uploadedByMemberId: string | null
        }
        Insert: {
          createdAt?: string
          extractedText?: string | null
          extractionStatus?: string
          id?: string
          mimeType: string
          name: string
          sessionId: string
          size: number
          storagePath: string
          uploadedByMemberId?: string | null
        }
        Update: {
          createdAt?: string
          extractedText?: string | null
          extractionStatus?: string
          id?: string
          mimeType?: string
          name?: string
          sessionId?: string
          size?: number
          storagePath?: string
          uploadedByMemberId?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "DesignSessionFile_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "design_session_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSessionFile_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "DesignSession"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSessionFile_uploadedByMemberId_fkey"
            columns: ["uploadedByMemberId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSessionFile_uploadedByMemberId_fkey"
            columns: ["uploadedByMemberId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSessionFile_uploadedByMemberId_fkey"
            columns: ["uploadedByMemberId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSessionFile_uploadedByMemberId_fkey"
            columns: ["uploadedByMemberId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      DesignSessionGap: {
        Row: {
          category: string | null
          createdAt: string
          id: string
          mitigation: string | null
          orderIndex: number
          relatedFeature: string | null
          sessionId: string
          severity: string | null
          text: string
          updatedAt: string
        }
        Insert: {
          category?: string | null
          createdAt?: string
          id?: string
          mitigation?: string | null
          orderIndex?: number
          relatedFeature?: string | null
          sessionId: string
          severity?: string | null
          text?: string
          updatedAt?: string
        }
        Update: {
          category?: string | null
          createdAt?: string
          id?: string
          mitigation?: string | null
          orderIndex?: number
          relatedFeature?: string | null
          sessionId?: string
          severity?: string | null
          text?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "DesignSessionGap_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "design_session_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSessionGap_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "DesignSession"
            referencedColumns: ["id"]
          },
        ]
      }
      DesignSessionHypothesis: {
        Row: {
          createdAt: string
          evidence: string | null
          expectedResult: string
          hypothesis: string
          id: string
          indicator: string
          orderIndex: number
          sessionId: string
          target: string
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          evidence?: string | null
          expectedResult?: string
          hypothesis?: string
          id?: string
          indicator?: string
          orderIndex?: number
          sessionId: string
          target?: string
          updatedAt?: string
        }
        Update: {
          createdAt?: string
          evidence?: string | null
          expectedResult?: string
          hypothesis?: string
          id?: string
          indicator?: string
          orderIndex?: number
          sessionId?: string
          target?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "DesignSessionHypothesis_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "design_session_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSessionHypothesis_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "DesignSession"
            referencedColumns: ["id"]
          },
        ]
      }
      DesignSessionItem: {
        Row: {
          aiGenerated: boolean
          description: string | null
          id: string
          orderIndex: number
          priority: string
          sessionId: string
          sourceStep: string | null
          title: string
          type: string
        }
        Insert: {
          aiGenerated?: boolean
          description?: string | null
          id?: string
          orderIndex?: number
          priority?: string
          sessionId: string
          sourceStep?: string | null
          title: string
          type?: string
        }
        Update: {
          aiGenerated?: boolean
          description?: string | null
          id?: string
          orderIndex?: number
          priority?: string
          sessionId?: string
          sourceStep?: string | null
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "DesignSessionItem_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "design_session_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSessionItem_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "DesignSession"
            referencedColumns: ["id"]
          },
        ]
      }
      DesignSessionParticipant: {
        Row: {
          externalEmail: string | null
          externalName: string | null
          externalRole: string | null
          id: string
          memberId: string | null
          role: string
          sessionId: string
        }
        Insert: {
          externalEmail?: string | null
          externalName?: string | null
          externalRole?: string | null
          id?: string
          memberId?: string | null
          role?: string
          sessionId: string
        }
        Update: {
          externalEmail?: string | null
          externalName?: string | null
          externalRole?: string | null
          id?: string
          memberId?: string | null
          role?: string
          sessionId?: string
        }
        Relationships: [
          {
            foreignKeyName: "DesignSessionParticipant_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSessionParticipant_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSessionParticipant_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSessionParticipant_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSessionParticipant_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "design_session_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSessionParticipant_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "DesignSession"
            referencedColumns: ["id"]
          },
        ]
      }
      DesignSessionPersona: {
        Row: {
          asIsSteps: Json
          context: string
          createdAt: string
          id: string
          name: string
          orderIndex: number
          role: string
          sessionId: string
          toBeSteps: Json
          updatedAt: string
        }
        Insert: {
          asIsSteps?: Json
          context?: string
          createdAt?: string
          id?: string
          name?: string
          orderIndex?: number
          role?: string
          sessionId: string
          toBeSteps?: Json
          updatedAt?: string
        }
        Update: {
          asIsSteps?: Json
          context?: string
          createdAt?: string
          id?: string
          name?: string
          orderIndex?: number
          role?: string
          sessionId?: string
          toBeSteps?: Json
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "DesignSessionPersona_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "design_session_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSessionPersona_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "DesignSession"
            referencedColumns: ["id"]
          },
        ]
      }
      DesignSessionPriorityItem: {
        Row: {
          bucket: string
          createdAt: string
          howItSolves: string
          id: string
          keyScreens: string | null
          orderIndex: number
          painPointRef: string | null
          sessionId: string
          targetPersona: string
          technicalNotes: string | null
          title: string
          updatedAt: string
          userFlows: string | null
        }
        Insert: {
          bucket?: string
          createdAt?: string
          howItSolves?: string
          id?: string
          keyScreens?: string | null
          orderIndex?: number
          painPointRef?: string | null
          sessionId: string
          targetPersona?: string
          technicalNotes?: string | null
          title?: string
          updatedAt?: string
          userFlows?: string | null
        }
        Update: {
          bucket?: string
          createdAt?: string
          howItSolves?: string
          id?: string
          keyScreens?: string | null
          orderIndex?: number
          painPointRef?: string | null
          sessionId?: string
          targetPersona?: string
          technicalNotes?: string | null
          title?: string
          updatedAt?: string
          userFlows?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "DesignSessionPriorityItem_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "design_session_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSessionPriorityItem_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "DesignSession"
            referencedColumns: ["id"]
          },
        ]
      }
      DesignSessionProductVision: {
        Row: {
          consequences: string
          impactMetrics: string
          problem: string
          sessionId: string
          successVision: string
          updatedAt: string
          whoSuffers: string
        }
        Insert: {
          consequences?: string
          impactMetrics?: string
          problem?: string
          sessionId: string
          successVision?: string
          updatedAt?: string
          whoSuffers?: string
        }
        Update: {
          consequences?: string
          impactMetrics?: string
          problem?: string
          sessionId?: string
          successVision?: string
          updatedAt?: string
          whoSuffers?: string
        }
        Relationships: [
          {
            foreignKeyName: "DesignSessionProductVision_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: true
            referencedRelation: "design_session_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSessionProductVision_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: true
            referencedRelation: "DesignSession"
            referencedColumns: ["id"]
          },
        ]
      }
      DesignSessionResearch: {
        Row: {
          createdAt: string
          id: string
          projectId: string
          query: string
          sessionId: string
          sources: Json
          summary: string
        }
        Insert: {
          createdAt?: string
          id?: string
          projectId: string
          query: string
          sessionId: string
          sources: Json
          summary: string
        }
        Update: {
          createdAt?: string
          id?: string
          projectId?: string
          query?: string
          sessionId?: string
          sources?: Json
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "DesignSessionResearch_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSessionResearch_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "design_session_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSessionResearch_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "DesignSession"
            referencedColumns: ["id"]
          },
        ]
      }
      DesignSessionRisk: {
        Row: {
          category: string
          createdAt: string
          id: string
          mitigation: string | null
          orderIndex: number
          relatedFeature: string | null
          sessionId: string
          severity: string
          text: string
          updatedAt: string
        }
        Insert: {
          category?: string
          createdAt?: string
          id?: string
          mitigation?: string | null
          orderIndex?: number
          relatedFeature?: string | null
          sessionId: string
          severity?: string
          text?: string
          updatedAt?: string
        }
        Update: {
          category?: string
          createdAt?: string
          id?: string
          mitigation?: string | null
          orderIndex?: number
          relatedFeature?: string | null
          sessionId?: string
          severity?: string
          text?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "DesignSessionRisk_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "design_session_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSessionRisk_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "DesignSession"
            referencedColumns: ["id"]
          },
        ]
      }
      DesignSessionScope: {
        Row: {
          does: Json
          doesNot: Json
          inScope: Json
          outOfScope: Json
          sessionId: string
          updatedAt: string
        }
        Insert: {
          does?: Json
          doesNot?: Json
          inScope?: Json
          outOfScope?: Json
          sessionId: string
          updatedAt?: string
        }
        Update: {
          does?: Json
          doesNot?: Json
          inScope?: Json
          outOfScope?: Json
          sessionId?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "DesignSessionScope_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: true
            referencedRelation: "design_session_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSessionScope_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: true
            referencedRelation: "DesignSession"
            referencedColumns: ["id"]
          },
        ]
      }
      DesignSessionStepData: {
        Row: {
          data: Json
          id: string
          sessionId: string
          stepIndex: number
          stepKey: string
          updatedAt: string
        }
        Insert: {
          data?: Json
          id?: string
          sessionId: string
          stepIndex: number
          stepKey: string
          updatedAt: string
        }
        Update: {
          data?: Json
          id?: string
          sessionId?: string
          stepIndex?: number
          stepKey?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "DesignSessionStepData_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "design_session_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSessionStepData_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "DesignSession"
            referencedColumns: ["id"]
          },
        ]
      }
      DesignSessionStepNote: {
        Row: {
          createdAt: string
          id: string
          orderIndex: number
          sessionId: string
          stepKey: string
          text: string
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          id?: string
          orderIndex?: number
          sessionId: string
          stepKey: string
          text?: string
          updatedAt?: string
        }
        Update: {
          createdAt?: string
          id?: string
          orderIndex?: number
          sessionId?: string
          stepKey?: string
          text?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "DesignSessionStepNote_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "design_session_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSessionStepNote_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "DesignSession"
            referencedColumns: ["id"]
          },
        ]
      }
      DesignSessionTechnicalSpecs: {
        Row: {
          integrations: Json
          performance: string
          rules: Json
          sessionId: string
          stack: string
          updatedAt: string
        }
        Insert: {
          integrations?: Json
          performance?: string
          rules?: Json
          sessionId: string
          stack?: string
          updatedAt?: string
        }
        Update: {
          integrations?: Json
          performance?: string
          rules?: Json
          sessionId?: string
          stack?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "DesignSessionTechnicalSpecs_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: true
            referencedRelation: "design_session_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSessionTechnicalSpecs_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: true
            referencedRelation: "DesignSession"
            referencedColumns: ["id"]
          },
        ]
      }
      EntityLink: {
        Row: {
          contextSourceId: string | null
          designSessionId: string | null
          id: string
          linkedAt: string
          linkedById: string | null
          meetingId: string | null
          note: string | null
          planningCeremonyId: string | null
          planningSessionId: string | null
          pmReviewId: string | null
          weight: string | null
        }
        Insert: {
          contextSourceId?: string | null
          designSessionId?: string | null
          id?: string
          linkedAt?: string
          linkedById?: string | null
          meetingId?: string | null
          note?: string | null
          planningCeremonyId?: string | null
          planningSessionId?: string | null
          pmReviewId?: string | null
          weight?: string | null
        }
        Update: {
          contextSourceId?: string | null
          designSessionId?: string | null
          id?: string
          linkedAt?: string
          linkedById?: string | null
          meetingId?: string | null
          note?: string | null
          planningCeremonyId?: string | null
          planningSessionId?: string | null
          pmReviewId?: string | null
          weight?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "EntityLink_contextSourceId_fkey"
            columns: ["contextSourceId"]
            isOneToOne: false
            referencedRelation: "ContextSource"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "EntityLink_designSessionId_fkey"
            columns: ["designSessionId"]
            isOneToOne: false
            referencedRelation: "design_session_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "EntityLink_designSessionId_fkey"
            columns: ["designSessionId"]
            isOneToOne: false
            referencedRelation: "DesignSession"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "EntityLink_linkedById_fkey"
            columns: ["linkedById"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "EntityLink_linkedById_fkey"
            columns: ["linkedById"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "EntityLink_linkedById_fkey"
            columns: ["linkedById"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "EntityLink_linkedById_fkey"
            columns: ["linkedById"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "EntityLink_meetingId_fkey"
            columns: ["meetingId"]
            isOneToOne: false
            referencedRelation: "Meeting"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "EntityLink_planningCeremonyId_fkey"
            columns: ["planningCeremonyId"]
            isOneToOne: false
            referencedRelation: "PlanningCeremony"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "EntityLink_planningSessionId_fkey"
            columns: ["planningSessionId"]
            isOneToOne: false
            referencedRelation: "PlanningSession"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "EntityLink_pmReviewId_fkey"
            columns: ["pmReviewId"]
            isOneToOne: false
            referencedRelation: "PMReview"
            referencedColumns: ["id"]
          },
        ]
      }
      ForgeAgent: {
        Row: {
          costUsd: number
          endedAt: string | null
          id: string
          meta: Json
          name: string
          parentId: string | null
          progress: number
          role: string
          runId: string
          startedAt: string | null
          status: string
          tokensIn: number
          tokensOut: number
        }
        Insert: {
          costUsd?: number
          endedAt?: string | null
          id?: string
          meta?: Json
          name: string
          parentId?: string | null
          progress?: number
          role: string
          runId: string
          startedAt?: string | null
          status: string
          tokensIn?: number
          tokensOut?: number
        }
        Update: {
          costUsd?: number
          endedAt?: string | null
          id?: string
          meta?: Json
          name?: string
          parentId?: string | null
          progress?: number
          role?: string
          runId?: string
          startedAt?: string | null
          status?: string
          tokensIn?: number
          tokensOut?: number
        }
        Relationships: [
          {
            foreignKeyName: "ForgeAgent_parentId_fkey"
            columns: ["parentId"]
            isOneToOne: false
            referencedRelation: "ForgeAgent"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeAgent_runId_fkey"
            columns: ["runId"]
            isOneToOne: false
            referencedRelation: "ForgeRun"
            referencedColumns: ["id"]
          },
        ]
      }
      ForgeDaemon: {
        Row: {
          daemonId: string
          hostname: string | null
          lastHeartbeatAt: string
          memberId: string | null
          startedAt: string
        }
        Insert: {
          daemonId: string
          hostname?: string | null
          lastHeartbeatAt?: string
          memberId?: string | null
          startedAt?: string
        }
        Update: {
          daemonId?: string
          hostname?: string | null
          lastHeartbeatAt?: string
          memberId?: string | null
          startedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "ForgeDaemon_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeDaemon_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeDaemon_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeDaemon_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      ForgeEvent: {
        Row: {
          agentId: string | null
          kind: string
          payload: Json
          runId: string
          seq: number
          taskId: string | null
          ts: string
        }
        Insert: {
          agentId?: string | null
          kind: string
          payload: Json
          runId: string
          seq: number
          taskId?: string | null
          ts?: string
        }
        Update: {
          agentId?: string | null
          kind?: string
          payload?: Json
          runId?: string
          seq?: number
          taskId?: string | null
          ts?: string
        }
        Relationships: [
          {
            foreignKeyName: "ForgeEvent_agentId_fkey"
            columns: ["agentId"]
            isOneToOne: false
            referencedRelation: "ForgeAgent"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeEvent_runId_fkey"
            columns: ["runId"]
            isOneToOne: false
            referencedRelation: "ForgeRun"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeEvent_taskId_fkey"
            columns: ["taskId"]
            isOneToOne: false
            referencedRelation: "ForgeTask"
            referencedColumns: ["id"]
          },
        ]
      }
      ForgeJob: {
        Row: {
          assignToAnyone: boolean
          claimedAt: string | null
          claimedBy: string | null
          createdAt: string
          heartbeatAt: string | null
          id: string
          kind: string
          maxStories: number | null
          meta: Json
          ownerId: string
          prdSlug: string
          projectId: string | null
          runId: string | null
          status: string
          updatedAt: string
        }
        Insert: {
          assignToAnyone?: boolean
          claimedAt?: string | null
          claimedBy?: string | null
          createdAt?: string
          heartbeatAt?: string | null
          id?: string
          kind?: string
          maxStories?: number | null
          meta?: Json
          ownerId: string
          prdSlug: string
          projectId?: string | null
          runId?: string | null
          status?: string
          updatedAt?: string
        }
        Update: {
          assignToAnyone?: boolean
          claimedAt?: string | null
          claimedBy?: string | null
          createdAt?: string
          heartbeatAt?: string | null
          id?: string
          kind?: string
          maxStories?: number | null
          meta?: Json
          ownerId?: string
          prdSlug?: string
          projectId?: string | null
          runId?: string | null
          status?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "ForgeJob_ownerId_fkey"
            columns: ["ownerId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeJob_ownerId_fkey"
            columns: ["ownerId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeJob_ownerId_fkey"
            columns: ["ownerId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeJob_ownerId_fkey"
            columns: ["ownerId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeJob_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeJob_runId_fkey"
            columns: ["runId"]
            isOneToOne: false
            referencedRelation: "ForgeRun"
            referencedColumns: ["id"]
          },
        ]
      }
      ForgeLearning: {
        Row: {
          addedAt: string
          id: string
          lesson: string
          ownerId: string
          profileScope: string | null
          projectId: string | null
          severity: string
          slug: string
        }
        Insert: {
          addedAt?: string
          id?: string
          lesson: string
          ownerId: string
          profileScope?: string | null
          projectId?: string | null
          severity?: string
          slug: string
        }
        Update: {
          addedAt?: string
          id?: string
          lesson?: string
          ownerId?: string
          profileScope?: string | null
          projectId?: string | null
          severity?: string
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "ForgeLearning_ownerId_fkey"
            columns: ["ownerId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeLearning_ownerId_fkey"
            columns: ["ownerId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeLearning_ownerId_fkey"
            columns: ["ownerId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeLearning_ownerId_fkey"
            columns: ["ownerId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeLearning_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
        ]
      }
      ForgeRun: {
        Row: {
          branchName: string | null
          costUsdTotal: number
          createdAt: string
          designSessionId: string | null
          endedAt: string | null
          id: string
          manifest: Json
          meta: Json
          ownerId: string
          progress: number
          projectId: string
          repoUrl: string | null
          specId: string | null
          startedAt: string | null
          status: string
          title: string
          tokensInTotal: number
          tokensOutTotal: number
          trigger: string
          triggerRef: string | null
        }
        Insert: {
          branchName?: string | null
          costUsdTotal?: number
          createdAt?: string
          designSessionId?: string | null
          endedAt?: string | null
          id?: string
          manifest?: Json
          meta?: Json
          ownerId: string
          progress?: number
          projectId: string
          repoUrl?: string | null
          specId?: string | null
          startedAt?: string | null
          status: string
          title: string
          tokensInTotal?: number
          tokensOutTotal?: number
          trigger: string
          triggerRef?: string | null
        }
        Update: {
          branchName?: string | null
          costUsdTotal?: number
          createdAt?: string
          designSessionId?: string | null
          endedAt?: string | null
          id?: string
          manifest?: Json
          meta?: Json
          ownerId?: string
          progress?: number
          projectId?: string
          repoUrl?: string | null
          specId?: string | null
          startedAt?: string | null
          status?: string
          title?: string
          tokensInTotal?: number
          tokensOutTotal?: number
          trigger?: string
          triggerRef?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ForgeRun_designSessionId_fkey"
            columns: ["designSessionId"]
            isOneToOne: false
            referencedRelation: "design_session_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeRun_designSessionId_fkey"
            columns: ["designSessionId"]
            isOneToOne: false
            referencedRelation: "DesignSession"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeRun_ownerId_fkey"
            columns: ["ownerId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeRun_ownerId_fkey"
            columns: ["ownerId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeRun_ownerId_fkey"
            columns: ["ownerId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeRun_ownerId_fkey"
            columns: ["ownerId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeRun_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeRun_specId_fkey"
            columns: ["specId"]
            isOneToOne: false
            referencedRelation: "ForgeSpec"
            referencedColumns: ["id"]
          },
        ]
      }
      ForgeSpec: {
        Row: {
          approvedAt: string | null
          approvedBy: string | null
          createdAt: string
          id: string
          nonGoals: Json
          ownerId: string
          problem: string
          slug: string
          solution: string
          status: string
          successCriteria: Json
          title: string
          updatedAt: string
          upstream: Json | null
          userStories: Json
        }
        Insert: {
          approvedAt?: string | null
          approvedBy?: string | null
          createdAt?: string
          id?: string
          nonGoals?: Json
          ownerId: string
          problem: string
          slug: string
          solution: string
          status?: string
          successCriteria?: Json
          title: string
          updatedAt?: string
          upstream?: Json | null
          userStories?: Json
        }
        Update: {
          approvedAt?: string | null
          approvedBy?: string | null
          createdAt?: string
          id?: string
          nonGoals?: Json
          ownerId?: string
          problem?: string
          slug?: string
          solution?: string
          status?: string
          successCriteria?: Json
          title?: string
          updatedAt?: string
          upstream?: Json | null
          userStories?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ForgeSpec_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeSpec_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeSpec_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeSpec_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeSpec_ownerId_fkey"
            columns: ["ownerId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeSpec_ownerId_fkey"
            columns: ["ownerId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeSpec_ownerId_fkey"
            columns: ["ownerId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeSpec_ownerId_fkey"
            columns: ["ownerId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      ForgeTask: {
        Row: {
          agentId: string | null
          agentProfile: string | null
          assigneeId: string | null
          costUsd: number
          currentTool: string | null
          dependsOn: Json
          dueDate: string | null
          endedAt: string | null
          id: string
          meta: Json
          ord: number
          passes: boolean | null
          progress: number
          projectId: string
          runId: string | null
          specId: string | null
          startedAt: string | null
          status: string
          title: string
          tokensIn: number
          tokensOut: number
          type: string
          userStoryId: string | null
          verifiable: Json
          worktreePath: string | null
        }
        Insert: {
          agentId?: string | null
          agentProfile?: string | null
          assigneeId?: string | null
          costUsd?: number
          currentTool?: string | null
          dependsOn?: Json
          dueDate?: string | null
          endedAt?: string | null
          id?: string
          meta?: Json
          ord: number
          passes?: boolean | null
          progress?: number
          projectId: string
          runId?: string | null
          specId?: string | null
          startedAt?: string | null
          status: string
          title: string
          tokensIn?: number
          tokensOut?: number
          type?: string
          userStoryId?: string | null
          verifiable?: Json
          worktreePath?: string | null
        }
        Update: {
          agentId?: string | null
          agentProfile?: string | null
          assigneeId?: string | null
          costUsd?: number
          currentTool?: string | null
          dependsOn?: Json
          dueDate?: string | null
          endedAt?: string | null
          id?: string
          meta?: Json
          ord?: number
          passes?: boolean | null
          progress?: number
          projectId?: string
          runId?: string | null
          specId?: string | null
          startedAt?: string | null
          status?: string
          title?: string
          tokensIn?: number
          tokensOut?: number
          type?: string
          userStoryId?: string | null
          verifiable?: Json
          worktreePath?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ForgeTask_agentId_fkey"
            columns: ["agentId"]
            isOneToOne: false
            referencedRelation: "ForgeAgent"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeTask_assigneeId_fkey"
            columns: ["assigneeId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeTask_assigneeId_fkey"
            columns: ["assigneeId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeTask_assigneeId_fkey"
            columns: ["assigneeId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeTask_assigneeId_fkey"
            columns: ["assigneeId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeTask_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeTask_runId_fkey"
            columns: ["runId"]
            isOneToOne: false
            referencedRelation: "ForgeRun"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeTask_specId_fkey"
            columns: ["specId"]
            isOneToOne: false
            referencedRelation: "ForgeSpec"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ForgeTask_userStoryId_fkey"
            columns: ["userStoryId"]
            isOneToOne: false
            referencedRelation: "user_story_overview"
            referencedColumns: ["userStoryId"]
          },
          {
            foreignKeyName: "ForgeTask_userStoryId_fkey"
            columns: ["userStoryId"]
            isOneToOne: false
            referencedRelation: "UserStory"
            referencedColumns: ["id"]
          },
        ]
      }
      GranolaImportJob: {
        Row: {
          createdAt: string
          cursorFrom: string | null
          cursorTo: string | null
          error: string | null
          finishedAt: string | null
          id: string
          meetingsCreated: number
          meetingsSkipped: number
          memberId: string
          notesScanned: number
          source: string
          startedAt: string | null
          status: string
        }
        Insert: {
          createdAt?: string
          cursorFrom?: string | null
          cursorTo?: string | null
          error?: string | null
          finishedAt?: string | null
          id?: string
          meetingsCreated?: number
          meetingsSkipped?: number
          memberId: string
          notesScanned?: number
          source: string
          startedAt?: string | null
          status?: string
        }
        Update: {
          createdAt?: string
          cursorFrom?: string | null
          cursorTo?: string | null
          error?: string | null
          finishedAt?: string | null
          id?: string
          meetingsCreated?: number
          meetingsSkipped?: number
          memberId?: string
          notesScanned?: number
          source?: string
          startedAt?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "GranolaImportJob_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "GranolaImportJob_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "GranolaImportJob_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "GranolaImportJob_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      InsightJob: {
        Row: {
          clientId: string | null
          createdAt: string
          error: string | null
          finishedAt: string | null
          id: string
          kind: string
          projectId: string | null
          source: string
          startedAt: string | null
          status: string
          triggeredByMemberId: string | null
        }
        Insert: {
          clientId?: string | null
          createdAt?: string
          error?: string | null
          finishedAt?: string | null
          id?: string
          kind?: string
          projectId?: string | null
          source: string
          startedAt?: string | null
          status?: string
          triggeredByMemberId?: string | null
        }
        Update: {
          clientId?: string | null
          createdAt?: string
          error?: string | null
          finishedAt?: string | null
          id?: string
          kind?: string
          projectId?: string | null
          source?: string
          startedAt?: string | null
          status?: string
          triggeredByMemberId?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "InsightJob_clientId_fkey"
            columns: ["clientId"]
            isOneToOne: false
            referencedRelation: "Client"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "InsightJob_clientId_fkey"
            columns: ["clientId"]
            isOneToOne: false
            referencedRelation: "client_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "InsightJob_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "InsightJob_triggeredByMemberId_fkey"
            columns: ["triggeredByMemberId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "InsightJob_triggeredByMemberId_fkey"
            columns: ["triggeredByMemberId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "InsightJob_triggeredByMemberId_fkey"
            columns: ["triggeredByMemberId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "InsightJob_triggeredByMemberId_fkey"
            columns: ["triggeredByMemberId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      Meeting: {
        Row: {
          createdAt: string
          createdById: string | null
          date: string
          id: string
          kind: string
          notes: string | null
          sprintId: string | null
          title: string | null
          type: string
          updatedAt: string
          visibility: string
        }
        Insert: {
          createdAt?: string
          createdById?: string | null
          date: string
          id?: string
          kind?: string
          notes?: string | null
          sprintId?: string | null
          title?: string | null
          type?: string
          updatedAt: string
          visibility?: string
        }
        Update: {
          createdAt?: string
          createdById?: string | null
          date?: string
          id?: string
          kind?: string
          notes?: string | null
          sprintId?: string | null
          title?: string | null
          type?: string
          updatedAt?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "Meeting_createdById_fkey"
            columns: ["createdById"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Meeting_createdById_fkey"
            columns: ["createdById"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Meeting_createdById_fkey"
            columns: ["createdById"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Meeting_createdById_fkey"
            columns: ["createdById"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Meeting_sprintId_fkey"
            columns: ["sprintId"]
            isOneToOne: false
            referencedRelation: "Sprint"
            referencedColumns: ["id"]
          },
        ]
      }
      MeetingAttendee: {
        Row: {
          createdAt: string
          externalEmail: string | null
          externalName: string | null
          externalRole: string | null
          id: string
          meetingId: string
          memberId: string | null
          role: string | null
        }
        Insert: {
          createdAt?: string
          externalEmail?: string | null
          externalName?: string | null
          externalRole?: string | null
          id?: string
          meetingId: string
          memberId?: string | null
          role?: string | null
        }
        Update: {
          createdAt?: string
          externalEmail?: string | null
          externalName?: string | null
          externalRole?: string | null
          id?: string
          meetingId?: string
          memberId?: string | null
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "MeetingAttendee_meetingId_fkey"
            columns: ["meetingId"]
            isOneToOne: false
            referencedRelation: "Meeting"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MeetingAttendee_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MeetingAttendee_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MeetingAttendee_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MeetingAttendee_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      MeetingPersonalNote: {
        Row: {
          content: string
          meetingId: string
          memberId: string
          updatedAt: string
        }
        Insert: {
          content?: string
          meetingId: string
          memberId: string
          updatedAt?: string
        }
        Update: {
          content?: string
          meetingId?: string
          memberId?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "MeetingPersonalNote_meetingId_fkey"
            columns: ["meetingId"]
            isOneToOne: false
            referencedRelation: "Meeting"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MeetingPersonalNote_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MeetingPersonalNote_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MeetingPersonalNote_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MeetingPersonalNote_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      MeetingProjectLink: {
        Row: {
          createdAt: string
          meetingId: string
          projectId: string
        }
        Insert: {
          createdAt?: string
          meetingId: string
          projectId: string
        }
        Update: {
          createdAt?: string
          meetingId?: string
          projectId?: string
        }
        Relationships: [
          {
            foreignKeyName: "MeetingProjectLink_meetingId_fkey"
            columns: ["meetingId"]
            isOneToOne: false
            referencedRelation: "Meeting"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MeetingProjectLink_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
        ]
      }
      MeetingProjectReview: {
        Row: {
          additionalNotes: string | null
          attentionPoints: string | null
          createdAt: string
          id: string
          meetingId: string
          memberId: string
          nextSteps: string | null
          order: number
          projectId: string
          sprintHealth: string
          updatedAt: string
        }
        Insert: {
          additionalNotes?: string | null
          attentionPoints?: string | null
          createdAt?: string
          id?: string
          meetingId: string
          memberId: string
          nextSteps?: string | null
          order?: number
          projectId: string
          sprintHealth?: string
          updatedAt: string
        }
        Update: {
          additionalNotes?: string | null
          attentionPoints?: string | null
          createdAt?: string
          id?: string
          meetingId?: string
          memberId?: string
          nextSteps?: string | null
          order?: number
          projectId?: string
          sprintHealth?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "MeetingProjectReview_meetingId_fkey"
            columns: ["meetingId"]
            isOneToOne: false
            referencedRelation: "Meeting"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MeetingProjectReview_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MeetingProjectReview_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MeetingProjectReview_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MeetingProjectReview_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MeetingProjectReview_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
        ]
      }
      MeetingTaskAction: {
        Row: {
          aiConfidence: number | null
          aiReasoning: string | null
          appliedAt: string | null
          createdAt: string
          decidedAt: string | null
          decidedById: string | null
          decision: string
          errorMessage: string | null
          execution: string
          id: string
          meetingId: string | null
          notes: string | null
          payload: Json
          planningCeremonyId: string | null
          projectId: string
          reviewNote: string | null
          reviewReasons: string[] | null
          source: string
          sourceNoteIds: string[]
          targetSprintId: string | null
          taskId: string | null
          type: string
          updatedAt: string
          wasEdited: boolean
        }
        Insert: {
          aiConfidence?: number | null
          aiReasoning?: string | null
          appliedAt?: string | null
          createdAt?: string
          decidedAt?: string | null
          decidedById?: string | null
          decision?: string
          errorMessage?: string | null
          execution?: string
          id?: string
          meetingId?: string | null
          notes?: string | null
          payload?: Json
          planningCeremonyId?: string | null
          projectId: string
          reviewNote?: string | null
          reviewReasons?: string[] | null
          source: string
          sourceNoteIds?: string[]
          targetSprintId?: string | null
          taskId?: string | null
          type: string
          updatedAt?: string
          wasEdited?: boolean
        }
        Update: {
          aiConfidence?: number | null
          aiReasoning?: string | null
          appliedAt?: string | null
          createdAt?: string
          decidedAt?: string | null
          decidedById?: string | null
          decision?: string
          errorMessage?: string | null
          execution?: string
          id?: string
          meetingId?: string | null
          notes?: string | null
          payload?: Json
          planningCeremonyId?: string | null
          projectId?: string
          reviewNote?: string | null
          reviewReasons?: string[] | null
          source?: string
          sourceNoteIds?: string[]
          targetSprintId?: string | null
          taskId?: string | null
          type?: string
          updatedAt?: string
          wasEdited?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "MeetingTaskAction_decidedById_fkey"
            columns: ["decidedById"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MeetingTaskAction_decidedById_fkey"
            columns: ["decidedById"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MeetingTaskAction_decidedById_fkey"
            columns: ["decidedById"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MeetingTaskAction_decidedById_fkey"
            columns: ["decidedById"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MeetingTaskAction_meetingId_fkey"
            columns: ["meetingId"]
            isOneToOne: false
            referencedRelation: "Meeting"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MeetingTaskAction_planningCeremonyId_fkey"
            columns: ["planningCeremonyId"]
            isOneToOne: false
            referencedRelation: "PlanningCeremony"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MeetingTaskAction_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MeetingTaskAction_targetSprintId_fkey"
            columns: ["targetSprintId"]
            isOneToOne: false
            referencedRelation: "Sprint"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MeetingTaskAction_taskId_fkey"
            columns: ["taskId"]
            isOneToOne: false
            referencedRelation: "Task"
            referencedColumns: ["id"]
          },
        ]
      }
      Member: {
        Row: {
          createdAt: string
          dailyTodosEveningEnabled: boolean
          dailyTodosEveningTime: string
          dailyTodosLastSent: Json
          dailyTodosMorningEnabled: boolean
          dailyTodosMorningTime: string
          dedicationPercent: number
          email: string | null
          fpCapacity: number
          githubUsername: string | null
          id: string
          isExternal: boolean
          isGuest: boolean
          name: string
          onboardedAt: string | null
          position: string | null
          role: string
          seniority: string | null
          specialty: string | null
          telegramBindExpiresAt: string | null
          telegramBindToken: string | null
          telegramChatId: number | null
          telegramConnectedAt: string | null
          telegramKindsDisabled: string[]
          telegramUsername: string | null
          theme: string
          updatedAt: string
          userId: string | null
        }
        Insert: {
          createdAt?: string
          dailyTodosEveningEnabled?: boolean
          dailyTodosEveningTime?: string
          dailyTodosLastSent?: Json
          dailyTodosMorningEnabled?: boolean
          dailyTodosMorningTime?: string
          dedicationPercent?: number
          email?: string | null
          fpCapacity?: number
          githubUsername?: string | null
          id?: string
          isExternal?: boolean
          isGuest?: boolean
          name: string
          onboardedAt?: string | null
          position?: string | null
          role?: string
          seniority?: string | null
          specialty?: string | null
          telegramBindExpiresAt?: string | null
          telegramBindToken?: string | null
          telegramChatId?: number | null
          telegramConnectedAt?: string | null
          telegramKindsDisabled?: string[]
          telegramUsername?: string | null
          theme?: string
          updatedAt: string
          userId?: string | null
        }
        Update: {
          createdAt?: string
          dailyTodosEveningEnabled?: boolean
          dailyTodosEveningTime?: string
          dailyTodosLastSent?: Json
          dailyTodosMorningEnabled?: boolean
          dailyTodosMorningTime?: string
          dedicationPercent?: number
          email?: string | null
          fpCapacity?: number
          githubUsername?: string | null
          id?: string
          isExternal?: boolean
          isGuest?: boolean
          name?: string
          onboardedAt?: string | null
          position?: string | null
          role?: string
          seniority?: string | null
          specialty?: string | null
          telegramBindExpiresAt?: string | null
          telegramBindToken?: string | null
          telegramChatId?: number | null
          telegramConnectedAt?: string | null
          telegramKindsDisabled?: string[]
          telegramUsername?: string | null
          theme?: string
          updatedAt?: string
          userId?: string | null
        }
        Relationships: []
      }
      MemberAssessment: {
        Row: {
          completedAt: string | null
          goals: string | null
          lastStepIndex: number
          memberId: string
          startedAt: string
          status: string
          updatedAt: string
        }
        Insert: {
          completedAt?: string | null
          goals?: string | null
          lastStepIndex?: number
          memberId: string
          startedAt?: string
          status?: string
          updatedAt?: string
        }
        Update: {
          completedAt?: string | null
          goals?: string | null
          lastStepIndex?: number
          memberId?: string
          startedAt?: string
          status?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "MemberAssessment_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: true
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MemberAssessment_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: true
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MemberAssessment_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: true
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MemberAssessment_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: true
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      MemberIntegration: {
        Row: {
          autoImportCursor: string | null
          autoImportEnabled: boolean
          autoImportLastRunAt: string | null
          createdAt: string
          memberId: string
          provider: string
          secretId: string
          tokenHint: string | null
          updatedAt: string
        }
        Insert: {
          autoImportCursor?: string | null
          autoImportEnabled?: boolean
          autoImportLastRunAt?: string | null
          createdAt?: string
          memberId: string
          provider: string
          secretId: string
          tokenHint?: string | null
          updatedAt?: string
        }
        Update: {
          autoImportCursor?: string | null
          autoImportEnabled?: boolean
          autoImportLastRunAt?: string | null
          createdAt?: string
          memberId?: string
          provider?: string
          secretId?: string
          tokenHint?: string | null
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "MemberIntegration_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MemberIntegration_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MemberIntegration_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MemberIntegration_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      MemberPDI: {
        Row: {
          createdAt: string
          cycleEndDate: string
          cycleStartDate: string
          id: string
          memberId: string
          status: string
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          cycleEndDate: string
          cycleStartDate: string
          id?: string
          memberId: string
          status?: string
          updatedAt?: string
        }
        Update: {
          createdAt?: string
          cycleEndDate?: string
          cycleStartDate?: string
          id?: string
          memberId?: string
          status?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "MemberPDI_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MemberPDI_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MemberPDI_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MemberPDI_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      MemberSkill: {
        Row: {
          cases: string | null
          createdAt: string
          id: string
          memberId: string
          score: number | null
          subskills: Json
          towerKey: string
          updatedAt: string
        }
        Insert: {
          cases?: string | null
          createdAt?: string
          id?: string
          memberId: string
          score?: number | null
          subskills?: Json
          towerKey: string
          updatedAt?: string
        }
        Update: {
          cases?: string | null
          createdAt?: string
          id?: string
          memberId?: string
          score?: number | null
          subskills?: Json
          towerKey?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "MemberSkill_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MemberSkill_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MemberSkill_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MemberSkill_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      Module: {
        Row: {
          approvedAt: string | null
          approvedBy: string | null
          createdAt: string
          description: string | null
          id: string
          name: string
          projectId: string
          updatedAt: string
        }
        Insert: {
          approvedAt?: string | null
          approvedBy?: string | null
          createdAt?: string
          description?: string | null
          id?: string
          name: string
          projectId: string
          updatedAt?: string
        }
        Update: {
          approvedAt?: string | null
          approvedBy?: string | null
          createdAt?: string
          description?: string | null
          id?: string
          name?: string
          projectId?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "Module_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Module_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Module_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Module_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Module_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
        ]
      }
      ModuleActivity: {
        Row: {
          actorMemberId: string | null
          createdAt: string
          id: string
          moduleId: string
          payload: Json
          type: string
        }
        Insert: {
          actorMemberId?: string | null
          createdAt?: string
          id?: string
          moduleId: string
          payload?: Json
          type: string
        }
        Update: {
          actorMemberId?: string | null
          createdAt?: string
          id?: string
          moduleId?: string
          payload?: Json
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ModuleActivity_actorMemberId_fkey"
            columns: ["actorMemberId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ModuleActivity_actorMemberId_fkey"
            columns: ["actorMemberId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ModuleActivity_actorMemberId_fkey"
            columns: ["actorMemberId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ModuleActivity_actorMemberId_fkey"
            columns: ["actorMemberId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ModuleActivity_moduleId_fkey"
            columns: ["moduleId"]
            isOneToOne: false
            referencedRelation: "Module"
            referencedColumns: ["id"]
          },
        ]
      }
      Notification: {
        Row: {
          actorMemberId: string | null
          batchId: string | null
          createdAt: string
          entityId: string
          entityType: string
          id: string
          kind: string
          payload: Json
          readAt: string | null
          recipientMemberId: string
        }
        Insert: {
          actorMemberId?: string | null
          batchId?: string | null
          createdAt?: string
          entityId: string
          entityType: string
          id?: string
          kind: string
          payload?: Json
          readAt?: string | null
          recipientMemberId: string
        }
        Update: {
          actorMemberId?: string | null
          batchId?: string | null
          createdAt?: string
          entityId?: string
          entityType?: string
          id?: string
          kind?: string
          payload?: Json
          readAt?: string | null
          recipientMemberId?: string
        }
        Relationships: [
          {
            foreignKeyName: "Notification_actorMemberId_fkey"
            columns: ["actorMemberId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Notification_actorMemberId_fkey"
            columns: ["actorMemberId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Notification_actorMemberId_fkey"
            columns: ["actorMemberId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Notification_actorMemberId_fkey"
            columns: ["actorMemberId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Notification_recipientMemberId_fkey"
            columns: ["recipientMemberId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Notification_recipientMemberId_fkey"
            columns: ["recipientMemberId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Notification_recipientMemberId_fkey"
            columns: ["recipientMemberId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Notification_recipientMemberId_fkey"
            columns: ["recipientMemberId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      Opportunity: {
        Row: {
          clientId: string
          createdAt: string
          createdBy: string
          description: string | null
          effort: number
          id: string
          impact: number
          priorityRank: number | null
          promotedProjectId: string | null
          sourceDesignSessionId: string | null
          sourceMeetingId: string | null
          sourceTranscriptRefId: string | null
          status: Database["public"]["Enums"]["OpportunityStatus"]
          title: string
          updatedAt: string
        }
        Insert: {
          clientId: string
          createdAt?: string
          createdBy: string
          description?: string | null
          effort: number
          id?: string
          impact: number
          priorityRank?: number | null
          promotedProjectId?: string | null
          sourceDesignSessionId?: string | null
          sourceMeetingId?: string | null
          sourceTranscriptRefId?: string | null
          status?: Database["public"]["Enums"]["OpportunityStatus"]
          title: string
          updatedAt?: string
        }
        Update: {
          clientId?: string
          createdAt?: string
          createdBy?: string
          description?: string | null
          effort?: number
          id?: string
          impact?: number
          priorityRank?: number | null
          promotedProjectId?: string | null
          sourceDesignSessionId?: string | null
          sourceMeetingId?: string | null
          sourceTranscriptRefId?: string | null
          status?: Database["public"]["Enums"]["OpportunityStatus"]
          title?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "Opportunity_clientId_fkey"
            columns: ["clientId"]
            isOneToOne: false
            referencedRelation: "Client"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Opportunity_clientId_fkey"
            columns: ["clientId"]
            isOneToOne: false
            referencedRelation: "client_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Opportunity_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Opportunity_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Opportunity_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Opportunity_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Opportunity_promotedProjectId_fkey"
            columns: ["promotedProjectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Opportunity_sourceDesignSessionId_fkey"
            columns: ["sourceDesignSessionId"]
            isOneToOne: false
            referencedRelation: "design_session_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Opportunity_sourceDesignSessionId_fkey"
            columns: ["sourceDesignSessionId"]
            isOneToOne: false
            referencedRelation: "DesignSession"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Opportunity_sourceMeetingId_fkey"
            columns: ["sourceMeetingId"]
            isOneToOne: false
            referencedRelation: "Meeting"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Opportunity_sourceTranscriptRefId_fkey"
            columns: ["sourceTranscriptRefId"]
            isOneToOne: false
            referencedRelation: "ContextSource"
            referencedColumns: ["id"]
          },
        ]
      }
      PDIAction: {
        Row: {
          completedAt: string | null
          createdAt: string
          criterion: string
          dueAt: string | null
          how: string | null
          id: string
          orderIdx: number
          pdiId: string
          status: string
          title: string
          towerKey: string | null
          updatedAt: string
          why: string | null
        }
        Insert: {
          completedAt?: string | null
          createdAt?: string
          criterion: string
          dueAt?: string | null
          how?: string | null
          id?: string
          orderIdx?: number
          pdiId: string
          status?: string
          title: string
          towerKey?: string | null
          updatedAt?: string
          why?: string | null
        }
        Update: {
          completedAt?: string | null
          createdAt?: string
          criterion?: string
          dueAt?: string | null
          how?: string | null
          id?: string
          orderIdx?: number
          pdiId?: string
          status?: string
          title?: string
          towerKey?: string | null
          updatedAt?: string
          why?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "PDIAction_pdiId_fkey"
            columns: ["pdiId"]
            isOneToOne: false
            referencedRelation: "MemberPDI"
            referencedColumns: ["id"]
          },
        ]
      }
      PlanningCeremony: {
        Row: {
          archivedAt: string | null
          briefingGeneratedAt: string | null
          closedAt: string | null
          createdAt: string
          facilitatorId: string | null
          id: string
          phase: string
          projectId: string
          scheduledFor: string | null
          sprintId: string | null
          startedAt: string | null
          updatedAt: string
        }
        Insert: {
          archivedAt?: string | null
          briefingGeneratedAt?: string | null
          closedAt?: string | null
          createdAt?: string
          facilitatorId?: string | null
          id?: string
          phase?: string
          projectId: string
          scheduledFor?: string | null
          sprintId?: string | null
          startedAt?: string | null
          updatedAt?: string
        }
        Update: {
          archivedAt?: string | null
          briefingGeneratedAt?: string | null
          closedAt?: string | null
          createdAt?: string
          facilitatorId?: string | null
          id?: string
          phase?: string
          projectId?: string
          scheduledFor?: string | null
          sprintId?: string | null
          startedAt?: string | null
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "PlanningCeremony_facilitatorId_fkey"
            columns: ["facilitatorId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PlanningCeremony_facilitatorId_fkey"
            columns: ["facilitatorId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PlanningCeremony_facilitatorId_fkey"
            columns: ["facilitatorId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PlanningCeremony_facilitatorId_fkey"
            columns: ["facilitatorId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PlanningCeremony_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PlanningCeremony_sprintId_fkey"
            columns: ["sprintId"]
            isOneToOne: false
            referencedRelation: "Sprint"
            referencedColumns: ["id"]
          },
        ]
      }
      PlanningContextNote: {
        Row: {
          content: string
          dismissedAt: string | null
          generatedAt: string
          generatedByAgent: string | null
          generatedByMemberId: string | null
          id: string
          kind: string
          planningCeremonyId: string
          priority: number
          sourceMeetingIds: string[]
          sourceRepoPath: string | null
          sourceTranscriptIds: string[]
        }
        Insert: {
          content: string
          dismissedAt?: string | null
          generatedAt?: string
          generatedByAgent?: string | null
          generatedByMemberId?: string | null
          id?: string
          kind: string
          planningCeremonyId: string
          priority?: number
          sourceMeetingIds?: string[]
          sourceRepoPath?: string | null
          sourceTranscriptIds?: string[]
        }
        Update: {
          content?: string
          dismissedAt?: string | null
          generatedAt?: string
          generatedByAgent?: string | null
          generatedByMemberId?: string | null
          id?: string
          kind?: string
          planningCeremonyId?: string
          priority?: number
          sourceMeetingIds?: string[]
          sourceRepoPath?: string | null
          sourceTranscriptIds?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "PlanningContextNote_generatedByMemberId_fkey"
            columns: ["generatedByMemberId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PlanningContextNote_generatedByMemberId_fkey"
            columns: ["generatedByMemberId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PlanningContextNote_generatedByMemberId_fkey"
            columns: ["generatedByMemberId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PlanningContextNote_generatedByMemberId_fkey"
            columns: ["generatedByMemberId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PlanningContextNote_planningCeremonyId_fkey"
            columns: ["planningCeremonyId"]
            isOneToOne: false
            referencedRelation: "PlanningCeremony"
            referencedColumns: ["id"]
          },
        ]
      }
      PlanningSession: {
        Row: {
          agentOutputsJsonb: Json | null
          approvedAt: string | null
          approvedBy: string | null
          codebaseIndexSha: string | null
          costUsd: number
          createdAt: string
          draftRoadmapJsonb: Json | null
          errorMessage: string | null
          facilitatorId: string | null
          id: string
          orchestrateJobId: string | null
          prdIndexSha: string | null
          projectId: string
          scheduledFor: string | null
          sprintCount: number
          status: string
          title: string
          tokensUsed: number
          updatedAt: string
        }
        Insert: {
          agentOutputsJsonb?: Json | null
          approvedAt?: string | null
          approvedBy?: string | null
          codebaseIndexSha?: string | null
          costUsd?: number
          createdAt?: string
          draftRoadmapJsonb?: Json | null
          errorMessage?: string | null
          facilitatorId?: string | null
          id?: string
          orchestrateJobId?: string | null
          prdIndexSha?: string | null
          projectId: string
          scheduledFor?: string | null
          sprintCount?: number
          status?: string
          title: string
          tokensUsed?: number
          updatedAt?: string
        }
        Update: {
          agentOutputsJsonb?: Json | null
          approvedAt?: string | null
          approvedBy?: string | null
          codebaseIndexSha?: string | null
          costUsd?: number
          createdAt?: string
          draftRoadmapJsonb?: Json | null
          errorMessage?: string | null
          facilitatorId?: string | null
          id?: string
          orchestrateJobId?: string | null
          prdIndexSha?: string | null
          projectId?: string
          scheduledFor?: string | null
          sprintCount?: number
          status?: string
          title?: string
          tokensUsed?: number
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "PlanningSession_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PlanningSession_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PlanningSession_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PlanningSession_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PlanningSession_facilitatorId_fkey"
            columns: ["facilitatorId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PlanningSession_facilitatorId_fkey"
            columns: ["facilitatorId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PlanningSession_facilitatorId_fkey"
            columns: ["facilitatorId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PlanningSession_facilitatorId_fkey"
            columns: ["facilitatorId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PlanningSession_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
        ]
      }
      PlanningSessionPRD: {
        Row: {
          agentJustification: string | null
          assignedSquadId: string | null
          createdAt: string
          id: string
          order: number
          ownerOverride: string | null
          planningSessionId: string
          prdSlug: string | null
          productRequirementId: string | null
          sprintCount: number
          sprintStart: number
        }
        Insert: {
          agentJustification?: string | null
          assignedSquadId?: string | null
          createdAt?: string
          id?: string
          order: number
          ownerOverride?: string | null
          planningSessionId: string
          prdSlug?: string | null
          productRequirementId?: string | null
          sprintCount?: number
          sprintStart: number
        }
        Update: {
          agentJustification?: string | null
          assignedSquadId?: string | null
          createdAt?: string
          id?: string
          order?: number
          ownerOverride?: string | null
          planningSessionId?: string
          prdSlug?: string | null
          productRequirementId?: string | null
          sprintCount?: number
          sprintStart?: number
        }
        Relationships: [
          {
            foreignKeyName: "PlanningSessionPRD_assignedSquadId_fkey"
            columns: ["assignedSquadId"]
            isOneToOne: false
            referencedRelation: "Squad"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PlanningSessionPRD_planningSessionId_fkey"
            columns: ["planningSessionId"]
            isOneToOne: false
            referencedRelation: "PlanningSession"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PlanningSessionPRD_productRequirementId_fkey"
            columns: ["productRequirementId"]
            isOneToOne: false
            referencedRelation: "ProductRequirement"
            referencedColumns: ["id"]
          },
        ]
      }
      PMReview: {
        Row: {
          archivedAt: string | null
          createdAt: string
          facilitatorId: string | null
          id: string
          projectId: string
          publishedAt: string | null
          referenceWeek: string
          reportGeneratedAt: string | null
          reportMarkdown: string | null
          scheduledFor: string | null
          status: string
          updatedAt: string
        }
        Insert: {
          archivedAt?: string | null
          createdAt?: string
          facilitatorId?: string | null
          id?: string
          projectId: string
          publishedAt?: string | null
          referenceWeek: string
          reportGeneratedAt?: string | null
          reportMarkdown?: string | null
          scheduledFor?: string | null
          status?: string
          updatedAt?: string
        }
        Update: {
          archivedAt?: string | null
          createdAt?: string
          facilitatorId?: string | null
          id?: string
          projectId?: string
          publishedAt?: string | null
          referenceWeek?: string
          reportGeneratedAt?: string | null
          reportMarkdown?: string | null
          scheduledFor?: string | null
          status?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "PMReview_facilitatorId_fkey"
            columns: ["facilitatorId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PMReview_facilitatorId_fkey"
            columns: ["facilitatorId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PMReview_facilitatorId_fkey"
            columns: ["facilitatorId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PMReview_facilitatorId_fkey"
            columns: ["facilitatorId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PMReview_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
        ]
      }
      PMReviewNote: {
        Row: {
          audience: string
          content: string
          dismissedAt: string | null
          dueAt: string | null
          generatedAt: string
          generatedByAgent: string | null
          generatedByMemberId: string | null
          id: string
          kind: string
          pmReviewId: string
          priority: number
          sourceMeetingIds: string[]
          sourceTranscriptIds: string[]
          stance: string | null
        }
        Insert: {
          audience?: string
          content: string
          dismissedAt?: string | null
          dueAt?: string | null
          generatedAt?: string
          generatedByAgent?: string | null
          generatedByMemberId?: string | null
          id?: string
          kind: string
          pmReviewId: string
          priority?: number
          sourceMeetingIds?: string[]
          sourceTranscriptIds?: string[]
          stance?: string | null
        }
        Update: {
          audience?: string
          content?: string
          dismissedAt?: string | null
          dueAt?: string | null
          generatedAt?: string
          generatedByAgent?: string | null
          generatedByMemberId?: string | null
          id?: string
          kind?: string
          pmReviewId?: string
          priority?: number
          sourceMeetingIds?: string[]
          sourceTranscriptIds?: string[]
          stance?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "PMReviewNote_generatedByMemberId_fkey"
            columns: ["generatedByMemberId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PMReviewNote_generatedByMemberId_fkey"
            columns: ["generatedByMemberId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PMReviewNote_generatedByMemberId_fkey"
            columns: ["generatedByMemberId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PMReviewNote_generatedByMemberId_fkey"
            columns: ["generatedByMemberId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PMReviewNote_pmReviewId_fkey"
            columns: ["pmReviewId"]
            isOneToOne: false
            referencedRelation: "PMReview"
            referencedColumns: ["id"]
          },
        ]
      }
      PrdQuickAskJob: {
        Row: {
          brief: string
          createdAt: string
          error: string | null
          finishedAt: string | null
          id: string
          prdCount: number | null
          projectId: string
          sessionId: string
          startedAt: string | null
          status: string
          triggeredByMemberId: string | null
        }
        Insert: {
          brief: string
          createdAt?: string
          error?: string | null
          finishedAt?: string | null
          id?: string
          prdCount?: number | null
          projectId: string
          sessionId: string
          startedAt?: string | null
          status?: string
          triggeredByMemberId?: string | null
        }
        Update: {
          brief?: string
          createdAt?: string
          error?: string | null
          finishedAt?: string | null
          id?: string
          prdCount?: number | null
          projectId?: string
          sessionId?: string
          startedAt?: string | null
          status?: string
          triggeredByMemberId?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "PrdQuickAskJob_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PrdQuickAskJob_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "design_session_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PrdQuickAskJob_sessionId_fkey"
            columns: ["sessionId"]
            isOneToOne: false
            referencedRelation: "DesignSession"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PrdQuickAskJob_triggeredByMemberId_fkey"
            columns: ["triggeredByMemberId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PrdQuickAskJob_triggeredByMemberId_fkey"
            columns: ["triggeredByMemberId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PrdQuickAskJob_triggeredByMemberId_fkey"
            columns: ["triggeredByMemberId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "PrdQuickAskJob_triggeredByMemberId_fkey"
            columns: ["triggeredByMemberId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      ProductRequirement: {
        Row: {
          acceptanceCriteria: Json
          approvedAt: string | null
          approvedBy: string | null
          createdAt: string
          deliveryStatus: string
          dependencies: Json
          deployedToProductionAt: string | null
          deployedToStagingAt: string | null
          designSessionId: string | null
          dismissedAt: string | null
          estimateFp: number | null
          goal: string
          id: string
          lastRunFinishedAt: string | null
          lastRunId: string | null
          lastRunStatus: string | null
          markdown: string
          moduleId: string | null
          oneLiner: string
          originType: string | null
          outOfScope: string[]
          personaIds: string[]
          problem: string
          projectId: string
          reference: string
          risksAndAssumptions: Json
          sourceCardIds: string[]
          specMarkdown: string | null
          sprintId: string | null
          status: string
          stories: Json
          successMetrics: Json
          technicalNotes: string
          title: string
          updatedAt: string
          userJourney: Json
          userStoryId: string | null
          version: number
        }
        Insert: {
          acceptanceCriteria?: Json
          approvedAt?: string | null
          approvedBy?: string | null
          createdAt?: string
          deliveryStatus?: string
          dependencies?: Json
          deployedToProductionAt?: string | null
          deployedToStagingAt?: string | null
          designSessionId?: string | null
          dismissedAt?: string | null
          estimateFp?: number | null
          goal?: string
          id?: string
          lastRunFinishedAt?: string | null
          lastRunId?: string | null
          lastRunStatus?: string | null
          markdown?: string
          moduleId?: string | null
          oneLiner?: string
          originType?: string | null
          outOfScope?: string[]
          personaIds?: string[]
          problem?: string
          projectId: string
          reference: string
          risksAndAssumptions?: Json
          sourceCardIds?: string[]
          specMarkdown?: string | null
          sprintId?: string | null
          status?: string
          stories?: Json
          successMetrics?: Json
          technicalNotes?: string
          title: string
          updatedAt?: string
          userJourney?: Json
          userStoryId?: string | null
          version?: number
        }
        Update: {
          acceptanceCriteria?: Json
          approvedAt?: string | null
          approvedBy?: string | null
          createdAt?: string
          deliveryStatus?: string
          dependencies?: Json
          deployedToProductionAt?: string | null
          deployedToStagingAt?: string | null
          designSessionId?: string | null
          dismissedAt?: string | null
          estimateFp?: number | null
          goal?: string
          id?: string
          lastRunFinishedAt?: string | null
          lastRunId?: string | null
          lastRunStatus?: string | null
          markdown?: string
          moduleId?: string | null
          oneLiner?: string
          originType?: string | null
          outOfScope?: string[]
          personaIds?: string[]
          problem?: string
          projectId?: string
          reference?: string
          risksAndAssumptions?: Json
          sourceCardIds?: string[]
          specMarkdown?: string | null
          sprintId?: string | null
          status?: string
          stories?: Json
          successMetrics?: Json
          technicalNotes?: string
          title?: string
          updatedAt?: string
          userJourney?: Json
          userStoryId?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "ProductRequirement_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ProductRequirement_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ProductRequirement_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ProductRequirement_approvedBy_fkey"
            columns: ["approvedBy"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ProductRequirement_designSessionId_fkey"
            columns: ["designSessionId"]
            isOneToOne: false
            referencedRelation: "design_session_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ProductRequirement_designSessionId_fkey"
            columns: ["designSessionId"]
            isOneToOne: false
            referencedRelation: "DesignSession"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ProductRequirement_lastRunId_fkey"
            columns: ["lastRunId"]
            isOneToOne: false
            referencedRelation: "ForgeRun"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ProductRequirement_moduleId_fkey"
            columns: ["moduleId"]
            isOneToOne: false
            referencedRelation: "Module"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ProductRequirement_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ProductRequirement_sprintId_fkey"
            columns: ["sprintId"]
            isOneToOne: false
            referencedRelation: "Sprint"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ProductRequirement_userStoryId_fkey"
            columns: ["userStoryId"]
            isOneToOne: false
            referencedRelation: "user_story_overview"
            referencedColumns: ["userStoryId"]
          },
          {
            foreignKeyName: "ProductRequirement_userStoryId_fkey"
            columns: ["userStoryId"]
            isOneToOne: false
            referencedRelation: "UserStory"
            referencedColumns: ["id"]
          },
        ]
      }
      ProductRequirementActivity: {
        Row: {
          actorAgent: string | null
          actorMemberId: string | null
          createdAt: string
          diff: Json
          id: string
          kind: string
          productRequirementId: string
        }
        Insert: {
          actorAgent?: string | null
          actorMemberId?: string | null
          createdAt?: string
          diff?: Json
          id?: string
          kind: string
          productRequirementId: string
        }
        Update: {
          actorAgent?: string | null
          actorMemberId?: string | null
          createdAt?: string
          diff?: Json
          id?: string
          kind?: string
          productRequirementId?: string
        }
        Relationships: [
          {
            foreignKeyName: "ProductRequirementActivity_actorMemberId_fkey"
            columns: ["actorMemberId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ProductRequirementActivity_actorMemberId_fkey"
            columns: ["actorMemberId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ProductRequirementActivity_actorMemberId_fkey"
            columns: ["actorMemberId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ProductRequirementActivity_actorMemberId_fkey"
            columns: ["actorMemberId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ProductRequirementActivity_productRequirementId_fkey"
            columns: ["productRequirementId"]
            isOneToOne: false
            referencedRelation: "ProductRequirement"
            referencedColumns: ["id"]
          },
        ]
      }
      ProductRequirementAssignee: {
        Row: {
          assignedAt: string
          memberId: string
          productRequirementId: string
        }
        Insert: {
          assignedAt?: string
          memberId: string
          productRequirementId: string
        }
        Update: {
          assignedAt?: string
          memberId?: string
          productRequirementId?: string
        }
        Relationships: [
          {
            foreignKeyName: "ProductRequirementAssignee_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ProductRequirementAssignee_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ProductRequirementAssignee_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ProductRequirementAssignee_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ProductRequirementAssignee_productRequirementId_fkey"
            columns: ["productRequirementId"]
            isOneToOne: false
            referencedRelation: "ProductRequirement"
            referencedColumns: ["id"]
          },
        ]
      }
      Project: {
        Row: {
          alphaHierarchyEnabled: boolean
          category: string
          clientId: string
          createdAt: string
          definitionOfDone: Json
          driveFolderId: string | null
          driveLinkedBy: string | null
          endDate: string | null
          engagementType: string
          forgeSourceSessionId: string | null
          githubDefaultBranch: string
          githubPat: string | null
          githubRepoName: string | null
          githubRepoOwner: string | null
          id: string
          memoryMd: string | null
          memoryUpdatedAt: string | null
          memoryVersion: number
          name: string
          phase: string
          phaseChangedAt: string
          planningActive: boolean
          planningCadence: string | null
          pmId: string | null
          referenceKey: string | null
          repoManifest: string | null
          repoManifestUpdatedAt: string | null
          repoUrl: string | null
          startDate: string | null
          status: string
          updatedAt: string
        }
        Insert: {
          alphaHierarchyEnabled?: boolean
          category?: string
          clientId: string
          createdAt?: string
          definitionOfDone?: Json
          driveFolderId?: string | null
          driveLinkedBy?: string | null
          endDate?: string | null
          engagementType?: string
          forgeSourceSessionId?: string | null
          githubDefaultBranch?: string
          githubPat?: string | null
          githubRepoName?: string | null
          githubRepoOwner?: string | null
          id?: string
          memoryMd?: string | null
          memoryUpdatedAt?: string | null
          memoryVersion?: number
          name: string
          phase?: string
          phaseChangedAt?: string
          planningActive?: boolean
          planningCadence?: string | null
          pmId?: string | null
          referenceKey?: string | null
          repoManifest?: string | null
          repoManifestUpdatedAt?: string | null
          repoUrl?: string | null
          startDate?: string | null
          status?: string
          updatedAt: string
        }
        Update: {
          alphaHierarchyEnabled?: boolean
          category?: string
          clientId?: string
          createdAt?: string
          definitionOfDone?: Json
          driveFolderId?: string | null
          driveLinkedBy?: string | null
          endDate?: string | null
          engagementType?: string
          forgeSourceSessionId?: string | null
          githubDefaultBranch?: string
          githubPat?: string | null
          githubRepoName?: string | null
          githubRepoOwner?: string | null
          id?: string
          memoryMd?: string | null
          memoryUpdatedAt?: string | null
          memoryVersion?: number
          name?: string
          phase?: string
          phaseChangedAt?: string
          planningActive?: boolean
          planningCadence?: string | null
          pmId?: string | null
          referenceKey?: string | null
          repoManifest?: string | null
          repoManifestUpdatedAt?: string | null
          repoUrl?: string | null
          startDate?: string | null
          status?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "Project_clientId_fkey"
            columns: ["clientId"]
            isOneToOne: false
            referencedRelation: "Client"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Project_clientId_fkey"
            columns: ["clientId"]
            isOneToOne: false
            referencedRelation: "client_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Project_driveLinkedBy_fkey"
            columns: ["driveLinkedBy"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Project_driveLinkedBy_fkey"
            columns: ["driveLinkedBy"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Project_driveLinkedBy_fkey"
            columns: ["driveLinkedBy"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Project_driveLinkedBy_fkey"
            columns: ["driveLinkedBy"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Project_forgeSourceSessionId_fkey"
            columns: ["forgeSourceSessionId"]
            isOneToOne: false
            referencedRelation: "design_session_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Project_forgeSourceSessionId_fkey"
            columns: ["forgeSourceSessionId"]
            isOneToOne: false
            referencedRelation: "DesignSession"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Project_pmId_fkey"
            columns: ["pmId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Project_pmId_fkey"
            columns: ["pmId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Project_pmId_fkey"
            columns: ["pmId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Project_pmId_fkey"
            columns: ["pmId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      ProjectAccess: {
        Row: {
          grantedAt: string
          grantedBy: string | null
          id: string
          projectId: string
          role: string
          userId: string
        }
        Insert: {
          grantedAt?: string
          grantedBy?: string | null
          id?: string
          projectId: string
          role: string
          userId: string
        }
        Update: {
          grantedAt?: string
          grantedBy?: string | null
          id?: string
          projectId?: string
          role?: string
          userId?: string
        }
        Relationships: [
          {
            foreignKeyName: "ProjectAccess_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
        ]
      }
      ProjectBusinessContext: {
        Row: {
          businessModel: string | null
          competitors: Json | null
          icp: string | null
          projectId: string
          runwayMonths: number | null
          stage: string | null
          ticketRangeBrl: unknown
          updatedAt: string
          updatedBy: string | null
        }
        Insert: {
          businessModel?: string | null
          competitors?: Json | null
          icp?: string | null
          projectId: string
          runwayMonths?: number | null
          stage?: string | null
          ticketRangeBrl?: unknown
          updatedAt?: string
          updatedBy?: string | null
        }
        Update: {
          businessModel?: string | null
          competitors?: Json | null
          icp?: string | null
          projectId?: string
          runwayMonths?: number | null
          stage?: string | null
          ticketRangeBrl?: unknown
          updatedAt?: string
          updatedBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ProjectBusinessContext_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: true
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
        ]
      }
      ProjectDriveFile: {
        Row: {
          fileId: string
          iconHint: string | null
          id: string
          mimeType: string
          modifiedTime: string | null
          name: string
          projectId: string
          sizeBytes: number | null
          stage: string | null
          syncedAt: string
          webViewLink: string | null
        }
        Insert: {
          fileId: string
          iconHint?: string | null
          id?: string
          mimeType: string
          modifiedTime?: string | null
          name: string
          projectId: string
          sizeBytes?: number | null
          stage?: string | null
          syncedAt?: string
          webViewLink?: string | null
        }
        Update: {
          fileId?: string
          iconHint?: string | null
          id?: string
          mimeType?: string
          modifiedTime?: string | null
          name?: string
          projectId?: string
          sizeBytes?: number | null
          stage?: string | null
          syncedAt?: string
          webViewLink?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ProjectDriveFile_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
        ]
      }
      ProjectInsight: {
        Row: {
          costUsdCents: number
          createdAt: string
          errorRelational: string | null
          errorTechnical: string | null
          generatedAt: string
          generatedBy: string
          id: string
          inputMeetingsCount: number
          inputSprintId: string | null
          modelRelational: string | null
          modelTechnical: string | null
          projectId: string
          relationalHealth: string | null
          relationalSignals: Json
          relationalSummary: string | null
          relationalWatch: Json
          technicalHealth: string | null
          technicalRisks: Json
          technicalSummary: string | null
          technicalWatch: Json
          triggeredByMemberId: string | null
          updatedAt: string
        }
        Insert: {
          costUsdCents?: number
          createdAt?: string
          errorRelational?: string | null
          errorTechnical?: string | null
          generatedAt?: string
          generatedBy: string
          id?: string
          inputMeetingsCount?: number
          inputSprintId?: string | null
          modelRelational?: string | null
          modelTechnical?: string | null
          projectId: string
          relationalHealth?: string | null
          relationalSignals?: Json
          relationalSummary?: string | null
          relationalWatch?: Json
          technicalHealth?: string | null
          technicalRisks?: Json
          technicalSummary?: string | null
          technicalWatch?: Json
          triggeredByMemberId?: string | null
          updatedAt?: string
        }
        Update: {
          costUsdCents?: number
          createdAt?: string
          errorRelational?: string | null
          errorTechnical?: string | null
          generatedAt?: string
          generatedBy?: string
          id?: string
          inputMeetingsCount?: number
          inputSprintId?: string | null
          modelRelational?: string | null
          modelTechnical?: string | null
          projectId?: string
          relationalHealth?: string | null
          relationalSignals?: Json
          relationalSummary?: string | null
          relationalWatch?: Json
          technicalHealth?: string | null
          technicalRisks?: Json
          technicalSummary?: string | null
          technicalWatch?: Json
          triggeredByMemberId?: string | null
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "ProjectInsight_inputSprintId_fkey"
            columns: ["inputSprintId"]
            isOneToOne: false
            referencedRelation: "Sprint"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ProjectInsight_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: true
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ProjectInsight_triggeredByMemberId_fkey"
            columns: ["triggeredByMemberId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ProjectInsight_triggeredByMemberId_fkey"
            columns: ["triggeredByMemberId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ProjectInsight_triggeredByMemberId_fkey"
            columns: ["triggeredByMemberId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ProjectInsight_triggeredByMemberId_fkey"
            columns: ["triggeredByMemberId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      ProjectMember: {
        Row: {
          createdAt: string
          fpAllocation: number
          id: string
          memberId: string
          projectId: string
        }
        Insert: {
          createdAt?: string
          fpAllocation?: number
          id?: string
          memberId: string
          projectId: string
        }
        Update: {
          createdAt?: string
          fpAllocation?: number
          id?: string
          memberId?: string
          projectId?: string
        }
        Relationships: [
          {
            foreignKeyName: "ProjectMember_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ProjectMember_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ProjectMember_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ProjectMember_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ProjectMember_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
        ]
      }
      ProjectPersona: {
        Row: {
          createdAt: string
          description: string | null
          id: string
          name: string
          projectId: string
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          description?: string | null
          id?: string
          name: string
          projectId: string
          updatedAt?: string
        }
        Update: {
          createdAt?: string
          description?: string | null
          id?: string
          name?: string
          projectId?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "ProjectPersona_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
        ]
      }
      ProjectResource: {
        Row: {
          createdAt: string
          id: string
          kind: string
          notes: string | null
          order: number
          projectId: string
          title: string
          updatedAt: string
          url: string | null
        }
        Insert: {
          createdAt?: string
          id?: string
          kind: string
          notes?: string | null
          order?: number
          projectId: string
          title: string
          updatedAt?: string
          url?: string | null
        }
        Update: {
          createdAt?: string
          id?: string
          kind?: string
          notes?: string | null
          order?: number
          projectId?: string
          title?: string
          updatedAt?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ProjectResource_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
        ]
      }
      ProjectSquad: {
        Row: {
          id: string
          projectId: string
          squadId: string
        }
        Insert: {
          id?: string
          projectId: string
          squadId: string
        }
        Update: {
          id?: string
          projectId?: string
          squadId?: string
        }
        Relationships: [
          {
            foreignKeyName: "ProjectSquad_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ProjectSquad_squadId_fkey"
            columns: ["squadId"]
            isOneToOne: false
            referencedRelation: "Squad"
            referencedColumns: ["id"]
          },
        ]
      }
      ProjectWikiSection: {
        Row: {
          createdAt: string
          data: Json
          generatedAt: string | null
          generatedBy: string | null
          id: string
          inputsHash: string | null
          order: number
          projectId: string
          schemaVersion: number | null
          sectionKey: string
          suppressed: Json
          title: string
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          data?: Json
          generatedAt?: string | null
          generatedBy?: string | null
          id?: string
          inputsHash?: string | null
          order?: number
          projectId: string
          schemaVersion?: number | null
          sectionKey: string
          suppressed?: Json
          title: string
          updatedAt: string
        }
        Update: {
          createdAt?: string
          data?: Json
          generatedAt?: string | null
          generatedBy?: string | null
          id?: string
          inputsHash?: string | null
          order?: number
          projectId?: string
          schemaVersion?: number | null
          sectionKey?: string
          suppressed?: Json
          title?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "ProjectWikiSection_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
        ]
      }
      ProjectWikiSectionSource: {
        Row: {
          bulletHash: string
          extractedAt: string
          id: string
          sourceId: string
          sourceType: string
          wikiSectionId: string
        }
        Insert: {
          bulletHash: string
          extractedAt?: string
          id?: string
          sourceId: string
          sourceType: string
          wikiSectionId: string
        }
        Update: {
          bulletHash?: string
          extractedAt?: string
          id?: string
          sourceId?: string
          sourceType?: string
          wikiSectionId?: string
        }
        Relationships: [
          {
            foreignKeyName: "ProjectWikiSectionSource_wikiSectionId_fkey"
            columns: ["wikiSectionId"]
            isOneToOne: false
            referencedRelation: "ProjectWikiSection"
            referencedColumns: ["id"]
          },
        ]
      }
      Sprint: {
        Row: {
          createdAt: string
          deployedToProductionAt: string | null
          deployedToStagingAt: string | null
          endDate: string
          goal: string | null
          id: string
          name: string
          projectId: string
          startDate: string
          status: string
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          deployedToProductionAt?: string | null
          deployedToStagingAt?: string | null
          endDate: string
          goal?: string | null
          id?: string
          name: string
          projectId: string
          startDate: string
          status?: string
          updatedAt: string
        }
        Update: {
          createdAt?: string
          deployedToProductionAt?: string | null
          deployedToStagingAt?: string | null
          endDate?: string
          goal?: string | null
          id?: string
          name?: string
          projectId?: string
          startDate?: string
          status?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "Sprint_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
        ]
      }
      SprintDeploy: {
        Row: {
          commitSha: string | null
          completedAt: string | null
          environment: string
          errorLog: string | null
          id: string
          sprintId: string
          startedAt: string
          status: string
          tasksFailed: Json
          tasksIncluded: Json
          triggeredBy: string | null
        }
        Insert: {
          commitSha?: string | null
          completedAt?: string | null
          environment?: string
          errorLog?: string | null
          id?: string
          sprintId: string
          startedAt?: string
          status?: string
          tasksFailed?: Json
          tasksIncluded?: Json
          triggeredBy?: string | null
        }
        Update: {
          commitSha?: string | null
          completedAt?: string | null
          environment?: string
          errorLog?: string | null
          id?: string
          sprintId?: string
          startedAt?: string
          status?: string
          tasksFailed?: Json
          tasksIncluded?: Json
          triggeredBy?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "SprintDeploy_sprintId_fkey"
            columns: ["sprintId"]
            isOneToOne: false
            referencedRelation: "Sprint"
            referencedColumns: ["id"]
          },
        ]
      }
      SprintMember: {
        Row: {
          createdAt: string
          fpAllocation: number
          memberId: string
          sprintId: string
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          fpAllocation: number
          memberId: string
          sprintId: string
          updatedAt?: string
        }
        Update: {
          createdAt?: string
          fpAllocation?: number
          memberId?: string
          sprintId?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "SprintMember_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "SprintMember_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "SprintMember_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "SprintMember_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "SprintMember_sprintId_fkey"
            columns: ["sprintId"]
            isOneToOne: false
            referencedRelation: "Sprint"
            referencedColumns: ["id"]
          },
        ]
      }
      SprintRetrospective: {
        Row: {
          badPoints: string | null
          completedAt: string
          completedBy: string | null
          createdAt: string
          goodPoints: string | null
          id: string
          ideas: string | null
          sprintId: string
          updatedAt: string
        }
        Insert: {
          badPoints?: string | null
          completedAt?: string
          completedBy?: string | null
          createdAt?: string
          goodPoints?: string | null
          id?: string
          ideas?: string | null
          sprintId: string
          updatedAt?: string
        }
        Update: {
          badPoints?: string | null
          completedAt?: string
          completedBy?: string | null
          createdAt?: string
          goodPoints?: string | null
          id?: string
          ideas?: string | null
          sprintId?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "SprintRetrospective_completedBy_fkey"
            columns: ["completedBy"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "SprintRetrospective_completedBy_fkey"
            columns: ["completedBy"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "SprintRetrospective_completedBy_fkey"
            columns: ["completedBy"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "SprintRetrospective_completedBy_fkey"
            columns: ["completedBy"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "SprintRetrospective_sprintId_fkey"
            columns: ["sprintId"]
            isOneToOne: false
            referencedRelation: "Sprint"
            referencedColumns: ["id"]
          },
        ]
      }
      Squad: {
        Row: {
          createdAt: string
          id: string
          name: string
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          id?: string
          name: string
          updatedAt: string
        }
        Update: {
          createdAt?: string
          id?: string
          name?: string
          updatedAt?: string
        }
        Relationships: []
      }
      SquadMember: {
        Row: {
          id: string
          memberId: string
          squadId: string
        }
        Insert: {
          id?: string
          memberId: string
          squadId: string
        }
        Update: {
          id?: string
          memberId?: string
          squadId?: string
        }
        Relationships: [
          {
            foreignKeyName: "SquadMember_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "SquadMember_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "SquadMember_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "SquadMember_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "SquadMember_squadId_fkey"
            columns: ["squadId"]
            isOneToOne: false
            referencedRelation: "Squad"
            referencedColumns: ["id"]
          },
        ]
      }
      Task: {
        Row: {
          billable: boolean
          complexity: string
          createdAt: string
          createdByAgent: boolean
          createdById: string | null
          description: string | null
          designSessionId: string | null
          dismissedAt: string | null
          doneAt: string | null
          dueDate: string | null
          functionPoints: number | null
          githubBranchName: string | null
          githubIssueNumber: number | null
          githubPrNumber: number | null
          githubPrUrl: string | null
          id: string
          lastMergeError: string | null
          layer: Database["public"]["Enums"]["TaskLayer"] | null
          mergeAttempts: number
          notes: string | null
          personaScope: string | null
          priority: number
          productRequirementId: string | null
          projectId: string
          qualityFlags: string[] | null
          reference: string | null
          scope: string
          sprintId: string | null
          status: string
          title: string
          type: string
          updatedAt: string
          userStoryId: string | null
        }
        Insert: {
          billable?: boolean
          complexity?: string
          createdAt?: string
          createdByAgent?: boolean
          createdById?: string | null
          description?: string | null
          designSessionId?: string | null
          dismissedAt?: string | null
          doneAt?: string | null
          dueDate?: string | null
          functionPoints?: number | null
          githubBranchName?: string | null
          githubIssueNumber?: number | null
          githubPrNumber?: number | null
          githubPrUrl?: string | null
          id?: string
          lastMergeError?: string | null
          layer?: Database["public"]["Enums"]["TaskLayer"] | null
          mergeAttempts?: number
          notes?: string | null
          personaScope?: string | null
          priority?: number
          productRequirementId?: string | null
          projectId: string
          qualityFlags?: string[] | null
          reference?: string | null
          scope?: string
          sprintId?: string | null
          status?: string
          title: string
          type?: string
          updatedAt: string
          userStoryId?: string | null
        }
        Update: {
          billable?: boolean
          complexity?: string
          createdAt?: string
          createdByAgent?: boolean
          createdById?: string | null
          description?: string | null
          designSessionId?: string | null
          dismissedAt?: string | null
          doneAt?: string | null
          dueDate?: string | null
          functionPoints?: number | null
          githubBranchName?: string | null
          githubIssueNumber?: number | null
          githubPrNumber?: number | null
          githubPrUrl?: string | null
          id?: string
          lastMergeError?: string | null
          layer?: Database["public"]["Enums"]["TaskLayer"] | null
          mergeAttempts?: number
          notes?: string | null
          personaScope?: string | null
          priority?: number
          productRequirementId?: string | null
          projectId?: string
          qualityFlags?: string[] | null
          reference?: string | null
          scope?: string
          sprintId?: string | null
          status?: string
          title?: string
          type?: string
          updatedAt?: string
          userStoryId?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "Task_createdById_fkey"
            columns: ["createdById"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Task_createdById_fkey"
            columns: ["createdById"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Task_createdById_fkey"
            columns: ["createdById"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Task_createdById_fkey"
            columns: ["createdById"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Task_designSessionId_fkey"
            columns: ["designSessionId"]
            isOneToOne: false
            referencedRelation: "design_session_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Task_designSessionId_fkey"
            columns: ["designSessionId"]
            isOneToOne: false
            referencedRelation: "DesignSession"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Task_productRequirementId_fkey"
            columns: ["productRequirementId"]
            isOneToOne: false
            referencedRelation: "ProductRequirement"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Task_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Task_sprintId_fkey"
            columns: ["sprintId"]
            isOneToOne: false
            referencedRelation: "Sprint"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Task_userStoryId_fkey"
            columns: ["userStoryId"]
            isOneToOne: false
            referencedRelation: "user_story_overview"
            referencedColumns: ["userStoryId"]
          },
          {
            foreignKeyName: "Task_userStoryId_fkey"
            columns: ["userStoryId"]
            isOneToOne: false
            referencedRelation: "UserStory"
            referencedColumns: ["id"]
          },
        ]
      }
      TaskActivity: {
        Row: {
          actorMemberId: string | null
          createdAt: string
          id: string
          payload: Json
          taskId: string
          type: string
        }
        Insert: {
          actorMemberId?: string | null
          createdAt?: string
          id?: string
          payload?: Json
          taskId: string
          type: string
        }
        Update: {
          actorMemberId?: string | null
          createdAt?: string
          id?: string
          payload?: Json
          taskId?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "TaskActivity_actorMemberId_fkey"
            columns: ["actorMemberId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "TaskActivity_actorMemberId_fkey"
            columns: ["actorMemberId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "TaskActivity_actorMemberId_fkey"
            columns: ["actorMemberId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "TaskActivity_actorMemberId_fkey"
            columns: ["actorMemberId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "TaskActivity_taskId_fkey"
            columns: ["taskId"]
            isOneToOne: false
            referencedRelation: "Task"
            referencedColumns: ["id"]
          },
        ]
      }
      TaskAssignment: {
        Row: {
          createdAt: string
          designSessionItemId: string | null
          id: string
          memberId: string | null
          taskId: string
        }
        Insert: {
          createdAt?: string
          designSessionItemId?: string | null
          id?: string
          memberId?: string | null
          taskId: string
        }
        Update: {
          createdAt?: string
          designSessionItemId?: string | null
          id?: string
          memberId?: string | null
          taskId?: string
        }
        Relationships: [
          {
            foreignKeyName: "TaskAssignment_designSessionItemId_fkey"
            columns: ["designSessionItemId"]
            isOneToOne: false
            referencedRelation: "DesignSessionItem"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "TaskAssignment_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "TaskAssignment_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "TaskAssignment_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "TaskAssignment_memberId_fkey"
            columns: ["memberId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "TaskAssignment_taskId_fkey"
            columns: ["taskId"]
            isOneToOne: false
            referencedRelation: "Task"
            referencedColumns: ["id"]
          },
        ]
      }
      TaskComment: {
        Row: {
          authorMemberId: string | null
          body: string
          createdAt: string
          deletedAt: string | null
          editedAt: string | null
          id: string
          mentionedMemberIds: string[]
          taskId: string
        }
        Insert: {
          authorMemberId?: string | null
          body: string
          createdAt?: string
          deletedAt?: string | null
          editedAt?: string | null
          id?: string
          mentionedMemberIds?: string[]
          taskId: string
        }
        Update: {
          authorMemberId?: string | null
          body?: string
          createdAt?: string
          deletedAt?: string | null
          editedAt?: string | null
          id?: string
          mentionedMemberIds?: string[]
          taskId?: string
        }
        Relationships: [
          {
            foreignKeyName: "TaskComment_authorMemberId_fkey"
            columns: ["authorMemberId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "TaskComment_authorMemberId_fkey"
            columns: ["authorMemberId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "TaskComment_authorMemberId_fkey"
            columns: ["authorMemberId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "TaskComment_authorMemberId_fkey"
            columns: ["authorMemberId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "TaskComment_taskId_fkey"
            columns: ["taskId"]
            isOneToOne: false
            referencedRelation: "Task"
            referencedColumns: ["id"]
          },
        ]
      }
      TaskDependency: {
        Row: {
          createdAt: string
          dependsOn: string
          kind: string
          taskId: string
        }
        Insert: {
          createdAt?: string
          dependsOn: string
          kind?: string
          taskId: string
        }
        Update: {
          createdAt?: string
          dependsOn?: string
          kind?: string
          taskId?: string
        }
        Relationships: [
          {
            foreignKeyName: "TaskDependency_dependsOn_fkey"
            columns: ["dependsOn"]
            isOneToOne: false
            referencedRelation: "Task"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "TaskDependency_taskId_fkey"
            columns: ["taskId"]
            isOneToOne: false
            referencedRelation: "Task"
            referencedColumns: ["id"]
          },
        ]
      }
      TaskIteration: {
        Row: {
          commitSha: string | null
          completedAt: string | null
          costInputTokens: number
          costOutputTokens: number
          errorLog: string | null
          id: string
          number: number
          promptSent: string | null
          resultSummary: string | null
          startedAt: string
          success: boolean
          taskId: string
          trigger: string
          type: string
        }
        Insert: {
          commitSha?: string | null
          completedAt?: string | null
          costInputTokens?: number
          costOutputTokens?: number
          errorLog?: string | null
          id?: string
          number: number
          promptSent?: string | null
          resultSummary?: string | null
          startedAt?: string
          success?: boolean
          taskId: string
          trigger?: string
          type?: string
        }
        Update: {
          commitSha?: string | null
          completedAt?: string | null
          costInputTokens?: number
          costOutputTokens?: number
          errorLog?: string | null
          id?: string
          number?: number
          promptSent?: string | null
          resultSummary?: string | null
          startedAt?: string
          success?: boolean
          taskId?: string
          trigger?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "TaskIteration_taskId_fkey"
            columns: ["taskId"]
            isOneToOne: false
            referencedRelation: "Task"
            referencedColumns: ["id"]
          },
        ]
      }
      TaskTag: {
        Row: {
          createdAt: string
          id: string
          name: string
          projectId: string
          tone: string
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          id?: string
          name: string
          projectId: string
          tone: string
          updatedAt?: string
        }
        Update: {
          createdAt?: string
          id?: string
          name?: string
          projectId?: string
          tone?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "TaskTag_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
        ]
      }
      TaskTagAssignment: {
        Row: {
          createdAt: string
          tagId: string
          taskId: string
        }
        Insert: {
          createdAt?: string
          tagId: string
          taskId: string
        }
        Update: {
          createdAt?: string
          tagId?: string
          taskId?: string
        }
        Relationships: [
          {
            foreignKeyName: "TaskTagAssignment_tagId_fkey"
            columns: ["tagId"]
            isOneToOne: false
            referencedRelation: "TaskTag"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "TaskTagAssignment_taskId_fkey"
            columns: ["taskId"]
            isOneToOne: false
            referencedRelation: "Task"
            referencedColumns: ["id"]
          },
        ]
      }
      Todo: {
        Row: {
          assigneeId: string
          createdAt: string
          createdById: string
          decision: string
          description: string
          dueDate: string | null
          id: string
          meetingId: string | null
          notes: string | null
          resolvedAt: string | null
          source: string
          sourceReviewId: string | null
          status: string
          updatedAt: string
        }
        Insert: {
          assigneeId: string
          createdAt?: string
          createdById: string
          decision?: string
          description: string
          dueDate?: string | null
          id?: string
          meetingId?: string | null
          notes?: string | null
          resolvedAt?: string | null
          source?: string
          sourceReviewId?: string | null
          status?: string
          updatedAt: string
        }
        Update: {
          assigneeId?: string
          createdAt?: string
          createdById?: string
          decision?: string
          description?: string
          dueDate?: string | null
          id?: string
          meetingId?: string | null
          notes?: string | null
          resolvedAt?: string | null
          source?: string
          sourceReviewId?: string | null
          status?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "Todo_assigneeId_fkey"
            columns: ["assigneeId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Todo_assigneeId_fkey"
            columns: ["assigneeId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Todo_assigneeId_fkey"
            columns: ["assigneeId"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Todo_assigneeId_fkey"
            columns: ["assigneeId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Todo_createdById_fkey"
            columns: ["createdById"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Todo_createdById_fkey"
            columns: ["createdById"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Todo_createdById_fkey"
            columns: ["createdById"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Todo_createdById_fkey"
            columns: ["createdById"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Todo_meetingId_fkey"
            columns: ["meetingId"]
            isOneToOne: false
            referencedRelation: "Meeting"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "Todo_sourceReviewId_fkey"
            columns: ["sourceReviewId"]
            isOneToOne: false
            referencedRelation: "MeetingProjectReview"
            referencedColumns: ["id"]
          },
        ]
      }
      UserStory: {
        Row: {
          acValidatedAt: string | null
          acValidatedBy: string | null
          createdAt: string
          createdByAgent: boolean
          createdById: string | null
          designSessionId: string | null
          designSessionItemId: string | null
          dismissedAt: string | null
          id: string
          moduleId: string | null
          personaId: string | null
          projectId: string
          proposedModuleName: string | null
          reference: string
          refinementStatus: string
          soThat: string | null
          title: string
          updatedAt: string
          want: string
        }
        Insert: {
          acValidatedAt?: string | null
          acValidatedBy?: string | null
          createdAt?: string
          createdByAgent?: boolean
          createdById?: string | null
          designSessionId?: string | null
          designSessionItemId?: string | null
          dismissedAt?: string | null
          id?: string
          moduleId?: string | null
          personaId?: string | null
          projectId: string
          proposedModuleName?: string | null
          reference: string
          refinementStatus?: string
          soThat?: string | null
          title: string
          updatedAt?: string
          want: string
        }
        Update: {
          acValidatedAt?: string | null
          acValidatedBy?: string | null
          createdAt?: string
          createdByAgent?: boolean
          createdById?: string | null
          designSessionId?: string | null
          designSessionItemId?: string | null
          dismissedAt?: string | null
          id?: string
          moduleId?: string | null
          personaId?: string | null
          projectId?: string
          proposedModuleName?: string | null
          reference?: string
          refinementStatus?: string
          soThat?: string | null
          title?: string
          updatedAt?: string
          want?: string
        }
        Relationships: [
          {
            foreignKeyName: "UserStory_acValidatedBy_fkey"
            columns: ["acValidatedBy"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "UserStory_acValidatedBy_fkey"
            columns: ["acValidatedBy"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "UserStory_acValidatedBy_fkey"
            columns: ["acValidatedBy"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "UserStory_acValidatedBy_fkey"
            columns: ["acValidatedBy"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "UserStory_createdById_fkey"
            columns: ["createdById"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "UserStory_createdById_fkey"
            columns: ["createdById"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "UserStory_createdById_fkey"
            columns: ["createdById"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "UserStory_createdById_fkey"
            columns: ["createdById"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "UserStory_designSessionId_fkey"
            columns: ["designSessionId"]
            isOneToOne: false
            referencedRelation: "design_session_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "UserStory_designSessionId_fkey"
            columns: ["designSessionId"]
            isOneToOne: false
            referencedRelation: "DesignSession"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "UserStory_designSessionItemId_fkey"
            columns: ["designSessionItemId"]
            isOneToOne: false
            referencedRelation: "DesignSessionItem"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "UserStory_moduleId_fkey"
            columns: ["moduleId"]
            isOneToOne: false
            referencedRelation: "Module"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "UserStory_personaId_fkey"
            columns: ["personaId"]
            isOneToOne: false
            referencedRelation: "ProjectPersona"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "UserStory_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
        ]
      }
      WikiJob: {
        Row: {
          createdAt: string
          error: string | null
          finishedAt: string | null
          id: string
          projectId: string
          startedAt: string | null
          status: string
          trigger: string
        }
        Insert: {
          createdAt?: string
          error?: string | null
          finishedAt?: string | null
          id?: string
          projectId: string
          startedAt?: string | null
          status?: string
          trigger?: string
        }
        Update: {
          createdAt?: string
          error?: string | null
          finishedAt?: string | null
          id?: string
          projectId?: string
          startedAt?: string | null
          status?: string
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "WikiJob_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      agent_quality_metrics: {
        Row: {
          agentSlug: string | null
          category: string | null
          correct: number | null
          edited: number | null
          pct_correct: number | null
          pending: number | null
          total: number | null
          wrong: number | null
        }
        Relationships: []
      }
      agent_usage_hourly_mv: {
        Row: {
          agent_name: string | null
          bucket_hour: string | null
          cached_input_tokens: number | null
          call_kind: string | null
          calls: number | null
          cost_usd: number | null
          input_tokens: number | null
          member_id: string | null
          model_id: string | null
          output_tokens: number | null
          project_id: string | null
          reasoning_tokens: number | null
          total_tokens: number | null
        }
        Relationships: [
          {
            foreignKeyName: "AgentUsage_memberId_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AgentUsage_memberId_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AgentUsage_memberId_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AgentUsage_memberId_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "AgentUsage_projectId_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
        ]
      }
      client_summary: {
        Row: {
          createdAt: string | null
          email: string | null
          id: string | null
          name: string | null
          notes: string | null
          phone: string | null
          project_count: number | null
          updatedAt: string | null
        }
        Insert: {
          createdAt?: string | null
          email?: string | null
          id?: string | null
          name?: string | null
          notes?: string | null
          phone?: string | null
          project_count?: never
          updatedAt?: string | null
        }
        Update: {
          createdAt?: string | null
          email?: string | null
          id?: string | null
          name?: string | null
          notes?: string | null
          phone?: string | null
          project_count?: never
          updatedAt?: string | null
        }
        Relationships: []
      }
      design_session_summary: {
        Row: {
          actualDurationMin: number | null
          completedAt: string | null
          createdAt: string | null
          createdBy: string | null
          currentStep: number | null
          description: string | null
          id: string | null
          isMain: boolean | null
          item_count: number | null
          projectId: string | null
          scheduledAt: string | null
          status: string | null
          title: string | null
          totalSteps: number | null
          type: string | null
          updatedAt: string | null
          visibility: string | null
        }
        Relationships: [
          {
            foreignKeyName: "DesignSession_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSession_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSession_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "member_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSession_createdBy_fkey"
            columns: ["createdBy"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "DesignSession_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
        ]
      }
      member_capacity_overview: {
        Row: {
          active_task_count: number | null
          fp_allocated: number | null
          fp_capacity: number | null
          id: string | null
          name: string | null
          position: string | null
          role: string | null
        }
        Relationships: []
      }
      member_commitment_overview: {
        Row: {
          capacity: number | null
          committed: number | null
          id: string | null
          name: string | null
          position: string | null
          project_count: number | null
          remaining: number | null
          role: string | null
        }
        Relationships: []
      }
      member_summary: {
        Row: {
          active_task_count: number | null
          createdAt: string | null
          email: string | null
          fpCapacity: number | null
          githubUsername: string | null
          id: string | null
          name: string | null
          position: string | null
          role: string | null
          squad_count: number | null
          updatedAt: string | null
          userId: string | null
        }
        Insert: {
          active_task_count?: never
          createdAt?: string | null
          email?: string | null
          fpCapacity?: number | null
          githubUsername?: string | null
          id?: string | null
          name?: string | null
          position?: string | null
          role?: string | null
          squad_count?: never
          updatedAt?: string | null
          userId?: string | null
        }
        Update: {
          active_task_count?: never
          createdAt?: string | null
          email?: string | null
          fpCapacity?: number | null
          githubUsername?: string | null
          id?: string | null
          name?: string | null
          position?: string | null
          role?: string | null
          squad_count?: never
          updatedAt?: string | null
          userId?: string | null
        }
        Relationships: []
      }
      sprint_capacity_overview: {
        Row: {
          capacity: number | null
          done: number | null
          open: number | null
          planned: number | null
          sprintId: string | null
        }
        Relationships: []
      }
      sprint_member_capacity: {
        Row: {
          fp_allocation: number | null
          fp_done: number | null
          fp_open: number | null
          fp_planned: number | null
          has_sprint_override: boolean | null
          member_name: string | null
          memberId: string | null
          projectId: string | null
          sprintId: string | null
        }
        Relationships: []
      }
      sprint_prd_capacity: {
        Row: {
          fp_allocated: number | null
          fp_done: number | null
          fp_open: number | null
          prd_count: number | null
          sprintId: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ProductRequirement_sprintId_fkey"
            columns: ["sprintId"]
            isOneToOne: false
            referencedRelation: "Sprint"
            referencedColumns: ["id"]
          },
        ]
      }
      user_story_overview: {
        Row: {
          acValidatedAt: string | null
          computedStatus: string | null
          doneFunctionPoints: number | null
          doneTasks: number | null
          moduleId: string | null
          projectId: string | null
          reference: string | null
          refinementStatus: string | null
          title: string | null
          totalFunctionPoints: number | null
          totalTasks: number | null
          userStoryId: string | null
        }
        Relationships: [
          {
            foreignKeyName: "UserStory_moduleId_fkey"
            columns: ["moduleId"]
            isOneToOne: false
            referencedRelation: "Module"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "UserStory_projectId_fkey"
            columns: ["projectId"]
            isOneToOne: false
            referencedRelation: "Project"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      activate_sprint: {
        Args: { p_sprint_id: string }
        Returns: {
          createdAt: string
          deployedToProductionAt: string | null
          deployedToStagingAt: string | null
          endDate: string
          goal: string | null
          id: string
          name: string
          projectId: string
          startDate: string
          status: string
          updatedAt: string
        }
        SetofOptions: {
          from: "*"
          to: "Sprint"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_sprint_suggestion: {
        Args: { p_project_id: string; p_sprints: Json }
        Returns: Json
      }
      bulk_update_tasks: {
        Args: { p_actor_id: string; p_project_id: string; p_updates: Json }
        Returns: Json
      }
      can_access_session: { Args: { p_session_id: string }; Returns: boolean }
      can_change_session_visibility: {
        Args: { p_session_id: string }
        Returns: boolean
      }
      can_create_pm_review: { Args: { p_project_id: string }; Returns: boolean }
      can_edit_client: { Args: { p_client_id: string }; Returns: boolean }
      can_edit_meeting: { Args: { p_meeting_id: string }; Returns: boolean }
      can_edit_project: { Args: { p_project_id: string }; Returns: boolean }
      can_edit_session: { Args: { p_session_id: string }; Returns: boolean }
      can_edit_sessions: { Args: { p_project_id: string }; Returns: boolean }
      can_edit_tasks: { Args: { p_project_id: string }; Returns: boolean }
      can_view_design_session: {
        Args: { p_session_id: string }
        Returns: boolean
      }
      can_view_meeting: { Args: { p_meeting_id: string }; Returns: boolean }
      can_view_project: { Args: { p_project_id: string }; Returns: boolean }
      claim_next_job: {
        Args: { p_daemon_id: string; p_kind: string }
        Returns: {
          assignToAnyone: boolean
          claimedAt: string | null
          claimedBy: string | null
          createdAt: string
          heartbeatAt: string | null
          id: string
          kind: string
          maxStories: number | null
          meta: Json
          ownerId: string
          prdSlug: string
          projectId: string | null
          runId: string | null
          status: string
          updatedAt: string
        }[]
        SetofOptions: {
          from: "*"
          to: "ForgeJob"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_meeting_with_reviews: {
        Args: {
          p_attendees?: Json
          p_carry_actions?: Json
          p_date: string
          p_notes?: string
          p_project_ids?: Json
          p_reviews?: Json
          p_sprint_id?: string
          p_title?: string
          p_type?: string
        }
        Returns: string
      }
      delete_member_integration: {
        Args: { p_member_id: string; p_provider: string }
        Returns: undefined
      }
      delete_project_cascade: {
        Args: { p_project_id: string }
        Returns: undefined
      }
      enqueue_client_insight_jobs: { Args: never; Returns: number }
      enqueue_daily_todo_reminders: { Args: never; Returns: undefined }
      enqueue_granola_auto_imports: { Args: never; Returns: number }
      enqueue_project_insight_jobs: { Args: never; Returns: number }
      ensure_wiki_sections: {
        Args: { p_project_id: string; p_sections: Json }
        Returns: {
          createdAt: string
          data: Json
          generatedAt: string | null
          generatedBy: string | null
          id: string
          inputsHash: string | null
          order: number
          projectId: string
          schemaVersion: number | null
          sectionKey: string
          suppressed: Json
          title: string
          updatedAt: string
        }[]
        SetofOptions: {
          from: "*"
          to: "ProjectWikiSection"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      entitylink_can_edit: {
        Args: { el: Database["public"]["Tables"]["EntityLink"]["Row"] }
        Returns: boolean
      }
      entitylink_can_view: {
        Args: { el: Database["public"]["Tables"]["EntityLink"]["Row"] }
        Returns: boolean
      }
      extract_module_hint: { Args: { p_title: string }; Returns: string }
      forge_next_seq: { Args: { p_run: string }; Returns: number }
      forge_recover_orphan_jobs: { Args: never; Returns: undefined }
      get_member_integration_secret: {
        Args: { p_member_id: string; p_provider: string }
        Returns: string
      }
      get_my_access_level: { Args: never; Returns: string }
      get_my_member_id: { Args: never; Returns: string }
      get_my_role: { Args: never; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      is_allocated_to: { Args: { p_project_id: string }; Returns: boolean }
      is_guest: { Args: never; Returns: boolean }
      is_manager: { Args: never; Returns: boolean }
      kick_granola_import_drain: { Args: never; Returns: undefined }
      kick_project_insight_drain: { Args: never; Returns: undefined }
      next_task_reference: { Args: { p_project_id: string }; Returns: string }
      next_user_story_reference: {
        Args: { p_project_id: string }
        Returns: string
      }
      persona_journey_delete: {
        Args: { p_kind: string; p_persona_id: string; p_step_id: string }
        Returns: boolean
      }
      persona_journey_upsert: {
        Args: { p_kind: string; p_persona_id: string; p_step: Json }
        Returns: Json
      }
      prd_render_markdown: {
        Args: { p: Database["public"]["Tables"]["ProductRequirement"]["Row"] }
        Returns: string
      }
      refresh_agent_usage_hourly_mv: { Args: never; Returns: undefined }
      renumber_sprints_chronologically: {
        Args: { p_project_id: string }
        Returns: undefined
      }
      reopen_sprint: {
        Args: { p_sprint_id: string }
        Returns: {
          createdAt: string
          deployedToProductionAt: string | null
          deployedToStagingAt: string | null
          endDate: string
          goal: string | null
          id: string
          name: string
          projectId: string
          startDate: string
          status: string
          updatedAt: string
        }
        SetofOptions: {
          from: "*"
          to: "Sprint"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      run_granola_auto_import_batch: { Args: never; Returns: number }
      run_project_insight_batch: { Args: never; Returns: number }
      scope_item_delete: {
        Args: { p_bucket: string; p_item_id: string; p_session_id: string }
        Returns: boolean
      }
      scope_item_upsert: {
        Args: { p_bucket: string; p_item: Json; p_session_id: string }
        Returns: Json
      }
      set_member_integration: {
        Args: {
          p_member_id: string
          p_provider: string
          p_token: string
          p_token_hint: string
        }
        Returns: undefined
      }
      step_array_add: {
        Args: {
          p_array_key: string
          p_item: Json
          p_session_id: string
          p_step_index?: number
          p_step_key: string
        }
        Returns: Json
      }
      step_array_delete: {
        Args: {
          p_array_key: string
          p_item_id: string
          p_session_id: string
          p_step_key: string
        }
        Returns: boolean
      }
      step_array_update: {
        Args: {
          p_array_key: string
          p_item_id: string
          p_session_id: string
          p_step_key: string
          p_updates: Json
        }
        Returns: Json
      }
      step_data_lock_key: {
        Args: { p_session_id: string; p_step_key: string }
        Returns: number
      }
      task_acceptance_bulk_diff: {
        Args: { p_payload: Json; p_task_id: string }
        Returns: {
          checkedAt: string | null
          checkedBy: string | null
          createdAt: string
          id: string
          order: number
          taskId: string | null
          text: string
          updatedAt: string
          userStoryId: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "AcceptanceCriterion"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      tech_specs_item_delete: {
        Args: { p_item_id: string; p_kind: string; p_session_id: string }
        Returns: boolean
      }
      tech_specs_item_upsert: {
        Args: { p_item: Json; p_kind: string; p_session_id: string }
        Returns: Json
      }
      unassigned_active_task_count: { Args: never; Returns: number }
    }
    Enums: {
      context_source_kind:
        | "transcript"
        | "meeting"
        | "spreadsheet_csv"
        | "spreadsheet_gsheets"
        | "github_repo"
        | "github_pr"
        | "github_issue"
        | "document"
        | "notion"
        | "gdrive_file"
      OpportunityStatus:
        | "discovery"
        | "evaluating"
        | "approved"
        | "in_project"
        | "rejected"
      TaskLayer: "DATA" | "API" | "REALTIME" | "UI" | "OPS"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      context_source_kind: [
        "transcript",
        "meeting",
        "spreadsheet_csv",
        "spreadsheet_gsheets",
        "github_repo",
        "github_pr",
        "github_issue",
        "document",
        "notion",
        "gdrive_file",
      ],
      OpportunityStatus: [
        "discovery",
        "evaluating",
        "approved",
        "in_project",
        "rejected",
      ],
      TaskLayer: ["DATA", "API", "REALTIME", "UI", "OPS"],
    },
  },
} as const
