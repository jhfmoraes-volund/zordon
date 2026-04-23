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
      _prisma_migrations: {
        Row: {
          applied_steps_count: number
          checksum: string
          finished_at: string | null
          id: string
          logs: string | null
          migration_name: string
          rolled_back_at: string | null
          started_at: string
        }
        Insert: {
          applied_steps_count?: number
          checksum: string
          finished_at?: string | null
          id: string
          logs?: string | null
          migration_name: string
          rolled_back_at?: string | null
          started_at?: string
        }
        Update: {
          applied_steps_count?: number
          checksum?: string
          finished_at?: string | null
          id?: string
          logs?: string | null
          migration_name?: string
          rolled_back_at?: string | null
          started_at?: string
        }
        Relationships: []
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
          channel: string
          createdAt: string
          createdBy: string | null
          id: string
          sessionId: string | null
          title: string | null
          updatedAt: string
        }
        Insert: {
          agentId?: string | null
          agentName?: string | null
          agentVersionId?: string | null
          channel?: string
          createdAt?: string
          createdBy?: string | null
          id?: string
          sessionId?: string | null
          title?: string | null
          updatedAt?: string
        }
        Update: {
          agentId?: string | null
          agentName?: string | null
          agentVersionId?: string | null
          channel?: string
          createdAt?: string
          createdBy?: string | null
          id?: string
          sessionId?: string | null
          title?: string | null
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
      Client: {
        Row: {
          createdAt: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          email?: string | null
          id: string
          name: string
          notes?: string | null
          phone?: string | null
          updatedAt: string
        }
        Update: {
          createdAt?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          updatedAt?: string
        }
        Relationships: []
      }
      DesignSession: {
        Row: {
          actualDurationMin: number | null
          completedAt: string | null
          createdAt: string
          createdBy: string | null
          currentStep: number
          description: string | null
          id: string
          projectId: string
          scheduledAt: string | null
          status: string
          title: string
          totalSteps: number
          type: string
          updatedAt: string
        }
        Insert: {
          actualDurationMin?: number | null
          completedAt?: string | null
          createdAt?: string
          createdBy?: string | null
          currentStep?: number
          description?: string | null
          id: string
          projectId: string
          scheduledAt?: string | null
          status?: string
          title: string
          totalSteps?: number
          type?: string
          updatedAt: string
        }
        Update: {
          actualDurationMin?: number | null
          completedAt?: string | null
          createdAt?: string
          createdBy?: string | null
          currentStep?: number
          description?: string | null
          id?: string
          projectId?: string
          scheduledAt?: string | null
          status?: string
          title?: string
          totalSteps?: number
          type?: string
          updatedAt?: string
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
          id: string
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
          id: string
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
          id: string
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
      MeetingActionItem: {
        Row: {
          assigneeId: string
          createdAt: string
          description: string
          dueDate: string | null
          id: string
          meetingId: string
          resolvedAt: string | null
          sourceReviewId: string | null
          status: string
          updatedAt: string
        }
        Insert: {
          assigneeId: string
          createdAt?: string
          description: string
          dueDate?: string | null
          id: string
          meetingId: string
          resolvedAt?: string | null
          sourceReviewId?: string | null
          status?: string
          updatedAt: string
        }
        Update: {
          assigneeId?: string
          createdAt?: string
          description?: string
          dueDate?: string | null
          id?: string
          meetingId?: string
          resolvedAt?: string | null
          sourceReviewId?: string | null
          status?: string
          updatedAt?: string
        }
        Relationships: [
          {
            foreignKeyName: "MeetingActionItem_assigneeId_fkey"
            columns: ["assigneeId"]
            isOneToOne: false
            referencedRelation: "Member"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MeetingActionItem_assigneeId_fkey"
            columns: ["assigneeId"]
            isOneToOne: false
            referencedRelation: "member_capacity_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MeetingActionItem_assigneeId_fkey"
            columns: ["assigneeId"]
            isOneToOne: false
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MeetingActionItem_meetingId_fkey"
            columns: ["meetingId"]
            isOneToOne: false
            referencedRelation: "WeeklyMeeting"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "MeetingActionItem_sourceReviewId_fkey"
            columns: ["sourceReviewId"]
            isOneToOne: false
            referencedRelation: "MeetingProjectReview"
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
          id: string
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
            referencedRelation: "WeeklyMeeting"
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
      Member: {
        Row: {
          createdAt: string
          email: string | null
          fpCapacity: number
          githubUsername: string | null
          id: string
          isExternal: boolean
          name: string
          role: string
          specialty: string | null
          updatedAt: string
          userId: string | null
        }
        Insert: {
          createdAt?: string
          email?: string | null
          fpCapacity?: number
          githubUsername?: string | null
          id: string
          isExternal?: boolean
          name: string
          role?: string
          specialty?: string | null
          updatedAt: string
          userId?: string | null
        }
        Update: {
          createdAt?: string
          email?: string | null
          fpCapacity?: number
          githubUsername?: string | null
          id?: string
          isExternal?: boolean
          name?: string
          role?: string
          specialty?: string | null
          updatedAt?: string
          userId?: string | null
        }
        Relationships: []
      }
      MemberIntegration: {
        Row: {
          createdAt: string
          memberId: string
          provider: string
          secretId: string
          tokenHint: string | null
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          memberId: string
          provider: string
          secretId: string
          tokenHint?: string | null
          updatedAt?: string
        }
        Update: {
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
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      Project: {
        Row: {
          clientId: string
          createdAt: string
          endDate: string | null
          githubDefaultBranch: string
          githubRepoName: string | null
          githubRepoOwner: string | null
          id: string
          name: string
          pmId: string | null
          repoUrl: string | null
          startDate: string | null
          status: string
          updatedAt: string
        }
        Insert: {
          clientId: string
          createdAt?: string
          endDate?: string | null
          githubDefaultBranch?: string
          githubRepoName?: string | null
          githubRepoOwner?: string | null
          id: string
          name: string
          pmId?: string | null
          repoUrl?: string | null
          startDate?: string | null
          status?: string
          updatedAt: string
        }
        Update: {
          clientId?: string
          createdAt?: string
          endDate?: string | null
          githubDefaultBranch?: string
          githubRepoName?: string | null
          githubRepoOwner?: string | null
          id?: string
          name?: string
          pmId?: string | null
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
            referencedRelation: "member_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      ProjectMember: {
        Row: {
          createdAt: string
          id: string
          memberId: string
          projectId: string
        }
        Insert: {
          createdAt?: string
          id: string
          memberId: string
          projectId: string
        }
        Update: {
          createdAt?: string
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
      ProjectSquad: {
        Row: {
          id: string
          projectId: string
          squadId: string
        }
        Insert: {
          id: string
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
          id: string
          order: number
          projectId: string
          sectionKey: string
          title: string
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          data?: Json
          id: string
          order?: number
          projectId: string
          sectionKey: string
          title: string
          updatedAt: string
        }
        Update: {
          createdAt?: string
          data?: Json
          id?: string
          order?: number
          projectId?: string
          sectionKey?: string
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
      Sprint: {
        Row: {
          createdAt: string
          deployedToProductionAt: string | null
          deployedToStagingAt: string | null
          endDate: string
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
          id: string
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
          id: string
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
      Squad: {
        Row: {
          createdAt: string
          id: string
          name: string
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          id: string
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
          id: string
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
          acceptanceCriteria: string | null
          billable: boolean
          complexity: string
          createdAt: string
          dependencies: Json | null
          description: string | null
          designSessionId: string | null
          dueDate: string | null
          functionPoints: number | null
          githubBranchName: string | null
          githubIssueNumber: number | null
          githubPrNumber: number | null
          githubPrUrl: string | null
          id: string
          lastMergeError: string | null
          mergeAttempts: number
          notes: string | null
          priority: number
          projectId: string
          reference: string
          scope: string
          sprintId: string | null
          status: string
          title: string
          type: string
          updatedAt: string
        }
        Insert: {
          acceptanceCriteria?: string | null
          billable?: boolean
          complexity?: string
          createdAt?: string
          dependencies?: Json | null
          description?: string | null
          designSessionId?: string | null
          dueDate?: string | null
          functionPoints?: number | null
          githubBranchName?: string | null
          githubIssueNumber?: number | null
          githubPrNumber?: number | null
          githubPrUrl?: string | null
          id: string
          lastMergeError?: string | null
          mergeAttempts?: number
          notes?: string | null
          priority?: number
          projectId: string
          reference: string
          scope?: string
          sprintId?: string | null
          status?: string
          title: string
          type?: string
          updatedAt: string
        }
        Update: {
          acceptanceCriteria?: string | null
          billable?: boolean
          complexity?: string
          createdAt?: string
          dependencies?: Json | null
          description?: string | null
          designSessionId?: string | null
          dueDate?: string | null
          functionPoints?: number | null
          githubBranchName?: string | null
          githubIssueNumber?: number | null
          githubPrNumber?: number | null
          githubPrUrl?: string | null
          id?: string
          lastMergeError?: string | null
          mergeAttempts?: number
          notes?: string | null
          priority?: number
          projectId?: string
          reference?: string
          scope?: string
          sprintId?: string | null
          status?: string
          title?: string
          type?: string
          updatedAt?: string
        }
        Relationships: [
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
          id: string
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
          id: string
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
      WeeklyMeeting: {
        Row: {
          createdAt: string
          date: string
          id: string
          notes: string | null
          status: string
          updatedAt: string
        }
        Insert: {
          createdAt?: string
          date: string
          id: string
          notes?: string | null
          status?: string
          updatedAt: string
        }
        Update: {
          createdAt?: string
          date?: string
          id?: string
          notes?: string | null
          status?: string
          updatedAt?: string
        }
        Relationships: []
      }
    }
    Views: {
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
          item_count: number | null
          projectId: string | null
          scheduledAt: string | null
          status: string | null
          title: string | null
          totalSteps: number | null
          type: string | null
          updatedAt: string | null
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
          role?: string | null
          squad_count?: never
          updatedAt?: string | null
          userId?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      create_meeting_with_reviews: {
        Args: { p_carry_actions?: Json; p_date: string; p_reviews: Json }
        Returns: string
      }
      delete_member_integration: {
        Args: { p_member_id: string; p_provider: string }
        Returns: undefined
      }
      ensure_wiki_sections: {
        Args: { p_project_id: string; p_sections: Json }
        Returns: {
          createdAt: string
          data: Json
          id: string
          order: number
          projectId: string
          sectionKey: string
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
      get_member_integration_secret: {
        Args: { p_member_id: string; p_provider: string }
        Returns: string
      }
      get_my_role: { Args: never; Returns: string }
      is_admin: { Args: never; Returns: boolean }
      next_task_reference: { Args: never; Returns: string }
      set_member_integration: {
        Args: {
          p_member_id: string
          p_provider: string
          p_token: string
          p_token_hint: string
        }
        Returns: undefined
      }
      unassigned_active_task_count: { Args: never; Returns: number }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
