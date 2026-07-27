import "server-only";
import { ATTACHMENT_BUCKET, db } from "./supabase";
import type { CategoryRow, MemberRow } from "./database.types";
import type {
  AttachmentWithUrl,
  BoardData,
  BoardTask,
  CommentWithAuthor,
  LinkItem,
  NotificationItem,
  SuggestionAttachmentWithUrl,
  SuggestionItem,
  TaskDetail,
} from "./types";

const SIGNED_URL_TTL_SECONDS = 60 * 60;

export async function getMembers(): Promise<MemberRow[]> {
  const { data, error } = await db()
    .from("staff_members")
    .select("*")
    .order("sort_order");

  if (error) throw error;
  return data ?? [];
}

export async function getCategories(): Promise<CategoryRow[]> {
  const { data, error } = await db()
    .from("staff_categories")
    .select("*")
    .order("sort_order");

  if (error) throw error;
  return data ?? [];
}

/**
 * Everything the board needs, in one pass.
 *
 * Counts are aggregated in JS from flat selects rather than embedded PostgREST
 * aggregates — at this team's data volume the difference is immaterial and the
 * queries stay trivially typed.
 */
export async function getBoardData(): Promise<BoardData> {
  const supabase = db();

  const [
    tasks,
    members,
    categories,
    assignees,
    subtasks,
    comments,
    attachments,
    links,
  ] = await Promise.all([
    supabase
      .from("staff_tasks")
      .select("*")
      .is("archived_at", null)
      .order("position", { ascending: true }),
    supabase.from("staff_members").select("*").order("sort_order"),
    supabase.from("staff_categories").select("*").order("sort_order"),
    supabase.from("staff_task_assignees").select("task_id, member_id"),
    supabase.from("staff_subtasks").select("task_id, done"),
    supabase.from("staff_comments").select("task_id"),
    supabase.from("staff_attachments").select("task_id"),
    supabase.from("staff_links").select("task_id").not("task_id", "is", null),
  ]);

  for (const result of [
    tasks,
    members,
    categories,
    assignees,
    subtasks,
    comments,
    attachments,
    links,
  ]) {
    if (result.error) throw result.error;
  }

  type Tally = {
    assigneeIds: string[];
    subtasksTotal: number;
    subtasksDone: number;
    commentCount: number;
    attachmentCount: number;
    linkCount: number;
  };

  const tally = new Map<string, Tally>();

  const entry = (taskId: string): Tally => {
    let value = tally.get(taskId);
    if (!value) {
      value = {
        assigneeIds: [],
        subtasksTotal: 0,
        subtasksDone: 0,
        commentCount: 0,
        attachmentCount: 0,
        linkCount: 0,
      };
      tally.set(taskId, value);
    }
    return value;
  };

  // Ordered by the team's own sort order so avatar stacks are stable.
  const memberRank = new Map(
    (members.data ?? []).map((member, index) => [member.id, index]),
  );
  for (const row of assignees.data ?? []) {
    entry(row.task_id).assigneeIds.push(row.member_id);
  }
  for (const value of tally.values()) {
    value.assigneeIds.sort(
      (a, b) => (memberRank.get(a) ?? 99) - (memberRank.get(b) ?? 99),
    );
  }

  for (const row of subtasks.data ?? []) {
    const value = entry(row.task_id);
    value.subtasksTotal += 1;
    if (row.done) value.subtasksDone += 1;
  }
  for (const row of comments.data ?? []) entry(row.task_id).commentCount += 1;
  for (const row of attachments.data ?? []) {
    entry(row.task_id).attachmentCount += 1;
  }
  for (const row of links.data ?? []) {
    if (row.task_id) entry(row.task_id).linkCount += 1;
  }

  const boardTasks: BoardTask[] = (tasks.data ?? []).map((task) => ({
    ...task,
    ...(tally.get(task.id) ?? {
      assigneeIds: [],
      subtasksTotal: 0,
      subtasksDone: 0,
      commentCount: 0,
      attachmentCount: 0,
      linkCount: 0,
    }),
  }));

  return {
    tasks: boardTasks,
    members: members.data ?? [],
    categories: categories.data ?? [],
  };
}

