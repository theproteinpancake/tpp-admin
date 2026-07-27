"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  dayOfMonth,
  isSameMonth,
  monthGrid,
  monthLabel,
  shortDate,
  startOfWeek,
  today,
  weekGrid,
  weekdayShort,
} from "@/lib/staff/dates";
import { PRIORITY_META } from "@/lib/staff/constants";
import type { MemberRow } from "@/lib/staff/database.types";
import type { BoardTask } from "@/lib/staff/types";
import { Avatar, cx } from "./primitives";
import { useCalendarDrag } from "./useCalendarDrag";
import { CheckIcon, ChevronDownIcon, PlusIcon } from "./icons";

type Mode = "month" | "week";

const WEEKDAY_HEADS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** How many chips fit in a month cell before it collapses to "+N more". */
const MONTH_CHIP_LIMIT = 3;

export function CalendarView({
  tasks,
  membersById,
  onOpenTask,
  onAddTask,
  onReschedule,
}: {
  tasks: BoardTask[];
  membersById: Map<string, MemberRow>;
  onOpenTask: (taskId: string) => void;
  onAddTask: (dueDate: string) => void;
  onReschedule: (taskId: string, dueDate: string) => void;
}) {
  /*
   * Month on a desktop, week on a phone.
   *
   * A month grid needs seven columns; at 375px that is 45px each, which fits a
   * date number and nothing else — task chips render as "S…". Week mode stacks
   * the seven days as full-width rows instead, so a chip gets the whole width
   * and the titles are actually readable. Month stays available via the toggle
   * for the "which days are busy" glance, and now scrolls inside each cell.
   *
   * Set after mount rather than in the initialiser: this is server rendered,
   * and branching on matchMedia during render is a hydration mismatch.
   */
  const [mode, setMode] = useState<Mode>("month");

  useEffect(() => {
    if (!window.matchMedia("(min-width: 640px)").matches) setMode("week");
  }, []);
  const [anchor, setAnchor] = useState(() => today());
  const [showCompleted, setShowCompleted] = useState(false);
  /** Which way the last move travelled, so the new page enters from that side. */
  const [travel, setTravel] = useState<-1 | 0 | 1>(0);

  const { drag, startDrag, registerDay, wasDragging } =
    useCalendarDrag(onReschedule);

  const days = useMemo(
    () => (mode === "month" ? monthGrid(anchor) : weekGrid(anchor)),
    [mode, anchor],
  );

  const byDate = useMemo(() => {
    const map = new Map<string, BoardTask[]>();

    for (const task of tasks) {
      if (!task.due_date) continue;
      if (!showCompleted && task.status === "done") continue;

      const list = map.get(task.due_date);
      if (list) list.push(task);
      else map.set(task.due_date, [task]);
    }

    for (const list of map.values()) {
      list.sort((a, b) => {
        // Finished work sinks below whatever is still open.
        if ((a.status === "done") !== (b.status === "done")) {
          return a.status === "done" ? 1 : -1;
        }
        return PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank;
      });
    }

    return map;
  }, [tasks, showCompleted]);

  const step = (direction: 1 | -1) => {
    setTravel(direction);
    setAnchor((current) =>
      mode === "month"
        ? addMonths(current, direction)
        : addDays(current, 7 * direction),
    );
  };

  const goToToday = () => {
    const now = today();
    // Jumping back to today is still a direction of travel.
    setTravel(now === anchor ? 0 : now > anchor ? 1 : -1);
    setAnchor(now);
  };

  const heading =
    mode === "month"
      ? monthLabel(anchor)
      : `${shortDate(startOfWeek(anchor))} – ${shortDate(addDays(startOfWeek(anchor), 6))}`;

  const currentDay = today();

  return (
    <div className="flex h-full flex-col px-3 pb-4 sm:px-5">
      {/* Controls ------------------------------------------------ */}
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 sm:gap-0.5">
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label={mode === "month" ? "Previous month" : "Previous week"}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-ink-soft transition hover:bg-sunken hover:text-ink sm:h-8 sm:w-8"
          >
            <ChevronDownIcon className="h-4 w-4 rotate-90" />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label={mode === "month" ? "Next month" : "Next week"}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-ink-soft transition hover:bg-sunken hover:text-ink sm:h-8 sm:w-8"
          >
            <ChevronDownIcon className="h-4 w-4 -rotate-90" />
          </button>
        </div>

        <h2 className="text-sm font-semibold text-ink">{heading}</h2>

        <button
          type="button"
          onClick={goToToday}
          className="rounded-lg border border-line bg-surface px-3 py-2.5 text-sm font-medium text-ink-soft transition hover:border-line-strong hover:text-ink sm:px-2 sm:py-1 sm:text-xs"
        >
          Today
        </button>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCompleted((value) => !value)}
            aria-pressed={showCompleted}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-medium transition sm:px-2 sm:py-1 sm:text-xs",
              showCompleted
                ? "border-emerald-500/40 bg-emerald-50 text-emerald-700"
                : "border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink",
            )}
          >
            <CheckIcon className="h-3.5 w-3.5" />
            Completed
          </button>

          <div className="flex items-center gap-1.5 rounded-lg bg-sunken p-0.5 sm:gap-1">
            {(["month", "week"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  // Month↔week isn't a move through time, so it fades rather
                  // than sliding in from a direction.
                  setTravel(0);
                  setMode(option);
                }}
                aria-pressed={mode === option}
                className={cx(
                  "rounded-md px-3 py-2.5 text-sm font-medium capitalize transition sm:px-2 sm:py-1 sm:text-xs",
                  mode === option
                    ? "bg-surface text-ink card-shadow"
                    : "text-ink-mute hover:text-ink-soft",
                )}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Weekday header — only above a real 7-column grid. In week mode on a
          phone the days are stacked rows that name themselves. */}
      <div
        className={cx(
          "grid-cols-7 gap-1.5 pb-1.5",
          mode === "month" ? "grid" : "hidden sm:grid",
        )}
      >
        {WEEKDAY_HEADS.map((label) => (
          <div
            key={label}
            className="px-1 text-xs font-semibold tracking-wide text-ink-mute uppercase sm:text-[11px]"
          >
            {label}
          </div>
        ))}
      </div>

      {/* Grid ---------------------------------------------------- */}
      {/* Keyed on what's actually being shown, so a new month remounts and
          replays its entrance instead of the numbers silently swapping. */}
      <div
        key={`${mode}-${days[0]}`}
        className={cx(
          "grid min-h-0 flex-1 gap-1.5 overflow-x-hidden overflow-y-auto overscroll-contain pb-2",
          mode === "month"
            ? // A row can't be squeezed below 5rem — on a short screen the month
              // scrolls instead of crushing every cell into a number strip.
              "grid-cols-7 auto-rows-[minmax(5rem,1fr)]"
            : // Week: seven stacked full-width rows on a phone, seven columns
              // from sm up. A stacked row gives a chip the whole screen width,
              // which is the only way a task title is readable at 375px.
              // content-start keeps rows at their natural height and lets the
              // grid scroll, rather than stretching seven rows to fit and
              // slicing whichever ones hold a task.
              "grid-cols-1 content-start sm:grid-cols-7 sm:grid-rows-1 sm:content-stretch",
          travel === 1
            ? "animate-pane-from-right"
            : travel === -1
              ? "animate-pane-from-left"
              : "animate-view-in",
        )}
      >
        {days.map((date) => {
          const items = byDate.get(date) ?? [];
          const isToday = date === currentDay;
          // ISO dates sort as strings, so this is just a comparison.
          const past = date < currentDay;
          const outside = mode === "month" && !isSameMonth(date, anchor);
          const isDropTarget = drag?.targetDate === date;
          const overflow =
            mode === "month" ? Math.max(0, items.length - MONTH_CHIP_LIMIT) : 0;
          const shown =
            mode === "month" ? items.slice(0, MONTH_CHIP_LIMIT) : items;

          return (
            <div
              key={date}
              ref={(element) => registerDay(date, element)}
              className={cx(
                // `group` drives the day's hover state: the + in the corner and
                // the "Add a task" hint below both wake up when the pointer is
                // anywhere over the day, not just over the control itself.
                "group flex cursor-pointer flex-col rounded-lg border transition-colors",
                // A bounded cell clips and scrolls inside its grid row. A
                // stacked week row instead grows to fit — and must NOT be a
                // scroll container, because that would zero out its automatic
                // minimum size and let the grid squash it flat again.
                mode === "month"
                  ? "min-h-0 overflow-hidden"
                  : "sm:min-h-0 sm:overflow-hidden",
                isDropTarget
                  ? "border-accent bg-accent-soft"
                  : isToday
                    ? "border-accent/35 bg-accent-soft/40 hover:border-accent/60"
                    : outside
                      ? "border-line/60 bg-canvas hover:border-line-strong hover:bg-surface"
                      : // Days already gone sit back on the canvas so the week
                        // ahead is what stands out — you can still schedule
                        // into them, they just stop competing for attention.
                        past
                        ? "border-line/70 bg-canvas hover:border-accent/40 hover:bg-accent-soft/25"
                        : "border-line bg-surface hover:border-accent/40 hover:bg-accent-soft/25",
              )}
            >
              <div className="flex shrink-0 items-center gap-1.5 px-1.5 pt-1.5 pb-1">
                <span
                  className={cx(
                    "text-xs font-semibold tabular-nums sm:text-[11px]",
                    isToday
                      ? "flex h-5 w-5 items-center justify-center rounded-full bg-accent text-white"
                      : outside
                        ? "text-ink-mute/60"
                        : past
                          ? "text-ink-mute"
                          : "text-ink",
                  )}
                >
                  {dayOfMonth(date)}
                </span>
                {mode === "week" && (
                  <span className="text-xs text-ink-soft sm:text-[10px] sm:text-ink-mute">
                    {weekdayShort(date)}
                  </span>
                )}
                {/* Always there on touch — a hover-revealed + is simply gone on
                    a phone. `reveal-on-hover` keeps the fade for a mouse. */}
                <button
                  type="button"
                  onClick={() => onAddTask(date)}
                  aria-label={`Add a task due ${shortDate(date)}`}
                  title={`Add a task due ${shortDate(date)}`}
                  className="reveal-on-hover tap-target ml-auto rounded p-1 text-ink-mute transition hover:bg-accent-soft hover:text-accent sm:p-0.5"
                >
                  <PlusIcon className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                </button>
              </div>

              <div
                className={cx(
                  "flex flex-col gap-1 px-1 pb-1",
                  mode === "month"
                    ? // Month cells sit in a fixed-height row, so a busy day
                      // scrolls inside itself rather than losing its third chip.
                      "fade-scroll-end [--fade-scroll-size:1rem] min-h-0 flex-1 overflow-y-auto"
                    : // Week: stacked full-width rows on a phone, so the row
                      // simply grows to fit its chips — no inner scroller, and
                      // nothing gets clipped. From sm up it's a column again
                      // and needs the scroller back.
                      "sm:fade-scroll-end sm:[--fade-scroll-size:1rem] sm:min-h-0 sm:flex-1 sm:overflow-y-auto sm:pb-4",
                )}
              >
                {shown.map((task) => (
                  <TaskChip
                    key={task.id}
                    task={task}
                    date={date}
                    member={
                      task.assigneeIds.length > 0
                        ? (membersById.get(task.assigneeIds[0]) ?? null)
                        : null
                    }
                    dimmed={drag?.taskId === task.id}
                    detailed={mode === "week"}
                    onOpen={() => {
                      if (wasDragging()) return;
                      onOpenTask(task.id);
                    }}
                    onDragStart={startDrag}
                  />
                ))}

                {overflow > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      // Jump to the week containing this day, where they all fit.
                      setAnchor(date);
                      setMode("week");
                    }}
                    className="min-h-9 px-1 py-1.5 text-left text-xs font-medium text-ink-mute transition hover:text-accent sm:min-h-0 sm:py-0 sm:text-[10px]"
                  >
                    +{overflow} more
                  </button>
                )}

                {/* Clicking the empty part of a day starts a task on it —
                    nobody would guess that, so the day says so. Month cells are
                    too narrow for the label; there the + in the header is the
                    affordance and this stays a silent hit area. */}
                <button
                  type="button"
                  onClick={() => onAddTask(date)}
                  aria-label={`Add a task due ${shortDate(date)}`}
                  title={`Add a task due ${shortDate(date)}`}
                  tabIndex={-1}
                  className={cx(
                    "flex min-h-4 shrink-0 flex-1 items-center justify-center gap-0.5 overflow-hidden rounded font-medium whitespace-nowrap text-accent transition hover:bg-accent-soft",
                    mode === "week"
                      ? "reveal-on-hover text-xs sm:text-[10px]"
                      : "text-[0px]",
                  )}
                >
                  {mode === "week" && (
                    <>
                      <PlusIcon className="h-3.5 w-3.5 shrink-0 sm:h-3 sm:w-3" />
                      Add a task
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {drag && (
        <div
          className="drag-ghost"
          style={{
            width: drag.width,
            transform: `translate3d(${drag.x}px, ${drag.y}px, 0)`,
          }}
        >
          <span className="block truncate rounded-md border border-accent bg-surface px-1.5 py-1 text-[11px] font-medium text-ink card-shadow-lifted">
            {drag.label}
          </span>
        </div>
      )}
    </div>
  );
}

function TaskChip({
  task,
  date,
  member,
  dimmed,
  detailed,
  onOpen,
  onDragStart,
}: {
  task: BoardTask;
  date: string;
  member: MemberRow | null;
  dimmed: boolean;
  detailed: boolean;
  onOpen: () => void;
  onDragStart: (
    event: React.PointerEvent,
    taskId: string,
    fromDate: string,
    label: string,
  ) => void;
}) {
  const isDone = task.status === "done";

  return (
    <button
      type="button"
      onPointerDown={(event) => onDragStart(event, task.id, date, task.title)}
      onClick={onOpen}
      title={task.title}
      className={cx(
        // touch-pan-y, not touch-none: the browser keeps vertical scrolling on
        // a phone, so a finger can still scroll past a chip instead of being
        // trapped by it. Mouse drag is unaffected.
        "flex w-full shrink-0 cursor-pointer touch-pan-y items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left transition select-none sm:touch-none sm:py-1",
        detailed && "min-h-11 sm:min-h-0",
        isDone ? "bg-canvas" : "bg-sunken hover:bg-line",
        dimmed && "opacity-30",
      )}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{
          backgroundColor: PRIORITY_META[task.priority].color,
          opacity: isDone ? 0.4 : 1,
        }}
      />
      <span
        className={cx(
          "min-w-0 flex-1 truncate text-xs sm:text-[11px]",
          isDone ? "text-ink-mute line-through" : "text-ink",
        )}
      >
        {task.title}
      </span>
      {detailed && member && (
        <span className="shrink-0">
          <Avatar member={member} size="xs" />
        </span>
      )}
    </button>
  );
}
