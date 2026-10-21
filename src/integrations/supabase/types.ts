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
        }
        Relationships: [
          {
            foreignKeyName: "advisory_projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
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
      audit_review_notes: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          engagement_id: string
          id: string
          resolved: boolean
          stage: string | null
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          engagement_id: string
          id?: string
          resolved?: boolean
          stage?: string | null
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          engagement_id?: string
          id?: string
          resolved?: boolean
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
      audit_workpapers: {
        Row: {
          category: string
          created_at: string
          engagement_id: string
          file_path: string | null
          id: string
          notes: string | null
          title: string
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
        }
        Relationships: []
      }
      chat_channel_members: {
        Row: {
          channel_id: string
          created_at: string
          id: string
          last_read_at: string | null
          user_id: string
        }
        Insert: {
          channel_id: string
          created_at?: string
          id?: string
          last_read_at?: string | null
          user_id: string
        }
        Update: {
          channel_id?: string
          created_at?: string
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
          kind: "team" | "client" | "dm" | "group"
          name: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          kind: "team" | "client" | "dm" | "group"
          name?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: "team" | "client" | "dm" | "group"
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
          sender_id: string
        }
        Insert: {
          attachment_name?: string | null
          attachment_path?: string | null
          body?: string | null
          channel_id: string
          created_at?: string
          id?: string
          sender_id: string
        }
        Update: {
          attachment_name?: string | null
          attachment_path?: string | null
          body?: string | null
          channel_id?: string
          created_at?: string
          id?: string
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
          assigned_by: string | null
          client_id: string
          created_at: string
          id: string
          role_on_engagement: string | null
          user_id: string
        }
        Insert: {
          assigned_by?: string | null
          client_id: string
          created_at?: string
          id?: string
          role_on_engagement?: string | null
          user_id: string
        }
        Update: {
          assigned_by?: string | null
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
          kra_pin: string | null
          last_name: string | null
          notes: string | null
          phone: string | null
          portal_password_hash: string | null
          portal_password_updated_at: string | null
          portal_password_updated_by: string | null
          reg_number: string | null
          status: Database["public"]["Enums"]["client_status"]
          updated_at: string
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
          kra_pin?: string | null
          last_name?: string | null
          notes?: string | null
          phone?: string | null
          portal_password_hash?: string | null
          portal_password_updated_at?: string | null
          portal_password_updated_by?: string | null
          reg_number?: string | null
          status?: Database["public"]["Enums"]["client_status"]
          updated_at?: string
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
          kra_pin?: string | null
          last_name?: string | null
          notes?: string | null
          phone?: string | null
          portal_password_hash?: string | null
          portal_password_updated_at?: string | null
          portal_password_updated_by?: string | null
          reg_number?: string | null
          status?: Database["public"]["Enums"]["client_status"]
          updated_at?: string
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
          client_id: string | null
          created_at: string
          engagement_id: string | null
          file_path: string
          id: string
          title: string
          uploaded_by: string | null
          version: number
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          engagement_id?: string | null
          file_path: string
          id?: string
          title: string
          uploaded_by?: string | null
          version?: number
        }
        Update: {
          client_id?: string | null
          created_at?: string
          engagement_id?: string | null
          file_path?: string
          id?: string
          title?: string
          uploaded_by?: string | null
          version?: number
        }
        Relationships: [
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
        ]
      }
      engagements: {
        Row: {
          client_id: string
          completion_pct: number
          created_at: string
          due_date: string | null
          id: string
          notes: string | null
          signed_off_at: string | null
          signed_off_by: string | null
          signoff_notes: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["engagement_status"]
          title: string
          type: Database["public"]["Enums"]["engagement_type"]
        }
        Insert: {
          client_id: string
          completion_pct?: number
          created_at?: string
          due_date?: string | null
          id?: string
          notes?: string | null
          signed_off_at?: string | null
          signed_off_by?: string | null
          signoff_notes?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["engagement_status"]
          title: string
          type: Database["public"]["Enums"]["engagement_type"]
        }
        Update: {
          client_id?: string
          completion_pct?: number
          created_at?: string
          due_date?: string | null
          id?: string
          notes?: string | null
          signed_off_at?: string | null
          signed_off_by?: string | null
          signoff_notes?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["engagement_status"]
          title?: string
          type?: Database["public"]["Enums"]["engagement_type"]
        }
        Relationships: [
          {
            foreignKeyName: "engagements_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
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
            referencedRelation: "profiles"
            referencedColumns: ["id"]
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
      invoice_items: {
        Row: {
          amount: number
          created_at: string
          description: string
          id: string
          invoice_id: string
          quantity: number
          sort_order: number
          unit_price: number
        }
        Insert: {
          amount?: number
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          quantity?: number
          sort_order?: number
          unit_price?: number
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          quantity?: number
          sort_order?: number
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
          paid_at: string | null
          amount_paid: number
          client_id: string
          created_at: string
          created_by: string | null
          currency: string
          due_date: string
          id: string
          invoice_number: string
          issue_date: string
          notes: string | null
          service_line: string | null
          status: string
          subtotal: number
          total: number
          updated_at: string
          vat_amount: number
          vat_rate: number
        }
        Insert: {
          paid_at?: string | null
          amount_paid?: number
          client_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          due_date: string
          id?: string
          invoice_number: string
          issue_date?: string
          notes?: string | null
          service_line?: string | null
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
          vat_amount?: number
          vat_rate?: number
        }
        Update: {
          paid_at?: string | null
          amount_paid?: number
          client_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          due_date?: string
          id?: string
          invoice_number?: string
          issue_date?: string
          notes?: string | null
          service_line?: string | null
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
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
          created_at: string
          days: number
          decided_at: string | null
          decided_by: string | null
          decision_notes: string | null
          employee_id: string
          end_date: string
          id: string
          leave_type_id: string
          reason: string | null
          reliever_id: string | null
          reliever_decided_by: string | null
          reliever_decided_at: string | null
          reliever_decision_notes: string | null
          start_date: string
          status: string
          transferred_tasks_count: number
          transferred_tax_returns_count: number
          transferred_milestones_count: number
        }
        Insert: {
          created_at?: string
          days: number
          decided_at?: string | null
          decided_by?: string | null
          decision_notes?: string | null
          employee_id: string
          end_date: string
          id?: string
          leave_type_id: string
          reason?: string | null
          reliever_id?: string | null
          reliever_decided_by?: string | null
          reliever_decided_at?: string | null
          reliever_decision_notes?: string | null
          start_date: string
          status?: string
          transferred_tasks_count?: number
          transferred_tax_returns_count?: number
          transferred_milestones_count?: number
        }
        Update: {
          created_at?: string
          days?: number
          decided_at?: string | null
          decided_by?: string | null
          decision_notes?: string | null
          employee_id?: string
          end_date?: string
          id?: string
          leave_type_id?: string
          reason?: string | null
          reliever_id?: string | null
          reliever_decided_by?: string | null
          reliever_decided_at?: string | null
          reliever_decision_notes?: string | null
          start_date?: string
          status?: string
          transferred_tasks_count?: number
          transferred_tax_returns_count?: number
          transferred_milestones_count?: number
        }
        Relationships: [
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
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_reliever_id_fkey"
            columns: ["reliever_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leave_requests_reliever_decided_by_fkey"
            columns: ["reliever_decided_by"]
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
          body: string | null
          created_at: string
          id: string
          link: string | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
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
          module: string
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
          module: string
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
          module?: string
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
        ]
      }
      task_comments: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          task_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          task_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
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
      tasks: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          assigned_to: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          engagement_id: string | null
          id: string
          is_overdue: boolean
          priority: Database["public"]["Enums"]["task_priority"]
          stage: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          assigned_to?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          engagement_id?: string | null
          id?: string
          is_overdue?: boolean
          priority?: Database["public"]["Enums"]["task_priority"]
          stage?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title: string
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          assigned_to?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          engagement_id?: string | null
          id?: string
          is_overdue?: boolean
          priority?: Database["public"]["Enums"]["task_priority"]
          stage?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
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
          filed_at: string | null
          filed_by: string | null
          assigned_at: string | null
          assigned_by: string | null
          ack_file_path: string | null
          assigned_to: string | null
          client_id: string
          created_at: string
          due_date: string
          id: string
          notes: string | null
          period_end: string | null
          period_start: string | null
          return_type: Database["public"]["Enums"]["tax_return_type"]
          status: Database["public"]["Enums"]["tax_return_status"]
        }
        Insert: {
          filed_at?: string | null
          filed_by?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          ack_file_path?: string | null
          assigned_to?: string | null
          client_id: string
          created_at?: string
          due_date: string
          id?: string
          notes?: string | null
          period_end?: string | null
          period_start?: string | null
          return_type: Database["public"]["Enums"]["tax_return_type"]
          status?: Database["public"]["Enums"]["tax_return_status"]
        }
        Update: {
          filed_at?: string | null
          filed_by?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          ack_file_path?: string | null
          assigned_to?: string | null
          client_id?: string
          created_at?: string
          due_date?: string
          id?: string
          notes?: string | null
          period_end?: string | null
          period_start?: string | null
          return_type?: Database["public"]["Enums"]["tax_return_type"]
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
      [_ in never]: never
    }
    Functions: {
      request_leave: {
        Args: { _leave_type_id: string; _start_date: string; _end_date: string; _reason?: string | null; _reliever_id?: string }
        Returns: string
      }
      decide_leave_request: {
        Args: { _id: string; _approve: boolean; _notes?: string | null }
        Returns: undefined
      }
      delete_leave_record: {
        Args: { _id: string }
        Returns: undefined
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      get_or_create_dm: { Args: { _other_user_id: string }; Returns: string }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      next_invoice_number: { Args: never; Returns: string }
      recompute_invoice: { Args: { _invoice_id: string }; Returns: undefined }
      set_client_portal_password: {
        Args: { _client_id: string; _password: string }
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
      task_status: "todo" | "in_progress" | "blocked" | "done"
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
      task_status: ["todo", "in_progress", "blocked", "done"],
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
