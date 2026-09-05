export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      agent_request_files: {
        Row: {
          created_at: string
          filename: string
          id: string
          mime_type: string
          request_id: string
          size_bytes: number
          storage_path: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          filename: string
          id?: string
          mime_type: string
          request_id: string
          size_bytes: number
          storage_path: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          filename?: string
          id?: string
          mime_type?: string
          request_id?: string
          size_bytes?: number
          storage_path?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_request_files_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "agent_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_request_files_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_requests: {
        Row: {
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["agent_request_kind"]
          note: string | null
          payload: Json
          stage: Database["public"]["Enums"]["agent_request_stage"]
          status_note: string | null
          tenant_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["agent_request_kind"]
          note?: string | null
          payload?: Json
          stage?: Database["public"]["Enums"]["agent_request_stage"]
          status_note?: string | null
          tenant_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["agent_request_kind"]
          note?: string | null
          payload?: Json
          stage?: Database["public"]["Enums"]["agent_request_stage"]
          status_note?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          id: string
          payload: Json
          tenant_id: string | null
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          payload?: Json
          tenant_id?: string | null
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          id?: string
          payload?: Json
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      calls: {
        Row: {
          analysis: Json
          caller_name: string | null
          caller_phone: string | null
          created_at: string
          duration_seconds: number
          id: string
          lead_score: number | null
          minutes_counted_at: string | null
          outcome: Database["public"]["Enums"]["call_outcome"] | null
          provider: Database["public"]["Enums"]["voice_provider"]
          provider_call_id: string
          recording_attempts: number
          recording_first_attempt_at: string | null
          recording_last_error: string | null
          recording_next_retry_at: string | null
          recording_path: string | null
          recording_status: string
          started_at: string
          tenant_id: string
          transcript: Json
          vertical: Database["public"]["Enums"]["agent_vertical"]
          voice_agent_id: string | null
        }
        Insert: {
          analysis?: Json
          caller_name?: string | null
          caller_phone?: string | null
          created_at?: string
          duration_seconds?: number
          id?: string
          lead_score?: number | null
          minutes_counted_at?: string | null
          outcome?: Database["public"]["Enums"]["call_outcome"] | null
          provider?: Database["public"]["Enums"]["voice_provider"]
          provider_call_id: string
          recording_attempts?: number
          recording_first_attempt_at?: string | null
          recording_last_error?: string | null
          recording_next_retry_at?: string | null
          recording_path?: string | null
          recording_status?: string
          started_at?: string
          tenant_id: string
          transcript?: Json
          vertical?: Database["public"]["Enums"]["agent_vertical"]
          voice_agent_id?: string | null
        }
        Update: {
          analysis?: Json
          caller_name?: string | null
          caller_phone?: string | null
          created_at?: string
          duration_seconds?: number
          id?: string
          lead_score?: number | null
          minutes_counted_at?: string | null
          outcome?: Database["public"]["Enums"]["call_outcome"] | null
          provider?: Database["public"]["Enums"]["voice_provider"]
          provider_call_id?: string
          recording_attempts?: number
          recording_first_attempt_at?: string | null
          recording_last_error?: string | null
          recording_next_retry_at?: string | null
          recording_path?: string | null
          recording_status?: string
          started_at?: string
          tenant_id?: string
          transcript?: Json
          vertical?: Database["public"]["Enums"]["agent_vertical"]
          voice_agent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calls_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_voice_agent_id_fkey"
            columns: ["voice_agent_id"]
            isOneToOne: false
            referencedRelation: "voice_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      change_requests: {
        Row: {
          created_at: string
          id: string
          message: string
          status: Database["public"]["Enums"]["change_request_status"]
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          status?: Database["public"]["Enums"]["change_request_status"]
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          status?: Database["public"]["Enums"]["change_request_status"]
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "change_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          minutes: number
          number: string | null
          pdf_url: string | null
          period_label: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          stripe_invoice_id: string | null
          tenant_id: string
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          id?: string
          minutes?: number
          number?: string | null
          pdf_url?: string | null
          period_label?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          stripe_invoice_id?: string | null
          tenant_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          minutes?: number
          number?: string | null
          pdf_url?: string | null
          period_label?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          stripe_invoice_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          assigned_to: string | null
          call_id: string | null
          created_at: string
          details: Json
          id: string
          name: string
          position: number
          stage: Database["public"]["Enums"]["lead_stage"]
          summary: string | null
          tags: string[]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          call_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          name: string
          position?: number
          stage?: Database["public"]["Enums"]["lead_stage"]
          summary?: string | null
          tags?: string[]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          call_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          name?: string
          position?: number
          stage?: Database["public"]["Enums"]["lead_stage"]
          summary?: string | null
          tags?: string[]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["membership_role"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["membership_role"]
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["membership_role"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          created_at: string
          id: string
          included_minutes: number
          monthly_price_cents: number
          name: Database["public"]["Enums"]["plan_name"]
          overage_cents_per_min: number
          stripe_price_ids: Json
        }
        Insert: {
          created_at?: string
          id?: string
          included_minutes: number
          monthly_price_cents: number
          name: Database["public"]["Enums"]["plan_name"]
          overage_cents_per_min: number
          stripe_price_ids?: Json
        }
        Update: {
          created_at?: string
          id?: string
          included_minutes?: number
          monthly_price_cents?: number
          name?: Database["public"]["Enums"]["plan_name"]
          overage_cents_per_min?: number
          stripe_price_ids?: Json
        }
        Relationships: []
      }
      platform_admins: {
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
      profiles: {
        Row: {
          avatar_initials: string | null
          created_at: string
          display_name: string | null
          id: string
          theme_pref: string
        }
        Insert: {
          avatar_initials?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          theme_pref?: string
        }
        Update: {
          avatar_initials?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          theme_pref?: string
        }
        Relationships: []
      }
      tenants: {
        Row: {
          branding: Json
          created_at: string
          id: string
          initials: string
          name: string
          plan_id: string | null
          slug: string
          status: Database["public"]["Enums"]["tenant_status"]
        }
        Insert: {
          branding?: Json
          created_at?: string
          id?: string
          initials: string
          name: string
          plan_id?: string | null
          slug: string
          status?: Database["public"]["Enums"]["tenant_status"]
        }
        Update: {
          branding?: Json
          created_at?: string
          id?: string
          initials?: string
          name?: string
          plan_id?: string | null
          slug?: string
          status?: Database["public"]["Enums"]["tenant_status"]
        }
        Relationships: [
          {
            foreignKeyName: "tenants_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_periods: {
        Row: {
          created_at: string
          id: string
          minutes_used: number
          period_end: string
          period_start: string
          stripe_reported_at: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          minutes_used?: number
          period_end: string
          period_start: string
          stripe_reported_at?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          minutes_used?: number
          period_end?: string
          period_start?: string
          stripe_reported_at?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_periods_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_agents: {
        Row: {
          after_hours_behavior: string | null
          business_hours: Json
          created_at: string
          credential_ref: string | null
          crm_connection: Json
          escalation_number: string | null
          id: string
          languages: string[]
          last_synced_at: string | null
          linked_at: string | null
          name: string
          phone_number: string | null
          provider: Database["public"]["Enums"]["voice_provider"]
          provider_agent_id: string | null
          provider_deployment_id: string | null
          qualification_questions: string[]
          recording_retention_months: number
          status: Database["public"]["Enums"]["agent_status"]
          tenant_id: string
          vertical: Database["public"]["Enums"]["agent_vertical"]
          voice_desc: string | null
          webhook_forward_last_at: string | null
          webhook_forward_last_status: number | null
          webhook_forward_url: string | null
          webhook_token: string | null
          webhook_verified_at: string | null
        }
        Insert: {
          after_hours_behavior?: string | null
          business_hours?: Json
          created_at?: string
          credential_ref?: string | null
          crm_connection?: Json
          escalation_number?: string | null
          id?: string
          languages?: string[]
          last_synced_at?: string | null
          linked_at?: string | null
          name: string
          phone_number?: string | null
          provider?: Database["public"]["Enums"]["voice_provider"]
          provider_agent_id?: string | null
          provider_deployment_id?: string | null
          qualification_questions?: string[]
          recording_retention_months?: number
          status?: Database["public"]["Enums"]["agent_status"]
          tenant_id: string
          vertical?: Database["public"]["Enums"]["agent_vertical"]
          voice_desc?: string | null
          webhook_forward_last_at?: string | null
          webhook_forward_last_status?: number | null
          webhook_forward_url?: string | null
          webhook_token?: string | null
          webhook_verified_at?: string | null
        }
        Update: {
          after_hours_behavior?: string | null
          business_hours?: Json
          created_at?: string
          credential_ref?: string | null
          crm_connection?: Json
          escalation_number?: string | null
          id?: string
          languages?: string[]
          last_synced_at?: string | null
          linked_at?: string | null
          name?: string
          phone_number?: string | null
          provider?: Database["public"]["Enums"]["voice_provider"]
          provider_agent_id?: string | null
          provider_deployment_id?: string | null
          qualification_questions?: string[]
          recording_retention_months?: number
          status?: Database["public"]["Enums"]["agent_status"]
          tenant_id?: string
          vertical?: Database["public"]["Enums"]["agent_vertical"]
          voice_desc?: string | null
          webhook_forward_last_at?: string | null
          webhook_forward_last_status?: number | null
          webhook_forward_url?: string | null
          webhook_token?: string | null
          webhook_verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "voice_agents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_call_minutes: {
        Args: { p_minutes: number; p_tenant_id: string }
        Returns: undefined
      }
      auth_tenant_ids: { Args: never; Returns: string[] }
      call_outcome_counts: {
        Args: { p_tenant_id: string; p_voice_agent_id?: string }
        Returns: {
          n: number
          outcome: Database["public"]["Enums"]["call_outcome"]
        }[]
      }
      call_stats_daily: {
        Args: { p_from: string; p_tenant_id: string; p_to: string }
        Returns: {
          bucket: string
          n: number
          outcome: Database["public"]["Enums"]["call_outcome"]
          total_seconds: number
        }[]
      }
      is_platform_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      agent_request_kind: "new_agent" | "document_update"
      agent_request_stage:
        | "submitted"
        | "in_review"
        | "building"
        | "test_ready"
        | "number_pending"
        | "completed"
        | "cancelled"
      agent_status: "live" | "paused"
      agent_vertical: "travel" | "real_estate"
      call_outcome:
        | "inquiry_captured"
        | "quote_requested"
        | "voicemail"
        | "not_a_fit"
        | "site_visit_booked"
        | "transferred_to_human"
      change_request_status: "open" | "done"
      invoice_status: "paid" | "open" | "void"
      lead_stage: "new_inquiry" | "quoted" | "booked" | "traveling"
      membership_role: "owner" | "member"
      plan_name: "starter" | "growth" | "scale"
      tenant_status: "active" | "paused" | "churned"
      voice_provider: "retell" | "sarvam" | "vapi" | "elevenlabs"
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
      agent_request_kind: ["new_agent", "document_update"],
      agent_request_stage: [
        "submitted",
        "in_review",
        "building",
        "test_ready",
        "number_pending",
        "completed",
        "cancelled",
      ],
      agent_status: ["live", "paused"],
      agent_vertical: ["travel", "real_estate"],
      call_outcome: [
        "inquiry_captured",
        "quote_requested",
        "voicemail",
        "not_a_fit",
        "site_visit_booked",
        "transferred_to_human",
      ],
      change_request_status: ["open", "done"],
      invoice_status: ["paid", "open", "void"],
      lead_stage: ["new_inquiry", "quoted", "booked", "traveling"],
      membership_role: ["owner", "member"],
      plan_name: ["starter", "growth", "scale"],
      tenant_status: ["active", "paused", "churned"],
      voice_provider: ["retell", "sarvam", "vapi", "elevenlabs"],
    },
  },
} as const

