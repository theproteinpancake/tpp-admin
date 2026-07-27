import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ATTACHMENT_BUCKET, db, isConfigured } from "@/lib/staff/supabase";
import { ingestTokenMatches } from "@/lib/staff/ingest-token";
import { parseMessage } from "@/lib/staff/parse-message";
import { mentionsTaskTrigger, stripTaskTrigger } from "@/lib/staff/task-trigger";
import { lookupOrder } from "@/lib/staff/shopify";
import type { MemberRow } from "@/lib/staff/database.types";

export const dynamic = "force-dynamic";

/** Guard against a runaway agent posting its whole message history at once. */
const MAX_BATCH = 50;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

type IncomingAttachment = {
  fileName?: string;
  mimeType?: string;
  base64?: string;
};

type IncomingMessage = {
  guid?: string;
  chatGuid?: string;
  sender?: string;
  senderName?: string;
  text?: string;
  sentAt?: string;
  rowid?: number;
  attachments?: IncomingAttachment[];
};

function unauthorised() {
  return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

/**
 * Where the agent should resume from. Called on start-up so a Mac that has been
 * asleep for a week doesn't re-read the whole chat.
 */
export async function GET(request: Request) {
  if (!isConfigured()) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const token = bearer(request);
  if (!token || !ingestTokenMatches(token)) return unauthorised();

  const { data } = await db()
    .from("staff_ingest_state")
    .select("last_rowid, last_seen_at")
    .eq("id", "imessage")
    .maybeSingle();

  return NextResponse.json({
    lastRowid: data?.last_rowid ?? 0,
    lastSeenAt: data?.last_seen_at ?? null,
  });
}

export async function POST(request: Request) {
  if (!isConfigured()) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const token = bearer(request);
  if (!token || !ingestTokenMatches(token)) return unauthorised();

  let body: { messages?: IncomingMessage[]; cursor?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const incoming = (body.messages ?? []).slice(0, MAX_BATCH);
  const supabase = db();

  const [membersResult, categoriesResult] = await Promise.all([
    supabase.from("staff_members").select("*").order("sort_order"),
    supabase.from("staff_categories").select("id, name"),
  ]);

  const members = membersResult.data ?? [];
  const categories = categoriesResult.data ?? [];

  let created = 0;
  let skipped = 0;

  for (const message of incoming) {
    const text = (message.text ?? "").trim();
    if (!text || !message.guid) {
      skipped += 1;
      continue;
    }

    /*
     * Nothing is proposed unless the message says "task". The listener already
     * filters on this before sending, so reaching here without it means some
     * other client posted — enforce it either way, since this is the rule the
     * team relies on to keep the rest of their chat out of the app.
     */
    if (!mentionsTaskTrigger(text)) {
      skipped += 1;
      continue;
    }

    // The message GUID is unique in the database, but checking first avoids
    // burning a model call on something already triaged.
    const { data: seen } = await supabase
      .from("staff_suggestions")
      .select("id")
      .eq("message_guid", message.guid)
      .maybeSingle();

    if (seen) {
      skipped += 1;
      continue;
    }

    const sender = matchSender(members, message);

    // Parse the message without its marker, so a task doesn't end up titled
    // "Email Craig about order #2627 task". A message that is only the marker
    // says nothing worth proposing.
    const instruction = stripTaskTrigger(text);
    if (!instruction) {
      skipped += 1;
      continue;
    }

    const proposal = await parseMessage({
      text: instruction,
      senderName: sender?.name ?? message.senderName ?? null,
      memberNames: members.map((member) => member.name),
      categoryNames: categories.map((category) => category.name),
      flagged: true,
    });

    /*
     * Writing "task" IS the decision that this is a task — the parser's job
     * here is only to extract the details, not to overrule the person who
     * asked. Without this, a marked message with no recognisable cue ("task —
     * new flavour idea") would be silently dropped, which is the worst
     * possible behaviour for an explicit trigger.
     */
    const title = proposal.title || instruction.replace(/\s+/g, " ").slice(0, 120);
    if (!title) {
      skipped += 1;
      continue;
    }

    const orderContext = proposal.orderReference
      ? await lookupOrder(proposal.orderReference)
      : null;

    const categoryId =
      categories.find((category) => category.name === proposal.categoryName)
        ?.id ?? null;

    const { data: suggestion, error } = await supabase
      .from("staff_suggestions")
      .insert({
        source: "imessage",
        chat_guid: message.chatGuid ?? null,
        message_guid: message.guid,
        sender_handle: message.sender ?? null,
        sender_member_id: sender?.id ?? null,
        message_text: text.slice(0, 5000),
        message_sent_at: message.sentAt ?? null,
        proposed_title: title,
        proposed_description: proposal.description,
        proposed_priority: proposal.priority,
        proposed_due_date: proposal.dueDate,
        proposed_category_id: categoryId,
        confidence: proposal.confidence,
        reasoning: proposal.reasoning,
        order_reference: proposal.orderReference,
        order_context: orderContext,
      })
      .select("id")
      .single();

    if (error || !suggestion) {
      skipped += 1;
      continue;
    }

    const assigneeIds = proposal.assigneeNames
      .map((name) => members.find((member) => member.name === name)?.id)
      .filter((id): id is string => Boolean(id));

    if (assigneeIds.length > 0) {
      await supabase.from("staff_suggestion_assignees").insert(
        assigneeIds.map((member_id) => ({
          suggestion_id: suggestion.id,
          member_id,
        })),
      );
    }

    await storeAttachments(suggestion.id, message.attachments ?? []);
    created += 1;
  }

  if (typeof body.cursor === "number" && Number.isFinite(body.cursor)) {
    await supabase
      .from("staff_ingest_state")
      .update({
        last_rowid: Math.floor(body.cursor),
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", "imessage");
  }

  return NextResponse.json({ created, skipped });
}

/** Match an incoming handle (phone number or Apple ID) to a team member. */
function matchSender(
  members: MemberRow[],
  message: IncomingMessage,
): MemberRow | null {
  const handle = (message.sender ?? "").trim().toLowerCase();
  if (handle) {
    const digits = handle.replace(/[^0-9]/g, "");
    const match = members.find((member) =>
      member.imessage_handles.some((known) => {
        const candidate = known.trim().toLowerCase();
        if (candidate === handle) return true;
        // Phone numbers arrive in inconsistent formats; compare the last 8
        // digits so +61 4xx and 04xx resolve to the same person.
        const knownDigits = candidate.replace(/[^0-9]/g, "");
        return (
          digits.length >= 8 &&
          knownDigits.length >= 8 &&
          digits.slice(-8) === knownDigits.slice(-8)
        );
      }),
    );
    if (match) return match;
  }

  const name = (message.senderName ?? "").trim().toLowerCase();
  if (!name) return null;

  return (
    members.find(
      (member) =>
        member.name.toLowerCase() === name ||
        name.startsWith(member.name.slice(0, 3).toLowerCase()),
    ) ?? null
  );
}

async function storeAttachments(
  suggestionId: string,
  attachments: IncomingAttachment[],
): Promise<void> {
  const supabase = db();

  for (const attachment of attachments.slice(0, 5)) {
    if (!attachment.base64) continue;

    let bytes: Buffer;
    try {
      bytes = Buffer.from(attachment.base64, "base64");
    } catch {
      continue;
    }

    if (bytes.byteLength === 0 || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      continue;
    }

    const safeName = (attachment.fileName ?? "attachment")
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      .slice(-80);
    const path = `suggestions/${suggestionId}/${randomUUID()}-${safeName}`;

    const { error } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .upload(path, bytes, {
        contentType: attachment.mimeType || "application/octet-stream",
        upsert: false,
      });

    if (error) continue;

    await supabase.from("staff_suggestion_attachments").insert({
      suggestion_id: suggestionId,
      storage_path: path,
      file_name: safeName,
      mime_type: attachment.mimeType ?? null,
      size_bytes: bytes.byteLength,
    });
  }
}
