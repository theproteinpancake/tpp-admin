"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/staff/session";
import { ATTACHMENT_BUCKET, db } from "@/lib/staff/supabase";
import { notify, taskAssignees, taskWatchers } from "@/lib/staff/notify";
import { findMentions } from "@/lib/staff/mentions";
import { addDays, addMonths, dayDiff, today } from "@/lib/staff/dates";
import {
  ACCEPTED_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  NEXT_STATUS,
  STATUS_LABEL,
} from "@/lib/staff/constants";
import type {
  RecurrenceFreq,
  TaskPriority,
  TaskRow,
  TaskStatus,
} from "@/lib/staff/database.types";

const STATUS_VALUES: TaskStatus[] = ["todo", "in_progress", "blocked", "done"];
const PRIORITY_VALUES: TaskPriority[] = ["urgent", "high", "medium", "low"];
const RECURRENCE_VALUES: RecurrenceFreq[] = [
  "daily",
  "weekly",
  "fortnightly",
  "monthly",
];

function refreshBoard() {
  revalidatePath("/", "layout");
}

/* ------------------------------------------------------------------ *
 * Parsing helpers
 *
 * Actions are a public POST endpoint, so every value coming in is
 * treated as untrusted and narrowed to a known-good shape.
 * ------------------------------------------------------------------ */

function asStatus(value: unknown): TaskStatus | null {
  return STATUS_VALUES.includes(value as TaskStatus)
    ? (value as TaskStatus)
    : null;
}

function asPriority(value: unknown): TaskPriority | null {
  return PRIORITY_VALUES.includes(value as TaskPriority)
    ? (value as TaskPriority)
    : null;
}

function asRecurrence(value: unknown): RecurrenceFreq | null {
  return RECURRENCE_VALUES.includes(value as RecurrenceFreq)
    ? (value as RecurrenceFreq)
    : null;
}

function asDate(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function asUuid(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    text,
  )
    ? text
    : null;
}

function asUuidList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values
        .map((value) => asUuid(value))
        .filter((value): value is string => value !== null),
    ),
  ].slice(0, 20);
}

function asTitle(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 300) : "";
}

/* ------------------------------------------------------------------ *
 * Assignees
 * ------------------------------------------------------------------ */

/** Replace a task's people, returning only those newly added. */
async function setAssignees(
  taskId: string,
  memberIds: string[],
): Promise<string[]> {
  const supabase = db();
  const existing = await taskAssignees(taskId);

  const removed = existing.filter((id) => !memberIds.includes(id));
  const added = memberIds.filter((id) => !existing.includes(id));

  if (removed.length > 0) {
    await supabase
      .from("staff_task_assignees")
      .delete()
      .eq("task_id", taskId)
      .in("member_id", removed);
  }

  if (added.length > 0) {
    await supabase
      .from("staff_task_assignees")
      .insert(added.map((member_id) => ({ task_id: taskId, member_id })));
  }

  return added;
}

/* ------------------------------------------------------------------ *
 * Ordering
 *
 * Cards carry a float position. A drop between two cards takes the
 * midpoint, so a move is a single UPDATE rather than a rewrite of the
 * whole column. If the gap ever collapses, the column is renumbered.
 * ------------------------------------------------------------------ */

const MIN_GAP = 1e-6;

async function renumberColumn(status: TaskStatus): Promise<void> {
  const supabase = db();
  const { data } = await supabase
    .from("staff_tasks")
    .select("id")
    .eq("status", status)
    .is("archived_at", null)
    .order("position", { ascending: true });

  await Promise.all(
    (data ?? []).map((row, index) =>
      supabase
        .from("staff_tasks")
        .update({ position: index * 100 })
        .eq("id", row.id),
    ),
  );
}

async function topOfColumn(status: TaskStatus): Promise<number> {
  const { data } = await db()
    .from("staff_tasks")
    .select("position")
    .eq("status", status)
    .is("archived_at", null)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  return (data?.position ?? 0) - 100;
}

/* ------------------------------------------------------------------ *
 * Recurrence
 * ------------------------------------------------------------------ */

