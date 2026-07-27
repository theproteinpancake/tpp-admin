import 'server-only';
import { db } from './supabase';

/**
 * Mark a task done from outside the board — specifically the "Mark as complete" button on a
 * WhatsApp task ping. Kept separate from the app's own server actions because those assume a
 * dashboard session (requireMember); here the caller is the WhatsApp agent, which has already
 * established who it's talking to via the allowlist.
 *
 * Deliberately does NOT handle recurrence: the board's own action re-creates the next
 * occurrence of a repeating task, and duplicating that logic here would risk two copies. A
 * recurring task completed by button is reported back so it can be checked on the board.
 */
export async function completeTaskById(taskId: string, memberName?: string):
  Promise<{ ok: true; title: string; already_done: boolean; recurring: boolean } | { error: string }> {
  const id = String(taskId || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: 'Need the task id from the ping.' };

  const { data: task } = await db()
    .from('staff_tasks')
    .select('id, title, status, recurrence, archived_at')
    .eq('id', id)
    .maybeSingle();
  if (!task) return { error: "That task no longer exists — it may have been deleted." };
  if (task.archived_at) return { error: `"${task.title}" is archived, so there's nothing to complete.` };
  if (task.status === 'done') return { ok: true, title: task.title, already_done: true, recurring: !!task.recurrence };

  const { error } = await db()
    .from('staff_tasks')
    .update({ status: 'done', completed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { error: `Couldn't update the task: ${error.message.slice(0, 120)}` };

  // Tell the people watching it, minus whoever just completed it (notify skips the actor,
  // but this path has no member id, so the actor is identified by name in the body).
  try {
    const { notify, taskWatchers } = await import('./notify');
    const watchers = await taskWatchers(id);
    await notify({
      recipientIds: watchers,
      actorId: null,
      taskId: id,
      type: 'status_changed',
      body: `${memberName || 'Someone'} marked "${task.title}" as done`,
    });
  } catch { /* the task is done either way — notifications are best-effort */ }

  return { ok: true, title: task.title, already_done: false, recurring: !!task.recurrence };
}
