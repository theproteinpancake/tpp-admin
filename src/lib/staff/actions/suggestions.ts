"use server";

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/staff/session";
import { db } from "@/lib/staff/supabase";
import { notify } from "@/lib/staff/notify";
import { timeAgo } from "@/lib/staff/dates";
import type { OrderContext, TaskPriority } from "@/lib/staff/database.types";

export type AcceptOverrides = {
  title: string;
  description: string | null;
  priority: TaskPriority;
  dueDate: string | null;
  categoryId: string | null;
  assigneeIds: string[];
};

/** Render the Shopify lookup as a readable block on the task. */
function describeOrder(order: OrderContext): string {
  const lines = [
    `Order ${order.orderName}`,
    order.customerName && `Customer: ${order.customerName}`,
    order.email && `Email: ${order.email}`,
    order.financialStatus && `Payment: ${order.financialStatus}`,
    order.fulfillmentStatus && `Fulfilment: ${order.fulfillmentStatus}`,
    order.total && `Total: ${order.total}`,
    order.items.length > 0 && `Items: ${order.items.join(", ")}`,
  ];
  return lines.filter(Boolean).join("\n");
}

export async function acceptSuggestion(
  suggestionId: string,
  overrides: AcceptOverrides,
): Promise<{ error?: string; taskId?: string }> {
  const member = await requireMember();
  const supabase = db();

  const { data: suggestion } = await supabase
    .from("staff_suggestions")
    .select("*")
    .eq("id", suggestionId)
    .eq("status", "pending")
    .maybeSingle();

  if (!suggestion) return { error: "That suggestion has already been handled." };

  const title = overrides.title.trim().slice(0, 300);
  if (!title) return { error: "Give the task a title." };

  const description = [
    overrides.description?.trim() || null,
    suggestion.order_context ? describeOrder(suggestion.order_context) : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const { data: first } = await supabase
    .from("staff_tasks")
    .select("position")
    .eq("status", "todo")
    .is("archived_at", null)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();

  const { data: task, error } = await supabase
    .from("staff_tasks")
    .insert({
      title,
      description: description || null,
      status: "todo",
      priority: overrides.priority,
      created_by_id: member.id,
      category_id: overrides.categoryId,
      due_date: overrides.dueDate,
      position: (first?.position ?? 0) - 100,
    })
    .select("id")
    .single();

  if (error || !task) return { error: "Could not create that task." };

  if (overrides.assigneeIds.length > 0) {
    await supabase.from("staff_task_assignees").insert(
      overrides.assigneeIds.map((member_id) => ({
        task_id: task.id,
        member_id,
      })),
    );
  }

  // Keep the original message on the task so there's always provenance for why
  // it exists. Attributed to whoever sent it, where we know.
  const when = suggestion.message_sent_at
    ? timeAgo(suggestion.message_sent_at)
    : "earlier";

  await supabase.from("staff_comments").insert({
    task_id: task.id,
    author_id: suggestion.sender_member_id,
    body: `From the team chat (${when}):\n\n"${suggestion.message_text}"`,
  });

  // The uploaded file is already in storage — point the task at the same object
  // rather than copying the bytes.
  const { data: attachments } = await supabase
    .from("staff_suggestion_attachments")
    .select("*")
    .eq("suggestion_id", suggestionId);

  if (attachments && attachments.length > 0) {
    await supabase.from("staff_attachments").insert(
      attachments.map((attachment) => ({
        task_id: task.id,
        storage_path: attachment.storage_path,
        file_name: attachment.file_name,
        mime_type: attachment.mime_type,
        size_bytes: attachment.size_bytes,
        uploaded_by_id: suggestion.sender_member_id,
      })),
    );
  }

  await supabase
    .from("staff_suggestions")
    .update({
      status: "accepted",
      created_task_id: task.id,
      reviewed_by_id: member.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", suggestionId);

  await notify({
    recipientIds: overrides.assigneeIds,
    actorId: member.id,
    taskId: task.id,
    type: "assigned",
    body: `${member.name} put you on "${title}" from the team chat.`,
  });

  revalidatePath("/", "layout");
  return { taskId: task.id };
}

export async function dismissSuggestion(
  suggestionId: string,
): Promise<{ error?: string }> {
  const member = await requireMember();

  const { error } = await db()
    .from("staff_suggestions")
    .update({
      status: "dismissed",
      reviewed_by_id: member.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", suggestionId)
    .eq("status", "pending");

  if (error) return { error: "Could not dismiss that." };

  revalidatePath("/", "layout");
  return {};
}
