import type {
  RecurrenceFreq,
  TaskPriority,
  TaskStatus,
} from "./database.types";

export const STATUSES: ReadonlyArray<{
  id: TaskStatus;
  label: string;
  hint: string;
}> = [
  { id: "todo", label: "To Do", hint: "Not started yet" },
  { id: "in_progress", label: "In Progress", hint: "Being worked on now" },
  // The database value stays `blocked`; only the wording changed.
  { id: "blocked", label: "Backlogged", hint: "Parked — not now, not dropped" },
  { id: "done", label: "Done", hint: "Finished" },
];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  blocked: "Backlogged",
  done: "Done",
};

/** Where the one-tap button on a card sends a task next. */
export const NEXT_STATUS: Record<TaskStatus, TaskStatus> = {
  todo: "in_progress",
  blocked: "in_progress",
  in_progress: "done",
  done: "todo",
};

export const PRIORITIES: ReadonlyArray<{
  id: TaskPriority;
  label: string;
  color: string;
  /** Lower sorts first. */
  rank: number;
}> = [
  { id: "urgent", label: "Urgent", color: "#dc2626", rank: 0 },
  { id: "high", label: "High", color: "#d97706", rank: 1 },
  { id: "medium", label: "Medium", color: "#3b82f6", rank: 2 },
  { id: "low", label: "Low", color: "#94a3b8", rank: 3 },
];

export const PRIORITY_META: Record<
  TaskPriority,
  { label: string; color: string; rank: number }
> = Object.fromEntries(
  PRIORITIES.map((p) => [p.id, { label: p.label, color: p.color, rank: p.rank }]),
) as Record<TaskPriority, { label: string; color: string; rank: number }>;

export const RECURRENCES: ReadonlyArray<{
  id: RecurrenceFreq;
  label: string;
}> = [
  { id: "daily", label: "Every day" },
  { id: "weekly", label: "Every week" },
  { id: "fortnightly", label: "Every 2 weeks" },
  { id: "monthly", label: "Every month" },
];

export const RECURRENCE_LABEL: Record<RecurrenceFreq, string> = {
  daily: "Daily",
  weekly: "Weekly",
  fortnightly: "Fortnightly",
  monthly: "Monthly",
};

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const ACCEPTED_ATTACHMENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/heic",
  "application/pdf",
];
