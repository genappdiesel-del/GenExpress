// ===================================================================
// Database type definitions
// ===================================================================
// These types describe the tables we create in supabase/migrations.
// They are hand-written for Phase 1 and will be replaced by types
// generated from the live database once Supabase is connected
// (supabase gen types typescript --project-id YOUR_PROJECT_ID).
//
// Why bother hand-writing them? Because TypeScript then catches a typo in a
// column name at compile time instead of failing silently at runtime in the
// browser, where a user sees a broken screen.
// ===================================================================

export type UserRole = 'super_admin' | 'supplier' | 'client' | 'agent'

export interface Profile {
  id: string
  role: UserRole
  supplier_id: string | null
  full_name: string
  username: string
  phone: string | null
  address: string | null
  is_active: boolean
  must_change_password: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface AuditLog {
  id: string
  actor_id: string | null
  action: string
  table_name: string
  record_id: string | null
  old_value: string | null
  new_value: string | null
  created_at: string
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: Omit<Profile, 'created_at' | 'updated_at'> &
          Partial<Pick<Profile, 'created_at' | 'updated_at'>>
        Update: Partial<Omit<Profile, 'id' | 'created_at' | 'updated_at'>>
        Relationships: []
      }
      audit_logs: {
        Row: AuditLog
        Insert: Omit<AuditLog, 'id' | 'created_at'> &
          Partial<Pick<AuditLog, 'id' | 'created_at'>>
        Update: never
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      current_user_id: { Args: Record<string, never>; Returns: string | null }
      current_role: { Args: Record<string, never>; Returns: UserRole | null }
      current_supplier_id: { Args: Record<string, never>; Returns: string | null }
      current_is_active: { Args: Record<string, never>; Returns: boolean }
      is_super_admin: { Args: Record<string, never>; Returns: boolean }
    }
    Enums: {
      user_role: UserRole
    }
    CompositeTypes: Record<string, never>
  }
}