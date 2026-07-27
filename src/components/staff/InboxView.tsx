"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import {
  acceptSuggestion,
  dismissSuggestion,
} from "@/lib/staff/actions/suggestions";
import { PRIORITIES } from "@/lib/staff/constants";
import { timeAgo } from "@/lib/staff/dates";
import type {
  CategoryRow,
  MemberRow,
  TaskPriority,
} from "@/lib/staff/database.types";
import type { SuggestionItem } from "@/lib/staff/types";
import {
  Avatar,
  GhostButton,
  PrimaryButton,
  Spinner,
  cx,
  fieldClass,
  labelClass,
} from "./primitives";
import { CheckIcon, CloseIcon, FileIcon, InboxIcon } from "./icons";

/**
 * The review tray for tasks proposed from the team chat.
 *
 * Everything is editable before it lands — the listener proposes, a person
 * decides. Nothing here has touched the board yet.
 */
export function InboxView({
  suggestions,
  members,
  categories,
  onOpenTask,
}: {
  suggestions: SuggestionItem[];
  members: MemberRow[];
  categories: CategoryRow[];
  onOpenTask: (taskId: string) => void;
}) {
  if (suggestions.length === 0) {
    return (
      <div className="w-full px-3 pb-12 sm:px-5">
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong/70 px-6 py-20 text-center">
          <InboxIcon className="h-7 w-7 text-ink-mute" />
          <h2 className="mt-3 text-base font-semibold text-ink">
            Nothing waiting
          </h2>
          <p className="mt-1 max-w-sm text-sm text-ink-soft">
            Write <strong className="font-semibold text-ink">task</strong>{" "}
            anywhere in a message in the TPP chat and it&rsquo;ll turn up here
            for you to accept or bin. Everything else in the chat is ignored.
          </p>
          <p className="mt-3 rounded-lg bg-sunken px-3 py-2 text-xs text-ink-mute">
            &ldquo;Hey Deb, can you email Craig about order #2627{" "}
            <strong className="font-semibold text-ink-soft">task</strong>&rdquo;
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-3 pb-12 sm:px-5">
      <p className="mb-3 px-1 text-xs text-ink-mute">
        {suggestions.length} suggested{" "}
        {suggestions.length === 1 ? "task" : "tasks"} from the team chat. Nothing
        is on the board until you accept it.
      </p>

      <div className="space-y-3">
        {suggestions.map((suggestion) => (
          <SuggestionCard
            key={suggestion.id}
            suggestion={suggestion}
            members={members}
            categories={categories}
            onOpenTask={onOpenTask}
          />
        ))}
      </div>
    </div>
  );
}

function SuggestionCard({
  suggestion,
  members,
  categories,
  onOpenTask,
}: {
  suggestion: SuggestionItem;
  members: MemberRow[];
  categories: CategoryRow[];
  onOpenTask: (taskId: string) => void;
}) {
  const [title, setTitle] = useState(suggestion.proposed_title);
  const [description, setDescription] = useState(
    suggestion.proposed_description ?? "",
  );
  const [priority, setPriority] = useState<TaskPriority>(
    suggestion.proposed_priority,
  );
  const [dueDate, setDueDate] = useState(suggestion.proposed_due_date ?? "");
  const [categoryId, setCategoryId] = useState(
    suggestion.proposed_category_id ?? "",
  );
  const [assigneeIds, setAssigneeIds] = useState<string[]>(
    suggestion.assigneeIds,
  );
  const [error, setError] = useState<string | null>(null);
  /** Arms "Not a task" — dismissing is one-way, so it takes two taps. */
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const [pending, startTransition] = useTransition();

  const lowConfidence = suggestion.confidence < 0.5;

  function accept() {
    setError(null);
    startTransition(async () => {
      const result = await acceptSuggestion(suggestion.id, {
        title,
        description: description || null,
        priority,
        dueDate: dueDate || null,
        categoryId: categoryId || null,
        assigneeIds,
      });

      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.taskId) onOpenTask(result.taskId);
    });
  }

  return (
    <article className="overflow-hidden rounded-xl border border-line bg-surface">
      {/* The message it came from ------------------------------- */}
      <div className="border-b border-line bg-canvas px-4 py-3">
        <div className="flex items-start gap-2.5">
          <Avatar member={suggestion.sender} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-[13px] font-medium text-ink">
                {suggestion.sender?.name ??
                  suggestion.sender_handle ??
                  "Unknown sender"}
              </span>
              <span className="text-[11px] text-ink-mute">
                {suggestion.message_sent_at
                  ? timeAgo(suggestion.message_sent_at)
                  : "in the team chat"}
              </span>
            </p>
            <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap text-ink-soft">
              {suggestion.message_text}
            </p>
          </div>
        </div>

        {suggestion.attachments.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-2 pl-8">
            {suggestion.attachments.map((attachment) =>
              attachment.isImage && attachment.url ? (
                <a
                  key={attachment.id}
                  href={attachment.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="overflow-hidden rounded-lg border border-line"
                >
                  <Image
                    src={attachment.url}
                    alt={attachment.file_name}
                    width={160}
                    height={110}
                    unoptimized
                    className="h-20 w-28 object-cover"
                  />
                </a>
              ) : (
                <span
                  key={attachment.id}
                  className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink-soft sm:text-[11px]"
                >
                  <FileIcon className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 break-all">{attachment.file_name}</span>
                </span>
              ),
            )}
          </div>
        )}
      </div>

      {/* The proposal -------------------------------------------- */}
      <div className="space-y-3 px-4 py-3">
        <div>
          <label className={labelClass} htmlFor={`title-${suggestion.id}`}>
            Task
          </label>
          <input
            id={`title-${suggestion.id}`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={cx(fieldClass, "font-medium")}
          />
        </div>

        <div>
          <span className={labelClass}>Who&rsquo;s on it</span>
          <div className="flex flex-wrap gap-2 sm:gap-1.5">
            {members.map((member) => {
              const on = assigneeIds.includes(member.id);
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
                  aria-pressed={on}
                  className={cx(
                    "inline-flex min-h-11 items-center gap-2 rounded-lg border py-2 pr-3 pl-2 text-sm font-medium transition sm:min-h-0 sm:gap-1.5 sm:py-1 sm:pr-2 sm:pl-1 sm:text-xs",
                    on
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
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <div>
            <label className={labelClass} htmlFor={`priority-${suggestion.id}`}>
              Priority
            </label>
            <select
              id={`priority-${suggestion.id}`}
              value={priority}
              onChange={(event) =>
                setPriority(event.target.value as TaskPriority)
              }
              className={fieldClass}
            >
              {PRIORITIES.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor={`due-${suggestion.id}`}>
              Due
            </label>
            <input
              id={`due-${suggestion.id}`}
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className={fieldClass}
            />
          </div>

          <div className="col-span-2 sm:col-span-1">
            <label className={labelClass} htmlFor={`category-${suggestion.id}`}>
              Category
            </label>
            <select
              id={`category-${suggestion.id}`}
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
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
        </div>

        <div>
          <label className={labelClass} htmlFor={`notes-${suggestion.id}`}>
            Notes
          </label>
          <textarea
            id={`notes-${suggestion.id}`}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            placeholder="Anything else worth carrying over…"
            className={cx(fieldClass, "resize-y leading-relaxed")}
          />
        </div>

        {suggestion.order_context && (
          <div className="rounded-lg border border-line bg-canvas px-3 py-2.5">
            <p className="mb-1 text-xs font-semibold text-ink">
              Order {suggestion.order_context.orderName}
            </p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] text-ink-soft">
              {suggestion.order_context.customerName && (
                <Detail label="Customer" value={suggestion.order_context.customerName} />
              )}
              {suggestion.order_context.email && (
                <Detail label="Email" value={suggestion.order_context.email} />
              )}
              {suggestion.order_context.financialStatus && (
                <Detail
                  label="Payment"
                  value={suggestion.order_context.financialStatus}
                />
              )}
              {suggestion.order_context.fulfillmentStatus && (
                <Detail
                  label="Fulfilment"
                  value={suggestion.order_context.fulfillmentStatus}
                />
              )}
              {suggestion.order_context.total && (
                <Detail label="Total" value={suggestion.order_context.total} />
              )}
            </dl>
            {suggestion.order_context.items.length > 0 && (
              <p className="mt-1.5 text-[11px] text-ink-mute">
                {suggestion.order_context.items.join(" · ")}
              </p>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-urgent">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <span
            className={cx(
              "inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
              lowConfidence
                ? "bg-high/10 text-high"
                : "bg-sunken text-ink-mute",
            )}
            title={suggestion.reasoning ?? undefined}
          >
            {lowConfidence ? "Low confidence" : "Looks like a task"}
          </span>
          {/* Wraps onto its own line on a phone rather than truncating at ~35
              characters — this is the sentence you decide on. */}
          {suggestion.reasoning && (
            <span className="w-full text-xs text-ink-soft sm:w-auto sm:min-w-0 sm:flex-1 sm:truncate sm:text-[11px] sm:text-ink-mute">
              {suggestion.reasoning}
            </span>
          )}

          <div className="mt-1 flex w-full items-center gap-3 sm:mt-0 sm:ml-auto sm:w-auto sm:gap-2">
            {/* Two taps to bin a suggestion — nothing in the app surfaces a
                dismissed one again, so a stray thumb would lose it silently. */}
            <GhostButton
              type="button"
              disabled={pending}
              className="min-h-11 flex-1 sm:min-h-0 sm:flex-none"
              onClick={() => {
                if (!confirmDismiss) {
                  setConfirmDismiss(true);
                  return;
                }
                setConfirmDismiss(false);
                startTransition(async () => {
                  await dismissSuggestion(suggestion.id);
                });
              }}
              onBlur={() => setConfirmDismiss(false)}
            >
              <CloseIcon className="h-4 w-4" />
              {confirmDismiss ? "Sure?" : "Not a task"}
            </GhostButton>
            <PrimaryButton
              type="button"
              onClick={accept}
              disabled={pending}
              className="min-h-11 flex-1 sm:min-h-0 sm:flex-none"
            >
              {pending ? <Spinner /> : <CheckIcon className="h-4 w-4" />}
              Add to board
            </PrimaryButton>
          </div>
        </div>
      </div>
    </article>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt className="shrink-0 text-ink-mute">{label}:</dt>
      <dd className="min-w-0 truncate text-ink-soft">{value}</dd>
    </div>
  );
}