function advanceDate(
  from: string,
  freq: RecurrenceFreq,
  interval: number,
): string {
  switch (freq) {
    case "daily":
      return addDays(from, interval);
    case "weekly":
      return addDays(from, 7 * interval);
    case "fortnightly":
      return addDays(from, 14 * interval);
    case "monthly":
      return addMonths(from, interval);
  }
}

/** Next occurrence strictly in the future, so a long-neglected task doesn't reappear overdue. */
function nextOccurrence(
  from: string,
  freq: RecurrenceFreq,
  interval: number,
): string {
  let next = advanceDate(from, freq, interval);
  let guard = 0;
  while (dayDiff(today(), next) < 0 && guard < 500) {
    next = advanceDate(next, freq, interval);
    guard += 1;
  }
  return next;
}

/** Clone a completed recurring task forward, resetting its checklist. */
async function spawnNextOccurrence(taskId: string): Promise<void> {
  const supabase = db();

  const { data: task } = await supabase
    .from("staff_tasks")
    .select("*")
    .eq("id", taskId)
    .maybeSingle();

  if (!task?.recurrence) return;

  const base = task.due_date ?? today();
  const dueDate = nextOccurrence(base, task.recurrence, task.recurrence_interval);

  const { data: created } = await supabase
    .from("staff_tasks")
    .insert({
      title: task.title,
      description: task.description,
      status: "todo",
      priority: task.priority,
      created_by_id: task.created_by_id,
      category_id: task.category_id,
      due_date: dueDate,
      position: task.position,
      recurrence: task.recurrence,
      recurrence_interval: task.recurrence_interval,
      recur_parent_id: task.recur_parent_id ?? task.id,
    })
    .select("id")
    .single();

  if (!created) return;

  const people = await taskAssignees(taskId);
  if (people.length > 0) {
    await supabase
      .from("staff_task_assignees")
      .insert(people.map((member_id) => ({ task_id: created.id, member_id })));
  }

  // Carry the checklist and links over; the checklist starts unticked.
  const [subtasks, links] = await Promise.all([
    supabase
      .from("staff_subtasks")
      .select("title, position")
      .eq("task_id", taskId)
      .order("position", { ascending: true }),
    supabase.from("staff_links").select("url, label").eq("task_id", taskId),
  ]);

  if (subtasks.data && subtasks.data.length > 0) {
    await supabase.from("staff_subtasks").insert(
      subtasks.data.map((subtask) => ({
        task_id: created.id,
        title: subtask.title,
        position: subtask.position,
        done: false,
      })),
    );
  }

  if (links.data && links.data.length > 0) {
    await supabase.from("staff_links").insert(
      links.data.map((link) => ({
        task_id: created.id,
        url: link.url,
        label: link.label,
      })),
    );
  }

  // The repeat is only useful if someone knows it exists — but it goes to the bell only.
  // A WhatsApp ping here fired the instant you ticked the current one ("Someone added a new
  // task…", for something due five weeks out), which read as the task not having completed.
  // It surfaces on the board on its due date, and the due-date sweep pings then.
  await notify({
    recipientIds: people,
    actorId: null,
    taskId: created.id,
    type: "assigned",
    body: `"${task.title}" repeats — the next one is due ${dueDate}.`,
    silent: true,
  });
}

/* ------------------------------------------------------------------ *
 * Tasks
 * ------------------------------------------------------------------ */

