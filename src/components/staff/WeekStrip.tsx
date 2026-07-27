"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDays,
  daysFromToday,
  dayOfMonth,
  monthShort,
  today,
  weekdayShort,
} from "@/lib/staff/dates";
import { PRIORITY_META } from "@/lib/staff/constants";
import type { MemberRow } from "@/lib/staff/database.types";
import type { BoardTask } from "@/lib/staff/types";
import { Avatar, cx } from "./primitives";
import { CalendarDaysIcon, ChevronDownIcon, ExpandIcon } from "./icons";

const DAYS_SHOWN = 7;

/**
 * The week ahead, above the board.
 *
 * The board answers "where is everything up to"; this answers "what lands
 * when". Anything already late is pulled into its own leading column so it
 * can't quietly scroll out of the week.
 */
export function WeekStrip({
  tasks,
  membersById,
  onOpenTask,
  onExpand,
}: {
  tasks: BoardTask[];
  membersById: Map<string, MemberRow>;
  onOpenTask: (taskId: string) => void;
  /** Opens the full calendar, where the same data is editable. */
  onExpand: () => void;
}) {
  /*
   * Starts closed and opens itself only where there is room. Expanded, this
   * strip costs ~136px — a sixth of a phone screen, on top of a header that
   * already takes another 150px. The height clause is what catches landscape,
   * which a width-only check would miss: a rotated iPhone is wider than the
   * `sm` breakpoint but barely 400px tall.
   *
   * Set after mount, not in the initialiser — this component is server
   * rendered, and reading matchMedia during render is a hydration mismatch.
   */
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(
      window.matchMedia("(min-width: 640px) and (min-height: 700px)").matches,
    );
  }, []);

  const { days, overdue } = useMemo(() => {
    const start = today();
    const dates = Array.from({ length: DAYS_SHOWN }, (_, i) =>
      addDays(start, i),
    );

    const open = tasks.filter(
      (task) => task.status !== "done" && task.due_date,
    );

    const byDate = new Map<string, BoardTask[]>(
      dates.map((date) => [date, []]),
    );
    const late: BoardTask[] = [];

    for (const task of open) {
      const due = task.due_date as string;
      if (daysFromToday(due) < 0) {
        late.push(task);
        continue;
      }
      byDate.get(due)?.push(task);
    }

    const byUrgency = (a: BoardTask, b: BoardTask) =>
      PRIORITY_META[a.priority].rank - PRIORITY_META[b.priority].rank;

    for (const list of byDate.values()) list.sort(byUrgency);
    late.sort(byUrgency);

    return {
      days: dates.map((date) => ({ date, items: byDate.get(date) ?? [] })),
      overdue: late,
    };
  }, [tasks]);

  const scheduled = days.reduce((total, day) => total + day.items.length, 0);

  return (
    <section
      aria-label="The week ahead"
      className="shrink-0 border-b border-line bg-surface"
    >
      {/*
        Collapsed, the whole bar is the expand control — a phone can't spare a
        44px row that only holds a label and a small "Show" button at one end.
        Expanded, the row splits back into a heading plus its two actions.
      */}
      {open ? (
        <div className="flex items-center gap-3 px-3 pt-1.5 pb-1.5 sm:gap-2 sm:px-5 sm:pt-2.5">
          <CalendarDaysIcon className="h-4 w-4 shrink-0 text-ink-mute" />
          <h2 className="shrink-0 text-[13px] font-semibold text-ink">
            This week
          </h2>
          <span className="min-w-0 truncate text-xs text-ink-mute tabular-nums sm:text-[11px]">
            {scheduled} scheduled
            {overdue.length > 0 && (
              <span className="ml-1.5 font-medium text-urgent">
                · {overdue.length} overdue
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={onExpand}
            className="ml-auto inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-accent transition hover:bg-accent-soft sm:min-h-0 sm:px-1.5 sm:text-[11px]"
          >
            <ExpandIcon className="h-3.5 w-3.5" />
            Open calendar
          </button>

          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-expanded
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-ink-mute transition hover:bg-sunken hover:text-ink sm:min-h-0 sm:px-1.5 sm:text-[11px]"
          >
            Hide
            <ChevronDownIcon className="h-3.5 w-3.5 rotate-180 transition-transform" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          className="flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left transition hover:bg-canvas sm:px-5"
        >
          <CalendarDaysIcon className="h-4 w-4 shrink-0 text-ink-mute" />
          <span className="shrink-0 text-[13px] font-semibold text-ink">
            This week
          </span>
          <span className="min-w-0 truncate text-xs text-ink-mute tabular-nums">
            {scheduled} scheduled
            {overdue.length > 0 && (
              <span className="ml-1.5 font-medium text-urgent">
                · {overdue.length} overdue
              </span>
            )}
          </span>
          <ChevronDownIcon className="ml-auto h-4 w-4 shrink-0 text-ink-mute" />
        </button>
      )}

      {open && (
        <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain px-3 pb-3 sm:px-5">
          {overdue.length > 0 && (
            <DayCell
              title="Overdue"
              subtitle={`${overdue.length} task${overdue.length > 1 ? "s" : ""}`}
              tone="overdue"
              items={overdue}
              membersById={membersById}
              onOpenTask={onOpenTask}
            />
          )}

          {days.map((day, index) => (
            <DayCell
              key={day.date}
              title={index === 0 ? "Today" : weekdayShort(day.date)}
              subtitle={`${dayOfMonth(day.date)} ${monthShort(day.date)}`}
              tone={index === 0 ? "today" : "normal"}
              items={day.items}
              membersById={membersById}
              onOpenTask={onOpenTask}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function DayCell({
  title,
  subtitle,
  tone,
  items,
  membersById,
  onOpenTask,
}: {
  title: string;
  subtitle: string;
  tone: "overdue" | "today" | "normal";
  items: BoardTask[];
  membersById: Map<string, MemberRow>;
  onOpenTask: (taskId: string) => void;
}) {
  return (
    <div
      className={cx(
        // Two cells fit exactly and the third peeks — the peek is the only
        // hint a touch device gets that the row keeps going.
        "flex w-[calc(50%-0.75rem)] shrink-0 snap-start flex-col rounded-lg border p-1.5 sm:w-auto sm:min-w-0 sm:flex-1",
        tone === "overdue"
          ? "border-urgent/25 bg-urgent/5"
          : tone === "today"
            ? "border-accent/30 bg-accent-soft"
            : "border-line bg-canvas",
      )}
    >
      <div className="mb-1.5 flex items-baseline gap-1.5 px-1">
        <span
          className={cx(
            "text-[11px] font-semibold",
            tone === "overdue"
              ? "text-urgent"
              : tone === "today"
                ? "text-accent"
                : "text-ink",
          )}
        >
          {title}
        </span>
        <span className="truncate text-xs text-ink-mute sm:text-[10px]">{subtitle}</span>
      </div>

      <div className="flex min-h-9 flex-col gap-1">
        {items.length === 0 ? (
          <span className="px-1 py-1.5 text-xs text-ink-mute/70 sm:text-[11px]">—</span>
        ) : (
          items.slice(0, 4).map((task) => {
            const people = task.assigneeIds
              .map((id) => membersById.get(id))
              .filter((member): member is MemberRow => Boolean(member));

            return (
              <button
                key={task.id}
                type="button"
                onClick={() => onOpenTask(task.id)}
                title={task.title}
                className="flex min-h-11 items-center gap-1.5 rounded-md bg-surface px-1.5 py-2 text-left transition hover:bg-line/60 sm:min-h-0 sm:py-1"
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor: PRIORITY_META[task.priority].color,
                  }}
                />
                <span className="min-w-0 flex-1 truncate text-xs text-ink sm:text-[11px]">
                  {task.title}
                </span>
                {people[0] && <Avatar member={people[0]} size="xs" />}
              </button>
            );
          })
        )}

        {items.length > 4 && (
          <span className="px-1.5 text-xs font-medium text-ink-mute sm:text-[10px]">
            +{items.length - 4} more
          </span>
        )}
      </div>
    </div>
  );
}
