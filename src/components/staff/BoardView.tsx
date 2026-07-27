"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { STATUSES } from "@/lib/staff/constants";
import type { CategoryRow, MemberRow, TaskStatus } from "@/lib/staff/database.types";
import type { BoardTask } from "@/lib/staff/types";
import { TaskCard } from "./TaskCard";
import { useBoardDrag } from "./useBoardDrag";
import { cx } from "./primitives";
import { PlusIcon } from "./icons";

const STATUS_DOT: Record<TaskStatus, string> = {
  todo: "#a1a1aa",
  in_progress: "#3b82f6",
  blocked: "#dc2626",
  done: "#059669",
};

/**
 * Backlogged work is parked, so the column recedes — but its dot stays full
 * strength, so you can still spot that something has been shelved.
 */
const MUTED_STATUS: TaskStatus = "blocked";

export function BoardView({
  tasks,
  membersById,
  categoriesById,
  onOpenTask,
  onMove,
  onAddTask,
  onAdvance,
}: {
  tasks: BoardTask[];
  membersById: Map<string, MemberRow>;
  categoriesById: Map<string, CategoryRow>;
  onOpenTask: (taskId: string) => void;
  onMove: (
    taskId: string,
    status: TaskStatus,
    above: number | null,
    below: number | null,
  ) => void;
  onAddTask: (status: TaskStatus) => void;
  onAdvance: (taskId: string) => void;
}) {
  const columns = useMemo(() => {
    const grouped = new Map<TaskStatus, BoardTask[]>(
      STATUSES.map((status) => [status.id, []]),
    );
    for (const task of tasks) grouped.get(task.status)?.push(task);
    for (const list of grouped.values()) {
      list.sort((a, b) => a.position - b.position);
    }
    return grouped;
  }, [tasks]);

  /*
   * Cards that weren't on the board a moment ago play themselves in — whether
   * you just created one or polling picked up somebody else's. The board you
   * arrive at is never animated, only what changes while you're watching.
   */
  const known = useRef(new Set<string>());
  const settled = useRef(false);
  const [entering, setEntering] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const fresh = tasks
      .filter((task) => !known.current.has(task.id))
      .map((task) => task.id);

    for (const task of tasks) known.current.add(task.id);

    if (!settled.current) {
      settled.current = true;
      return;
    }
    if (fresh.length === 0) return;

    setEntering(new Set(fresh));
    // Clear once the animation has run, so a later re-render doesn't replay it.
    const timer = window.setTimeout(() => setEntering(new Set()), 400);
    return () => window.clearTimeout(timer);
  }, [tasks]);

  const peopleFor = (task: BoardTask): MemberRow[] =>
    task.assigneeIds
      .map((id) => membersById.get(id))
      .filter((member): member is MemberRow => Boolean(member));

  const { drag, startDrag, registerColumn, registerScroller, wasDragging } =
    useBoardDrag((taskId, status, targetIndex) => {
      const column = (columns.get(status) ?? []).filter(
        (task) => task.id !== taskId,
      );
      const above = targetIndex > 0 ? column[targetIndex - 1].position : null;
      const below =
        targetIndex < column.length ? column[targetIndex].position : null;

      onMove(taskId, status, above, below);
    });

  const draggedTask = drag
    ? tasks.find((task) => task.id === drag.taskId)
    : null;

  return (
    <>
      {/* Columns share the width evenly on a wide screen; on a phone they
          become full-width pages you swipe between. */}
      <div
        ref={registerScroller}
        className="flex h-full snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-4 sm:snap-none sm:gap-4 sm:px-5"
      >
        {STATUSES.map((status) => {
          const list = columns.get(status.id) ?? [];
          const visible = drag
            ? list.filter((task) => task.id !== drag.taskId)
            : list;
          const showPlaceholderAt =
            drag && drag.targetStatus === status.id ? drag.targetIndex : -1;

          return (
            <section
              key={status.id}
              className="flex w-[85vw] shrink-0 snap-center flex-col sm:w-auto sm:min-w-0 sm:flex-1 sm:shrink sm:snap-align-none"
              aria-label={status.label}
            >
              <header className="flex items-center gap-2 px-1 pt-1 pb-2.5">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: STATUS_DOT[status.id] }}
                  aria-hidden
                />
                <h2
                  className={cx(
                    "truncate text-[13px] font-semibold",
                    status.id === MUTED_STATUS ? "text-ink-mute" : "text-ink",
                  )}
                >
                  {status.label}
                </h2>
                <span className="rounded-full bg-sunken px-1.5 py-0.5 text-[11px] font-medium text-ink-mute tabular-nums">
                  {list.length}
                </span>
                <button
                  type="button"
                  onClick={() => onAddTask(status.id)}
                  aria-label={`Add a task to ${status.label}`}
                  className="-my-2 -mr-1 ml-auto inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-ink-mute transition hover:bg-sunken hover:text-ink sm:my-0 sm:mr-0 sm:h-7 sm:w-7"
                >
                  <PlusIcon className="h-4 w-4" />
                </button>
              </header>

              <div
                ref={(element) => registerColumn(status.id, element)}
                className={cx(
                  // Extra room at the foot of the scroller so the last card can
                  // be scrolled fully clear of the viewport edge, and a fade
                  // over that same distance so mid-scroll cards dissolve into
                  // the edge instead of meeting it as a hard cut.
                  "fade-scroll-end flex min-h-32 flex-1 flex-col gap-2 overflow-y-auto rounded-xl px-1.5 pt-1.5 pb-8 transition",
                  // No column fill — the cards carry the tint, so they read as
                  // objects on the page rather than tiles inside a tray.
                  drag?.targetStatus === status.id
                    ? "bg-accent-soft"
                    : "bg-transparent",
                  // Parked work fades back, and comes forward when reached for.
                  // Only where there's a pointer to reach with — on touch there
                  // is no hover, so the fade would never lift.
                  status.id === MUTED_STATUS &&
                    !drag &&
                    "pointer-fine:opacity-55 pointer-fine:saturate-50 hover:opacity-100 hover:saturate-100 focus-within:opacity-100 focus-within:saturate-100",
                )}
              >
                {visible.map((task, index) => (
                  <div key={task.id} className="contents">
                    {showPlaceholderAt === index && <DropPlaceholder />}
                    <TaskCard
                      task={task}
                      assignees={peopleFor(task)}
                      category={
                        task.category_id
                          ? (categoriesById.get(task.category_id) ?? null)
                          : null
                      }
                      onOpen={() => {
                        if (wasDragging()) return;
                        onOpenTask(task.id);
                      }}
                      onDragStart={startDrag}
                      onAdvance={onAdvance}
                      entering={entering.has(task.id)}
                    />
                  </div>
                ))}

                {showPlaceholderAt >= visible.length && <DropPlaceholder />}

                {visible.length === 0 && showPlaceholderAt < 0 && (
                  <button
                    type="button"
                    onClick={() => onAddTask(status.id)}
                    className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong/60 py-7 text-xs text-ink-mute transition hover:border-ink-mute hover:text-ink-soft"
                  >
                    <PlusIcon className="h-4 w-4" />
                    Add a task
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {drag && draggedTask && (
        <div
          className="drag-ghost card-shadow-lifted"
          style={{
            width: drag.width,
            transform: `translate3d(${drag.x}px, ${drag.y}px, 0)`,
          }}
        >
          <TaskCard
            task={draggedTask}
            assignees={peopleFor(draggedTask)}
            category={
              draggedTask.category_id
                ? (categoriesById.get(draggedTask.category_id) ?? null)
                : null
            }
            floating
          />
        </div>
      )}
    </>
  );
}

function DropPlaceholder() {
  return (
    <div
      aria-hidden
      className="rounded-xl border border-dashed border-accent/50 bg-accent/5"
      style={{ height: 64 }}
    />
  );
}
