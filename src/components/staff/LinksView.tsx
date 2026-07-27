"use client";

import { useMemo, useState, useTransition } from "react";
import Image from "next/image";
import {
  addLink,
  deleteLink,
  refreshLinkPreview,
} from "@/lib/staff/actions/links";
import { timeAgo } from "@/lib/staff/dates";
import type { LinkItem } from "@/lib/staff/types";
import {
  Avatar,
  PrimaryButton,
  Spinner,
  cx,
  fieldClass,
  labelClass,
} from "./primitives";
import { CloseIcon, LinkIcon, PlusIcon, RotateIcon } from "./icons";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * A soft, deterministic colour per domain. Links have no thumbnail to show, so
 * the preview is generated instead — every Drive link gets the same shade,
 * which makes the grid scannable by source rather than just decorative.
 */
function hueFor(host: string): number {
  let hash = 0;
  for (let i = 0; i < host.length; i += 1) {
    hash = (hash * 31 + host.charCodeAt(i)) % 360;
  }
  return hash;
}

export function LinksView({
  links,
  onOpenTask,
}: {
  links: LinkItem[];
  onOpenTask: (taskId: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const { team, onTasks } = useMemo(
    () => ({
      team: links.filter((link) => !link.task_id),
      onTasks: links.filter((link) => link.task_id),
    }),
    [links],
  );

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = url.trim();
    if (!value) return;

    setError(null);
    startTransition(async () => {
      const result = await addLink({ url: value, label });
      if (result.error) {
        setError(result.error);
        return;
      }
      setUrl("");
      setLabel("");
    });
  }

  return (
    <div className="w-full px-3 pb-12 sm:px-5">
      <form
        onSubmit={submit}
        className="mb-7 rounded-xl border border-line bg-surface p-4"
      >
        <h2 className="mb-3 text-sm font-semibold text-ink">
          Save a link for the team
        </h2>

        <div className="flex flex-col gap-2.5 sm:flex-row">
          <div className="min-w-0 flex-1">
            <label className={labelClass} htmlFor="link-url">
              Address
            </label>
            <input
              id="link-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="drive.google.com/…"
              className={fieldClass}
            />
          </div>
          <div className="min-w-0 flex-1">
            <label className={labelClass} htmlFor="link-label">
              Name it <span className="normal-case">(optional)</span>
            </label>
            <input
              id="link-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Brand assets folder"
              className={fieldClass}
            />
          </div>
          <div className="flex items-end">
            <PrimaryButton type="submit" disabled={pending || !url.trim()}>
              {pending ? <Spinner /> : <PlusIcon className="h-4 w-4" />}
              Save
            </PrimaryButton>
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-2 text-sm text-urgent">
            {error}
          </p>
        )}
      </form>

      <LinkGrid
        title="Team links"
        empty="Nothing saved yet. Drive folders, briefs, dashboards — anything the four of you keep reaching for."
        links={team}
        onOpenTask={onOpenTask}
      />

      {onTasks.length > 0 && (
        <LinkGrid
          title="On tasks"
          empty=""
          links={onTasks}
          onOpenTask={onOpenTask}
        />
      )}
    </div>
  );
}

