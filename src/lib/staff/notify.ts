import "server-only";
import { db } from "./supabase";
import type { NotificationType } from "./database.types";

type NotifyInput = {
  recipientIds: Array<string | null | undefined>;
  actorId: string | null;
  taskId: string | null;
  type: NotificationType;
  body: string;
};

/**
 * Fan a notification out to a set of people, skipping duplicates and never
 * notifying the person who caused the event.
 */
export async function notify({
  recipientIds,
  actorId,
  taskId,
  type,
  body,
}: NotifyInput): Promise<void> {
  const recipients = [...new Set(recipientIds)].filter(
    (id): id is string => Boolean(id) && id !== actorId,
  );

  if (recipients.length === 0) return;

  const { data: inserted } = await db()
    .from("staff_notifications")
    .insert(
      recipients.map((recipient_id) => ({
        recipient_id,
        actor_id: actorId,
        task_id: taskId,
        type,
        body,
      })),
    )
    .select("id, recipient_id, type, body, task_id");

  // WhatsApp push happens here because every notifying path funnels through notify() —
  // 11 call sites, one hook. Best-effort and non-blocking: a Twilio hiccup must never fail
  // the task action that triggered it.
  void pushToWhatsApp(inserted ?? [], actorId).catch(() => {});
}

/**
 * Which notifications are worth interrupting someone's phone for. Deliberately narrow:
 * being handed work, or being named in it. Comments, status changes and due-date sweeps stay
 * in the in-app bell — a chatty task would otherwise fire a ping per comment, which is exactly
 * the notification spam Luke pruned out of the morning briefs.
 */
const WHATSAPP_TYPES: NotificationType[] = ["assigned", "mentioned"];

async function pushToWhatsApp(
  rows: { id: string; recipient_id: string; type: NotificationType; body: string; task_id: string | null }[],
  actorId: string | null,
): Promise<void> {
  const pushable = rows.filter((r) => WHATSAPP_TYPES.includes(r.type));
  if (!pushable.length) return;

  const supabase = db();
  const [{ data: members }, actor] = await Promise.all([
    supabase
      .from("staff_members")
      .select("id, name, app_user_id")
      .in("id", pushable.map((r) => r.recipient_id)),
    actorId
      ? supabase.from("staff_members").select("name").eq("id", actorId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!members?.length) return;

  const { supabaseLogistics } = await import("../supabase-logistics");
  const { sendWhatsApp, sendWhatsAppTemplate, hasOpenSession, allowedNumbers, senderRole, waAddr } =
    await import("../whatsapp");
  const { getTemplateSid } = await import("../waTemplates");
  const { recordProactiveContext } = await import("../stockAgent");
  const APP_URL = process.env.PUBLIC_APP_URL || "https://admin.theproteinpancake.co";

  const appUserIds = members.map((m) => m.app_user_id).filter(Boolean) as string[];
  const { data: users } = appUserIds.length
    ? await supabaseLogistics.from("app_users").select("id, whatsapp, role").in("id", appUserIds)
    : { data: [] as { id: string; whatsapp: string | null; role: string }[] };
  const userById = new Map((users ?? []).map((u: any) => [u.id, u]));

  // Owners' numbers live in the agent allowlist rather than app_users.whatsapp, so fall back
  // to it — otherwise Luke (no whatsapp column set) would silently never be pinged.
  const ownerNumber = allowedNumbers().find((n) => senderRole(n) === "owner") || "";
  const actorName = (actor?.data as { name?: string } | null)?.name || "Someone";

  const sentIds: string[] = [];
  for (const row of pushable) {
    const member = members.find((m) => m.id === row.recipient_id);
    const user = member?.app_user_id ? userById.get(member.app_user_id) : null;
    const to = user?.whatsapp || (user?.role === "owner" || user?.role === "admin" ? ownerNumber : "");
    if (!to) continue; // no number on file — the in-app bell still has it

    const verb = row.type === "assigned" ? "added a new task to your to do list" : "mentioned you in a task";
    // Deep link straight to the task rather than "go and find it" directions.
    const link = row.task_id ? `${APP_URL}/staff/todos?task=${row.task_id}` : `${APP_URL}/staff/todos`;
    const text = `📋 *${actorName}* ${verb}:\n\n${row.body}\n\n${link}`;

    // WhatsApp only allows free-form inside a 24h session (i.e. if they've messaged us
    // recently). Outside it, Meta silently drops free-form (error 63016), which is how the
    // sales review used to vanish. So: free-form when the window is open, approved template
    // when it isn't — a teammate who has never messaged the number still gets told.
    const inSession = await hasOpenSession(waAddr(to)).catch(() => false);
    let ok: string | boolean = false;
    if (inSession) ok = await sendWhatsApp(waAddr(to), text).catch(() => false);
    if (!ok) {
      const sid = await getTemplateSid("tpp_task_assigned").catch(() => null);
      if (sid) {
        ok = await sendWhatsAppTemplate(waAddr(to), sid, {
          "1": actorName.slice(0, 60),
          "2": verb,
          "3": `${row.body}\n${link}`.slice(0, 550),
        }).catch(() => false);
      }
    }
    if (!ok && !inSession) ok = await sendWhatsApp(waAddr(to), text).catch(() => false); // last resort
    if (ok) {
      sentIds.push(row.id);
      if (row.task_id) {
        const { sendWhatsAppButtons } = await import("../whatsapp");
        await sendWhatsAppButtons(waAddr(to), "Tap an option 👇", ["Mark as complete", "Not now"]).catch(() => false);
      }
      await recordProactiveContext(
        waAddr(to),
        `TASK PING just sent: ${actorName} ${verb} — "${row.body}"${row.task_id ? ` (task_id "${row.task_id}")` : ""}. PENDING TASK ACTION: if their next message is "Mark as complete" (or "done"/"completed"/"finished" about this task), call complete_task with task_id "${row.task_id}". "Not now" means leave it — just acknowledge briefly. The board is Staff → To do lists in TPP Control: ${link}`,
      ).catch(() => {});
    }
  }

  // Stamp what actually went out, so any future resend/retry can't double-ping.
  if (sentIds.length) {
    await supabase
      .from("staff_notifications")
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .in("id", sentIds);
  }
}

/** Everyone currently assigned to a task. */
export async function taskAssignees(taskId: string): Promise<string[]> {
  const { data } = await db()
    .from("staff_task_assignees")
    .select("member_id")
    .eq("task_id", taskId);

  return (data ?? []).map((row) => row.member_id);
}

/**
 * People with a stake in a task: everyone assigned to it, whoever created it,
 * and anyone who has commented on it.
 */
export async function taskWatchers(taskId: string): Promise<string[]> {
  const supabase = db();

  const [task, assignees, comments] = await Promise.all([
    supabase
      .from("staff_tasks")
      .select("created_by_id")
      .eq("id", taskId)
      .maybeSingle(),
    supabase.from("staff_task_assignees").select("member_id").eq("task_id", taskId),
    supabase.from("staff_comments").select("author_id").eq("task_id", taskId),
  ]);

  const ids = [
    task.data?.created_by_id,
    ...(assignees.data ?? []).map((row) => row.member_id),
    ...(comments.data ?? []).map((row) => row.author_id),
  ];

  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}
