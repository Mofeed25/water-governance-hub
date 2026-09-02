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
      billing_logs: {
        Row: {
          amount_yer: number
          consumption_m3: number
          created_at: string
          current_due_yer: number
          id: string
          paid: boolean
          paid_amount_yer: number
          paid_at: string | null
          period: string
          previous_arrears_yer: number
          subscriber_id: string
          tenant_id: string
        }
        Insert: {
          amount_yer?: number
          consumption_m3?: number
          created_at?: string
          current_due_yer?: number
          id?: string
          paid?: boolean
          paid_amount_yer?: number
          paid_at?: string | null
          period: string
          previous_arrears_yer?: number
          subscriber_id: string
          tenant_id: string
        }
        Update: {
          amount_yer?: number
          consumption_m3?: number
          created_at?: string
          current_due_yer?: number
          id?: string
          paid?: boolean
          paid_amount_yer?: number
          paid_at?: string | null
          period?: string
          previous_arrears_yer?: number
          subscriber_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_logs_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "subscribers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_conversations: {
        Row: {
          created_at: string
          id: string
          tenant_id: string | null
          title: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          tenant_id?: string | null
          title?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          tenant_id?: string | null
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
          ui_data: Json | null
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
          ui_data?: Json | null
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
          ui_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      meter_readings: {
        Row: {
          captured_at: string
          consumption_m3: number | null
          gps_lat: number | null
          gps_lng: number | null
          hash_signature: string | null
          id: string
          period: string | null
          photo_url: string | null
          previous_m3: number | null
          reader_id: string | null
          reading_m3: number
          subscriber_id: string
          tenant_id: string
        }
        Insert: {
          captured_at?: string
          consumption_m3?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          hash_signature?: string | null
          id?: string
          period?: string | null
          photo_url?: string | null
          previous_m3?: number | null
          reader_id?: string | null
          reading_m3: number
          subscriber_id: string
          tenant_id: string
        }
        Update: {
          captured_at?: string
          consumption_m3?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          hash_signature?: string | null
          id?: string
          period?: string | null
          photo_url?: string | null
          previous_m3?: number | null
          reader_id?: string | null
          reading_m3?: number
          subscriber_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meter_readings_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "subscribers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meter_readings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          phone?: string | null
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      receipts: {
        Row: {
          amount_words_ar: string | null
          amount_yer: number
          collector_id: string | null
          created_at: string
          hash_signature: string | null
          id: string
          period: string | null
          subscriber_id: string
          tenant_id: string
        }
        Insert: {
          amount_words_ar?: string | null
          amount_yer: number
          collector_id?: string | null
          created_at?: string
          hash_signature?: string | null
          id?: string
          period?: string | null
          subscriber_id: string
          tenant_id: string
        }
        Update: {
          amount_words_ar?: string | null
          amount_yer?: number
          collector_id?: string | null
          created_at?: string
          hash_signature?: string | null
          id?: string
          period?: string | null
          subscriber_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipts_subscriber_id_fkey"
            columns: ["subscriber_id"]
            isOneToOne: false
            referencedRelation: "subscribers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      subscribers: {
        Row: {
          balance_yer: number | null
          created_at: string
          household_size: number | null
          id: string
          meter_serial: string
          name: string
          phone: string | null
          status: string
          tenant_id: string
          zone: string | null
        }
        Insert: {
          balance_yer?: number | null
          created_at?: string
          household_size?: number | null
          id?: string
          meter_serial: string
          name: string
          phone?: string | null
          status?: string
          tenant_id: string
          zone?: string | null
        }
        Update: {
          balance_yer?: number | null
          created_at?: string
          household_size?: number | null
          id?: string
          meter_serial?: string
          name?: string
          phone?: string | null
          status?: string
          tenant_id?: string
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscribers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          active: boolean
          created_at: string
          expires_at: string | null
          id: string
          started_at: string
          tenant_id: string
          tier: Database["public"]["Enums"]["subscription_tier"]
        }
        Insert: {
          active?: boolean
          created_at?: string
          expires_at?: string | null
          id?: string
          started_at?: string
          tenant_id: string
          tier?: Database["public"]["Enums"]["subscription_tier"]
        }
        Update: {
          active?: boolean
          created_at?: string
          expires_at?: string | null
          id?: string
          started_at?: string
          tenant_id?: string
          tier?: Database["public"]["Enums"]["subscription_tier"]
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          directorate: string | null
          established_year: number | null
          households: number | null
          id: string
          name: string
          status: Database["public"]["Enums"]["tenant_status"]
          subscription_tier: Database["public"]["Enums"]["subscription_tier"]
          tariff_per_m3: number | null
        }
        Insert: {
          created_at?: string
          directorate?: string | null
          established_year?: number | null
          households?: number | null
          id?: string
          name: string
          status?: Database["public"]["Enums"]["tenant_status"]
          subscription_tier?: Database["public"]["Enums"]["subscription_tier"]
          tariff_per_m3?: number | null
        }
        Update: {
          created_at?: string
          directorate?: string | null
          established_year?: number | null
          households?: number | null
          id?: string
          name?: string
          status?: Database["public"]["Enums"]["tenant_status"]
          subscription_tier?: Database["public"]["Enums"]["subscription_tier"]
          tariff_per_m3?: number | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
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
      admin_list_users: {
        Args: never
        Returns: {
          email: string
          full_name: string
          id: string
          roles: string[]
          tenant_id: string
          tenant_name: string
        }[]
      }
      admin_revoke_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      admin_set_user_access: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _tenant_id: string
          _user_id: string
        }
        Returns: undefined
      }
      bootstrap_super_admin: { Args: never; Returns: boolean }
      calc_consumption: { Args: { _subscriber_id: string }; Returns: number }
      can_access_tenant: { Args: { _tenant_id: string }; Returns: boolean }
      current_tenant_id: { Args: never; Returns: string }
      generate_invoice: {
        Args: { _period: string; _subscriber_id: string }
        Returns: string
      }
      generate_invoices_for_tenant: {
        Args: { _period: string; _tenant_id: string }
        Returns: number
      }
      governance_score: { Args: { _tenant_id: string }; Returns: Json }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      super_admin_exists: { Args: never; Returns: boolean }
      tenant_is_active: { Args: { _tenant_id: string }; Returns: boolean }
    }
    Enums: {
      app_role:
        | "super_admin"
        | "central_admin"
        | "project_manager"
        | "meter_reader"
        | "financial_collector"
      subscription_tier: "free" | "premium"
      tenant_status: "active" | "suspended"
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
        "super_admin",
        "central_admin",
        "project_manager",
        "meter_reader",
        "financial_collector",
      ],
      subscription_tier: ["free", "premium"],
      tenant_status: ["active", "suspended"],
    },
  },
} as const
