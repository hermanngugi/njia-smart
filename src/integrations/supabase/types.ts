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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: string
          created_at: string
          entity: string | null
          entity_id: string | null
          id: string
          meta: Json | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity?: string | null
          entity_id?: string | null
          id?: string
          meta?: Json | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity?: string | null
          entity_id?: string | null
          id?: string
          meta?: Json | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: []
      }
      advisory_case_controls: {
        Row: {
          applicability: string
          applicability_check: boolean
          assigned_to: string | null
          category: string
          control_key: string
          created_at: string
          created_by: string | null
          due_date: string | null
          evidence_hint: string | null
          evidence_note: string | null
          guidance: string | null
          id: string
          legal_reference: string | null
          mandatory: boolean
          project_id: string
          reviewer_note: string | null
          source_url: string | null
          status: string
          template_control_id: string | null
          title: string
          updated_at: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          applicability?: string
          applicability_check?: boolean
          assigned_to?: string | null
          category: string
          control_key: string
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          evidence_hint?: string | null
          evidence_note?: string | null
          guidance?: string | null
          id?: string
          legal_reference?: string | null
          mandatory?: boolean
          project_id: string
          reviewer_note?: string | null
          source_url?: string | null
          status?: string
          template_control_id?: string | null
          title: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          applicability?: string
          applicability_check?: boolean
          assigned_to?: string | null
          category?: string
          control_key?: string
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          evidence_hint?: string | null
          evidence_note?: string | null
          guidance?: string | null
          id?: string
          legal_reference?: string | null
          mandatory?: boolean
          project_id?: string
          reviewer_note?: string | null
          source_url?: string | null
          status?: string
          template_control_id?: string | null
          title?: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "advisory_case_controls_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "advisory_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advisory_case_controls_template_control_id_fkey"
            columns: ["template_control_id"]
            isOneToOne: false
            referencedRelation: "advisory_template_controls"
            referencedColumns: ["id"]
          },
        ]
      }
      advisory_milestone_documents: {
        Row: {
          created_at: string
          file_path: string
          id: string
          milestone_id: string
          note: string | null
          title: string
          uploaded_by: string | null
          verified: boolean
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          created_at?: string
          file_path: string
          id?: string
          milestone_id: string
          note?: string | null
          title: string
          uploaded_by?: string | null
          verified?: boolean
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          created_at?: string
          file_path?: string
          id?: string
          milestone_id?: string
          note?: string | null
          title?: string
          uploaded_by?: string | null
          verified?: boolean
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "advisory_milestone_documents_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "advisory_milestones"
            referencedColumns: ["id"]
          },
        ]
      }
      advisory_milestones: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          done: boolean
          due_date: string | null
          id: string
          notes: string | null
          project_id: string
          stage: string | null
          title: string
          verified: boolean
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          done?: boolean
          due_date?: string | null
          id?: string
          notes?: string | null
          project_id: string
          stage?: string | null
          title: string
          verified?: boolean
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          done?: boolean
          due_date?: string | null
          id?: string
          notes?: string | null
          project_id?: string
          stage?: string | null
          title?: string
          verified?: boolean
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "advisory_milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "advisory_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      advisory_projects: {
        Row: {
          case_number: number
          client_id: string
          closed_at: string | null
          closed_by: string | null
          closure_notes: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          invoice_id: string | null
          service_type: string
          stage: string
          start_date: string | null
          status: Database["public"]["Enums"]["engagement_status"]
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          case_number?: number
          client_id: string
          closed_at?: string | null
          closed_by?: string | null
          closure_notes?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          invoice_id?: string | null
          service_type?: string
          stage?: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["engagement_status"]
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          case_number?: number
          client_id?: string
          closed_at?: string | null
          closed_by?: string | null
          closure_notes?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          invoice_id?: string | null
          service_type?: string
          stage?: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["engagement_status"]
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "advisory_projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advisory_projects_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      advisory_service_templates: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          id: string
          legal_basis: string | null
          regulator: string | null
          review_required: boolean
          service_type: string
          source_checked_at: string | null
          source_url: string | null
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          legal_basis?: string | null
          regulator?: string | null
          review_required?: boolean
          service_type: string
          source_checked_at?: string | null
          source_url?: string | null
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          legal_basis?: string | null
          regulator?: string | null
          review_required?: boolean
          service_type?: string
          source_checked_at?: string | null
          source_url?: string | null
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      advisory_template_controls: {
        Row: {
          active: boolean
          applicability_check: boolean
          category: string
          control_key: string
          created_at: string
          evidence_hint: string | null
          guidance: string | null
          id: string
          legal_reference: string | null
          mandatory: boolean
          sort_order: number
          source_url: string | null
          template_id: string
          title: string
        }
        Insert: {
          active?: boolean
          applicability_check?: boolean
          category?: string
          control_key: string
          created_at?: string
          evidence_hint?: string | null
          guidance?: string | null
          id?: string
          legal_reference?: string | null
          mandatory?: boolean
          sort_order?: number
          source_url?: string | null
          template_id: string
          title: string
        }
        Update: {
          active?: boolean
          applicability_check?: boolean
          category?: string
          control_key?: string
          created_at?: string
          evidence_hint?: string | null
          guidance?: string | null
          id?: string
          legal_reference?: string | null
          mandatory?: boolean
          sort_order?: number
          source_url?: string | null
          template_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "advisory_template_controls_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "advisory_service_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          audience: string | null
          author_id: string | null
          body: string
          created_at: string
          id: string
          title: string
        }
        Insert: {
          audience?: string | null
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          title: string
        }
        Update: {
          audience?: string | null
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          title?: string
        }
        Relationships: []
      }
      audit_change_history: {
        Row: {
          action: string
          actor_id: string | null
          after_data: Json | null
          before_data: Json | null
          engagement_id: string | null
          entity_id: string
          entity_type: string
          id: number
          occurred_at: string
          reason: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          engagement_id?: string | null
          entity_id: string
          entity_type: string
          id?: never
          occurred_at?: string
          reason?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          after_data?: Json | null
          before_data?: Json | null
          engagement_id?: string | null
          entity_id?: string
          entity_type?: string
          id?: never
          occurred_at?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_change_history_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "engagements"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_engagement_procedures: {
        Row: {
          assigned_reviewer_id: string | null
          assigned_to: string | null
          created_at: string
          created_by: string | null
          engagement_id: string
          id: string
          pack_id: string
          pack_version: number
          procedure_id: string
          status: string
          updated_at: string
        }
        Insert: {
          assigned_reviewer_id?: string | null
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          engagement_id: string
          id?: string
          pack_id: string
          pack_version: number
          procedure_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_reviewer_id?: string | null
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          engagement_id?: string
          id?: string
          pack_id?: string
          pack_version?: number
          procedure_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_engagement_procedures_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_engagement_procedures_pack_id_pack_version_procedure_fkey"
            columns: ["pack_id", "pack_version", "procedure_id"]
            isOneToOne: false
            referencedRelation: "audit_procedure_definitions"
            referencedColumns: ["pack_id", "pack_version", "procedure_id"]
          },
        ]
      }
      audit_evidence_links: {
        Row: {
          engagement_procedure_id: string
          id: string
          linked_at: string
          linked_by: string | null
          note: string | null
          workpaper_id: string
        }
        Insert: {
          engagement_procedure_id: string
          id?: string
          linked_at?: string
          linked_by?: string | null
          note?: string | null
          workpaper_id: string
        }
        Update: {
          engagement_procedure_id?: string
          id?: string
          linked_at?: string
          linked_by?: string | null
          note?: string | null
          workpaper_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_evidence_links_engagement_procedure_id_fkey"
            columns: ["engagement_procedure_id"]
            isOneToOne: false
            referencedRelation: "audit_engagement_procedures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_evidence_links_workpaper_id_fkey"
            columns: ["workpaper_id"]
            isOneToOne: false
            referencedRelation: "audit_workpapers"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_procedure_definitions: {
        Row: {
          created_at: string
          definition: Json
          enabled: boolean
          pack_id: string
          pack_version: number
          procedure_id: string
          required: boolean
          section_id: string
          standard_references: Json
          title: string
        }
        Insert: {
          created_at?: string
          definition?: Json
          enabled?: boolean
          pack_id: string
          pack_version: number
          procedure_id: string
          required?: boolean
          section_id: string
          standard_references?: Json
          title: string
        }
        Update: {
          created_at?: string
          definition?: Json
          enabled?: boolean
          pack_id?: string
          pack_version?: number
          procedure_id?: string
          required?: boolean
          section_id?: string
          standard_references?: Json
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_procedure_definitions_pack_id_pack_version_fkey"
            columns: ["pack_id", "pack_version"]
            isOneToOne: false
            referencedRelation: "audit_procedure_packs"
            referencedColumns: ["id", "version"]
          },
        ]
      }
      audit_procedure_packs: {
        Row: {
          created_at: string
          created_by: string | null
          description: string
          effective_from: string
          engagement_kind: string
          id: string
          jurisdiction: string
          standards_basis: Json
          status: string
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string
          effective_from: string
          engagement_kind: string
          id: string
          jurisdiction?: string
          standards_basis?: Json
          status?: string
          title: string
          updated_at?: string
          version: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string
          effective_from?: string
          engagement_kind?: string
          id?: string
          jurisdiction?: string
          standards_basis?: Json
          status?: string
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      audit_procedure_results: {
        Row: {
          conclusion: string | null
          created_at: string
          engagement_procedure_id: string
          exceptions: Json
          id: string
          prepared_at: string
          prepared_by: string | null
          result_data: Json
          work_performed: string
        }
        Insert: {
          conclusion?: string | null
          created_at?: string
          engagement_procedure_id: string
          exceptions?: Json
          id?: string
          prepared_at?: string
          prepared_by?: string | null
          result_data?: Json
          work_performed?: string
        }
        Update: {
          conclusion?: string | null
          created_at?: string
          engagement_procedure_id?: string
          exceptions?: Json
          id?: string
          prepared_at?: string
          prepared_by?: string | null
          result_data?: Json
          work_performed?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_procedure_results_engagement_procedure_id_fkey"
            columns: ["engagement_procedure_id"]
            isOneToOne: false
            referencedRelation: "audit_engagement_procedures"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_review_notes: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          engagement_id: string
          id: string
          resolution_note: string | null
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
          stage: string | null
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          engagement_id: string
          id?: string
          resolution_note?: string | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          stage?: string | null
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          engagement_id?: string
          id?: string
          resolution_note?: string | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          stage?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_review_notes_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "engagements"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_risk_procedure_links: {
        Row: {
          engagement_procedure_id: string
          id: string
          linked_at: string
          linked_by: string | null
          risk_id: string
        }
        Insert: {
          engagement_procedure_id: string
          id?: string
          linked_at?: string
          linked_by?: string | null
          risk_id: string
        }
        Update: {
          engagement_procedure_id?: string
          id?: string
          linked_at?: string
          linked_by?: string | null
          risk_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_risk_procedure_links_engagement_procedure_id_fkey"
            columns: ["engagement_procedure_id"]
            isOneToOne: false
            referencedRelation: "audit_engagement_procedures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_risk_procedure_links_risk_id_fkey"
            columns: ["risk_id"]
            isOneToOne: false
            referencedRelation: "audit_risks"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_risks: {
        Row: {
          assertions: Json
          created_at: string
          created_by: string | null
          description: string
          engagement_id: string
          financial_statement_area: string | null
          id: string
          impact: string | null
          likelihood: string | null
          planned_response: string | null
          significant_risk: boolean
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assertions?: Json
          created_at?: string
          created_by?: string | null
          description?: string
          engagement_id: string
          financial_statement_area?: string | null
          id?: string
          impact?: string | null
          likelihood?: string | null
          planned_response?: string | null
          significant_risk?: boolean
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assertions?: Json
          created_at?: string
          created_by?: string | null
          description?: string
          engagement_id?: string
          financial_statement_area?: string | null
          id?: string
          impact?: string | null
          likelihood?: string | null
          planned_response?: string | null
          significant_risk?: boolean
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_risks_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "engagements"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_signoffs: {
        Row: {
          comments: string | null
          decision: string
          engagement_procedure_id: string
          id: string
          result_id: string | null
          reviewer_id: string
          signed_at: string
        }
        Insert: {
          comments?: string | null
          decision: string
          engagement_procedure_id: string
          id?: string
          result_id?: string | null
          reviewer_id: string
          signed_at?: string
        }
        Update: {
          comments?: string | null
          decision?: string
          engagement_procedure_id?: string
          id?: string
          result_id?: string | null
          reviewer_id?: string
          signed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_signoffs_engagement_procedure_id_fkey"
            columns: ["engagement_procedure_id"]
            isOneToOne: false
            referencedRelation: "audit_engagement_procedures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_signoffs_result_id_fkey"
            columns: ["result_id"]
            isOneToOne: false
            referencedRelation: "audit_procedure_results"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_workpapers: {
        Row: {
          category: string
          created_at: string
          engagement_id: string
          file_path: string | null
          id: string
          notes: string | null
          title: string
          updated_at: string
          updated_by: string | null
          uploaded_by: string | null
          version: number
        }
        Insert: {
          category?: string
          created_at?: string
          engagement_id: string
          file_path?: string | null
          id?: string
          notes?: string | null
          title: string
          updated_at?: string
          updated_by?: string | null
          uploaded_by?: string | null
          version?: number
        }
        Update: {
          category?: string
          created_at?: string
          engagement_id?: string
          file_path?: string | null
          id?: string
          notes?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
          uploaded_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "audit_workpapers_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "engagements"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_events: {
        Row: {
          assigned_to: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          engagement_id: string | null
          event_date: string
          event_time: string | null
          id: string
          notes: string | null
          recurrence: string
          title: string
          type: string
          visibility: string
        }
        Insert: {
          assigned_to?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          engagement_id?: string | null
          event_date: string
          event_time?: string | null
          id?: string
          notes?: string | null
          recurrence?: string
          title: string
          type?: string
          visibility?: string
        }
        Update: {
          assigned_to?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          engagement_id?: string | null
          event_date?: string
          event_time?: string | null
          id?: string
          notes?: string | null
          recurrence?: string
          title?: string
          type?: string
          visibility?: string
        }
        Relationships: []
      }
      chat_channel_members: {
        Row: {
          channel_id: string
          cleared_at: string | null
          created_at: string
          hidden_at: string | null
          id: string
          last_read_at: string | null
          user_id: string
        }
        Insert: {
          channel_id: string
          cleared_at?: string | null
          created_at?: string
          hidden_at?: string | null
          id?: string
          last_read_at?: string | null
          user_id: string
        }
        Update: {
          channel_id?: string
          cleared_at?: string | null
          created_at?: string
          hidden_at?: string | null
          id?: string
          last_read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_channel_members_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_channels: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string | null
          id: string
          kind: string
          name: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          name?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_channels_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_message_hides: {
        Row: {
          created_at: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_message_hides_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          attachment_name: string | null
          attachment_path: string | null
          body: string | null
          channel_id: string
          created_at: string
          id: string
          mentioned_user_ids: string[]
          sender_id: string
        }
        Insert: {
          attachment_name?: string | null
          attachment_path?: string | null
          body?: string | null
          channel_id: string
          created_at?: string
          id?: string
          mentioned_user_ids?: string[]
          sender_id: string
        }
        Update: {
          attachment_name?: string | null
          attachment_path?: string | null
          body?: string | null
          channel_id?: string
          created_at?: string
          id?: string
          mentioned_user_ids?: string[]
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      client_assignments: {
        Row: {
          client_id: string
          created_at: string
          id: string
          role_on_engagement: string | null
          user_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          role_on_engagement?: string | null
          user_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          role_on_engagement?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_assignments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_contacts: {
        Row: {
          client_id: string
          email: string | null
          id: string
          name: string
          phone: string | null
          role: string | null
        }
        Insert: {
          client_id: string
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          role?: string | null
        }
        Update: {
          client_id?: string
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_contacts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_obligation_assignees: {
        Row: {
          assigned_by: string | null
          client_id: string
          created_at: string
          id: string
          tax_type: string
          user_id: string
        }
        Insert: {
          assigned_by?: string | null
          client_id: string
          created_at?: string
          id?: string
          tax_type: string
          user_id: string
        }
        Update: {
          assigned_by?: string | null
          client_id?: string
          created_at?: string
          id?: string
          tax_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_obligation_assignees_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_obligation_assignees_tax_type_fkey"
            columns: ["tax_type"]
            isOneToOne: false
            referencedRelation: "tax_policies"
            referencedColumns: ["tax_type"]
          },
        ]
      }
      client_obligation_contacts: {
        Row: {
          client_id: string
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          tax_type: string
        }
        Insert: {
          client_id: string
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          tax_type: string
        }
        Update: {
          client_id?: string
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          tax_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_obligation_contacts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_obligation_contacts_tax_type_fkey"
            columns: ["tax_type"]
            isOneToOne: false
            referencedRelation: "tax_policies"
            referencedColumns: ["tax_type"]
          },
        ]
      }
      client_obligation_logins: {
        Row: {
          client_id: string
          login_email: string | null
          login_password: string | null
          tax_type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          client_id: string
          login_email?: string | null
          login_password?: string | null
          tax_type: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          client_id?: string
          login_email?: string | null
          login_password?: string | null
          tax_type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_obligation_logins_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_obligation_logins_tax_type_fkey"
            columns: ["tax_type"]
            isOneToOne: false
            referencedRelation: "tax_policies"
            referencedColumns: ["tax_type"]
          },
        ]
      }
      client_tax_obligations: {
        Row: {
          active: boolean
          client_id: string
          created_at: string
          id: string
          notes: string | null
          tax_type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          client_id: string
          created_at?: string
          id?: string
          notes?: string | null
          tax_type: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          client_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          tax_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_tax_obligations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_tax_obligations_tax_type_fkey"
            columns: ["tax_type"]
            isOneToOne: false
            referencedRelation: "tax_policies"
            referencedColumns: ["tax_type"]
          },
        ]
      }
      clients: {
        Row: {
          client_type: string
          company_name: string
          created_at: string
          created_by: string | null
          email: string | null
          engagement_type: string | null
          first_name: string | null
          id: string
          id_number: string | null
          industry: string | null
          is_paused: boolean
          kra_pin: string | null
          last_name: string | null
          notes: string | null
          paused_at: string | null
          paused_by: string | null
          phone: string | null
          portal_password_hash: string | null
          portal_password_updated_at: string | null
          portal_password_updated_by: string | null
          reg_number: string | null
          status: Database["public"]["Enums"]["client_status"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          client_type?: string
          company_name: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          engagement_type?: string | null
          first_name?: string | null
          id?: string
          id_number?: string | null
          industry?: string | null
          is_paused?: boolean
          kra_pin?: string | null
          last_name?: string | null
          notes?: string | null
          paused_at?: string | null
          paused_by?: string | null
          phone?: string | null
          portal_password_hash?: string | null
          portal_password_updated_at?: string | null
          portal_password_updated_by?: string | null
          reg_number?: string | null
          status?: Database["public"]["Enums"]["client_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          client_type?: string
          company_name?: string
          created_at?: string
          created_by?: string | null
          email?: string | null
          engagement_type?: string | null
          first_name?: string | null
          id?: string
          id_number?: string | null
          industry?: string | null
          is_paused?: boolean
          kra_pin?: string | null
          last_name?: string | null
          notes?: string | null
          paused_at?: string | null
          paused_by?: string | null
          phone?: string | null
          portal_password_hash?: string | null
          portal_password_updated_at?: string | null
          portal_password_updated_by?: string | null
          reg_number?: string | null
          status?: Database["public"]["Enums"]["client_status"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      compliance_events: {
        Row: {
          category: string | null
          event_date: string
          id: string
          notes: string | null
          recurrence: string
          title: string
        }
        Insert: {
          category?: string | null
          event_date: string
          id?: string
          notes?: string | null
          recurrence?: string
          title: string
        }
        Update: {
          category?: string | null
          event_date?: string
          id?: string
          notes?: string | null
          recurrence?: string
          title?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          advisory_project_id: string | null
          category: string
          client_id: string | null
          confidentiality: string
          created_at: string
          document_group: string
          engagement_id: string | null
          expires_on: string | null
          file_path: string
          id: string
          period_label: string | null
          service_line: string | null
          service_project_id: string | null
          storage_bucket: string
          tax_return_id: string | null
          title: string
          updated_at: string
          updated_by: string | null
          uploaded_by: string | null
          version: number
        }
        Insert: {
          advisory_project_id?: string | null
          category?: string
          client_id?: string | null
          confidentiality?: string
          created_at?: string
          document_group?: string
          engagement_id?: string | null
          expires_on?: string | null
          file_path: string
          id?: string
          period_label?: string | null
          service_line?: string | null
          service_project_id?: string | null
          storage_bucket?: string
          tax_return_id?: string | null
          title: string
          updated_at?: string
          updated_by?: string | null
          uploaded_by?: string | null
          version?: number
        }
        Update: {
          advisory_project_id?: string | null
          category?: string
          client_id?: string | null
          confidentiality?: string
          created_at?: string
          document_group?: string
          engagement_id?: string | null
          expires_on?: string | null
          file_path?: string
          id?: string
          period_label?: string | null
          service_line?: string | null
          service_project_id?: string | null
          storage_bucket?: string
          tax_return_id?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
          uploaded_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "documents_advisory_project_id_fkey"
            columns: ["advisory_project_id"]
            isOneToOne: false
            referencedRelation: "advisory_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_service_project_id_fkey"
            columns: ["service_project_id"]
            isOneToOne: false
            referencedRelation: "service_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_tax_return_id_fkey"
            columns: ["tax_return_id"]
            isOneToOne: false
            referencedRelation: "tax_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      engagements: {
        Row: {
          assigned_to: string | null
          client_id: string
          completion_pct: number
          created_at: string
          created_by: string | null
          due_date: string | null
          id: string
          invoice_id: string | null
          notes: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["engagement_status"]
          title: string
          type: Database["public"]["Enums"]["engagement_type"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          assigned_to?: string | null
          client_id: string
          completion_pct?: number
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["engagement_status"]
          title: string
          type: Database["public"]["Enums"]["engagement_type"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          assigned_to?: string | null
          client_id?: string
          completion_pct?: number
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["engagement_status"]
          title?: string
          type?: Database["public"]["Enums"]["engagement_type"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "engagements_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagements_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_documents: {
        Row: {
          created_at: string
          doc_type: string
          employee_id: string
          file_path: string
          id: string
          title: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          doc_type?: string
          employee_id: string
          file_path: string
          id?: string
          title: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          doc_type?: string
          employee_id?: string
          file_path?: string
          id?: string
          title?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hr_documents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "leave_balances"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "hr_documents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_employment: {
        Row: {
          bank_account: string | null
          bank_name: string | null
          date_hired: string | null
          date_of_birth: string | null
          employee_id: string
          employee_no: string | null
          employment_status: string
          employment_type: string
          gender: string | null
          gross_salary: number | null
          kra_pin: string | null
          manager_id: string | null
          national_id: string | null
          next_of_kin_name: string | null
          next_of_kin_phone: string | null
          salary_currency: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          bank_account?: string | null
          bank_name?: string | null
          date_hired?: string | null
          date_of_birth?: string | null
          employee_id: string
          employee_no?: string | null
          employment_status?: string
          employment_type?: string
          gender?: string | null
          gross_salary?: number | null
          kra_pin?: string | null
          manager_id?: string | null
          national_id?: string | null
          next_of_kin_name?: string | null
          next_of_kin_phone?: string | null
          salary_currency?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          bank_account?: string | null
          bank_name?: string | null
          date_hired?: string | null
          date_of_birth?: string | null
          employee_id?: string
          employee_no?: string | null
          employment_status?: string
          employment_type?: string
          gender?: string | null
          gross_salary?: number | null
          kra_pin?: string | null
          manager_id?: string | null
          national_id?: string | null
          next_of_kin_name?: string | null
          next_of_kin_phone?: string | null
          salary_currency?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hr_employment_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "leave_balances"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "hr_employment_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_employment_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "leave_balances"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "hr_employment_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ict_assets: {
        Row: {
          assigned_to: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          purchase_date: string | null
          quantity: number
          unit_cost: number | null
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          purchase_date?: string | null
          quantity?: number
          unit_cost?: number | null
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          purchase_date?: string | null
          quantity?: number
          unit_cost?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      ict_case_controls: {
        Row: {
          assigned_to: string | null
          category: string
          completed_at: string | null
          completed_by: string | null
          control_key: string
          created_at: string
          created_by: string | null
          due_date: string | null
          evidence_hint: string | null
          evidence_note: string | null
          guidance: string | null
          id: string
          mandatory: boolean
          requires_evidence: boolean
          requires_verification: boolean
          sort_order: number
          status: string
          template_control_id: string | null
          ticket_id: string
          title: string
          updated_at: string
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          assigned_to?: string | null
          category?: string
          completed_at?: string | null
          completed_by?: string | null
          control_key: string
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          evidence_hint?: string | null
          evidence_note?: string | null
          guidance?: string | null
          id?: string
          mandatory?: boolean
          requires_evidence?: boolean
          requires_verification?: boolean
          sort_order?: number
          status?: string
          template_control_id?: string | null
          ticket_id: string
          title: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          assigned_to?: string | null
          category?: string
          completed_at?: string | null
          completed_by?: string | null
          control_key?: string
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          evidence_hint?: string | null
          evidence_note?: string | null
          guidance?: string | null
          id?: string
          mandatory?: boolean
          requires_evidence?: boolean
          requires_verification?: boolean
          sort_order?: number
          status?: string
          template_control_id?: string | null
          ticket_id?: string
          title?: string
          updated_at?: string
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ict_case_controls_template_control_id_fkey"
            columns: ["template_control_id"]
            isOneToOne: false
            referencedRelation: "ict_template_controls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ict_case_controls_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "ict_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ict_knowledge_articles: {
        Row: {
          active: boolean
          category: string
          created_at: string
          created_by: string | null
          id: string
          slug: string
          steps: string[]
          summary: string
          tags: string
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          slug: string
          steps?: string[]
          summary: string
          tags?: string
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          slug?: string
          steps?: string[]
          summary?: string
          tags?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      ict_password_vault: {
        Row: {
          created_at: string
          created_by: string | null
          encrypted_data: string
          id: string
          iv: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          encrypted_data: string
          id?: string
          iv: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          encrypted_data?: string
          id?: string
          iv?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      ict_password_vault_audit: {
        Row: {
          action: string
          actor_id: string | null
          id: number
          occurred_at: string
          vault_entry_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          id?: never
          occurred_at?: string
          vault_entry_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          id?: never
          occurred_at?: string
          vault_entry_id?: string | null
        }
        Relationships: []
      }
      ict_password_vault_config: {
        Row: {
          created_at: string
          created_by: string | null
          id: boolean
          salt: string
          verification_ciphertext: string
          verification_iv: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: boolean
          salt: string
          verification_ciphertext: string
          verification_iv: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: boolean
          salt?: string
          verification_ciphertext?: string
          verification_iv?: string
        }
        Relationships: []
      }
      ict_service_desk_team: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ict_service_templates: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          service_type: string
          sort_order: number
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          service_type: string
          sort_order?: number
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          service_type?: string
          sort_order?: number
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      ict_template_controls: {
        Row: {
          active: boolean
          category: string
          control_key: string
          created_at: string
          evidence_hint: string | null
          guidance: string | null
          id: string
          mandatory: boolean
          requires_evidence: boolean
          requires_verification: boolean
          sort_order: number
          template_id: string
          title: string
        }
        Insert: {
          active?: boolean
          category?: string
          control_key: string
          created_at?: string
          evidence_hint?: string | null
          guidance?: string | null
          id?: string
          mandatory?: boolean
          requires_evidence?: boolean
          requires_verification?: boolean
          sort_order?: number
          template_id: string
          title: string
        }
        Update: {
          active?: boolean
          category?: string
          control_key?: string
          created_at?: string
          evidence_hint?: string | null
          guidance?: string | null
          id?: string
          mandatory?: boolean
          requires_evidence?: boolean
          requires_verification?: boolean
          sort_order?: number
          template_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "ict_template_controls_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "ict_service_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      ict_tickets: {
        Row: {
          assigned_to: string | null
          category: string | null
          created_at: string
          description: string | null
          id: string
          priority: string | null
          reported_by: string
          service_type: string
          status: string
          ticket_number: string | null
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          priority?: string | null
          reported_by: string
          service_type?: string
          status?: string
          ticket_number?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          priority?: string | null
          reported_by?: string
          service_type?: string
          status?: string
          ticket_number?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      invoice_handlers: {
        Row: {
          created_at: string
          id: string
          invoice_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invoice_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_handlers_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          amount: number
          created_at: string
          description: string
          id: string
          invoice_id: string
          item_name: string | null
          quantity: number
          service_date: string | null
          sort_order: number
          tax_amount: number
          tax_code: string
          unit_price: number
        }
        Insert: {
          amount?: number
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          item_name?: string | null
          quantity?: number
          service_date?: string | null
          sort_order?: number
          tax_amount?: number
          tax_code?: string
          unit_price?: number
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          item_name?: string | null
          quantity?: number
          service_date?: string | null
          sort_order?: number
          tax_amount?: number
          tax_code?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_paid: number
          client_id: string
          created_at: string
          created_by: string | null
          currency: string
          due_date: string
          id: string
          invoice_number: string
          issue_date: string
          location: string | null
          memo: string | null
          notes: string | null
          paid_at: string | null
          service_line: string | null
          status: string
          subtotal: number
          total: number
          updated_at: string
          updated_by: string | null
          vat_amount: number
          vat_rate: number
        }
        Insert: {
          amount_paid?: number
          client_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          due_date: string
          id?: string
          invoice_number: string
          issue_date?: string
          location?: string | null
          memo?: string | null
          notes?: string | null
          paid_at?: string | null
          service_line?: string | null
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
          updated_by?: string | null
          vat_amount?: number
          vat_rate?: number
        }
        Update: {
          amount_paid?: number
          client_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          due_date?: string
          id?: string
          invoice_number?: string
          issue_date?: string
          location?: string | null
          memo?: string | null
          notes?: string | null
          paid_at?: string | null
          service_line?: string | null
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
          updated_by?: string | null
          vat_amount?: number
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_requests: {
        Row: {
          archive_reason: string | null
          archived_at: string | null
          archived_by: string | null
          balance_reset_at: string | null
          balance_reset_by: string | null
          balance_reset_reason: string | null
          created_at: string
          days: number
          decided_at: string | null
          decided_by: string | null
          decision_notes: string | null
          employee_id: string | null
          employee_name_snapshot: string | null
          end_date: string
          id: string
          leave_type_id: string
          reason: string | null
          reliever_decided_at: string | null
          reliever_decided_by: string | null
          reliever_decision_notes: string | null
          reliever_id: string | null
          start_date: string
          status: string
          transferred_milestones_count: number
          transferred_tasks_count: number
          transferred_tax_returns_count: number
        }
        Insert: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          balance_reset_at?: string | null
          balance_reset_by?: string | null
          balance_reset_reason?: string | null
          created_at?: string
          days: number
          decided_at?: string | null
          decided_by?: string | null
          decision_notes?: string | null
          employee_id?: string | null
          employee_name_snapshot?: string | null
          end_date: string
          id?: string
          leave_type_id: string
          reason?: string | null
          reliever_decided_at?: string | null
          reliever_decided_by?: string | null
          reliever_decision_notes?: string | null
          reliever_id?: string | null
          start_date: string
          status?: string
          transferred_milestones_count?: number
          transferred_tasks_count?: number
          transferred_tax_returns_count?: number
        }
        Update: {
          archive_reason?: string | null
          archived_at?: string | null
          archived_by?: string | null
          balance_reset_at?: string | null
          balance_reset_by?: string | null
          balance_reset_reason?: string | null
          created_at?: string
          days?: number
          decided_at?: string | null
          decided_by?: string | null
          decision_notes?: string | null
          employee_id?: string | null
          employee_name_snapshot?: string | null
          end_date?: string
          id?: string
          leave_type_id?: string
          reason?: string | null
          reliever_decided_at?: string | null
          reliever_decided_by?: string | null
          reliever_decision_notes?: string | null
          reliever_id?: string | null
          start_date?: string
          status?: string
          transferred_milestones_count?: number
          transferred_tasks_count?: number
          transferred_tax_returns_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "leave_requests_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "leave_balances"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "leave_requests_archived_by_fkey"
            columns: ["archived_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_balance_reset_by_fkey"
            columns: ["balance_reset_by"]
            isOneToOne: false
            referencedRelation: "leave_balances"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "leave_requests_balance_reset_by_fkey"
            columns: ["balance_reset_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "leave_balances"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "leave_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "leave_balances"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "leave_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_balances"
            referencedColumns: ["leave_type_id"]
          },
          {
            foreignKeyName: "leave_requests_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_reliever_decided_by_fkey"
            columns: ["reliever_decided_by"]
            isOneToOne: false
            referencedRelation: "leave_balances"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "leave_requests_reliever_decided_by_fkey"
            columns: ["reliever_decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_reliever_id_fkey"
            columns: ["reliever_id"]
            isOneToOne: false
            referencedRelation: "leave_balances"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "leave_requests_reliever_id_fkey"
            columns: ["reliever_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_types: {
        Row: {
          active: boolean
          annual_days: number
          eligible_gender: string | null
          id: string
          name: string
          paid: boolean
          sort_order: number
        }
        Insert: {
          active?: boolean
          annual_days?: number
          eligible_gender?: string | null
          id?: string
          name: string
          paid?: boolean
          sort_order?: number
        }
        Update: {
          active?: boolean
          annual_days?: number
          eligible_gender?: string | null
          id?: string
          name?: string
          paid?: boolean
          sort_order?: number
        }
        Relationships: []
      }
      notifications: {
        Row: {
          actor_id: string | null
          body: string | null
          created_at: string
          dedupe_key: string | null
          id: string
          link: string | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          body?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: string
          link?: string | null
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          body?: string | null
          created_at?: string
          dedupe_key?: string | null
          id?: string
          link?: string | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          client_id: string
          created_at: string
          id: string
          invoice_id: string | null
          method: string
          notes: string | null
          payment_date: string
          receipt_path: string | null
          receipt_url: string | null
          recorded_by: string | null
          reference: string | null
        }
        Insert: {
          amount: number
          client_id: string
          created_at?: string
          id?: string
          invoice_id?: string | null
          method?: string
          notes?: string | null
          payment_date?: string
          receipt_path?: string | null
          receipt_url?: string | null
          recorded_by?: string | null
          reference?: string | null
        }
        Update: {
          amount?: number
          client_id?: string
          created_at?: string
          id?: string
          invoice_id?: string | null
          method?: string
          notes?: string | null
          payment_date?: string
          receipt_path?: string | null
          receipt_url?: string | null
          recorded_by?: string | null
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      payslips: {
        Row: {
          created_at: string
          deductions: Json
          employee_id: string
          file_path: string | null
          gross_pay: number | null
          id: string
          net_pay: number | null
          period: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          deductions?: Json
          employee_id: string
          file_path?: string | null
          gross_pay?: number | null
          id?: string
          net_pay?: number | null
          period: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          deductions?: Json
          employee_id?: string
          file_path?: string | null
          gross_pay?: number | null
          id?: string
          net_pay?: number | null
          period?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payslips_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "leave_balances"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "payslips_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          department: string | null
          full_name: string | null
          id: string
          job_title: string | null
          phone: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          department?: string | null
          full_name?: string | null
          id: string
          job_title?: string | null
          phone?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          department?: string | null
          full_name?: string | null
          id?: string
          job_title?: string | null
          phone?: string | null
        }
        Relationships: []
      }
      quick_links: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          sort_order: number
          title: string
          updated_at: string
          url: string
        }
        Insert: {
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          sort_order?: number
          title: string
          updated_at?: string
          url: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          sort_order?: number
          title?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      service_milestone_documents: {
        Row: {
          created_at: string
          file_path: string
          id: string
          milestone_id: string
          title: string
          uploaded_by: string | null
          verified: boolean
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          created_at?: string
          file_path: string
          id?: string
          milestone_id: string
          title: string
          uploaded_by?: string | null
          verified?: boolean
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          created_at?: string
          file_path?: string
          id?: string
          milestone_id?: string
          title?: string
          uploaded_by?: string | null
          verified?: boolean
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_milestone_documents_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "service_milestones"
            referencedColumns: ["id"]
          },
        ]
      }
      service_milestones: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          created_at: string
          done: boolean
          due_date: string | null
          id: string
          notes: string | null
          project_id: string
          stage: string | null
          title: string
          verified: boolean
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          done?: boolean
          due_date?: string | null
          id?: string
          notes?: string | null
          project_id: string
          stage?: string | null
          title: string
          verified?: boolean
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          done?: boolean
          due_date?: string | null
          id?: string
          notes?: string | null
          project_id?: string
          stage?: string | null
          title?: string
          verified?: boolean
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "service_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      service_projects: {
        Row: {
          client_id: string
          closed_at: string | null
          closed_by: string | null
          closure_notes: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          invoice_id: string | null
          module: string
          service_type: string
          stage: string
          start_date: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          client_id: string
          closed_at?: string | null
          closed_by?: string | null
          closure_notes?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          invoice_id?: string | null
          module: string
          service_type?: string
          stage?: string
          start_date?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          closed_at?: string | null
          closed_by?: string | null
          closure_notes?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          invoice_id?: string | null
          module?: string
          service_type?: string
          stage?: string
          start_date?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_projects_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      task_comments: {
        Row: {
          action: string | null
          ask_guidance: boolean
          author_id: string | null
          body: string
          created_at: string
          id: string
          kind: string
          task_id: string
        }
        Insert: {
          action?: string | null
          ask_guidance?: boolean
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          kind?: string
          task_id: string
        }
        Update: {
          action?: string | null
          ask_guidance?: boolean
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          kind?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_outputs: {
        Row: {
          created_at: string
          file_name: string
          file_path: string
          id: string
          is_final: boolean
          note: string | null
          task_id: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_name: string
          file_path: string
          id?: string
          is_final?: boolean
          note?: string | null
          task_id: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string
          file_path?: string
          id?: string
          is_final?: boolean
          note?: string | null
          task_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_outputs_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_subtasks: {
        Row: {
          assigned_to: string | null
          created_at: string
          created_by: string | null
          done: boolean
          done_at: string | null
          due_date: string | null
          id: string
          task_id: string
          title: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          done?: boolean
          done_at?: string | null
          due_date?: string | null
          id?: string
          task_id: string
          title: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string | null
          done?: boolean
          done_at?: string | null
          due_date?: string | null
          id?: string
          task_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_subtasks_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_to: string | null
          client_id: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          engagement_id: string | null
          follow_up_on: string | null
          id: string
          is_overdue: boolean
          needs_guidance: boolean
          priority: Database["public"]["Enums"]["task_priority"]
          progress: number
          stage: string | null
          status: Database["public"]["Enums"]["task_status"]
          supervisor_id: string | null
          title: string
          updated_at: string
          updated_by: string | null
          waiting_reason: string | null
          waiting_since: string | null
          week_start: string | null
        }
        Insert: {
          assigned_to?: string | null
          client_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          engagement_id?: string | null
          follow_up_on?: string | null
          id?: string
          is_overdue?: boolean
          needs_guidance?: boolean
          priority?: Database["public"]["Enums"]["task_priority"]
          progress?: number
          stage?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          supervisor_id?: string | null
          title: string
          updated_at?: string
          updated_by?: string | null
          waiting_reason?: string | null
          waiting_since?: string | null
          week_start?: string | null
        }
        Update: {
          assigned_to?: string | null
          client_id?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          engagement_id?: string | null
          follow_up_on?: string | null
          id?: string
          is_overdue?: boolean
          needs_guidance?: boolean
          priority?: Database["public"]["Enums"]["task_priority"]
          progress?: number
          stage?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          supervisor_id?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
          waiting_reason?: string | null
          waiting_since?: string | null
          week_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "engagements"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_policies: {
        Row: {
          active: boolean
          cadence: string
          due_day: number
          label: string
          sort_order: number
          tax_type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          cadence?: string
          due_day?: number
          label: string
          sort_order?: number
          tax_type: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          cadence?: string
          due_day?: number
          label?: string
          sort_order?: number
          tax_type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      tax_return_assignees: {
        Row: {
          assigned_by: string | null
          created_at: string
          id: string
          role: string | null
          tax_return_id: string
          user_id: string
        }
        Insert: {
          assigned_by?: string | null
          created_at?: string
          id?: string
          role?: string | null
          tax_return_id: string
          user_id: string
        }
        Update: {
          assigned_by?: string | null
          created_at?: string
          id?: string
          role?: string | null
          tax_return_id?: string
          user_id?: string
        }
        Relationships: []
      }
      tax_returns: {
        Row: {
          ack_file_path: string | null
          assigned_at: string | null
          assigned_by: string | null
          assigned_to: string | null
          client_id: string
          created_at: string
          created_by: string | null
          due_date: string
          filed_at: string | null
          filed_by: string | null
          id: string
          invoice_id: string | null
          notes: string | null
          period_end: string | null
          period_start: string | null
          renewed_to_id: string | null
          return_type: string
          status: Database["public"]["Enums"]["tax_return_status"]
        }
        Insert: {
          ack_file_path?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_to?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          due_date: string
          filed_at?: string | null
          filed_by?: string | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
          period_end?: string | null
          period_start?: string | null
          renewed_to_id?: string | null
          return_type: string
          status?: Database["public"]["Enums"]["tax_return_status"]
        }
        Update: {
          ack_file_path?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_to?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          due_date?: string
          filed_at?: string | null
          filed_by?: string | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
          period_end?: string | null
          period_start?: string | null
          renewed_to_id?: string | null
          return_type?: string
          status?: Database["public"]["Enums"]["tax_return_status"]
        }
        Relationships: [
          {
            foreignKeyName: "tax_returns_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_returns_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_returns_renewed_to_id_fkey"
            columns: ["renewed_to_id"]
            isOneToOne: false
            referencedRelation: "tax_returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_returns_return_type_fkey"
            columns: ["return_type"]
            isOneToOne: false
            referencedRelation: "tax_policies"
            referencedColumns: ["tax_type"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      leave_balances: {
        Row: {
          employee_id: string | null
          entitled_days: number | null
          leave_type_id: string | null
          leave_type_name: string | null
          remaining_days: number | null
          used_days: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      audit_record_procedure_signoff: {
        Args: {
          p_comments?: string
          p_decision: string
          p_engagement_procedure_id: string
        }
        Returns: undefined
      }
      can_access_chat_channel: {
        Args: { _channel_id: string; _user_id: string }
        Returns: boolean
      }
      can_access_client: { Args: { _client_id: string }; Returns: boolean }
      can_access_financials: { Args: { _user_id: string }; Returns: boolean }
      can_delete_record: {
        Args: { _created_by: string; _module: string; _user_id: string }
        Returns: boolean
      }
      can_read_chat_channel: {
        Args: { _channel_id: string; _user_id: string }
        Returns: boolean
      }
      can_view_module: {
        Args: { _module: string; _user_id: string }
        Returns: boolean
      }
      can_view_module_all: {
        Args: { _module: string; _user_id: string }
        Returns: boolean
      }
      can_work_advisory: { Args: { _user_id: string }; Returns: boolean }
      can_work_ict: { Args: { _user_id: string }; Returns: boolean }
      chat_attachment_channel: { Args: { _name: string }; Returns: string }
      clear_chat_for_me: { Args: { _channel_id: string }; Returns: undefined }
      create_completion_invoice: {
        Args: {
          _amount: number
          _description: string
          _source: string
          _source_id: string
          _vat_rate?: number
        }
        Returns: string
      }
      create_tax_filing_invoice: {
        Args: { _items: Json; _vat_rate?: number }
        Returns: Json
      }
      decide_leave_request: {
        Args: { _approve: boolean; _id: string; _notes?: string }
        Returns: undefined
      }
      delete_chat_for_me: { Args: { _channel_id: string }; Returns: undefined }
      delete_leave_record: { Args: { _id: string }; Returns: undefined }
      document_path_client_accessible: {
        Args: { _path: string }
        Returns: boolean
      }
      ensure_current_tax_filing_periods: { Args: never; Returns: undefined }
      get_module_rank: {
        Args: { _module: string; _user_id: string }
        Returns: number
      }
      get_or_create_dm: { Args: { _other_user_id: string }; Returns: string }
      has_full_module: {
        Args: { _module: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      hide_chat_message_for_me: {
        Args: { _message_id: string }
        Returns: undefined
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_hr_manager: { Args: { _user_id: string }; Returns: boolean }
      is_ict_team: { Args: { _user_id: string }; Returns: boolean }
      is_module_assigned_only: {
        Args: { _module: string; _user_id: string }
        Returns: boolean
      }
      is_my_client: {
        Args: { _client_id: string; _user_id: string }
        Returns: boolean
      }
      is_my_invoice: {
        Args: { _invoice_id: string; _user_id: string }
        Returns: boolean
      }
      is_restricted_document_path: {
        Args: { _bucket: string; _path: string }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      list_leave_relievers: {
        Args: never
        Returns: {
          full_name: string
          id: string
          job_title: string
          roles: string[]
        }[]
      }
      next_invoice_number: { Args: never; Returns: string }
      next_tax_due_date: {
        Args: { _cur_due: string; _type: string }
        Returns: string
      }
      normalize_service_line: { Args: { _v: string }; Returns: string }
      push_deadline_notification: {
        Args: {
          _due: string
          _kind: string
          _link: string
          _record: string
          _title: string
          _today: string
          _user: string
        }
        Returns: undefined
      }
      recompute_invoice: { Args: { _invoice_id: string }; Returns: undefined }
      request_leave: {
        Args: {
          _end_date: string
          _leave_type_id: string
          _reason?: string
          _reliever_id?: string
          _start_date: string
        }
        Returns: string
      }
      reset_leave_balance: {
        Args: {
          _employee_id: string
          _leave_type_id?: string
          _reason?: string
        }
        Returns: number
      }
      seed_ict_ticket_controls: {
        Args: { _service_type: string; _ticket_id: string }
        Returns: number
      }
      send_deadline_reminders: { Args: never; Returns: undefined }
      set_client_portal_password: {
        Args: { _client_id: string; _password: string }
        Returns: undefined
      }
      set_client_tax_obligation: {
        Args: { _active: boolean; _client_id: string; _tax_type: string }
        Returns: undefined
      }
      sync_ict_ticket_checklist: {
        Args: { _ticket_id: string }
        Returns: number
      }
      task_has_access: {
        Args: { _task_id: string; _user_id: string }
        Returns: boolean
      }
      task_is_lead: {
        Args: { _task_id: string; _user_id: string }
        Returns: boolean
      }
      task_is_supervisor: {
        Args: { _task_id: string; _user_id: string }
        Returns: boolean
      }
      task_output_task: { Args: { _name: string }; Returns: string }
      tax_return_cadence: { Args: { _type: string }; Returns: string }
      tax_return_due_day: { Args: { _type: string }; Returns: number }
      tax_return_open_date: {
        Args: { _due: string; _type: string }
        Returns: string
      }
      update_my_employment_info: {
        Args: {
          _bank_account?: string
          _bank_name?: string
          _date_of_birth?: string
          _kra_pin?: string
          _national_id?: string
          _next_of_kin_name?: string
          _next_of_kin_phone?: string
        }
        Returns: undefined
      }
      verify_client_portal_password: {
        Args: { _client_id: string; _password: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "director"
        | "admin"
        | "audit_manager"
        | "tax_consultant"
        | "advisory_officer"
        | "accountant"
        | "accounts_assistant"
        | "intern"
        | "marketing"
        | "tax_assistant"
        | "audit_assistant"
        | "internal_admin"
        | "ict_officer"
      client_status:
        | "not_started"
        | "in_progress"
        | "waiting_for_documents"
        | "under_review"
        | "filed"
        | "completed"
        | "overdue"
        | "urgent"
      engagement_status:
        | "not_started"
        | "in_progress"
        | "under_review"
        | "completed"
      engagement_type: "audit" | "tax" | "advisory"
      task_priority: "low" | "normal" | "high" | "urgent"
      task_status:
        | "todo"
        | "in_progress"
        | "blocked"
        | "done"
        | "waiting_on_client"
      tax_return_status: "pending" | "in_progress" | "filed" | "overdue"
      tax_return_type:
        | "vat"
        | "paye"
        | "corp_tax"
        | "tot"
        | "wht"
        | "rental"
        | "nil"
        | "mri"
        | "nssf"
        | "sha"
        | "etims"
        | "income_tax"
        | "nita"
        | "excise_duty"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: [
        "director",
        "admin",
        "audit_manager",
        "tax_consultant",
        "advisory_officer",
        "accountant",
        "accounts_assistant",
        "intern",
        "marketing",
        "tax_assistant",
        "audit_assistant",
        "internal_admin",
        "ict_officer",
      ],
      client_status: [
        "not_started",
        "in_progress",
        "waiting_for_documents",
        "under_review",
        "filed",
        "completed",
        "overdue",
        "urgent",
      ],
      engagement_status: [
        "not_started",
        "in_progress",
        "under_review",
        "completed",
      ],
      engagement_type: ["audit", "tax", "advisory"],
      task_priority: ["low", "normal", "high", "urgent"],
      task_status: [
        "todo",
        "in_progress",
        "blocked",
        "done",
        "waiting_on_client",
      ],
      tax_return_status: ["pending", "in_progress", "filed", "overdue"],
      tax_return_type: [
        "vat",
        "paye",
        "corp_tax",
        "tot",
        "wht",
        "rental",
        "nil",
        "mri",
        "nssf",
        "sha",
        "etims",
        "income_tax",
        "nita",
        "excise_duty",
      ],
    },
  },
} as const