export async function createTask(
  formData: FormData,
): Promise<{ id: string } | { error: string }> {
  const member = await requireMember();
  const supabase = db();

  const title = asTitle(formData.get("title"));
  if (!title) return { error: "Give the task a title." };

  const description = String(formData.get("description") ?? "").trim();
  const status = asStatus(formData.get("status")) ?? "todo";
  const priority = asPriority(formData.get("priority")) ?? "medium";
  const categoryId = asUuid(formData.get("categoryId"));
  const dueDate = asDate(formData.get("dueDate"));
  const recurrence = asRecurrence(formData.get("recurrence"));
  const assigneeIds = asUuidList(formData.getAll("assigneeIds"));

  const { data: task, error } = await supabase
    .from("staff_tasks")
    .insert({
      title,
      description: description || null,
      status,
      priority,
      created_by_id: member.id,
      category_id: categoryId,
      due_date: dueDate,
      // New tasks land at the top of their column.
      position: await topOfColumn(status),
      recurrence,
      recurrence_interval: 1,
    })
    .select("id")
    .single();

  if (error || !task) return { error: "Could not save that task." };

  // Anyone named in the notes is on the job too.
  const { data: members } = await supabase.from("staff_members").select("id, name");
  const mentioned = findMentions(`${title} ${description}`, members ?? []);
  const people = [...new Set([...assigneeIds, ...mentioned])];

  if (people.length > 0) await setAssignees(task.id, people);

  const checklist = String(formData.get("checklist") ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 50);

  if (checklist.length > 0) {
    await supabase.from("staff_subtasks").insert(
      checklist.map((line, index) => ({
        task_id: task.id,
        title: line.slice(0, 300),
        position: index * 100,
      })),
    );
  }

  const linkUrl = String(formData.get("linkUrl") ?? "").trim();
  if (linkUrl) {
    const normalised = /^https?:\/\//i.test(linkUrl)
      ? linkUrl
      : `https://${linkUrl}`;
    try {
      const parsed = new URL(normalised);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        await supabase.from("staff_links").insert({
          task_id: task.id,
          url: parsed.toString(),
          label: String(formData.get("linkLabel") ?? "").trim() || null,
          added_by_id: member.id,
        });
      }
    } catch {
      // A malformed link shouldn't lose the task that was just created.
    }
  }

  const files = formData.getAll("files").filter(isUploadableFile);
  if (files.length > 0) await storeFiles(task.id, member.id, files);

  await notify({
    recipientIds: people,
    actorId: member.id,
    taskId: task.id,
    type: "assigned",
    body: `${member.name} put you on "${title}".`,
  });

  refreshBoard();
  return { id: task.id };
}

export type TaskPatch = {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  assigneeIds?: string[];
  categoryId?: string | null;
  dueDate?: string | null;
  status?: TaskStatus;
  recurrence?: RecurrenceFreq | null;
};

export async function updateTask(
  taskId: string,
  patch: TaskPatch,
): Promise<{ error?: string }> {
  const member = await requireMember();
  const id = asUuid(taskId);
  if (!id) return { error: "Unknown task." };

  const supabase = db();
  const { data: before } = await supabase
    .from("staff_tasks")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!before) return { error: "That task no longer exists." };

  const update: Partial<TaskRow> = {};

  if (patch.title !== undefined) {
    const title = asTitle(patch.title);
    if (!title) return { error: "A task needs a title." };
    update.title = title;
  }
  if (patch.description !== undefined) {
    const text = (patch.description ?? "").trim();
    update.description = text ? text.slice(0, 10_000) : null;
  }
  if (patch.priority !== undefined) {
    const priority = asPriority(patch.priority);
    if (priority) update.priority = priority;
  }
  if (patch.categoryId !== undefined) {
    update.category_id = patch.categoryId ? asUuid(patch.categoryId) : null;
  }
  if (patch.dueDate !== undefined) {
    update.due_date = patch.dueDate ? asDate(patch.dueDate) : null;
  }
  if (patch.recurrence !== undefined) {
    update.recurrence = patch.recurrence ? asRecurrence(patch.recurrence) : null;
  }
  if (patch.status !== undefined) {
    const status = asStatus(patch.status);
    if (status) {
      update.status = status;
      update.completed_at = status === "done" ? new Date().toISOString() : null;

      // Changing status from the task dialog should land the card somewhere
      // predictable, not wherever its old position happened to fall.
      if (status !== before.status) {
        update.position = await topOfColumn(status);
      }
    }
  }

  const title = update.title ?? before.title;

  if (patch.assigneeIds !== undefined) {
    const added = await setAssignees(id, asUuidList(patch.assigneeIds));
    await notify({
      recipientIds: added,
      actorId: member.id,
      taskId: id,
      type: "assigned",
      body: `${member.name} put you on "${title}".`,
    });
  }

  if (Object.keys(update).length > 0) {
    const { error } = await supabase.from("staff_tasks").update(update).eq("id", id);
    if (error) return { error: "Could not save that change." };
  }

  if (
    patch.dueDate !== undefined &&
    (update.due_date ?? null) !== before.due_date
  ) {
    await notify({
      recipientIds: await taskWatchers(id),
      actorId: member.id,
      taskId: id,
      type: "status_changed",
      body: update.due_date
        ? `${member.name} moved "${title}" to ${update.due_date}.`
        : `${member.name} removed the due date from "${title}".`,
    });
  }

  if (update.status && update.status !== before.status) {
    await notify({
      recipientIds: await taskWatchers(id),
      actorId: member.id,
      taskId: id,
      type: "status_changed",
      body: `${member.name} moved "${title}" to ${STATUS_LABEL[update.status]}.`,
    });

    if (update.status === "done" && before.recurrence) {
      await spawnNextOccurrence(id);
    }
  }

  refreshBoard();
  return {};
}

