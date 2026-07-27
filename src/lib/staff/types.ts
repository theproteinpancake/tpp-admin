import type {
  AttachmentRow,
  CategoryRow,
  CommentRow,
  LinkRow,
  MemberRow,
  NotificationRow,
  SubtaskRow,
  SuggestionAttachmentRow,
  SuggestionRow,
  TaskRow,
} from "./database.types";

/** A task as shown on the board — counts only, no nested records. */
export type BoardTask = TaskRow & {
  assigneeIds: string[];
  subtasksTotal: number;
  subtasksDone: number;
  commentCount: number;
  attachmentCount: number;
  linkCount: number;
};

export type CommentWithAuthor = CommentRow & { author: MemberRow | null };

export type AttachmentWithUrl = AttachmentRow & {
  /** Short-lived signed URL; the bucket is private. */
  url: string | null;
  isImage: boolean;
};

export type TaskDetail = TaskRow & {
  assigneeIds: string[];
  subtasks: SubtaskRow[];
  comments: CommentWithAuthor[];
  attachments: AttachmentWithUrl[];
  links: LinkRow[];
};

/** A link in the shared Links view, with enough context to make sense alone. */
export type LinkItem = LinkRow & {
  addedBy: MemberRow | null;
  taskTitle: string | null;
  /** Short-lived signed URLs for the stored preview image and site icon. */
  previewImageUrl: string | null;
  previewIconUrl: string | null;
};

export type SuggestionAttachmentWithUrl = SuggestionAttachmentRow & {
  url: string | null;
  isImage: boolean;
};

/** A proposed task from the chat listener, with everything the reviewer needs. */
export type SuggestionItem = SuggestionRow & {
  sender: MemberRow | null;
  assigneeIds: string[];
  attachments: SuggestionAttachmentWithUrl[];
};

export type NotificationItem = NotificationRow & {
  actor: MemberRow | null;
  taskTitle: string | null;
};

export type BoardData = {
  tasks: BoardTask[];
  members: MemberRow[];
  categories: CategoryRow[];
};

export type { MemberRow, CategoryRow, TaskRow, SubtaskRow, LinkRow };
