import "server-only";
import { db } from "./supabase";
import { addDays, daysFromToday, today } from "./dates";
import type { NotificationType } from "./database.types";

/** A task shouldn't nag more than once a day about the same thing. */
const QUIET_PERIOD_HOURS = 20;

/**
 * Raise "due tomorrow" and "overdue" notifications for open tasks, to everyone
 * assigned to them.
 *
 * Runs when the board is loaded rather than on a schedule — the team opens the
 * board far more often than a cron would fire, and it keeps the deployment to a
 * single service with nothing to configure.
 */
export async function sweepDueDates(): Promise<void> {
  const supabase = db();
  const cutoff = addDays(today(), 1);

  const { data: tasks } = await supabase
    .from("staff_tasks")
    .select("id, title, due_date")
    .is("archived_at", null)
    .neq("status", "done")
    .not("due_date", "is", null)
    .lte("due_date", cutoff);

  if (!tasks || tasks.length === 0) return;

  const taskIds = tasks.map((task) => task.id);
  const since = new Date(
    Date.now() - QUIET_PERIOD_HOURS * 3_600_000,
  ).toISOString();

  const [assignees, recent] = await Promise.all([
    supabase
      .from("staff_task_assignees")
      .select("task_id, member_id")
      .in("task_id", taskIds),
    supabase
      .from("staff_notifications")
      .select("task_id, type")
      .in("type", ["due_soon", "overdue"])
      .gte("created_at", since),
  ]);

  const assigneesByTask = new Map<string, string[]>();
  for (const row of assignees.data ?? []) {
    const list = assigneesByTask.get(row.task_id) ?? [];
    list.push(row.member_id);
    assigneesByTask.set(row.task_id, list);
  }

  const alreadyNotified = new Set(
    (recent.data ?? []).map((row) => `${row.task_id}:${row.type}`),
  );

  const pending = tasks.flatMap((task) => {
    if (!task.due_date) return [];

    const people = assigneesByTask.get(task.id) ?? [];
    if (people.length === 0) return [];

    const days = daysFromToday(task.due_date);
    const type: NotificationType = days < 0 ? "overdue" : "due_soon";
    if (alreadyNotified.has(`${task.id}:${type}`)) return [];

    const body =
      days < 0
        ? `"${task.title}" is overdue.`
        : days === 0
          ? `"${task.title}" is due today.`
          : `"${task.title}" is due tomorrow.`;

    return people.map((memberId) => ({
      recipient_id: memberId,
      actor_id: null,
      task_id: task.id,
      type,
      body,
    }));
  });

  if (pending.length > 0) {
    await supabase.from("staff_notifications").insert(pending);
  }
}