/**
 * One-tap progression from a card: To Do and Blocked start, In Progress
 * finishes, Done reopens.
 */
export async function advanceTask(
  taskId: string,
): Promise<{ error?: string; status?: TaskStatus }> {
  const member = await requireMember();

  const id = asUuid(taskId);
  if (!id) return { error: "Unknown task." };

  const { data: task } = await db()
    .from("staff_tasks")
    .select("status")
    .eq("id", id)
    .maybeSingle();

  if (!task) return { error: "That task no longer exists." };

  const next = NEXT_STATUS[task.status];

  // Starting an unclaimed job makes it yours. Without this, work drifts into
  // In Progress with nobody's name against it and the board stops answering
  // "who is on this". Only when it's genuinely unassigned — someone starting
  // a job on another person's behalf shouldn't take it off them.
  const claiming =
    next === "in_progress" && (await taskAssignees(id)).length === 0;

  const result = await updateTask(id, {
    status: next,
    ...(claiming ? { assigneeIds: [member.id] } : {}),
  });

  return result.error ? result : { status: next };
}

/**
 * Drop a card into a column between two neighbours. Pass the positions of the
 * cards immediately above and below the drop point, or null at either end.
 */
export async function moveTask(
  taskId: string,
  newStatus: TaskStatus,
  above: number | null,
  below: number | null,
): Promise<{ error?: string }> {
  const member = await requireMember();

  const id = asUuid(taskId);
  const status = asStatus(newStatus);
  if (!id || !status) return { error: "Unknown task." };

  const supabase = db();
  const { data: before } = await supabase
    .from("staff_tasks")
    .select("status, title, recurrence")
    .eq("id", id)
    .maybeSingle();

  if (!before) return { error: "That task no longer exists." };

  let position: number;
  let needsRenumber = false;

  if (above === null && below === null) position = 0;
  else if (above === null) position = (below as number) - 100;
  else if (below === null) position = above + 100;
  else {
    position = (above + below) / 2;
    needsRenumber = Math.abs(below - above) < MIN_GAP;
  }

  const changingStatus = before.status !== status;

  const { error } = await supabase
    .from("staff_tasks")
    .update({
      position,
      status,
      ...(changingStatus
        ? {
            completed_at: status === "done" ? new Date().toISOString() : null,
          }
        : {}),
    })
    .eq("id", id);

  if (error) return { error: "Could not move that task." };

  if (needsRenumber) await renumberColumn(status);

  if (changingStatus) {
    await notify({
      recipientIds: await taskWatchers(id),
      actorId: member.id,
      taskId: id,
      type: "status_changed",
      body: `${member.name} moved "${before.title}" to ${STATUS_LABEL[status]}.`,
    });

    if (status === "done" && before.recurrence) {
      await spawnNextOccurrence(id);
    }
  }

  refreshBoard();
  return {};
}

