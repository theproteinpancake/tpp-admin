"use server";

import { requireMember } from "@/lib/staff/session";
import { getTaskDetail } from "@/lib/staff/data";
import type { TaskDetail } from "@/lib/staff/types";

/**
 * Comments, checklist and attachments for one task. Kept out of the board
 * payload so opening a card is the only thing that pays for them.
 */
export async function loadTaskDetail(
  taskId: string,
): Promise<TaskDetail | null> {
  await requireMember();
  return getTaskDetail(taskId);
}