export async function getTaskDetail(taskId: string): Promise<TaskDetail | null> {
  const supabase = db();

  const [task, assignees, subtasks, comments, attachments, links, members] =
    await Promise.all([
      supabase.from("staff_tasks").select("*").eq("id", taskId).maybeSingle(),
      supabase.from("staff_task_assignees").select("member_id").eq("task_id", taskId),
      supabase
        .from("staff_subtasks")
        .select("*")
        .eq("task_id", taskId)
        .order("position", { ascending: true }),
      supabase
        .from("staff_comments")
        .select("*")
        .eq("task_id", taskId)
        .order("created_at", { ascending: true }),
      supabase
        .from("staff_attachments")
        .select("*")
        .eq("task_id", taskId)
        .order("created_at", { ascending: true }),
      supabase
        .from("staff_links")
        .select("*")
        .eq("task_id", taskId)
        .order("created_at", { ascending: true }),
      supabase.from("staff_members").select("*").order("sort_order"),
    ]);

  if (task.error) throw task.error;
  if (!task.data) return null;

  const membersById = new Map(
    (members.data ?? []).map((member) => [member.id, member]),
  );
  const memberRank = new Map(
    (members.data ?? []).map((member, index) => [member.id, index]),
  );

  const commentsWithAuthor: CommentWithAuthor[] = (comments.data ?? []).map(
    (comment) => ({
      ...comment,
      author: comment.author_id
        ? (membersById.get(comment.author_id) ?? null)
        : null,
    }),
  );

  return {
    ...task.data,
    assigneeIds: (assignees.data ?? [])
      .map((row) => row.member_id)
      .sort((a, b) => (memberRank.get(a) ?? 99) - (memberRank.get(b) ?? 99)),
    subtasks: subtasks.data ?? [],
    comments: commentsWithAuthor,
    attachments: await signAttachments(attachments.data ?? []),
    links: links.data ?? [],
  };
}

async function signAttachments(
  rows: Array<{
    id: string;
    task_id: string;
    storage_path: string;
    file_name: string;
    mime_type: string | null;
    size_bytes: number | null;
    uploaded_by_id: string | null;
    created_at: string;
  }>,
): Promise<AttachmentWithUrl[]> {
  if (rows.length === 0) return [];

  const { data: signed } = await db()
    .storage.from(ATTACHMENT_BUCKET)
    .createSignedUrls(
      rows.map((row) => row.storage_path),
      SIGNED_URL_TTL_SECONDS,
    );

  const urlByPath = new Map(
    (signed ?? []).map((item) => [item.path, item.signedUrl]),
  );

  return rows.map((row) => ({
    ...row,
    url: urlByPath.get(row.storage_path) ?? null,
    isImage: (row.mime_type ?? "").startsWith("image/"),
  }));
}

/**
 * Every link the team has saved — the ones pinned to the team plus the ones
 * living on individual tasks, so there is a single place to look.
 */