export async function deleteTask(taskId: string): Promise<{ error?: string }> {
  await requireMember();
  const id = asUuid(taskId);
  if (!id) return { error: "Unknown task." };

  const supabase = db();

  // Rows cascade, but storage objects do not.
  const { data: attachments } = await supabase
    .from("staff_attachments")
    .select("storage_path")
    .eq("task_id", id);

  if (attachments && attachments.length > 0) {
    await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .remove(attachments.map((a) => a.storage_path));
  }

  const { error } = await supabase.from("staff_tasks").delete().eq("id", id);
  if (error) return { error: "Could not delete that task." };

  refreshBoard();
  return {};
}

/* ------------------------------------------------------------------ *
 * Subtasks
 * ------------------------------------------------------------------ */

export async function addSubtask(
  taskId: string,
  title: string,
): Promise<{ error?: string }> {
  const member = await requireMember();

  const id = asUuid(taskId);
  const text = asTitle(title);
  if (!id) return { error: "Unknown task." };
  if (!text) return { error: "Give the step a name." };

  const supabase = db();
  const [{ data: last }, { data: task }, { data: members }] = await Promise.all([
    supabase
      .from("staff_subtasks")
      .select("position")
      .eq("task_id", id)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("staff_tasks").select("title").eq("id", id).maybeSingle(),
    supabase.from("staff_members").select("id, name"),
  ]);

  await supabase.from("staff_subtasks").insert({
    task_id: id,
    title: text,
    position: (last?.position ?? 0) + 100,
  });

  // Naming someone in a step puts them on the job, same as in a comment.
  const mentioned = findMentions(text, members ?? []).filter(
    (personId) => personId !== member.id,
  );

  if (mentioned.length > 0) {
    const existing = await taskAssignees(id);
    await setAssignees(id, [...new Set([...existing, ...mentioned])]);

    await notify({
      recipientIds: mentioned,
      actorId: member.id,
      taskId: id,
      type: "mentioned",
      body: `${member.name} tagged you on a step of "${task?.title ?? "a task"}".`,
    });
  }

  refreshBoard();
  return {};
}

/**
 * Persist a new checklist order. Takes the whole ordered list rather than a
 * single move — a checklist is short, and rewriting it outright avoids any
 * chance of two reorders interleaving into a nonsense order.
 */
export async function reorderSubtasks(
  taskId: string,
  orderedIds: string[],
): Promise<{ error?: string }> {
  await requireMember();

  const id = asUuid(taskId);
  if (!id) return { error: "Unknown task." };

  const ids = asUuidList(orderedIds);
  if (ids.length === 0) return {};

  const supabase = db();

  // Only reorder steps that actually belong to this task.
  const { data: owned } = await supabase
    .from("staff_subtasks")
    .select("id")
    .eq("task_id", id);

  const allowed = new Set((owned ?? []).map((row) => row.id));

  await Promise.all(
    ids
      .filter((subtaskId) => allowed.has(subtaskId))
      .map((subtaskId, index) =>
        supabase
          .from("staff_subtasks")
          .update({ position: index * 100 })
          .eq("id", subtaskId),
      ),
  );

  refreshBoard();
  return {};
}

export async function setSubtaskDone(
  subtaskId: string,
  done: boolean,
): Promise<{ error?: string }> {
  await requireMember();
  const id = asUuid(subtaskId);
  if (!id) return { error: "Unknown step." };

  await db()
    .from("staff_subtasks")
    .update({ done: Boolean(done) })
    .eq("id", id);

  refreshBoard();
  return {};
}

export async function deleteSubtask(
  subtaskId: string,
): Promise<{ error?: string }> {
  await requireMember();
  const id = asUuid(subtaskId);
  if (!id) return { error: "Unknown step." };

  await db().from("staff_subtasks").delete().eq("id", id);

  refreshBoard();
  return {};
}

/* ------------------------------------------------------------------ *
 * Comments
 * ------------------------------------------------------------------ */

