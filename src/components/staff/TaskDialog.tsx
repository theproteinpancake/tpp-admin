"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { loadTaskDetail } from "@/lib/staff/actions/detail";
import {
  addComment,
  addSubtask,
  deleteAttachment,
  deleteSubtask,
  deleteTask,
  reorderSubtasks,
  setSubtaskDone,
  updateTask,
  uploadAttachments,
} from "@/lib/staff/actions/tasks";
import { Checklist } from "./Checklist";
import { MentionInput } from "./MentionInput";
import { addLink, deleteLink } from "@/lib/staff/actions/links";
import {
  ACCEPTED_ATTACHMENT_TYPES,
  PRIORITIES,
  RECURRENCES,
  STATUSES,
} from "@/lib/staff/constants";
import { describeDue, timeAgo } from "@/lib/staff/dates";
import type { CategoryRow, MemberRow, TaskStatus } from "@/lib/staff/database.types";
import type { TaskDetail } from "@/lib/staff/types";
import {
  Avatar,
  GhostButton,
  MentionText,
  Modal,
  Spinner,
  cx,
  fieldClass,
  labelClass,
} from "./primitives";
import {
  CloseIcon,
  FileIcon,
  LinkIcon,
  PaperclipIcon,
  PlusIcon,
  TrashIcon,
} from "./icons";

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function TaskDialog({
  taskId,
  members,
  categories,
  currentMemberId,
  onClose,
}: {
  taskId: string;
  members: MemberRow[];
  categories: CategoryRow[];
  currentMemberId: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [comment, setComment] = useState("");
  const [newLink, setNewLink] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const next = await loadTaskDetail(taskId);
    if (!next) {
      setMissing(true);
      return;
    }
    setDetail(next);
    setTitle(next.title);
    setDescription(next.description ?? "");
  }, [taskId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Run a mutation, surface its error, and pull fresh detail either way. */
  const run = useCallback(
    (action: () => Promise<{ error?: string } | void>) => {
      setError(null);
      startTransition(async () => {
        const result = await action();
        if (result && "error" in result && result.error) {
          setError(result.error);
        }
        await refresh();
      });
    },
    [refresh],
  );

  const patch = useCallback(
    (changes: Parameters<typeof updateTask>[1]) => {
      run(() => updateTask(taskId, changes));
    },
    [run, taskId],
  );

  async function onFilesPicked(event: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    if (files.length === 0) return;

    setUploading(true);
    setError(null);

    const formData = new FormData();
    formData.set("taskId", taskId);
    for (const file of files) formData.append("files", file);

    const result = await uploadAttachments(formData);
    if (result.error) setError(result.error);

    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
    await refresh();
  }

  if (missing) {
    return (
      <Modal open onClose={onClose} width="max-w-sm">
        <div className="p-6 text-center">
          <p className="text-sm text-ink-soft">This task has been deleted.</p>
          <GhostButton className="mt-4" onClick={onClose}>
            Close
          </GhostButton>
        </div>
      </Modal>
    );
  }

  if (!detail) {
    return (
      <Modal open onClose={onClose} width="max-w-4xl">
        <div className="flex items-center justify-center gap-2 p-16 text-sm text-ink-mute">
          <Spinner />
          Loading…
        </div>
      </Modal>
    );
  }

  const due = detail.due_date ? describeDue(detail.due_date) : null;
  const stepsDone = detail.subtasks.filter((s) => s.done).length;

  return (
    <Modal open onClose={onClose} width="max-w-4xl">
      {/* Header ---------------------------------------------------- */}
      <div className="flex items-start gap-3 border-b border-line px-4 py-3 sm:px-5">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            const trimmed = title.trim();
            if (!trimmed) {
              setTitle(detail.title);
              return;
            }
            if (trimmed !== detail.title) patch({ title: trimmed });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          aria-label="Task title"
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-base font-semibold text-ink outline-none transition hover:bg-sunken focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent/15 sm:text-lg"
        />
        <div className="flex shrink-0 items-center gap-1">
          {busy && <Spinner className="mr-1 text-ink-mute" />}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1.5 inline-flex h-11 w-11 items-center justify-center rounded-lg text-ink-mute transition hover:bg-sunken hover:text-ink sm:mr-0 sm:h-8 sm:w-8"
          >
            <CloseIcon className="h-4.5 w-4.5" />
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="bg-urgent/8 px-5 py-2 text-sm text-urgent">
          {error}
        </p>
      )}

      <div className="flex flex-1 flex-col overflow-y-auto lg:flex-row-reverse">
        {/* Properties --------------------------------------------- */}
        <aside className="shrink-0 space-y-3.5 border-line px-4 py-4 sm:px-5 lg:w-64 lg:border-l">
          <div>
            <span className={labelClass}>Status</span>
            <div className="grid grid-cols-2 gap-2 lg:gap-1.5">
              {STATUSES.map((status) => (
                <button
                  key={status.id}
                  type="button"
                  onClick={() => patch({ status: status.id })}
                  title={status.hint}
                  className={cx(
                    "rounded-lg border px-2.5 py-2.5 text-sm font-medium transition lg:px-2 lg:py-1.5 lg:text-xs",
                    detail.status === status.id
                      ? "border-ink bg-ink text-white"
                      : "border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink",
                  )}
                >
                  {status.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className={labelClass}>
              On this job{" "}
              {detail.assigneeIds.length > 1 && (
                <span className="normal-case">
                  ({detail.assigneeIds.length} people)
                </span>
              )}
            </span>
            <div className="flex flex-wrap gap-2 lg:gap-1.5">
              {members.map((member) => {
                const on = detail.assigneeIds.includes(member.id);
                return (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() =>
                      patch({
                        assigneeIds: on
                          ? detail.assigneeIds.filter((id) => id !== member.id)
                          : [...detail.assigneeIds, member.id],
                      })
                    }
                    aria-pressed={on}
                    className={cx(
                      "inline-flex items-center gap-2 rounded-lg border py-2.5 pr-3 pl-2 text-sm font-medium transition lg:gap-1.5 lg:py-1 lg:pr-2 lg:pl-1 lg:text-xs",
                      on
                        ? "border-ink bg-ink text-white"
                        : "border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink",
                    )}
                  >
                    <Avatar member={member} size="xs" />
                    {member.name}
                  </button>
                );
              })}
            </div>
            {detail.assigneeIds.length === 0 && (
              <p className="mt-1 text-xs text-ink-mute">
                Nobody yet — tap a name, or @mention someone in a comment.
              </p>
            )}
          </div>

          <div>
            <label className={labelClass} htmlFor="priority">
              Priority
            </label>
            <select
              id="priority"
              className={fieldClass}
              value={detail.priority}
              onChange={(event) =>
                patch({
                  priority: event.target
                    .value as (typeof PRIORITIES)[number]["id"],
                })
              }
            >
              {PRIORITIES.map((priority) => (
                <option key={priority.id} value={priority.id}>
                  {priority.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="category">
              Category
            </label>
            <select
              id="category"
              className={fieldClass}
              value={detail.category_id ?? ""}
              onChange={(event) =>
                patch({ categoryId: event.target.value || null })
              }
            >
              <option value="">None</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="due">
              Due date
            </label>
            <input
              id="due"
              type="date"
              className={fieldClass}
              value={detail.due_date ?? ""}
              onChange={(event) =>
                patch({ dueDate: event.target.value || null })
              }
            />
            {due && detail.status !== "done" && (
              <p
                className={cx(
                  "mt-1 text-xs",
                  due.tone === "overdue"
                    ? "font-medium text-urgent"
                    : due.tone === "today"
                      ? "font-medium text-high"
                      : "text-ink-mute",
                )}
              >
                {due.label}
              </p>
            )}
          </div>

          <div>
            <label className={labelClass} htmlFor="recurrence">
              Repeats
            </label>
            <select
              id="recurrence"
              className={fieldClass}
              value={detail.recurrence ?? ""}
              onChange={(event) =>
                patch({
                  recurrence: (event.target.value ||
                    null) as (typeof RECURRENCES)[number]["id"] | null,
                })
              }
            >
              <option value="">Doesn&rsquo;t repeat</option>
              {RECURRENCES.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            {detail.recurrence && (
              <p className="mt-1 text-xs text-ink-mute">
                A fresh copy appears when this one is marked done.
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              if (
                !window.confirm(
                  `Delete "${detail.title}"? This cannot be undone.`,
                )
              ) {
                return;
              }
              startTransition(async () => {
                await deleteTask(taskId);
                onClose();
              });
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-mute transition hover:border-urgent/40 hover:bg-urgent/5 hover:text-urgent"
          >
            <TrashIcon className="h-3.5 w-3.5" />
            Delete task
          </button>
        </aside>

        {/* Main ---------------------------------------------------- */}
        <div className="min-w-0 flex-1 space-y-6 px-4 py-4 sm:px-5">
          <section>
            <h3 className={labelClass}>Notes</h3>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              onBlur={() => {
                if (description !== (detail.description ?? "")) {
                  patch({ description });
                }
              }}
              rows={3}
              placeholder="Add any detail, links or context…"
              className={cx(fieldClass, "resize-y leading-relaxed")}
            />
          </section>

          {/* Checklist -------------------------------------------- */}
          <Checklist
            subtasks={detail.subtasks}
            members={members}
            onAdd={(title) => run(() => addSubtask(taskId, title))}
            onToggle={(subtaskId, done) =>
              run(() => setSubtaskDone(subtaskId, done))
            }
            onDelete={(subtaskId) => run(() => deleteSubtask(subtaskId))}
            onReorder={(orderedIds) =>
              run(() => reorderSubtasks(taskId, orderedIds))
            }
          />

          {/* Links ------------------------------------------------ */}
          <section>
            <h3 className={labelClass}>Links</h3>

            {detail.links.length > 0 && (
              <ul className="mb-2 space-y-1">
                {detail.links.map((link) => (
                  <li
                    key={link.id}
                    className="group flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5"
                  >
                    <LinkIcon className="h-3.5 w-3.5 shrink-0 text-ink-mute" />
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="min-w-0 flex-1 truncate text-sm text-ink hover:text-accent hover:underline"
                    >
                      {link.label || hostOf(link.url)}
                    </a>
                    <span className="hidden shrink-0 text-[11px] text-ink-mute sm:block">
                      {hostOf(link.url)}
                    </span>
                    <button
                      type="button"
                      onClick={() => run(() => deleteLink(link.id))}
                      aria-label={`Remove ${link.label || hostOf(link.url)}`}
                      className="reveal-on-hover shrink-0 rounded p-2 text-ink-mute transition hover:bg-sunken hover:text-urgent sm:p-1"
                    >
                      <CloseIcon className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <form
              onSubmit={(event) => {
                event.preventDefault();
                const value = newLink.trim();
                if (!value) return;
                setNewLink("");
                run(() => addLink({ url: value, taskId }));
              }}
              className="flex items-center gap-2"
            >
              <LinkIcon className="h-4 w-4 shrink-0 text-ink-mute" />
              <input
                value={newLink}
                onChange={(event) => setNewLink(event.target.value)}
                placeholder="Paste a Drive link, doc, anything"
                aria-label="Add a link to this task"
                className="flex-1 rounded-lg border border-transparent bg-transparent px-2 py-2.5 text-base text-ink outline-none transition placeholder:text-ink-mute hover:bg-sunken focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent/15 sm:py-1.5 sm:text-sm"
              />
            </form>
          </section>

          {/* Attachments ------------------------------------------ */}
          <section>
            <h3 className={labelClass}>Attachments</h3>

            {detail.attachments.length > 0 && (
              <div className="mb-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {detail.attachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="group relative overflow-hidden rounded-lg border border-line bg-sunken"
                  >
                    {attachment.isImage && attachment.url ? (
                      <a
                        href={attachment.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block"
                      >
                        <Image
                          src={attachment.url}
                          alt={attachment.file_name}
                          width={320}
                          height={200}
                          unoptimized
                          className="h-24 w-full object-cover transition group-hover:opacity-90"
                        />
                      </a>
                    ) : (
                      <a
                        href={attachment.url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="flex h-24 flex-col items-center justify-center gap-1.5 px-2 text-center"
                      >
                        <FileIcon className="h-5 w-5 text-ink-mute" />
                        <span className="line-clamp-2 text-xs text-ink-soft sm:text-[11px]">
                          {attachment.file_name}
                        </span>
                      </a>
                    )}

                    <button
                      type="button"
                      onClick={() => run(() => deleteAttachment(attachment.id))}
                      aria-label={`Remove ${attachment.file_name}`}
                      className="reveal-on-hover absolute top-1 right-1 rounded-md bg-surface/90 p-2 text-ink-soft shadow-sm transition hover:text-urgent sm:p-1"
                    >
                      <CloseIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <input
              ref={fileInput}
              type="file"
              multiple
              accept={ACCEPTED_ATTACHMENT_TYPES.join(",")}
              onChange={onFilesPicked}
              className="sr-only"
              id={`upload-${taskId}`}
            />
            <label
              htmlFor={`upload-${taskId}`}
              className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink-soft transition hover:border-line-strong hover:text-ink"
            >
              {uploading ? <Spinner /> : <PaperclipIcon className="h-4 w-4" />}
              {uploading ? "Uploading…" : "Add image or PDF"}
            </label>
          </section>

          {/* Comments --------------------------------------------- */}
          <section>
            <h3 className={labelClass}>
              Comments{" "}
              {detail.comments.length > 0 && (
                <span className="text-ink-soft normal-case tabular-nums">
                  {detail.comments.length}
                </span>
              )}
            </h3>

            {detail.comments.length > 0 && (
              <ul className="mb-3 space-y-3">
                {detail.comments.map((entry) => (
                  <li key={entry.id} className="flex gap-2.5">
                    <Avatar member={entry.author} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-baseline gap-2">
                        <span className="text-[13px] font-medium text-ink">
                          {entry.author?.name ?? "Someone"}
                        </span>
                        <span className="text-[11px] text-ink-mute">
                          {timeAgo(entry.created_at)}
                        </span>
                      </p>
                      <MentionText
                        text={entry.body}
                        className="block text-sm leading-relaxed whitespace-pre-wrap text-ink-soft"
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <form
              onSubmit={(event) => {
                event.preventDefault();
                const value = comment.trim();
                if (!value) return;
                setComment("");
                run(() => addComment(taskId, value));
              }}
              className="flex gap-2.5"
            >
              <Avatar
                member={members.find((m) => m.id === currentMemberId) ?? null}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <MentionInput
                  value={comment}
                  onChange={setComment}
                  onSubmit={() => {
                    const value = comment.trim();
                    if (!value) return;
                    setComment("");
                    run(() => addComment(taskId, value));
                  }}
                  members={members}
                  multiline
                  rows={2}
                  placeholder="Leave a comment… type @ to tag someone"
                  ariaLabel="Write a comment"
                  className={cx(fieldClass, "resize-y")}
                />
                {comment.trim() && (
                  <button
                    type="submit"
                    className="mt-1.5 rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white transition hover:bg-ink/90"
                  >
                    Comment
                  </button>
                )}
              </div>
            </form>
          </section>
        </div>
      </div>
    </Modal>
  );
}
