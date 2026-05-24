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
      ad_comparative_analyses: {
        Row: {
          account_ids: string[]
          ad_ids: string[]
          ad_ids_hash: string
          analysis: Json
          analyzed_by: string | null
          cost_usd: number | null
          created_at: string
          date_preset: string
          id: string
          inputs_snapshot: Json | null
          model: string | null
          store_name: string | null
          tokens_used: number | null
        }
        Insert: {
          account_ids: string[]
          ad_ids: string[]
          ad_ids_hash: string
          analysis: Json
          analyzed_by?: string | null
          cost_usd?: number | null
          created_at?: string
          date_preset: string
          id?: string
          inputs_snapshot?: Json | null
          model?: string | null
          store_name?: string | null
          tokens_used?: number | null
        }
        Update: {
          account_ids?: string[]
          ad_ids?: string[]
          ad_ids_hash?: string
          analysis?: Json
          analyzed_by?: string | null
          cost_usd?: number | null
          created_at?: string
          date_preset?: string
          id?: string
          inputs_snapshot?: Json | null
          model?: string | null
          store_name?: string | null
          tokens_used?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_comparative_analyses_analyzed_by_fkey"
            columns: ["analyzed_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_copy_presets: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          id: string
          kind: Database["public"]["Enums"]["ad_copy_preset_kind"]
          label: string
          shopify_store_id: string
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind: Database["public"]["Enums"]["ad_copy_preset_kind"]
          label: string
          shopify_store_id: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["ad_copy_preset_kind"]
          label?: string
          shopify_store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_copy_presets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_copy_presets_shopify_store_id_fkey"
            columns: ["shopify_store_id"]
            isOneToOne: false
            referencedRelation: "shopify_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_creative_analyses: {
        Row: {
          account_id: string
          ad_id: string
          analysis: Json
          analyzed_by: string | null
          cost_usd: number | null
          created_at: string
          creative_id: string | null
          id: string
          model: string | null
          thumbnail_url: string | null
          tokens_used: number | null
          trigger_source: string
          video_id: string | null
          video_url: string | null
        }
        Insert: {
          account_id: string
          ad_id: string
          analysis: Json
          analyzed_by?: string | null
          cost_usd?: number | null
          created_at?: string
          creative_id?: string | null
          id?: string
          model?: string | null
          thumbnail_url?: string | null
          tokens_used?: number | null
          trigger_source?: string
          video_id?: string | null
          video_url?: string | null
        }
        Update: {
          account_id?: string
          ad_id?: string
          analysis?: Json
          analyzed_by?: string | null
          cost_usd?: number | null
          created_at?: string
          creative_id?: string | null
          id?: string
          model?: string | null
          thumbnail_url?: string | null
          tokens_used?: number | null
          trigger_source?: string
          video_id?: string | null
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_creative_analyses_analyzed_by_fkey"
            columns: ["analyzed_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_drafts: {
        Row: {
          ad_account_id: string
          ad_data: Json
          adset_data: Json | null
          campaign_data: Json | null
          created_at: string
          employee_id: string
          error_message: string | null
          existing_adset_id: string | null
          existing_campaign_id: string | null
          fb_ad_id: string | null
          fb_adset_id: string | null
          fb_campaign_id: string | null
          id: string
          mode: string
          name: string
          shopify_store_id: string | null
          status: Database["public"]["Enums"]["ad_draft_status"]
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          ad_account_id: string
          ad_data?: Json
          adset_data?: Json | null
          campaign_data?: Json | null
          created_at?: string
          employee_id: string
          error_message?: string | null
          existing_adset_id?: string | null
          existing_campaign_id?: string | null
          fb_ad_id?: string | null
          fb_adset_id?: string | null
          fb_campaign_id?: string | null
          id?: string
          mode?: string
          name: string
          shopify_store_id?: string | null
          status?: Database["public"]["Enums"]["ad_draft_status"]
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          ad_account_id?: string
          ad_data?: Json
          adset_data?: Json | null
          campaign_data?: Json | null
          created_at?: string
          employee_id?: string
          error_message?: string | null
          existing_adset_id?: string | null
          existing_campaign_id?: string | null
          fb_ad_id?: string | null
          fb_adset_id?: string | null
          fb_campaign_id?: string | null
          id?: string
          mode?: string
          name?: string
          shopify_store_id?: string | null
          status?: Database["public"]["Enums"]["ad_draft_status"]
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_drafts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_drafts_shopify_store_id_fkey"
            columns: ["shopify_store_id"]
            isOneToOne: false
            referencedRelation: "shopify_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_alerts: {
        Row: {
          acted_by: string | null
          acted_on_at: string | null
          action_url: string | null
          body: string | null
          created_at: string
          digest_included_at: string | null
          dismissed_at: string | null
          emailed_at: string | null
          id: string
          payload: Json | null
          read_at: string | null
          resource_id: string | null
          resource_type: string | null
          severity: string
          title: string
          type: string
        }
        Insert: {
          acted_by?: string | null
          acted_on_at?: string | null
          action_url?: string | null
          body?: string | null
          created_at?: string
          digest_included_at?: string | null
          dismissed_at?: string | null
          emailed_at?: string | null
          id?: string
          payload?: Json | null
          read_at?: string | null
          resource_id?: string | null
          resource_type?: string | null
          severity: string
          title: string
          type: string
        }
        Update: {
          acted_by?: string | null
          acted_on_at?: string | null
          action_url?: string | null
          body?: string | null
          created_at?: string
          digest_included_at?: string | null
          dismissed_at?: string | null
          emailed_at?: string | null
          id?: string
          payload?: Json | null
          read_at?: string | null
          resource_id?: string | null
          resource_type?: string | null
          severity?: string
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_alerts_acted_by_fkey"
            columns: ["acted_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_chat_sessions: {
        Row: {
          account_id: string | null
          created_at: string
          date_preset: string | null
          employee_id: string
          id: string
          messages: Json
          title: string | null
          total_cache_read_tokens: number
          total_cost_usd: number
          total_input_tokens: number
          total_output_tokens: number
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          date_preset?: string | null
          employee_id: string
          id?: string
          messages?: Json
          title?: string | null
          total_cache_read_tokens?: number
          total_cost_usd?: number
          total_input_tokens?: number
          total_output_tokens?: number
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          created_at?: string
          date_preset?: string | null
          employee_id?: string
          id?: string
          messages?: Json
          title?: string | null
          total_cache_read_tokens?: number
          total_cost_usd?: number
          total_input_tokens?: number
          total_output_tokens?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_sessions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_generations: {
        Row: {
          created_at: string
          employee_id: string | null
          id: string
          input_data: Json
          output_data: Json
          source_winner_analysis_id: string | null
          store_name: string
          structured_output: Json | null
          tool_type: string
        }
        Insert: {
          created_at?: string
          employee_id?: string | null
          id?: string
          input_data?: Json
          output_data?: Json
          source_winner_analysis_id?: string | null
          store_name: string
          structured_output?: Json | null
          tool_type: string
        }
        Update: {
          created_at?: string
          employee_id?: string | null
          id?: string
          input_data?: Json
          output_data?: Json
          source_winner_analysis_id?: string | null
          store_name?: string
          structured_output?: Json | null
          tool_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_generations_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_generations_source_winner_analysis_id_fkey"
            columns: ["source_winner_analysis_id"]
            isOneToOne: false
            referencedRelation: "ad_creative_analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_store_docs_archive_2026_05: {
        Row: {
          content: string | null
          created_at: string | null
          doc_type: string | null
          id: string
          metadata: Json | null
          store_name: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          doc_type?: string | null
          id: string
          metadata?: Json | null
          store_name?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string | null
          doc_type?: string | null
          id?: string
          metadata?: Json | null
          store_name?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      ai_tool_calls: {
        Row: {
          created_at: string
          duration_ms: number | null
          employee_id: string | null
          error_message: string | null
          id: string
          input: Json
          output_preview: string | null
          result_rows: number | null
          session_id: string | null
          status: string
          tool_name: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          employee_id?: string | null
          error_message?: string | null
          id?: string
          input?: Json
          output_preview?: string | null
          result_rows?: number | null
          session_id?: string | null
          status?: string
          tool_name: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          employee_id?: string | null
          error_message?: string | null
          id?: string
          input?: Json
          output_preview?: string | null
          result_rows?: number | null
          session_id?: string | null
          status?: string
          tool_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_tool_calls_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_tool_calls_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "ai_chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          created_at: string
          id: string
          key: string
          updated_at: string
          updated_by: string | null
          value: string
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          updated_at?: string
          updated_by?: string | null
          value: string
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      approved_script_creatives_archive_2026_05: {
        Row: {
          approved_script_id: string | null
          creative_type: string | null
          fb_ad_account_id: string | null
          fb_image_hash: string | null
          fb_video_id: string | null
          file_name: string | null
          id: string
          label: string | null
          thumbnail_url: string | null
          uploaded_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          approved_script_id?: string | null
          creative_type?: string | null
          fb_ad_account_id?: string | null
          fb_image_hash?: string | null
          fb_video_id?: string | null
          file_name?: string | null
          id: string
          label?: string | null
          thumbnail_url?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          approved_script_id?: string | null
          creative_type?: string | null
          fb_ad_account_id?: string | null
          fb_image_hash?: string | null
          fb_video_id?: string | null
          file_name?: string | null
          id?: string
          label?: string | null
          thumbnail_url?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: []
      }
      approved_scripts_archive_2026_05: {
        Row: {
          angle_title: string | null
          angle_type: string | null
          approved_at: string | null
          approved_by: string | null
          avatar: string | null
          awareness_level: string | null
          big_idea: string | null
          body_script: string | null
          capacity: number | null
          final_video_url: string | null
          funnel_stage: string | null
          hook: string | null
          hook_framework: string | null
          id: string
          intensity: number | null
          performance_metrics: Json | null
          performance_status: string | null
          performance_validated_at: string | null
          production_notes: string | null
          script_number: number | null
          source_message_index: number | null
          source_thread_id: string | null
          source_winner_ad_id: string | null
          source_winner_analysis_id: string | null
          status: Database["public"]["Enums"]["approved_script_status"] | null
          store_name: string | null
          strategic_format: string | null
          updated_at: string | null
          updated_by: string | null
          variable_shifts: Json | null
          variant_hooks: string[] | null
          video_format: string | null
        }
        Insert: {
          angle_title?: string | null
          angle_type?: string | null
          approved_at?: string | null
          approved_by?: string | null
          avatar?: string | null
          awareness_level?: string | null
          big_idea?: string | null
          body_script?: string | null
          capacity?: number | null
          final_video_url?: string | null
          funnel_stage?: string | null
          hook?: string | null
          hook_framework?: string | null
          id: string
          intensity?: number | null
          performance_metrics?: Json | null
          performance_status?: string | null
          performance_validated_at?: string | null
          production_notes?: string | null
          script_number?: number | null
          source_message_index?: number | null
          source_thread_id?: string | null
          source_winner_ad_id?: string | null
          source_winner_analysis_id?: string | null
          status?: Database["public"]["Enums"]["approved_script_status"] | null
          store_name?: string | null
          strategic_format?: string | null
          updated_at?: string | null
          updated_by?: string | null
          variable_shifts?: Json | null
          variant_hooks?: string[] | null
          video_format?: string | null
        }
        Update: {
          angle_title?: string | null
          angle_type?: string | null
          approved_at?: string | null
          approved_by?: string | null
          avatar?: string | null
          awareness_level?: string | null
          big_idea?: string | null
          body_script?: string | null
          capacity?: number | null
          final_video_url?: string | null
          funnel_stage?: string | null
          hook?: string | null
          hook_framework?: string | null
          id?: string
          intensity?: number | null
          performance_metrics?: Json | null
          performance_status?: string | null
          performance_validated_at?: string | null
          production_notes?: string | null
          script_number?: number | null
          source_message_index?: number | null
          source_thread_id?: string | null
          source_winner_ad_id?: string | null
          source_winner_analysis_id?: string | null
          status?: Database["public"]["Enums"]["approved_script_status"] | null
          store_name?: string | null
          strategic_format?: string | null
          updated_at?: string | null
          updated_by?: string | null
          variable_shifts?: Json | null
          variant_hooks?: string[] | null
          video_format?: string | null
        }
        Relationships: []
      }
      attendance_events: {
        Row: {
          created_at: string
          details: Json | null
          employee_id: string
          event_type: string
          id: string
          time_entry_id: string | null
        }
        Insert: {
          created_at?: string
          details?: Json | null
          employee_id: string
          event_type: string
          id?: string
          time_entry_id?: string | null
        }
        Update: {
          created_at?: string
          details?: Json | null
          employee_id?: string
          event_type?: string
          id?: string
          time_entry_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_events_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_events_time_entry_id_fkey"
            columns: ["time_entry_id"]
            isOneToOne: false
            referencedRelation: "time_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      autopilot_actions: {
        Row: {
          account_id: string | null
          action: string
          actor_id: string | null
          ad_id: string
          ad_name: string | null
          adset_id: string | null
          adset_name: string | null
          campaign_id: string | null
          campaign_name: string | null
          cpa: number | null
          created_at: string
          error_message: string | null
          id: string
          paused_action_id: string | null
          purchases: number | null
          rule_matched: string | null
          run_id: string
          spend: number | null
          status: string
          undone_at: string | null
          undone_by: string | null
        }
        Insert: {
          account_id?: string | null
          action: string
          actor_id?: string | null
          ad_id: string
          ad_name?: string | null
          adset_id?: string | null
          adset_name?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          cpa?: number | null
          created_at?: string
          error_message?: string | null
          id?: string
          paused_action_id?: string | null
          purchases?: number | null
          rule_matched?: string | null
          run_id: string
          spend?: number | null
          status?: string
          undone_at?: string | null
          undone_by?: string | null
        }
        Update: {
          account_id?: string | null
          action?: string
          actor_id?: string | null
          ad_id?: string
          ad_name?: string | null
          adset_id?: string | null
          adset_name?: string | null
          campaign_id?: string | null
          campaign_name?: string | null
          cpa?: number | null
          created_at?: string
          error_message?: string | null
          id?: string
          paused_action_id?: string | null
          purchases?: number | null
          rule_matched?: string | null
          run_id?: string
          spend?: number | null
          status?: string
          undone_at?: string | null
          undone_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "autopilot_actions_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autopilot_actions_paused_action_id_fkey"
            columns: ["paused_action_id"]
            isOneToOne: false
            referencedRelation: "autopilot_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autopilot_actions_undone_by_fkey"
            columns: ["undone_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      autopilot_config: {
        Row: {
          auto_resume: boolean
          enabled: boolean
          id: string
          kill_high_cpa_max: number
          kill_no_purchase_spend_min: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          auto_resume?: boolean
          enabled?: boolean
          id?: string
          kill_high_cpa_max?: number
          kill_no_purchase_spend_min?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          auto_resume?: boolean
          enabled?: boolean
          id?: string
          kill_high_cpa_max?: number
          kill_no_purchase_spend_min?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "autopilot_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      autopilot_watched_campaigns: {
        Row: {
          account_id: string
          added_at: string
          added_by: string | null
          campaign_id: string
          campaign_name: string | null
          id: string
        }
        Insert: {
          account_id: string
          added_at?: string
          added_by?: string | null
          campaign_id: string
          campaign_name?: string | null
          id?: string
        }
        Update: {
          account_id?: string
          added_at?: string
          added_by?: string | null
          campaign_id?: string
          campaign_name?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "autopilot_watched_campaigns_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      bin_locations: {
        Row: {
          bin_code: string
          created_at: string | null
          id: string
          notes: string | null
          product_title: string | null
          sku: string
          store_id: string
          updated_at: string | null
          variant_id: string | null
          zone: string | null
        }
        Insert: {
          bin_code: string
          created_at?: string | null
          id?: string
          notes?: string | null
          product_title?: string | null
          sku: string
          store_id: string
          updated_at?: string | null
          variant_id?: string | null
          zone?: string | null
        }
        Update: {
          bin_code?: string
          created_at?: string | null
          id?: string
          notes?: string | null
          product_title?: string | null
          sku?: string
          store_id?: string
          updated_at?: string | null
          variant_id?: string | null
          zone?: string | null
        }
        Relationships: []
      }
      briefings: {
        Row: {
          ai_summary: string | null
          created_at: string
          data: Json
          email_error: string | null
          email_id: string | null
          email_recipients: number | null
          email_sent_at: string | null
          fetch_errors: Json
          headline: string
          id: string
          last_retry_at: string | null
          period_end: string | null
          period_label: string
          period_start: string | null
          retry_count: number
          type: string
        }
        Insert: {
          ai_summary?: string | null
          created_at?: string
          data: Json
          email_error?: string | null
          email_id?: string | null
          email_recipients?: number | null
          email_sent_at?: string | null
          fetch_errors?: Json
          headline: string
          id?: string
          last_retry_at?: string | null
          period_end?: string | null
          period_label: string
          period_start?: string | null
          retry_count?: number
          type: string
        }
        Update: {
          ai_summary?: string | null
          created_at?: string
          data?: Json
          email_error?: string | null
          email_id?: string | null
          email_recipients?: number | null
          email_sent_at?: string | null
          fetch_errors?: Json
          headline?: string
          id?: string
          last_retry_at?: string | null
          period_end?: string | null
          period_label?: string
          period_start?: string | null
          retry_count?: number
          type?: string
        }
        Relationships: []
      }
      cached_api_data: {
        Row: {
          cache_key: string
          cache_type: string
          created_at: string
          id: string
          refreshed_at: string
          response_data: Json
        }
        Insert: {
          cache_key: string
          cache_type: string
          created_at?: string
          id?: string
          refreshed_at?: string
          response_data: Json
        }
        Update: {
          cache_key?: string
          cache_type?: string
          created_at?: string
          id?: string
          refreshed_at?: string
          response_data?: Json
        }
        Relationships: []
      }
      call_attempts: {
        Row: {
          ai_summary: string | null
          attempt_number: number
          call_source: string
          cost_usd: number | null
          created_at: string
          customer_name: string | null
          customer_phone: string
          customer_sentiment: string | null
          duration_seconds: number | null
          ended_at: string | null
          handoff_reason: string | null
          id: string
          initiated_by: string | null
          is_test_call: boolean
          locked_by: string | null
          locked_until: string | null
          needs_va_followup: boolean
          order_snapshot: Json | null
          outcome: string | null
          provider: string
          provider_call_id: string | null
          questions_asked: Json | null
          recording_url: string | null
          scheduled_for: string | null
          shopify_order_id: string
          shopify_order_name: string | null
          started_at: string | null
          status: string
          store_id: string
          transcript: Json | null
          va_id: string | null
        }
        Insert: {
          ai_summary?: string | null
          attempt_number?: number
          call_source?: string
          cost_usd?: number | null
          created_at?: string
          customer_name?: string | null
          customer_phone: string
          customer_sentiment?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          handoff_reason?: string | null
          id?: string
          initiated_by?: string | null
          is_test_call?: boolean
          locked_by?: string | null
          locked_until?: string | null
          needs_va_followup?: boolean
          order_snapshot?: Json | null
          outcome?: string | null
          provider?: string
          provider_call_id?: string | null
          questions_asked?: Json | null
          recording_url?: string | null
          scheduled_for?: string | null
          shopify_order_id: string
          shopify_order_name?: string | null
          started_at?: string | null
          status?: string
          store_id: string
          transcript?: Json | null
          va_id?: string | null
        }
        Update: {
          ai_summary?: string | null
          attempt_number?: number
          call_source?: string
          cost_usd?: number | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string
          customer_sentiment?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          handoff_reason?: string | null
          id?: string
          initiated_by?: string | null
          is_test_call?: boolean
          locked_by?: string | null
          locked_until?: string | null
          needs_va_followup?: boolean
          order_snapshot?: Json | null
          outcome?: string | null
          provider?: string
          provider_call_id?: string | null
          questions_asked?: Json | null
          recording_url?: string | null
          scheduled_for?: string | null
          shopify_order_id?: string
          shopify_order_name?: string | null
          started_at?: string | null
          status?: string
          store_id?: string
          transcript?: Json | null
          va_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_attempts_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_attempts_locked_by_fkey"
            columns: ["locked_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_attempts_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "shopify_stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_attempts_va_id_fkey"
            columns: ["va_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      call_confirmer_configs: {
        Row: {
          agent_name: string
          business_hours_end: string
          business_hours_start: string
          created_at: string
          daily_budget_usd: number
          enabled: boolean
          greeting_template: string | null
          id: string
          language: string
          max_attempts: number
          per_call_max_seconds: number
          retry_interval_minutes: number
          store_id: string
          support_phone: string | null
          updated_at: string
          voice_id: string | null
        }
        Insert: {
          agent_name?: string
          business_hours_end?: string
          business_hours_start?: string
          created_at?: string
          daily_budget_usd?: number
          enabled?: boolean
          greeting_template?: string | null
          id?: string
          language?: string
          max_attempts?: number
          per_call_max_seconds?: number
          retry_interval_minutes?: number
          store_id: string
          support_phone?: string | null
          updated_at?: string
          voice_id?: string | null
        }
        Update: {
          agent_name?: string
          business_hours_end?: string
          business_hours_start?: string
          created_at?: string
          daily_budget_usd?: number
          enabled?: boolean
          greeting_template?: string | null
          id?: string
          language?: string
          max_attempts?: number
          per_call_max_seconds?: number
          retry_interval_minutes?: number
          store_id?: string
          support_phone?: string | null
          updated_at?: string
          voice_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_confirmer_configs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: true
            referencedRelation: "shopify_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      call_spend_daily: {
        Row: {
          created_at: string
          date: string
          store_id: string
          test_calls: number
          test_cost_usd: number
          total_calls: number
          total_cost_usd: number
          total_seconds: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          date: string
          store_id: string
          test_calls?: number
          test_cost_usd?: number
          total_calls?: number
          total_cost_usd?: number
          total_seconds?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          store_id?: string
          test_calls?: number
          test_cost_usd?: number
          total_calls?: number
          total_cost_usd?: number
          total_seconds?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_spend_daily_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "shopify_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      cogs_items: {
        Row: {
          cogs_per_unit: number
          created_at: string
          id: string
          product_name: string | null
          sku: string
          store_name: string
          updated_at: string
        }
        Insert: {
          cogs_per_unit?: number
          created_at?: string
          id?: string
          product_name?: string | null
          sku: string
          store_name: string
          updated_at?: string
        }
        Update: {
          cogs_per_unit?: number
          created_at?: string
          id?: string
          product_name?: string | null
          sku?: string
          store_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      cycle_counts: {
        Row: {
          corrections_applied: boolean | null
          created_at: string | null
          discrepancies_found: number | null
          id: string
          performed_by: string | null
          store_id: string
          summary: Json | null
          total_skus_counted: number | null
          zone: string | null
        }
        Insert: {
          corrections_applied?: boolean | null
          created_at?: string | null
          discrepancies_found?: number | null
          id?: string
          performed_by?: string | null
          store_id: string
          summary?: Json | null
          total_skus_counted?: number | null
          zone?: string | null
        }
        Update: {
          corrections_applied?: boolean | null
          created_at?: string | null
          discrepancies_found?: number | null
          id?: string
          performed_by?: string | null
          store_id?: string
          summary?: Json | null
          total_skus_counted?: number | null
          zone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cycle_counts_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_notifications: {
        Row: {
          action_url: string | null
          body: string | null
          created_at: string
          dismissed_at: string | null
          email_error: string | null
          emailed_at: string | null
          employee_id: string
          id: string
          payload: Json | null
          read_at: string | null
          severity: string
          title: string
          type: string
        }
        Insert: {
          action_url?: string | null
          body?: string | null
          created_at?: string
          dismissed_at?: string | null
          email_error?: string | null
          emailed_at?: string | null
          employee_id: string
          id?: string
          payload?: Json | null
          read_at?: string | null
          severity?: string
          title: string
          type: string
        }
        Update: {
          action_url?: string | null
          body?: string | null
          created_at?: string
          dismissed_at?: string | null
          email_error?: string | null
          emailed_at?: string | null
          employee_id?: string
          id?: string
          payload?: Json | null
          read_at?: string | null
          severity?: string
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_notifications_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_shifts: {
        Row: {
          break_minutes: number
          created_at: string
          created_by: string | null
          employee_id: string
          end_time: string | null
          id: string
          is_off_day: boolean
          shift_date: string
          start_time: string | null
          updated_at: string
        }
        Insert: {
          break_minutes?: number
          created_at?: string
          created_by?: string | null
          employee_id: string
          end_time?: string | null
          id?: string
          is_off_day?: boolean
          shift_date: string
          start_time?: string | null
          updated_at?: string
        }
        Update: {
          break_minutes?: number
          created_at?: string
          created_by?: string | null
          employee_id?: string
          end_time?: string | null
          id?: string
          is_off_day?: boolean
          shift_date?: string
          start_time?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_shifts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_shifts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          auth_id: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          auth_id?: string | null
          created_at?: string
          email: string
          full_name: string
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          auth_id?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      fb_ad_attribution: {
        Row: {
          ad_name: string | null
          campaign_id: string | null
          created_by: string | null
          fb_ad_id: string
          fb_created_time: string | null
          is_test: boolean
          tagged_at: string
        }
        Insert: {
          ad_name?: string | null
          campaign_id?: string | null
          created_by?: string | null
          fb_ad_id: string
          fb_created_time?: string | null
          is_test?: boolean
          tagged_at?: string
        }
        Update: {
          ad_name?: string | null
          campaign_id?: string | null
          created_by?: string | null
          fb_ad_id?: string
          fb_created_time?: string | null
          is_test?: boolean
          tagged_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fb_ad_attribution_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      fb_rate_limit_state: {
        Row: {
          blocked_until: string | null
          id: number
          last_429_at: string | null
          last_message: string | null
          updated_at: string
          usage_pct: number | null
        }
        Insert: {
          blocked_until?: string | null
          id?: number
          last_429_at?: string | null
          last_message?: string | null
          updated_at?: string
          usage_pct?: number | null
        }
        Update: {
          blocked_until?: string | null
          id?: number
          last_429_at?: string | null
          last_message?: string | null
          updated_at?: string
          usage_pct?: number | null
        }
        Relationships: []
      }
      fb_refresh_state: {
        Row: {
          message: string | null
          refreshed_at: string
          scope: string
          status: string | null
          triggered_by: string | null
        }
        Insert: {
          message?: string | null
          refreshed_at?: string
          scope: string
          status?: string | null
          triggered_by?: string | null
        }
        Update: {
          message?: string | null
          refreshed_at?: string
          scope?: string
          status?: string | null
          triggered_by?: string | null
        }
        Relationships: []
      }
      ilp_deconstructions: {
        Row: {
          ad_origin: string | null
          ad_title: string | null
          compliance_flags_count: number
          cost_usd: number | null
          created_at: string
          employee_id: string | null
          id: string
          model: string | null
          source_text: string
          source_text_hash: string
          tokens_used: Json | null
          zones: Json
        }
        Insert: {
          ad_origin?: string | null
          ad_title?: string | null
          compliance_flags_count?: number
          cost_usd?: number | null
          created_at?: string
          employee_id?: string | null
          id?: string
          model?: string | null
          source_text: string
          source_text_hash: string
          tokens_used?: Json | null
          zones: Json
        }
        Update: {
          ad_origin?: string | null
          ad_title?: string | null
          compliance_flags_count?: number
          cost_usd?: number | null
          created_at?: string
          employee_id?: string | null
          id?: string
          model?: string | null
          source_text?: string
          source_text_hash?: string
          tokens_used?: Json | null
          zones?: Json
        }
        Relationships: [
          {
            foreignKeyName: "ilp_deconstructions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_adjustments: {
        Row: {
          adjustment_type: string
          change_qty: number | null
          created_at: string | null
          id: string
          new_qty: number | null
          performed_by: string | null
          previous_qty: number | null
          product_title: string | null
          reason: string | null
          rts_batch_id: string | null
          sku: string
          store_id: string
        }
        Insert: {
          adjustment_type: string
          change_qty?: number | null
          created_at?: string | null
          id?: string
          new_qty?: number | null
          performed_by?: string | null
          previous_qty?: number | null
          product_title?: string | null
          reason?: string | null
          rts_batch_id?: string | null
          sku: string
          store_id: string
        }
        Update: {
          adjustment_type?: string
          change_qty?: number | null
          created_at?: string | null
          id?: string
          new_qty?: number | null
          performed_by?: string | null
          previous_qty?: number | null
          product_title?: string | null
          reason?: string | null
          rts_batch_id?: string | null
          sku?: string
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_adjustments_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_adjustments_rts_batch_id_fkey"
            columns: ["rts_batch_id"]
            isOneToOne: false
            referencedRelation: "rts_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_snapshots: {
        Row: {
          created_at: string
          id: string
          product_id: string | null
          product_title: string | null
          sku: string | null
          snapshot_date: string
          stock: number
          store_id: string | null
          store_name: string
          variant_id: string | null
          variant_title: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          product_id?: string | null
          product_title?: string | null
          sku?: string | null
          snapshot_date?: string
          stock?: number
          store_id?: string | null
          store_name: string
          variant_id?: string | null
          variant_title?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          product_id?: string | null
          product_title?: string | null
          sku?: string | null
          snapshot_date?: string
          stock?: number
          store_id?: string | null
          store_name?: string
          variant_id?: string | null
          variant_title?: string | null
        }
        Relationships: []
      }
      jt_deliveries: {
        Row: {
          city: string | null
          classification: string
          cod_amount: number | null
          days_since_submit: number | null
          id: string
          is_delivered: boolean
          is_returned: boolean
          item_name: string | null
          item_value: number | null
          num_items: number | null
          order_status: string
          payment_method: string | null
          province: string | null
          receiver: string | null
          rts_reason: string | null
          shipping_cost: number | null
          shopify_customer_email: string | null
          shopify_order_date: string | null
          shopify_order_id: string | null
          shopify_order_name: string | null
          signing_time: string | null
          store_name: string | null
          submission_date: string | null
          tier_cutoff: number | null
          updated_at: string
          uploaded_at: string
          waybill: string
        }
        Insert: {
          city?: string | null
          classification: string
          cod_amount?: number | null
          days_since_submit?: number | null
          id?: string
          is_delivered?: boolean
          is_returned?: boolean
          item_name?: string | null
          item_value?: number | null
          num_items?: number | null
          order_status: string
          payment_method?: string | null
          province?: string | null
          receiver?: string | null
          rts_reason?: string | null
          shipping_cost?: number | null
          shopify_customer_email?: string | null
          shopify_order_date?: string | null
          shopify_order_id?: string | null
          shopify_order_name?: string | null
          signing_time?: string | null
          store_name?: string | null
          submission_date?: string | null
          tier_cutoff?: number | null
          updated_at?: string
          uploaded_at?: string
          waybill: string
        }
        Update: {
          city?: string | null
          classification?: string
          cod_amount?: number | null
          days_since_submit?: number | null
          id?: string
          is_delivered?: boolean
          is_returned?: boolean
          item_name?: string | null
          item_value?: number | null
          num_items?: number | null
          order_status?: string
          payment_method?: string | null
          province?: string | null
          receiver?: string | null
          rts_reason?: string | null
          shipping_cost?: number | null
          shopify_customer_email?: string | null
          shopify_order_date?: string | null
          shopify_order_id?: string | null
          shopify_order_name?: string | null
          signing_time?: string | null
          store_name?: string | null
          submission_date?: string | null
          tier_cutoff?: number | null
          updated_at?: string
          uploaded_at?: string
          waybill?: string
        }
        Relationships: []
      }
      kpi_daily_snapshots: {
        Row: {
          computed_at: string
          employee_id: string | null
          id: string
          kpi_key: string
          raw_data: Json | null
          scope: string
          snapshot_date: string
          status: string
          value: number
        }
        Insert: {
          computed_at?: string
          employee_id?: string | null
          id?: string
          kpi_key: string
          raw_data?: Json | null
          scope: string
          snapshot_date: string
          status: string
          value: number
        }
        Update: {
          computed_at?: string
          employee_id?: string | null
          id?: string
          kpi_key?: string
          raw_data?: Json | null
          scope?: string
          snapshot_date?: string
          status?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "kpi_daily_snapshots_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_targets: {
        Row: {
          created_at: string
          direction: string
          display_name: string
          effective_from: string
          green_threshold: number
          id: string
          is_active: boolean
          kpi_key: string
          red_threshold: number
          scope: string
          segment: string
          unit: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          direction: string
          display_name: string
          effective_from?: string
          green_threshold: number
          id?: string
          is_active?: boolean
          kpi_key: string
          red_threshold: number
          scope: string
          segment: string
          unit?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          direction?: string
          display_name?: string
          effective_from?: string
          green_threshold?: number
          id?: string
          is_active?: boolean
          kpi_key?: string
          red_threshold?: number
          scope?: string
          segment?: string
          unit?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      pack_verifications: {
        Row: {
          completed_at: string | null
          id: string
          items_expected: number | null
          items_scanned: number | null
          mismatches: Json | null
          notes: string | null
          order_id: string
          order_number: string
          source: string
          started_at: string | null
          status: string
          store_id: string
          verified_by: string | null
        }
        Insert: {
          completed_at?: string | null
          id?: string
          items_expected?: number | null
          items_scanned?: number | null
          mismatches?: Json | null
          notes?: string | null
          order_id: string
          order_number: string
          source?: string
          started_at?: string | null
          status: string
          store_id: string
          verified_by?: string | null
        }
        Update: {
          completed_at?: string | null
          id?: string
          items_expected?: number | null
          items_scanned?: number | null
          mismatches?: Json | null
          notes?: string | null
          order_id?: string
          order_number?: string
          source?: string
          started_at?: string | null
          status?: string
          store_id?: string
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pack_verifications_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      packing_errors: {
        Row: {
          created_at: string
          error_type: string
          id: string
          logged_by: string
          notes: string | null
          occurred_on: string
          packed_by: string | null
          shopify_order_id: string
          shopify_order_name: string | null
        }
        Insert: {
          created_at?: string
          error_type: string
          id?: string
          logged_by: string
          notes?: string | null
          occurred_on: string
          packed_by?: string | null
          shopify_order_id: string
          shopify_order_name?: string | null
        }
        Update: {
          created_at?: string
          error_type?: string
          id?: string
          logged_by?: string
          notes?: string | null
          occurred_on?: string
          packed_by?: string | null
          shopify_order_id?: string
          shopify_order_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "packing_errors_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packing_errors_packed_by_fkey"
            columns: ["packed_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      rts_batch_items: {
        Row: {
          barcode: string | null
          created_at: string
          damaged_qty: number
          expected_qty: number
          id: string
          inventory_item_id: number | null
          notes: string | null
          product_title: string | null
          received_qty: number
          rts_batch_id: string
          shopify_line_item_id: string | null
          sku: string | null
          updated_at: string
          variant_title: string | null
        }
        Insert: {
          barcode?: string | null
          created_at?: string
          damaged_qty?: number
          expected_qty: number
          id?: string
          inventory_item_id?: number | null
          notes?: string | null
          product_title?: string | null
          received_qty?: number
          rts_batch_id: string
          shopify_line_item_id?: string | null
          sku?: string | null
          updated_at?: string
          variant_title?: string | null
        }
        Update: {
          barcode?: string | null
          created_at?: string
          damaged_qty?: number
          expected_qty?: number
          id?: string
          inventory_item_id?: number | null
          notes?: string | null
          product_title?: string | null
          received_qty?: number
          rts_batch_id?: string
          shopify_line_item_id?: string | null
          sku?: string | null
          updated_at?: string
          variant_title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rts_batch_items_rts_batch_id_fkey"
            columns: ["rts_batch_id"]
            isOneToOne: false
            referencedRelation: "rts_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      rts_batches: {
        Row: {
          batch_ref: string
          closed_at: string | null
          closed_by: string | null
          id: string
          item_count: number
          lookup_source: string | null
          notes: string | null
          opened_at: string
          opened_by: string
          shopify_order_date: string | null
          shopify_order_id: string | null
          shopify_order_name: string | null
          status: string
          store_id: string
          unit_count: number
          waybill: string | null
        }
        Insert: {
          batch_ref: string
          closed_at?: string | null
          closed_by?: string | null
          id?: string
          item_count?: number
          lookup_source?: string | null
          notes?: string | null
          opened_at?: string
          opened_by: string
          shopify_order_date?: string | null
          shopify_order_id?: string | null
          shopify_order_name?: string | null
          status?: string
          store_id: string
          unit_count?: number
          waybill?: string | null
        }
        Update: {
          batch_ref?: string
          closed_at?: string | null
          closed_by?: string | null
          id?: string
          item_count?: number
          lookup_source?: string | null
          notes?: string | null
          opened_at?: string
          opened_by?: string
          shopify_order_date?: string | null
          shopify_order_id?: string | null
          shopify_order_name?: string | null
          status?: string
          store_id?: string
          unit_count?: number
          waybill?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rts_batches_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rts_batches_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rts_batches_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "shopify_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      scaling_detection_cache: {
        Row: {
          account_id: string | null
          campaign_id: string | null
          creative_id: string | null
          fb_ad_id: string
          in_scaling: boolean
          refreshed_at: string
          scaled_ad_id: string | null
          scaled_in_campaign: string | null
          scaled_in_store: string | null
          self_is_scaling: boolean
        }
        Insert: {
          account_id?: string | null
          campaign_id?: string | null
          creative_id?: string | null
          fb_ad_id: string
          in_scaling?: boolean
          refreshed_at?: string
          scaled_ad_id?: string | null
          scaled_in_campaign?: string | null
          scaled_in_store?: string | null
          self_is_scaling?: boolean
        }
        Update: {
          account_id?: string | null
          campaign_id?: string | null
          creative_id?: string | null
          fb_ad_id?: string
          in_scaling?: boolean
          refreshed_at?: string
          scaled_ad_id?: string | null
          scaled_in_campaign?: string | null
          scaled_in_store?: string | null
          self_is_scaling?: boolean
        }
        Relationships: []
      }
      shopify_stores: {
        Row: {
          api_token: string | null
          client_id: string | null
          client_secret: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          store_url: string
          updated_at: string
        }
        Insert: {
          api_token?: string | null
          client_id?: string | null
          client_secret?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          store_url: string
          updated_at?: string
        }
        Update: {
          api_token?: string | null
          client_id?: string | null
          client_secret?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          store_url?: string
          updated_at?: string
        }
        Relationships: []
      }
      stock_alert_thresholds: {
        Row: {
          id: string
          low_stock_threshold: number | null
          sku: string
          store_id: string
        }
        Insert: {
          id?: string
          low_stock_threshold?: number | null
          sku: string
          store_id: string
        }
        Update: {
          id?: string
          low_stock_threshold?: number | null
          sku?: string
          store_id?: string
        }
        Relationships: []
      }
      stock_count_watchlist: {
        Row: {
          added_at: string
          is_active: boolean
          product_name: string | null
          sku: string
        }
        Insert: {
          added_at?: string
          is_active?: boolean
          product_name?: string | null
          sku: string
        }
        Update: {
          added_at?: string
          is_active?: boolean
          product_name?: string | null
          sku?: string
        }
        Relationships: []
      }
      stock_counts: {
        Row: {
          actual_qty: number
          counted_at: string
          counted_by: string
          expected_qty: number
          id: string
          notes: string | null
          sku: string
          week_starting: string
        }
        Insert: {
          actual_qty: number
          counted_at?: string
          counted_by: string
          expected_qty: number
          id?: string
          notes?: string | null
          sku: string
          week_starting: string
        }
        Update: {
          actual_qty?: number
          counted_at?: string
          counted_by?: string
          expected_qty?: number
          id?: string
          notes?: string | null
          sku?: string
          week_starting?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_counts_counted_by_fkey"
            columns: ["counted_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      store_ad_defaults: {
        Row: {
          ad_account_id: string | null
          ad_name_pattern: string | null
          adset_name_pattern: string | null
          campaign_name_pattern: string | null
          created_at: string
          default_age_max: number | null
          default_age_min: number | null
          default_countries: string[]
          default_cta: string | null
          default_daily_budget: number | null
          id: string
          page_id: string | null
          page_name: string | null
          pixel_id: string | null
          shopify_store_id: string
          updated_at: string
          updated_by: string | null
          url_parameters: string | null
          website_url: string | null
        }
        Insert: {
          ad_account_id?: string | null
          ad_name_pattern?: string | null
          adset_name_pattern?: string | null
          campaign_name_pattern?: string | null
          created_at?: string
          default_age_max?: number | null
          default_age_min?: number | null
          default_countries?: string[]
          default_cta?: string | null
          default_daily_budget?: number | null
          id?: string
          page_id?: string | null
          page_name?: string | null
          pixel_id?: string | null
          shopify_store_id: string
          updated_at?: string
          updated_by?: string | null
          url_parameters?: string | null
          website_url?: string | null
        }
        Update: {
          ad_account_id?: string | null
          ad_name_pattern?: string | null
          adset_name_pattern?: string | null
          campaign_name_pattern?: string | null
          created_at?: string
          default_age_max?: number | null
          default_age_min?: number | null
          default_countries?: string[]
          default_cta?: string | null
          default_daily_budget?: number | null
          id?: string
          page_id?: string | null
          page_name?: string | null
          pixel_id?: string | null
          shopify_store_id?: string
          updated_at?: string
          updated_by?: string | null
          url_parameters?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_ad_defaults_shopify_store_id_fkey"
            columns: ["shopify_store_id"]
            isOneToOne: true
            referencedRelation: "shopify_stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_ad_defaults_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      store_scaling_campaigns: {
        Row: {
          account_id: string
          campaign_id: string
          campaign_name: string
          created_at: string
          id: string
          store_name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_id: string
          campaign_id: string
          campaign_name: string
          created_at?: string
          id?: string
          store_name: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_id?: string
          campaign_id?: string
          campaign_name?: string
          created_at?: string
          id?: string
          store_name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_scaling_campaigns_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_to: string
          completed_at: string | null
          created_at: string
          created_by: string
          description: string | null
          due_date: string | null
          id: string
          link_url: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to: string
          completed_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          due_date?: string | null
          id?: string
          link_url?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          due_date?: string | null
          id?: string
          link_url?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      time_entries: {
        Row: {
          created_at: string
          date: string
          employee_id: string
          ended_at: string | null
          id: string
          is_manual: boolean
          notes: string | null
          started_at: string
          status: Database["public"]["Enums"]["time_entry_status"]
          total_seconds: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          date?: string
          employee_id: string
          ended_at?: string | null
          id?: string
          is_manual?: boolean
          notes?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["time_entry_status"]
          total_seconds?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          employee_id?: string
          ended_at?: string | null
          id?: string
          is_manual?: boolean
          notes?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["time_entry_status"]
          total_seconds?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      time_pauses: {
        Row: {
          created_at: string
          id: string
          paused_at: string
          resumed_at: string | null
          time_entry_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          paused_at?: string
          resumed_at?: string | null
          time_entry_id: string
        }
        Update: {
          created_at?: string
          id?: string
          paused_at?: string
          resumed_at?: string | null
          time_entry_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_pauses_time_entry_id_fkey"
            columns: ["time_entry_id"]
            isOneToOne: false
            referencedRelation: "time_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      va_call_spend_daily: {
        Row: {
          created_at: string
          date: string
          total_calls: number
          total_cost_usd: number
          total_seconds: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          date: string
          total_calls?: number
          total_cost_usd?: number
          total_seconds?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          total_calls?: number
          total_cost_usd?: number
          total_seconds?: number
          updated_at?: string
        }
        Relationships: []
      }
      va_dialer_config: {
        Row: {
          daily_budget_usd: number
          enabled: boolean
          id: string
          per_call_max_seconds: number
          recording_disclosure_text: string
          recording_retention_days: number
          updated_at: string
        }
        Insert: {
          daily_budget_usd?: number
          enabled?: boolean
          id?: string
          per_call_max_seconds?: number
          recording_disclosure_text?: string
          recording_retention_days?: number
          updated_at?: string
        }
        Update: {
          daily_budget_usd?: number
          enabled?: boolean
          id?: string
          per_call_max_seconds?: number
          recording_disclosure_text?: string
          recording_retention_days?: number
          updated_at?: string
        }
        Relationships: []
      }
      waybill_sender_audits: {
        Row: {
          actual_sender: string
          expected_store: string
          id: string
          is_mismatch: boolean
          order_id: string
          order_number: string | null
          packed_at: string
          packed_by: string | null
          waybill: string | null
        }
        Insert: {
          actual_sender: string
          expected_store: string
          id?: string
          is_mismatch: boolean
          order_id: string
          order_number?: string | null
          packed_at?: string
          packed_by?: string | null
          waybill?: string | null
        }
        Update: {
          actual_sender?: string
          expected_store?: string
          id?: string
          is_mismatch?: boolean
          order_id?: string
          order_number?: string | null
          packed_at?: string
          packed_by?: string | null
          waybill?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "waybill_sender_audits_packed_by_fkey"
            columns: ["packed_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      winner_pool_ads: {
        Row: {
          ad_id: string
          store_name: string | null
          tagged_at: string
          tagged_by: string | null
        }
        Insert: {
          ad_id: string
          store_name?: string | null
          tagged_at?: string
          tagged_by?: string | null
        }
        Update: {
          ad_id?: string
          store_name?: string | null
          tagged_at?: string
          tagged_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "winner_pool_ads_tagged_by_fkey"
            columns: ["tagged_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      call_confirmer_has_budget: {
        Args: { p_store_id: string }
        Returns: boolean
      }
      increment_call_spend: {
        Args: {
          p_cost_usd: number
          p_is_test?: boolean
          p_seconds: number
          p_store_id: string
        }
        Returns: undefined
      }
      increment_va_call_spend: {
        Args: { p_cost_usd: number; p_seconds: number }
        Returns: undefined
      }
      insert_admin_alert: {
        Args: {
          p_action_url: string
          p_body: string
          p_dedup_hours?: number
          p_payload: Json
          p_resource_id: string
          p_resource_type: string
          p_severity: string
          p_title: string
          p_type: string
        }
        Returns: string
      }
      insert_employee_notification: {
        Args: {
          p_action_url: string
          p_body: string
          p_dedup_minutes?: number
          p_employee_id: string
          p_payload: Json
          p_severity: string
          p_title: string
          p_type: string
        }
        Returns: string
      }
      va_dialer_has_budget: { Args: never; Returns: boolean }
      va_queue_claim: {
        Args: {
          p_call_attempt_id: string
          p_lock_seconds?: number
          p_va_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      ad_copy_preset_kind:
        | "ad_name"
        | "primary_text"
        | "headline"
        | "description"
      ad_draft_status: "draft" | "submitting" | "submitted" | "failed"
      approved_script_status:
        | "approved"
        | "in_progress"
        | "submitted"
        | "archived"
      task_priority: "low" | "med" | "high"
      task_status: "pending" | "in_progress" | "done" | "cancelled"
      time_entry_status: "running" | "paused" | "completed"
      user_role: "admin" | "va" | "fulfillment" | "marketing"
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
      ad_copy_preset_kind: [
        "ad_name",
        "primary_text",
        "headline",
        "description",
      ],
      ad_draft_status: ["draft", "submitting", "submitted", "failed"],
      approved_script_status: [
        "approved",
        "in_progress",
        "submitted",
        "archived",
      ],
      task_priority: ["low", "med", "high"],
      task_status: ["pending", "in_progress", "done", "cancelled"],
      time_entry_status: ["running", "paused", "completed"],
      user_role: ["admin", "va", "fulfillment", "marketing"],
    },
  },
} as const

