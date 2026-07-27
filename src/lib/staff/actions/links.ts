"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/staff/session";
import { ATTACHMENT_BUCKET, db } from "@/lib/staff/supabase";
import { notify, taskWatchers } from "@/lib/staff/notify";
import { fetchLinkPreview } from "@/lib/staff/link-preview";

/**
 * Accepts what people actually paste. Anything without a scheme is assumed to
 * be https, and only http(s) is allowed through — a `javascript:` URL rendered
 * as an anchor would be a script-injection route.
 */
function normaliseUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2000) return null;

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname.includes(".")) return null;

  return parsed.toString();
}

export async function addLink(input: {
  url: string;
  label?: string;
  taskId?: string | null;
}): Promise<{ error?: string }> {
  const member = await requireMember();

  const url = normaliseUrl(input.url ?? "");
  if (!url) return { error: "That doesn't look like a web address." };

  const label = (input.label ?? "").trim().slice(0, 200) || null;
  const taskId = input.taskId ?? null;

  const { data: link, error } = await db()
    .from("staff_links")
    .insert({
      task_id: taskId,
      url,
      label,
      added_by_id: member.id,
    })
    .select("id")
    .single();

  if (error || !link) return { error: "Could not save that link." };

  await capturePreview(link.id, url);

  if (taskId) {
    const { data: task } = await db()
      .from("staff_tasks")
      .select("title")
      .eq("id", taskId)
      .maybeSingle();

    if (task) {
      await notify({
        recipientIds: await taskWatchers(taskId),
        actorId: member.id,
        taskId,
        type: "commented",
        body: `${member.name} added a link to "${task.title}".`,
      });
    }
  }

  revalidatePath("/", "layout");
  return {};
}

/**
 * Read the page's own title and preview image and store them alongside the
 * link. Runs inline so the card is complete the moment it appears; every
 * failure path is swallowed because a missing preview must never cost you the
 * link itself.
 */
async function store(
  linkId: string,
  kind: "image" | "icon",
  file: { bytes: Uint8Array; contentType: string } | null,
): Promise<string | null> {
  if (!file) return null;

  const extension =
    file.contentType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "img";
  const path = `link-previews/${linkId}/${kind}-${randomUUID()}.${extension}`;

  const { error } = await db()
    .storage.from(ATTACHMENT_BUCKET)
    .upload(path, file.bytes, {
      contentType: file.contentType,
      upsert: false,
    });

  return error ? null : path;
}

async function capturePreview(linkId: string, url: string): Promise<void> {
  const supabase = db();

  try {
    const preview = await fetchLinkPreview(url);
    if (!preview) {
      await supabase
        .from("staff_links")
        .update({ preview_fetched_at: new Date().toISOString() })
        .eq("id", linkId);
      return;
    }

    const [imagePath, iconPath] = await Promise.all([
      store(linkId, "image", preview.image),
      store(linkId, "icon", preview.icon),
    ]);

    await supabase
      .from("staff_links")
      .update({
        preview_title: preview.title,
        preview_description: preview.description,
        preview_site: preview.siteName,
        preview_image_path: imagePath,
        preview_icon_path: iconPath,
        preview_fetched_at: new Date().toISOString(),
      })
      .eq("id", linkId);
  } catch {
    // Preview is a bonus; the link is the point.
  }
}

/** Retry a link saved before previews existed, or one whose fetch failed. */
export async function refreshLinkPreview(
  linkId: string,
): Promise<{ error?: string }> {
  await requireMember();

  const { data: link } = await db()
    .from("staff_links")
    .select("id, url")
    .eq("id", linkId)
    .maybeSingle();

  if (!link) return { error: "That link no longer exists." };

  await capturePreview(link.id, link.url);
  revalidatePath("/", "layout");
  return {};
}

export async function deleteLink(linkId: string): Promise<{ error?: string }> {
  await requireMember();

  const supabase = db();

  // Remove the stored preview image too, or it lingers in the bucket forever.
  const { data: link } = await supabase
    .from("staff_links")
    .select("preview_image_path, preview_icon_path")
    .eq("id", linkId)
    .maybeSingle();

  const stored = [link?.preview_image_path, link?.preview_icon_path].filter(
    (path): path is string => Boolean(path),
  );

  if (stored.length > 0) {
    await supabase.storage.from(ATTACHMENT_BUCKET).remove(stored);
  }

  const { error } = await supabase.from("staff_links").delete().eq("id", linkId);
  if (error) return { error: "Could not remove that link." };

  revalidatePath("/", "layout");
  return {};
}

export async function updateLink(
  linkId: string,
  label: string,
): Promise<{ error?: string }> {
  await requireMember();

  const { error } = await db()
    .from("staff_links")
    .update({ label: label.trim().slice(0, 200) || null })
    .eq("id", linkId);

  if (error) return { error: "Could not rename that link." };

  revalidatePath("/", "layout");
  return {};
}