export async function addComment(
  taskId: string,
  body: string,
): Promise<{ error?: string }> {
  const member = await requireMember();

  const id = asUuid(taskId);
  const text = typeof body === "string" ? body.trim().slice(0, 5000) : "";
  if (!id) return { error: "Unknown task." };
  if (!text) return { error: "Write something first." };

  const supabase = db();
  const { data: task } = await supabase
    .from("staff_tasks")
    .select("title")
    .eq("id", id)
    .maybeSingle();

  if (!task) return { error: "That task no longer exists." };

  // Watchers are read before inserting so the author isn't counted twice.
  const watchers = await taskWatchers(id);

  const { error } = await supabase.from("staff_comments").insert({
    task_id: id,
    author_id: member.id,
    body: text,
  });

  if (error) return { error: "Could not post that comment." };

  // Naming someone in a comment puts them on the task.
  const { data: members } = await supabase.from("staff_members").select("id, name");
  const mentioned = findMentions(text, members ?? []).filter(
    (personId) => personId !== member.id,
  );

  if (mentioned.length > 0) {
    const existing = await taskAssignees(id);
    const added = await setAssignees(id, [
      ...new Set([...existing, ...mentioned]),
    ]);

    await notify({
      recipientIds: mentioned,
      actorId: member.id,
      taskId: id,
      type: "mentioned",
      body: added.length
        ? `${member.name} tagged you on "${task.title}".`
        : `${member.name} mentioned you on "${task.title}".`,
    });
  }

  await notify({
    recipientIds: watchers.filter((personId) => !mentioned.includes(personId)),
    actorId: member.id,
    taskId: id,
    type: "commented",
    body: `${member.name} commented on "${task.title}".`,
  });

  refreshBoard();
  return {};
}

/* ------------------------------------------------------------------ *
 * Attachments
 * ------------------------------------------------------------------ */

function isUploadableFile(value: FormDataEntryValue): value is File {
  return value instanceof File && value.size > 0;
}

function safeFileName(name: string): string {
  return (
    name
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      .replace(/-+/g, "-")
      .slice(-80) || "file"
  );
}

async function storeFiles(
  taskId: string,
  memberId: string,
  files: File[],
): Promise<string | null> {
  const supabase = db();

  for (const file of files.slice(0, 10)) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return `"${file.name}" is larger than 10MB.`;
    }
    if (file.type && !ACCEPTED_ATTACHMENT_TYPES.includes(file.type)) {
      return `"${file.name}" isn't an image or PDF.`;
    }

    const path = `${taskId}/${randomUUID()}-${safeFileName(file.name)}`;
    const bytes = new Uint8Array(await file.arrayBuffer());

    const { error } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .upload(path, bytes, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (error) return `Could not upload "${file.name}".`;

    await supabase.from("staff_attachments").insert({
      task_id: taskId,
      storage_path: path,
      file_name: file.name.slice(0, 200),
      mime_type: file.type || null,
      size_bytes: file.size,
      uploaded_by_id: memberId,
    });
  }

  return null;
}

export async function uploadAttachments(
  formData: FormData,
): Promise<{ error?: string }> {
  const member = await requireMember();

  const taskId = asUuid(formData.get("taskId"));
  if (!taskId) return { error: "Unknown task." };

  const files = formData.getAll("files").filter(isUploadableFile);
  if (files.length === 0) return { error: "Pick a file first." };

  const failure = await storeFiles(taskId, member.id, files);
  if (failure) return { error: failure };

  refreshBoard();
  return {};
}

export async function deleteAttachment(
  attachmentId: string,
): Promise<{ error?: string }> {
  await requireMember();
  const id = asUuid(attachmentId);
  if (!id) return { error: "Unknown attachment." };

  const supabase = db();
  const { data: attachment } = await supabase
    .from("staff_attachments")
    .select("storage_path")
    .eq("id", id)
    .maybeSingle();

  if (attachment) {
    await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .remove([attachment.storage_path]);
  }

  await supabase.from("staff_attachments").delete().eq("id", id);

  refreshBoard();
  return {};
}
