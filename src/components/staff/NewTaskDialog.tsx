"use client";

import { useRef, useState, useTransition } from "react";
import { createTask } from "@/lib/staff/actions/tasks";
import {
  ACCEPTED_ATTACHMENT_TYPES,
  PRIORITIES,
  RECURRENCES,
  STATUSES,
} from "@/lib/staff/constants";
import { today } from "@/lib/staff/dates";
import type { CategoryRow, MemberRow, TaskStatus } from "@/lib/staff/database.types";
import {
  Avatar,
  GhostButton,
  Modal,
  ModalHeader,
  PrimaryButton,
  Spinner,
  cx,
  fieldClass,
  labelClass,
} from "./primitives";
import { LinkIcon, PaperclipIcon } from "./icons";

export function NewTaskDialog({
  members,
  categories,
  defaultStatus,
  defaultAssigneeId,
  defaultDueDate,
  onClose,
  onCreated,
}: {
  members: MemberRow[];
  categories: CategoryRow[];
  defaultStatus: TaskStatus;
  defaultAssigneeId: string;
  /** Pre-filled when the task was started from a day in the calendar. */
  defaultDueDate?: string;
  onClose: () => void;
  onCreated: (taskId: string) => void;
}) {
  const [assigneeIds, setAssigneeIds] = useState<string[]>(
    defaultAssigneeId ? [defaultAssigneeId] : [],
  );
  const [error, setError] = useState<string | null>(null);
  const [fileCount, setFileCount] = useState(0);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);

    startTransition(async () => {
      const result = await createTask(formData);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      onCreated(result.id);
    });
  }

  return (
    <Modal open onClose={onClose} labelledBy="new-task-title" width="max-w-xl">
      <ModalHeader id="new-task-title" title="New task" onClose={onClose} />

      <form
        ref={formRef}
        onSubmit={onSubmit}
        className="flex flex-1 flex-col overflow-hidden"
      >
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <label className={labelClass} htmlFor="new-title">
              What needs doing?
            </label>
            <input
              id="new-title"
              name="title"
              required
              autoFocus
              maxLength={300}
              placeholder="e.g. Shoot the Cinnamon Churro recipe reel"
              className={cx(fieldClass, "sm:text-[15px]")}
            />
          </div>

          {/* A row of faces — faster and friendlier than a dropdown, and more
              than one person can be on the same job. */}
          <div>
            <span className={labelClass}>
              Who&rsquo;s on it?{" "}
              <span className="normal-case">(tap more than one)</span>
            </span>
            {assigneeIds.map((id) => (
              <input key={id} type="hidden" name="assigneeIds" value={id} />
            ))}
            <div className="flex flex-wrap gap-1.5">
              {members.map((member) => {
                const active = assigneeIds.includes(member.id);
                return (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() =>
                      setAssigneeIds((current) =>
                        current.includes(member.id)
                          ? current.filter((id) => id !== member.id)
                          : [...current, member.id],
                      )
                    }
                    aria-pressed={active}
                    className={cx(
                      "inline-flex items-center gap-1.5 rounded-lg border py-1.5 pr-2.5 pl-1.5 text-xs font-medium transition",
                      active
                        ? "border-ink bg-ink text-white"
                        : "border-line bg-surface text-ink-soft hover:border-line-strong",
                    )}
                  >
                    <Avatar member={member} size="xs" />
                    {member.name}
                  </button>
                );
              })}
            </div>
            {assigneeIds.length === 0 && (
              <p className="mt-1 text-xs text-ink-mute">
                Nobody selected — that&rsquo;s fine, you can assign it later.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} htmlFor="new-priority">
                Priority
              </label>
              <select
                id="new-priority"
                name="priority"
                defaultValue="medium"
                className={fieldClass}
              >
                {PRIORITIES.map((priority) => (
                  <option key={priority.id} value={priority.id}>
                    {priority.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass} htmlFor="new-due">
                Due date
              </label>
              <input
                id="new-due"
                name="dueDate"
                type="date"
                defaultValue={defaultDueDate}
                // Normally you can't schedule into the past, but a day picked
                // from the calendar wins over that.
                min={
                  defaultDueDate && defaultDueDate < today()
                    ? defaultDueDate
                    : today()
                }
                className={fieldClass}
              />
            </div>

            <div>
              <label className={labelClass} htmlFor="new-category">
                Category
              </label>
              <select
                id="new-category"
                name="categoryId"
                defaultValue=""
                className={fieldClass}
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
              <label className={labelClass} htmlFor="new-status">
                Column
              </label>
              <select
                id="new-status"
                name="status"
                defaultValue={defaultStatus}
                className={fieldClass}
              >
                {STATUSES.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass} htmlFor="new-description">
              Notes <span className="normal-case">(optional)</span>
            </label>
            <textarea
              id="new-description"
              name="description"
              rows={2}
              placeholder="Links, context, anything useful…"
              className={cx(fieldClass, "resize-y leading-relaxed")}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="new-checklist">
              Checklist <span className="normal-case">(one step per line)</span>
            </label>
            <textarea
              id="new-checklist"
              name="checklist"
              rows={2}
              placeholder={"Write script\nFilm\nEdit"}
              className={cx(fieldClass, "resize-y leading-relaxed")}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="new-link">
              Link <span className="normal-case">(optional)</span>
            </label>
            <div className="relative">
              <LinkIcon className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-ink-mute" />
              <input
                id="new-link"
                name="linkUrl"
                placeholder="drive.google.com/…"
                className={cx(fieldClass, "pl-8")}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} htmlFor="new-recurrence">
                Repeats
              </label>
              <select
                id="new-recurrence"
                name="recurrence"
                defaultValue=""
                className={fieldClass}
              >
                <option value="">Doesn&rsquo;t repeat</option>
                {RECURRENCES.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className={labelClass}>Attachments</span>
              <input
                id="new-files"
                name="files"
                type="file"
                multiple
                accept={ACCEPTED_ATTACHMENT_TYPES.join(",")}
                onChange={(event) =>
                  setFileCount(event.target.files?.length ?? 0)
                }
                className="sr-only"
              />
              <label
                htmlFor="new-files"
                className="inline-flex w-full cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-soft transition hover:border-line-strong hover:text-ink"
              >
                <PaperclipIcon className="h-4 w-4 shrink-0" />
                <span className="truncate">
                  {fileCount === 0
                    ? "Add files"
                    : `${fileCount} file${fileCount > 1 ? "s" : ""}`}
                </span>
              </label>
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-urgent/8 px-3 py-2 text-sm text-urgent"
            >
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <GhostButton type="button" onClick={onClose}>
            Cancel
          </GhostButton>
          <PrimaryButton type="submit" disabled={pending}>
            {pending && <Spinner />}
            {pending ? "Creating…" : "Create task"}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}