export async function getLinks(): Promise<LinkItem[]> {
  const supabase = db();

  const { data: rows, error } = await supabase
    .from("staff_links")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  if (!rows || rows.length === 0) return [];

  const taskIds = [
    ...new Set(rows.map((row) => row.task_id).filter(Boolean)),
  ] as string[];

  const [members, tasks] = await Promise.all([
    supabase.from("staff_members").select("*"),
    taskIds.length
      ? supabase.from("staff_tasks").select("id, title").in("id", taskIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const membersById = new Map(
    (members.data ?? []).map((member) => [member.id, member]),
  );
  const titleById = new Map(
    (tasks.data ?? []).map((task) => [task.id, task.title]),
  );

  // Preview images and icons live in the private bucket, same as attachments.
  const previewPaths = rows
    .flatMap((row) => [row.preview_image_path, row.preview_icon_path])
    .filter((path): path is string => Boolean(path));

  const signedPreviews = previewPaths.length
    ? await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .createSignedUrls(previewPaths, SIGNED_URL_TTL_SECONDS)
    : { data: [] };

  const previewByPath = new Map(
    (signedPreviews.data ?? []).map((item) => [item.path, item.signedUrl]),
  );

  return rows.map((row) => ({
    ...row,
    addedBy: row.added_by_id
      ? (membersById.get(row.added_by_id) ?? null)
      : null,
    taskTitle: row.task_id ? (titleById.get(row.task_id) ?? null) : null,
    previewImageUrl: row.preview_image_path
      ? (previewByPath.get(row.preview_image_path) ?? null)
      : null,
    previewIconUrl: row.preview_icon_path
      ? (previewByPath.get(row.preview_icon_path) ?? null)
      : null,
  }));
}

/** Pending proposals from the chat listener, newest first. */
export async function getSuggestions(): Promise<SuggestionItem[]> {
  const supabase = db();

  const { data: rows, error } = await supabase
    .from("staff_suggestions")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  if (!rows || rows.length === 0) return [];

  const ids = rows.map((row) => row.id);

  const [members, assignees, attachments] = await Promise.all([
    supabase.from("staff_members").select("*").order("sort_order"),
    supabase
      .from("staff_suggestion_assignees")
      .select("suggestion_id, member_id")
      .in("suggestion_id", ids),
    supabase
      .from("staff_suggestion_attachments")
      .select("*")
      .in("suggestion_id", ids),
  ]);

  const membersById = new Map(
    (members.data ?? []).map((member) => [member.id, member]),
  );

  const assigneesBySuggestion = new Map<string, string[]>();
  for (const row of assignees.data ?? []) {
    const list = assigneesBySuggestion.get(row.suggestion_id) ?? [];
    list.push(row.member_id);
    assigneesBySuggestion.set(row.suggestion_id, list);
  }

  const attachmentRows = attachments.data ?? [];
  const signed = attachmentRows.length
    ? await supabase.storage
        .from(ATTACHMENT_BUCKET)
        .createSignedUrls(
          attachmentRows.map((row) => row.storage_path),
          SIGNED_URL_TTL_SECONDS,
        )
    : { data: [] };

  const urlByPath = new Map(
    (signed.data ?? []).map((item) => [item.path, item.signedUrl]),
  );

  const attachmentsBySuggestion = new Map<
    string,
    SuggestionAttachmentWithUrl[]
  >();
  for (const row of attachmentRows) {
    const list = attachmentsBySuggestion.get(row.suggestion_id) ?? [];
    list.push({
      ...row,
      url: urlByPath.get(row.storage_path) ?? null,
      isImage: (row.mime_type ?? "").startsWith("image/"),
    });
    attachmentsBySuggestion.set(row.suggestion_id, list);
  }

  return rows.map((row) => ({
    ...row,
    sender: row.sender_member_id
      ? (membersById.get(row.sender_member_id) ?? null)
      : null,
    assigneeIds: assigneesBySuggestion.get(row.id) ?? [],
    attachments: attachmentsBySuggestion.get(row.id) ?? [],
  }));
}

export async function getNotifications(
  memberId: string,
): Promise<NotificationItem[]> {
  const supabase = db();

  const { data: rows, error } = await supabase
    .from("staff_notifications")
    .select("*")
    .eq("recipient_id", memberId)
    .order("created_at", { ascending: false })
    .limit(40);

  if (error) throw error;
  if (!rows || rows.length === 0) return [];

  const taskIds = [...new Set(rows.map((r) => r.task_id).filter(Boolean))];

  const [members, tasks] = await Promise.all([
    supabase.from("staff_members").select("*"),
    taskIds.length
      ? supabase.from("staff_tasks").select("id, title").in("id", taskIds as string[])
      : Promise.resolve({ data: [], error: null }),
  ]);

  const membersById = new Map(
    (members.data ?? []).map((member) => [member.id, member]),
  );
  const titleById = new Map(
    (tasks.data ?? []).map((task) => [task.id, task.title]),
  );

  return rows.map((row) => ({
    ...row,
    actor: row.actor_id ? (membersById.get(row.actor_id) ?? null) : null,
    taskTitle: row.task_id ? (titleById.get(row.task_id) ?? null) : null,
  }));
}

export async function getUnreadCount(memberId: string): Promise<number> {
  const { count, error } = await db()
    .from("staff_notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", memberId)
    .eq("read", false);

  if (error) throw error;
  return count ?? 0;
}
