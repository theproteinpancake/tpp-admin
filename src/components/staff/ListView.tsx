"use client";

import { useMemo } from "react";
import { PRIORITY_META, STATUS_LABEL, STATUSES } from "@/lib/staff/constants";
import { describeDue } from "@/lib/staff/dates";
import type { CategoryRow, MemberRow, TaskStatus } from "@/lib/staff/database.types";
import type { BoardTask } from "@/lib/staff/types";
import { AssigneeStack, Chip, PriorityDot, cx } from "./primitives";
import { CalendarIcon, CheckIcon, CommentIcon, PaperclipIcon } from "./icons";

const DUE_TONE_CLASS = {
  overdue: "text-urgent font-medium",
  today: "text-high font-medium",
  soon: "text-ink-soft",
  later: "text-ink-mute",
} as const;

const STATUS_PILL: Record<TaskStatus, string> = {
  todo: "bg-sunken text-ink-soft",
  in_progress: "bg-accent/10 text-accent",
  blocked: "bg-urgent/10 text-urgent",
  done: "bg-emerald-50 text-emerald-700",
};

/**
 * A flat, scannable alternative to the board. Grouped by status, sorted by
 * urgency within each group — the question this view answers is "what is most
 * pressing", not "where does this sit in the flow".
 */
export function ListView({
  tasks,
  membersById,
  categoriesById,
  onOpenTask,
}: {
  tasks: BoardTask[];
  membersById: Map<string, MemberRow>;
  categoriesById: Map<string, CategoryRow>;
  onOpenTask: (taskId: string) => void;
}) {
  const groups = useMemo(() => {
    return STATUSES.map((status) => ({
      status,
      items: tasks
        .filter((task) => task.status === status.id)
        .sort((a, b) => {
          const priorityGap =
            PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank;
          if (priorityGap !== 0) return priorityGap;

          // Dated work outranks undated work, soonest first.
          if (a.due_date && b.due_date) {
            return a.due_date.localeCompare(b.due_date);
          }
          if (a.due_date) return -1;
          if (b.due_date) return 1;
          return a.position - b.position;
        }),
    })).filter((group) => group.items.length > 0);
  }, [tasks]);

  if (groups.length === 0) return null;

  return (
    <div className="w-full px-3 pb-10 sm:px-5">
      {groups.map(({ status, items }) => (
        <section key={status.id} className="mb-6">
          <h2 className="mb-2 flex items-center gap-2 px-1 text-[13px] font-semibold text-ink">
            {status.label}
            <span className="rounded-full bg-sunken px-1.5 py-0.5 text-[11px] font-medium text-ink-mute tabular-nums">
              {items.length}
            </span>
          </h2>

          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {items.map((task) => {
              const due = task.due_date ? describeDue(task.due_date) : null;
              const assignees = task.assigneeIds
                .map((id) => membersById.get(id))
                .filter((member): member is MemberRow => Boolean(member));
              const category = task.category_id
                ? categoriesById.get(task.category_id)
                : null;
              const isDone = task.status === "done";

              return (
                <li key={task.id}>
                  {/*
                    One row on a desktop, two on a phone. Below sm the row
                    becomes a column and the two wrappers below are real boxes;
                    from sm up `sm:contents` dissolves them so the children fall
                    straight back into the original single-row flex layout.
                  */}
                  <button
                    type="button"
                    onClick={() => onOpenTask(task.id)}
                    className="flex w-full flex-col items-start gap-1.5 px-3 py-3 text-left transition hover:bg-canvas focus-visible:bg-canvas focus-visible:outline-none sm:flex-row sm:items-center sm:gap-3 sm:py-2.5"
                  >
                    <span className="flex w-full min-w-0 items-center gap-2 sm:contents">
                      <PriorityDot priority={task.priority} />

                      <span
                        className={cx(
                          "min-w-0 flex-1 truncate text-sm",
                          isDone
                            ? "text-ink-mute line-through"
                            : "font-medium text-ink",
                        )}
                      >
                        {task.title}
                      </span>
                    </span>

                    <span className="flex w-full items-center gap-2 pl-4 sm:contents">

                    <span className="hidden shrink-0 items-center gap-2 sm:flex">
                      {task.subtasksTotal > 0 && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-ink-mute tabular-nums">
                          <CheckIcon className="h-3 w-3" />
                          {task.subtasksDone}/{task.subtasksTotal}
                        </span>
                      )}
                      {task.commentCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-ink-mute tabular-nums">
                          <CommentIcon className="h-3 w-3" />
                          {task.commentCount}
                        </span>
                      )}
                      {task.attachmentCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-ink-mute tabular-nums">
                          <PaperclipIcon className="h-3 w-3" />
                          {task.attachmentCount}
                        </span>
                      )}
                    </span>

                    {category && (
                      <span className="shrink-0 md:block">
                        <Chip color={category.color}>{category.name}</Chip>
                      </span>
                    )}

                    <span
                      className={cx(
                        "hidden shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium lg:inline-flex",
                        STATUS_PILL[task.status],
                      )}
                    >
                      {STATUS_LABEL[task.status]}
                    </span>

                    {/* Only rendered when there is something to show — as an
                        always-present w-24 box it was reserving a third of a
                        375px row for nothing. */}
                    {due && !isDone && (
                      <span
                        className={cx(
                          "inline-flex shrink-0 items-center gap-1 text-xs sm:w-24 sm:justify-end sm:text-right sm:text-[11px]",
                          DUE_TONE_CLASS[due.tone],
                        )}
                      >
                        <CalendarIcon className="h-3 w-3" />
                        {due.label}
                      </span>
                    )}

                    <span className="ml-auto flex shrink-0 justify-end sm:ml-0 sm:w-32">
                      <AssigneeStack members={assignees} />
                    </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
