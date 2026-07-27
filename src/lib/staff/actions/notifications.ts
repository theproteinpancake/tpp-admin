"use server";

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/staff/session";
import { db } from "@/lib/staff/supabase";

export async function markNotificationRead(
  notificationId: string,
): Promise<void> {
  const member = await requireMember();

  await db()
    .from("staff_notifications")
    .update({ read: true })
    .eq("id", notificationId)
    // Scoped to the caller so one member can't mark another's notifications.
    .eq("recipient_id", member.id);

  revalidatePath("/", "layout");
}

export async function markAllNotificationsRead(): Promise<void> {
  const member = await requireMember();

  await db()
    .from("staff_notifications")
    .update({ read: true })
    .eq("recipient_id", member.id)
    .eq("read", false);

  revalidatePath("/", "layout");
}
