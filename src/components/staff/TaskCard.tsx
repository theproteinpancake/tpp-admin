"use client";

import { Fragment } from "react";
import { describeDue } from "@/lib/staff/dates";
import { PRIORITY_META } from "@/lib/staff/constants";
import type { CategoryRow, MemberRow, TaskStatus } from "@/lib/staff/database.types";
import type { BoardTask } from "@/lib/staff/types";
import { AssigneeStack, cx } from "./primitives";
import {
  ArrowRightIcon,
  CheckIcon,
  CommentIcon,
  LinkIcon,
  PaperclipIcon,
  RotateIcon,
} from "./icons";

const DUE_TONE_CLASS = {
  overdue: "font-medium text-urgent",
  today: "font-medium text-high",
  soon: "text-ink-soft",
  later: "text-ink-mute",
} as const;

/** What the one-tap button on a card does next, per column. */
const ADVANCE: Record<
  TaskStatus,
  { label: string; icon: "arrow" | "check" | "rotate" }
> = {
  todo: { label: "Start", icon: "arrow" },
  blocked: { label: "Start", icon: "arrow" },
  in_progress: { label: "Done", icon: "check" },
  done: { label: "Reopen", icon: "rotate" },
};

export function TaskCard({
  task,
  assignees,
  category,
  dragging,
  onOpen,
  onDragStart,
  onAdvance,
  floating = false,
  entering = false,
}: {
  task: BoardTask;
  assignees: MemberRow[];
  category: CategoryRow | null;
  dragging?: boolean;
  /** First time this card has appeared — play it in rather than popping it. */
  entering?: boolean;
  onOpen?: () => void;
  onDragStart?: (
    event: React.PointerEvent,
    taskId: string,
    status: TaskStatus,
    options?: { fromHandle?: boolean },
  ) => void;
  onAdvance?: (taskId: string) => void;
  /** Rendered inside the drag ghost — no interactions. */
  floating?: boolean;
}) {
  const priority = PRIORITY_META[task.priority];
  const due = task.due_date ? describeDue(task.due_date) : null;
  const isDone = task.status === "done";
  const advance = ADVANCE[task.status];

  /* One quiet line instead of a row of boxes — the information is the same,
     it just stops shouting. */
  const meta: React.ReactNode[] = [];

  if (category) {
    meta.push(
      <span key="category" style={{ color: category.color }}>
        {category.name}
      </span>,
    );
  }
  if (task.recurrence) meta.push(<span key="repeats">Repeats</span>);
  if (due && !isDone) {
    meta.push(
      <span key="due" className={DUE_TONE_CLASS[due.tone]}>
        {due.label}
      </span>,
    );
  }
  if (task.subtasksTotal > 0) {
    const complete = task.subtasksDone === task.subtasksTotal;
    meta.push(
      <span key="steps" className={complete ? "text-emerald-600" : undefined}>
        {task.subtasksDone}/{task.subtasksTotal} done
      </span>,
    );
  }

  const counts: React.ReactNode[] = [];
  if (task.commentCount > 0) {
    counts.push(
      <Count key="comments" icon={<CommentIcon className="h-3 w-3" />}>
        {task.commentCount}
      </Count>,
    );
  }
  if (task.attachmentCount > 0) {
    counts.push(
      <Count key="files" icon={<PaperclipIcon className="h-3 w-3" />}>
        {task.attachmentCount}
      </Count>,
    );
  }
  if (task.linkCount > 0) {
    counts.push(
      <Count key="links" icon={<LinkIcon className="h-3 w-3" />}>
        {task.linkCount}
      </Count>,
    );
  }

  return (
    <article
      data-card-id={task.id}
      onPointerDown={
        onDragStart
          ? (event) => onDragStart(event, task.id, task.status)
          : undefined
      }
      onClick={onOpen}
      onKeyDown={
        onOpen
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={onOpen ? `Open task: ${task.title}` : undefined}
      className={cx(
        "group relative rounded-xl bg-sunken px-3.5 py-3 select-none",
        !floating &&
          "cursor-pointer transition hover:bg-line/70 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
        floating && "bg-surface card-shadow-lifted",
        dragging && "is-dragging",
        entering && "animate-card-in",
      )}
    >
      <div className="flex items-start gap-2">
        <span
          aria-label={`${priority.label} priority`}
          title={`${priority.label} priority`}
          className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full"
          style={{
            backgroundColor: priority.color,
            opacity: isDone ? 0.35 : 1,
          }}
        />

        <h3
          className={cx(
            "min-w-0 flex-1 text-[13.5px] leading-snug font-medium text-balance",
            isDone ? "text-ink-mute line-through" : "text-ink",
          )}
        >
          {task.title}
        </h3>

        {/* Touch drag starts here so a finger can still scroll the column —
            which makes this handle the ONLY way to move a card on a phone, so
            it has to be visible there. On a mouse it still fades in on hover. */}
        {onDragStart && !floating && (
          <button
            type="button"
            aria-label="Drag to move"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => {
              event.stopPropagation();
              onDragStart(event, task.id, task.status, { fromHandle: true });
            }}
            className="reveal-on-hover tap-target -mt-0.5 -mr-1 shrink-0 cursor-grab touch-none rounded p-1 text-ink-mute/60 transition hover:bg-line hover:text-ink-soft active:cursor-grabbing"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4 sm:h-3.5 sm:w-3.5" aria-hidden>
              <g fill="currentColor">
                <circle cx="6" cy="3" r="1.3" />
                <circle cx="10" cy="3" r="1.3" />
                <circle cx="6" cy="8" r="1.3" />
                <circle cx="10" cy="8" r="1.3" />
                <circle cx="6" cy="13" r="1.3" />
                <circle cx="10" cy="13" r="1.3" />
              </g>
            </svg>
          </button>
        )}
      </div>

      {/* text-ink-soft rather than text-ink-mute on a phone: 6.3:1 against the
          card fill instead of 3.2:1, which is the difference between readable
          and not in daylight. Desktop keeps the quieter tone. */}
      {(meta.length > 0 || counts.length > 0) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 pl-3.5 text-xs text-ink-soft sm:text-[11px] sm:text-ink-mute">
          {meta.map((item, index) => (
            <Fragment key={index}>
              {index > 0 && <Separator />}
              {item}
            </Fragment>
          ))}
          {counts.length > 0 && (
            <>
              {meta.length > 0 && <Separator />}
              <span className="inline-flex items-center gap-2">{counts}</span>
            </>
          )}
        </div>
      )}

      <div className="mt-2.5 flex items-center gap-2 pl-3.5">
        <AssigneeStack members={assignees} />

        {onAdvance && !floating && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onAdvance(task.id);
            }}
            onPointerDown={(event) => event.stopPropagation()}
            // tap-target grows the hit area to ~48px without growing the chip,
            // so a thumb can land on it without costing a card per screenful.
            className="tap-target ml-auto inline-flex h-7 shrink-0 items-center gap-1 rounded-lg bg-surface px-2.5 text-xs font-medium text-ink-soft transition hover:text-ink sm:text-[11px]"
          >
            {advance.icon === "arrow" && <ArrowRightIcon className="h-3.5 w-3.5 sm:h-3 sm:w-3" />}
            {advance.icon === "check" && <CheckIcon className="h-3.5 w-3.5 sm:h-3 sm:w-3" />}
            {advance.icon === "rotate" && <RotateIcon className="h-3.5 w-3.5 sm:h-3 sm:w-3" />}
            {advance.label}
          </button>
        )}
      </div>
    </article>
  );
}

function Separator() {
  return (
    <span aria-hidden className="text-ink-mute/50">
      ·
    </span>
  );
}

function Count({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      {icon}
      {children}
    </span>
  );
}