function LinkGrid({
  title,
  empty,
  links,
  onOpenTask,
}: {
  title: string;
  empty: string;
  links: LinkItem[];
  onOpenTask: (taskId: string) => void;
}) {
  const [, startTransition] = useTransition();
  /** Which card's delete is armed, so removal takes two deliberate taps. */
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <section className="mb-8">
      <h2 className="mb-3 flex items-center gap-2 px-1 text-[13px] font-semibold text-ink">
        {title}
        <span className="rounded-full bg-sunken px-1.5 py-0.5 text-[11px] font-medium text-ink-mute tabular-nums">
          {links.length}
        </span>
      </h2>

      {links.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong/60 px-4 py-10 text-center text-sm text-ink-mute">
          {empty}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {links.map((link) => {
            const host = hostOf(link.url);
            const hue = hueFor(host);

            return (
              <li
                key={link.id}
                className="group relative flex flex-col overflow-hidden rounded-xl border border-line bg-surface transition hover:border-line-strong hover:card-shadow-lifted"
              >
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="block focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                >
                  {link.previewImageUrl ? (
                    <div className="aspect-[16/10] overflow-hidden bg-sunken">
                      <Image
                        src={link.previewImageUrl}
                        alt=""
                        width={480}
                        height={300}
                        unoptimized
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ) : (
                    /* No preview image — most often a page behind a login. The
                       site's own icon still identifies it at a glance. */
                    <div
                      className="flex aspect-[16/10] flex-col items-center justify-center gap-2 px-4"
                      style={{
                        background: `linear-gradient(135deg, hsl(${hue} 62% 93%), hsl(${(hue + 45) % 360} 66% 86%))`,
                      }}
                    >
                      {link.previewIconUrl && (
                        <Image
                          src={link.previewIconUrl}
                          alt=""
                          width={96}
                          height={96}
                          unoptimized
                          className="h-12 w-12 object-contain drop-shadow-sm"
                        />
                      )}
                      <span
                        className="max-w-full truncate text-sm font-semibold"
                        style={{ color: `hsl(${hue} 45% 32%)` }}
                      >
                        {host}
                      </span>
                    </div>
                  )}

                  <div className="px-3.5 pt-3">
                    <h3 className="truncate text-sm font-medium text-ink">
                      {link.label || link.preview_title || host}
                    </h3>
                    <p className="mt-0.5 truncate text-[11px] text-ink-mute">
                      {link.preview_site ?? host} ·{" "}
                      {link.addedBy ? `${link.addedBy.name} · ` : ""}
                      {timeAgo(link.created_at)}
                    </p>
                  </div>
                </a>

                {/* Outside the anchor — a link inside a link is neither
                    keyboard-reachable nor clickable the way you'd expect. */}
                <div className="mt-auto flex items-center gap-1.5 px-3.5 pt-2.5 pb-3">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-sunken text-ink-mute">
                    <LinkIcon className="h-3 w-3" />
                  </span>
                  {link.addedBy && <Avatar member={link.addedBy} size="xs" />}

                  {link.taskTitle && link.task_id && (
                    <button
                      type="button"
                      onClick={() => onOpenTask(link.task_id as string)}
                      title={`Open task: ${link.taskTitle}`}
                      className="ml-auto inline-flex min-h-11 min-w-0 items-center truncate rounded px-1 text-xs text-ink-soft underline decoration-dotted underline-offset-2 transition hover:text-accent sm:min-h-0 sm:text-[11px] sm:text-ink-mute sm:no-underline sm:hover:underline"
                    >
                      {link.taskTitle}
                    </button>
                  )}
                </div>

                {/*
                  These were opacity-0 without pointer-events-none, which on a
                  phone meant two invisible-but-tappable buttons over every card
                  — and the right-hand one deleted the link. They are visible on
                  touch now, and still fade in on hover for a mouse.
                */}
                <div className="reveal-on-hover absolute top-2 right-2 flex gap-2 sm:gap-1">
                  {/* Always offered: a preview can be missing, stale, or from
                      before we captured icons. */}
                  <button
                    type="button"
                    onClick={() =>
                      startTransition(() => {
                        void refreshLinkPreview(link.id);
                      })
                    }
                    aria-label={`Refresh preview for ${link.label || host}`}
                    title="Refresh preview"
                    className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-surface/90 text-ink-soft backdrop-blur-sm transition hover:bg-surface hover:text-accent sm:h-8 sm:w-8"
                  >
                    <RotateIcon className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                  </button>

                  {/* Two-step: a stray tap on a phone shouldn't be able to
                      delete a link the whole team relies on. */}
                  <button
                    type="button"
                    onClick={() => {
                      if (confirming !== link.id) {
                        setConfirming(link.id);
                        return;
                      }
                      setConfirming(null);
                      startTransition(() => {
                        void deleteLink(link.id);
                      });
                    }}
                    onBlur={() =>
                      setConfirming((id) => (id === link.id ? null : id))
                    }
                    aria-label={
                      confirming === link.id
                        ? `Confirm removing ${link.label || host}`
                        : `Remove ${link.label || host}`
                    }
                    className={cx(
                      "inline-flex h-11 items-center justify-center rounded-lg bg-surface/90 px-0 text-ink-soft backdrop-blur-sm transition hover:bg-surface hover:text-urgent sm:h-8",
                      confirming === link.id
                        ? "w-auto bg-urgent px-2.5 text-xs font-medium text-white hover:bg-urgent hover:text-white"
                        : "w-11 sm:w-8",
                    )}
                  >
                    {confirming === link.id ? (
                      "Remove?"
                    ) : (
                      <CloseIcon className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                    )}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
