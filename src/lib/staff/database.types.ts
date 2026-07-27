/**
 * Shape of the Supabase schema, kept in sync with the SQL migrations.
 *
 * Hand-authored rather than generated: Insert/Update are derived from Row so a
 * new column only has to be added in one place.
 */

export type TaskStatus = "todo" | "in_progress" | "blocked" | "done";
export type TaskPriority = "urgent" | "high" | "medium" | "low";
export type RecurrenceFreq = "daily" | "weekly" | "fortnightly" | "monthly";
export type NotificationType =
  | "assigned"
  | "unassigned"
  | "commented"
  | "status_changed"
  | "due_soon"
  | "overdue"
  | "mentioned";

/** `Defaulted` are columns the database fills in when omitted. */
type Table<Row, Defaulted extends keyof Row = never> = {
  Row: Row;
  Insert: Omit<Row, Defaulted> & Partial<Pick<Row, Defaulted>>;
  Update: Partial<Row>;
  Relationships: [];
};

export type SuggestionStatus = "pending" | "accepted" | "dismissed";

export type MemberRow = {
  id: string;
  /** The TPP Control account this person signs in with (null = no dashboard login yet). */
  app_user_id: string | null;
  name: string;
  initials: string;
  color: string;
  sort_order: number;
  /** Phone numbers / Apple IDs this person messages from. */
  imessage_handles: string[];
  active: boolean;
  created_at: string;
};

/** A task proposed from a chat message, waiting for someone to accept it. */
export type SuggestionRow = {
  id: string;
  source: string;
  chat_guid: string | null;
  message_guid: string | null;
  sender_handle: string | null;
  sender_member_id: string | null;
  message_text: string;
  message_sent_at: string | null;
  proposed_title: string;
  proposed_description: string | null;
  proposed_priority: TaskPriority;
  proposed_due_date: string | null;
  proposed_category_id: string | null;
  confidence: number;
  reasoning: string | null;
  order_reference: string | null;
  order_context: OrderContext | null;
  status: SuggestionStatus;
  created_task_id: string | null;
  reviewed_by_id: string | null;
  reviewed_at: string | null;
  created_at: string;
};

/** What the Shopify lookup found for an order number spotted in a message. */
export type OrderContext = {
  orderName: string;
  customerName: string | null;
  email: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  total: string | null;
  placedAt: string | null;
  items: string[];
};

export type SuggestionAssigneeRow = {
  suggestion_id: string;
  member_id: string;
};

export type SuggestionAttachmentRow = {
  id: string;
  suggestion_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

export type IngestStateRow = {
  id: string;
  last_rowid: number;
  last_seen_at: string | null;
  updated_at: string;
};

export type CategoryRow = {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
};

export type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  created_by_id: string | null;
  category_id: string | null;
  due_date: string | null;
  position: number;
  recurrence: RecurrenceFreq | null;
  recurrence_interval: number;
  recur_parent_id: string | null;
  completed_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

/** A task can involve several people; membership lives in its own table. */
export type TaskAssigneeRow = {
  task_id: string;
  member_id: string;
  created_at: string;
};

/** `task_id: null` means a team-wide link rather than one on a task. */
export type LinkRow = {
  id: string;
  task_id: string | null;
  url: string;
  label: string | null;
  added_by_id: string | null;
  created_at: string;
  /** Read from the page itself when saved; null when it needs a login. */
  preview_title: string | null;
  preview_description: string | null;
  preview_site: string | null;
  preview_image_path: string | null;
  preview_icon_path: string | null;
  preview_fetched_at: string | null;
};

export type SubtaskRow = {
  id: string;
  task_id: string;
  title: string;
  done: boolean;
  position: number;
  created_at: string;
};

export type CommentRow = {
  id: string;
  task_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
};

export type AttachmentRow = {
  id: string;
  task_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by_id: string | null;
  created_at: string;
};

export type NotificationRow = {
  id: string;
  recipient_id: string;
  actor_id: string | null;
  task_id: string | null;
  type: NotificationType;
  body: string;
  read: boolean;
  /** Set once this notification has been pushed to WhatsApp, so a retry can't double-ping. */
  whatsapp_sent_at: string | null;
  created_at: string;
};

export type AppSettingsRow = {
  id: boolean;
  pin_hash: string;
  pin_is_default: boolean;
  updated_at: string;
};

export type Database = {
  public: {
    Tables: {
      staff_members: Table<
        MemberRow,
        "id" | "app_user_id" | "color" | "sort_order" | "imessage_handles" | "active" | "created_at"
      >;
      staff_suggestions: Table<
        SuggestionRow,
        | "id"
        | "source"
        | "chat_guid"
        | "message_guid"
        | "sender_handle"
        | "sender_member_id"
        | "message_sent_at"
        | "proposed_description"
        | "proposed_priority"
        | "proposed_due_date"
        | "proposed_category_id"
        | "confidence"
        | "reasoning"
        | "order_reference"
        | "order_context"
        | "status"
        | "created_task_id"
        | "reviewed_by_id"
        | "reviewed_at"
        | "created_at"
      >;
      staff_suggestion_assignees: Table<SuggestionAssigneeRow>;
      staff_suggestion_attachments: Table<
        SuggestionAttachmentRow,
        "id" | "mime_type" | "size_bytes" | "created_at"
      >;
      staff_ingest_state: Table<IngestStateRow, "last_seen_at" | "updated_at">;
      staff_categories: Table<
        CategoryRow,
        "id" | "color" | "sort_order" | "created_at"
      >;
      staff_tasks: Table<
        TaskRow,
        | "id"
        | "description"
        | "status"
        | "priority"
        | "created_by_id"
        | "category_id"
        | "due_date"
        | "position"
        | "recurrence"
        | "recurrence_interval"
        | "recur_parent_id"
        | "completed_at"
        | "archived_at"
        | "created_at"
        | "updated_at"
      >;
      staff_task_assignees: Table<TaskAssigneeRow, "created_at">;
      staff_links: Table<
        LinkRow,
        | "id"
        | "task_id"
        | "label"
        | "added_by_id"
        | "created_at"
        | "preview_title"
        | "preview_description"
        | "preview_site"
        | "preview_image_path"
        | "preview_icon_path"
        | "preview_fetched_at"
      >;
      staff_subtasks: Table<SubtaskRow, "id" | "done" | "position" | "created_at">;
      staff_comments: Table<CommentRow, "id" | "author_id" | "created_at">;
      staff_attachments: Table<
        AttachmentRow,
        "id" | "mime_type" | "size_bytes" | "uploaded_by_id" | "created_at"
      >;
      staff_notifications: Table<
        NotificationRow,
        "id" | "actor_id" | "task_id" | "read" | "whatsapp_sent_at" | "created_at"
      >;
      staff_app_settings: Table<
        AppSettingsRow,
        "id" | "pin_is_default" | "updated_at"
      >;
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: {
      staff_task_status: TaskStatus;
      staff_task_priority: TaskPriority;
      staff_recurrence_freq: RecurrenceFreq;
    };
    CompositeTypes: Record<never, never>;
  };
};
