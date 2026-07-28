"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { advanceTask, moveTask, updateTask } from "@/lib/staff/actions/tasks";
import { NEXT_STATUS } from "@/lib/staff/constants";
import type { CategoryRow, MemberRow, TaskStatus } from "@/lib/staff/database.types";
import type {
  BoardTask,
  LinkItem,
  NotificationItem,
  SuggestionItem,
} from "@/lib/staff/types";
import { BoardView } from "./BoardView";
import { CalendarView } from "./CalendarView";
import { InboxView } from "./InboxView";
import { LinksView } from "./LinksView";
import { ListView } from "./ListView";
import { NewTaskDialog } from "./NewTaskDialog";
import { NotificationBell } from "./NotificationBell";
import { SettingsDialog } from "./SettingsDialog";
import { TaskDialog } from "./TaskDialog";
import { WeekStrip } from "./WeekStrip";
import { Avatar, SelectControl, cx } from "./primitives";
import {
  RepeatIcon,
  BoardIcon,
  CalendarDaysIcon,
  ChevronDownIcon,
  InboxIcon,
  LinkIcon,
  ListIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
} from "./icons";

/** How often to pull in other people's changes. */
const POLL_MS = 45_000;

type View = "board" | "list" | "upcoming" | "calendar" | "links" | "inbox";

type NewTaskSeed = { status: TaskStatus; dueDate?: string };

export function Workspace({
  tasks: serverTasks,
  members,
  categories,
  links,
  suggestions,
  notifications,
  unreadCount,
  currentMember,
  initialTaskId,
}: {
  tasks: BoardTask[];
  members: MemberRow[];
  categories: CategoryRow[];
  links: LinkItem[];
  suggestions: SuggestionItem[];
  notifications: NotificationItem[];
  unreadCount: number;
  currentMember: MemberRow;
  initialTaskId?: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Local mirror so a drag lands instantly; the server's copy wins on refresh.
  const [tasks, setTasks] = useState(serverTasks);
  useEffect(() => setTasks(serverTasks), [serverTasks]);

  const [view, setView] = useState<View>("board");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [search, setSearch] = useState("");

  // ?task=<id> deep link: WhatsApp task pings link straight to the task, so a ping is one tap
  // from the thing it's about rather than "go find it on the board". Cleared from the URL once
  // opened, so a refresh or a shared link doesn't keep re-opening it.
  const [openTaskId, setOpenTaskId] = useState<string | null>(initialTaskId ?? null);
  useEffect(() => {
    if (!initialTaskId) return;
    window.history.replaceState(null, "", window.location.pathname);
  }, [initialTaskId]);
  const [newTask, setNewTask] = useState<NewTaskSeed | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  /* Keep the board fresh without a websocket — at four people, polling is
     plenty and there is nothing extra to run or pay for. */
  useEffect(() => {
    // Each refresh is a full server render, so don't burn one while the tab is in the
    // background — coming back to it triggers the focus refresh below anyway.
    const id = window.setInterval(() => {
      if (!document.hidden) router.refresh();
    }, POLL_MS);
    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [router]);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  const membersById = useMemo(
    () => new Map(members.map((member) => [member.id, member])),
    [members],
  );
  const categoriesById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );

  const visibleTasks = useMemo(() => {
    const query = search.trim().toLowerCase();

    return tasks.filter((task) => {
      if (assigneeFilter === "unassigned") {
        if (task.assigneeIds.length > 0) return false;
      } else if (assigneeFilter !== "all") {
        if (!task.assigneeIds.includes(assigneeFilter)) return false;
      }

      if (categoryFilter && task.category_id !== categoryFilter) return false;

      if (query) {
        const haystack = `${task.title} ${task.description ?? ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }

      return true;
    });
  }, [tasks, assigneeFilter, categoryFilter, search]);

  /*
   * A repeating task spawns its next occurrence the moment you tick the current one, so
   * "Pay HotlineUGC Creator Balances" (due 1 Sep) reappeared in To Do the instant it was
   * completed in July — it read as though nothing had happened. Anything due beyond the
   * week strip is parked in Upcoming and rejoins the board on its own timeline. The horizon
   * is the week strip's, so "if it's not in the week above, it's in Upcoming".
   */
  const upcomingCutoff = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  }, []);

  const isUpcoming = (task: BoardTask) =>
    task.status !== "done" && !!task.due_date && task.due_date > upcomingCutoff;

  const upcomingTasks = useMemo(
    () => visibleTasks.filter(isUpcoming).sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? "")),
    [visibleTasks, upcomingCutoff],
  );
  // Board and list show what's actually live; the calendar deliberately keeps everything,
  // since showing future dates is the entire point of a calendar.
  const currentTasks = useMemo(() => visibleTasks.filter((t) => !isUpcoming(t)), [visibleTasks, upcomingCutoff]);

  function handleMove(
    taskId: string,
    status: TaskStatus,
    above: number | null,
    below: number | null,
  ) {
    const position =
      above === null && below === null
        ? 0
        : above === null
          ? (below as number) - 100
          : below === null
            ? above + 100
            : (above + below) / 2;

    setTasks((previous) =>
      previous.map((task) =>
        task.id === taskId ? { ...task, status, position } : task,
      ),
    );

    startTransition(async () => {
      await moveTask(taskId, status, above, below);
    });
  }

  function handleAdvance(taskId: string) {
    setTasks((previous) =>
      previous.map((task) => {
        if (task.id !== taskId) return task;

        const status = NEXT_STATUS[task.status];
        // Starting an unclaimed job puts your name on it — mirrored here so
        // the avatar appears with the same tap, not a poll later.
        const claiming = status === "in_progress" && task.assigneeIds.length === 0;

        return {
          ...task,
          status,
          assigneeIds: claiming ? [currentMember.id] : task.assigneeIds,
        };
      }),
    );

    startTransition(async () => {
      await advanceTask(taskId);
    });
  }

  function handleReschedule(taskId: string, dueDate: string) {
    setTasks((previous) =>
      previous.map((task) =>
        task.id === taskId ? { ...task, due_date: dueDate } : task,
      ),
    );

    startTransition(async () => {
      await updateTask(taskId, { dueDate });
    });
  }

  const filtersActive =
    assigneeFilter !== "all" || categoryFilter !== "" || search.trim() !== "";
  const fillsScreen = view === "board" || view === "calendar";

  return (
    <div className="flex h-dvh flex-col">
      {/* Top bar ------------------------------------------------- */}
      <header className="shrink-0 border-b border-line bg-surface">
        <div className="flex items-center gap-2 px-3 py-2.5 sm:px-5">
          <h1 className="mr-1 text-[15px] font-semibold tracking-tight text-ink">
            Tasks
          </h1>

          {/* One search box, not two. It takes the spare width on a phone and
              settles back to a fixed field from sm up. */}
          <div className="relative ml-auto min-w-0 flex-1 sm:flex-none">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-ink-mute" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search"
              aria-label="Search tasks"
              className="h-11 w-full rounded-lg border border-line bg-surface pr-3 pl-8 text-base text-ink outline-none transition placeholder:text-ink-mute focus:border-accent focus:ring-2 focus:ring-accent/15 sm:h-9 sm:w-44 sm:text-sm sm:focus:w-56"
            />
          </div>

          <NotificationBell
            notifications={notifications}
            unreadCount={unreadCount}
            onOpenTask={(taskId) => setOpenTaskId(taskId)}
          />

          <div ref={menuRef} className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((value) => !value)}
              aria-expanded={menuOpen}
              aria-label={`Signed in as ${currentMember.name}`}
              className="flex h-11 items-center gap-1 rounded-lg px-1.5 transition hover:bg-sunken sm:h-auto sm:p-1"
            >
              <Avatar member={currentMember} size="sm" />
              <ChevronDownIcon className="h-3.5 w-3.5 text-ink-mute" />
            </button>

            {menuOpen && (
              <div className="animate-pop-in absolute right-0 z-40 mt-2 w-52 overflow-hidden rounded-xl border border-line bg-surface overlay-shadow">
                <div className="border-b border-line px-3.5 py-2.5">
                  <p className="text-[13px] font-medium text-ink">
                    {currentMember.name}
                  </p>
                  <p className="text-[11px] text-ink-mute">
                    The Protein Pancake
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setSettingsOpen(true);
                  }}
                  className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] text-ink-soft transition hover:bg-canvas hover:text-ink"
                >
                  <SettingsIcon className="h-4 w-4" />
                  Task settings
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setNewTask({ status: "todo" })}
            // The label is hidden on a phone, so the button needs its own name.
            aria-label="New task"
            className="ml-1 inline-flex h-11 w-11 items-center justify-center gap-1.5 rounded-lg bg-ink text-sm font-medium text-white transition hover:bg-ink/90 sm:h-9 sm:w-auto sm:px-3"
          >
            <PlusIcon className="h-5 w-5 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">New task</span>
          </button>
        </div>

        {/* Views and filters ------------------------------------- */}
        <div className="flex flex-col gap-2 px-3 pb-2.5 sm:flex-row sm:items-center sm:gap-2 sm:px-5">
          {/* On a phone the switcher gets its own full-width row: it is the
              primary navigation and must never be the thing that scrolled
              out of sight. From sm up it sits inline as before. */}
          <div className="flex h-11 w-full shrink-0 items-center gap-0.5 rounded-lg bg-sunken p-0.5 sm:h-8 sm:w-auto sm:p-1">
            <ViewToggle
              active={view === "board"}
              onClick={() => setView("board")}
              label="Board"
              icon={<BoardIcon className="h-4 w-4 sm:h-3.5 sm:w-3.5" />}
            />
            <ViewToggle
              active={view === "list"}
              onClick={() => setView("list")}
              label="List"
              icon={<ListIcon className="h-4 w-4 sm:h-3.5 sm:w-3.5" />}
            />
            <ViewToggle
              active={view === "upcoming"}
              onClick={() => setView("upcoming")}
              label="Upcoming"
              icon={<RepeatIcon className="h-3.5 w-3.5" />}
              badge={upcomingTasks.length}
            />
            <ViewToggle
              active={view === "calendar"}
              onClick={() => setView("calendar")}
              label="Calendar"
              icon={<CalendarDaysIcon className="h-4 w-4 sm:h-3.5 sm:w-3.5" />}
            />
            <ViewToggle
              active={view === "links"}
              onClick={() => setView("links")}
              label="Links"
              icon={<LinkIcon className="h-4 w-4 sm:h-3.5 sm:w-3.5" />}
            />
            <ViewToggle
              active={view === "inbox"}
              onClick={() => setView("inbox")}
              label="Inbox"
              icon={<InboxIcon className="h-4 w-4 sm:h-3.5 sm:w-3.5" />}
              badge={suggestions.length}
            />
          </div>

          {view !== "links" && view !== "inbox" && (
            /* The filters keep scrolling sideways — there are too many to fit
               and too few to hide. The right-edge fade is the only cue a
               touch device gets that the row continues. */
            <div className="fade-scroll-x-end -mx-3 flex min-w-0 items-center gap-2 overflow-x-auto px-3 pb-0.5 sm:mx-0 sm:mask-none sm:flex-1 sm:px-0">
              <span className="hidden h-4 w-px shrink-0 bg-line sm:block" aria-hidden />

              <FilterChip
                active={assigneeFilter === "all"}
                onClick={() => setAssigneeFilter("all")}
              >
                Everyone
              </FilterChip>

              {members.map((member) => (
                <FilterChip
                  key={member.id}
                  active={assigneeFilter === member.id}
                  onClick={() =>
                    setAssigneeFilter((current) =>
                      current === member.id ? "all" : member.id,
                    )
                  }
                >
                  <Avatar member={member} size="xs" />
                  {member.id === currentMember.id ? "Me" : member.name}
                </FilterChip>
              ))}

              <FilterChip
                active={assigneeFilter === "unassigned"}
                onClick={() =>
                  setAssigneeFilter((current) =>
                    current === "unassigned" ? "all" : "unassigned",
                  )
                }
              >
                Unassigned
              </FilterChip>

              <span className="h-4 w-px shrink-0 bg-line" aria-hidden />

              <SelectControl
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                aria-label="Filter by category"
              >
                <option value="">All categories</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </SelectControl>

              {filtersActive && (
                <button
                  type="button"
                  onClick={() => {
                    setAssigneeFilter("all");
                    setCategoryFilter("");
                    setSearch("");
                  }}
                  className="inline-flex h-11 shrink-0 items-center rounded-lg px-3 text-sm font-medium text-accent transition hover:bg-accent-soft sm:h-8 sm:px-2.5 sm:text-xs"
                >
                  Clear
                </button>
              )}

              {/* A little tail so the last chip can clear the edge fade. */}
              <span className="w-3 shrink-0 sm:hidden" aria-hidden />
            </div>
          )}
        </div>
      </header>

      {/* The week ahead sits above the board it belongs to. */}
      {view === "board" && tasks.length > 0 && (
        <WeekStrip
          tasks={visibleTasks}
          membersById={membersById}
          onOpenTask={setOpenTaskId}
          onExpand={() => setView("calendar")}
        />
      )}

      {/* Body ---------------------------------------------------- */}
      <main
        className={cx(
          "min-h-0 flex-1 pt-3",
          fillsScreen ? "overflow-hidden" : "overflow-y-auto",
        )}
      >
        {/* Keyed on the view so switching pages remounts and replays the
            entrance — the board doesn't just blink into a list. */}
        <div
          key={view}
          className={cx("animate-view-in", fillsScreen && "h-full")}
        >
          {view === "links" ? (
            <LinksView links={links} onOpenTask={setOpenTaskId} />
          ) : view === "inbox" ? (
            <InboxView
              suggestions={suggestions}
              members={members}
              categories={categories}
              onOpenTask={setOpenTaskId}
            />
          ) : tasks.length === 0 ? (
            <EmptyBoard onCreate={() => setNewTask({ status: "todo" })} />
          ) : view === "upcoming" ? (
            upcomingTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
                <h2 className="text-base font-semibold text-ink">Nothing waiting in the wings</h2>
                <p className="mt-1 max-w-sm text-sm text-ink-soft">
                  Tasks due more than a week out wait here — including the next occurrence of
                  anything that repeats. They join the board as their date comes around.
                </p>
              </div>
            ) : (
              <div className="animate-view-in">
                <p className="px-1 pb-2 text-xs text-ink-mute">
                  Due more than a week out — these join the board automatically as their date arrives.
                </p>
                <ListView
                  tasks={upcomingTasks}
                  membersById={membersById}
                  categoriesById={categoriesById}
                  onOpenTask={setOpenTaskId}
                />
              </div>
            )
          ) : view === "calendar" ? (
            <CalendarView
              tasks={visibleTasks}
              membersById={membersById}
              onOpenTask={setOpenTaskId}
              onAddTask={(dueDate) => setNewTask({ status: "todo", dueDate })}
              onReschedule={handleReschedule}
            />
          ) : visibleTasks.length === 0 ? (
            <p className="px-5 py-16 text-center text-sm text-ink-mute">
              Nothing matches those filters.
            </p>
          ) : view === "board" ? (
            <BoardView
              tasks={currentTasks}
              membersById={membersById}
              categoriesById={categoriesById}
              onOpenTask={setOpenTaskId}
              onMove={handleMove}
              onAddTask={(status) => setNewTask({ status })}
              onAdvance={handleAdvance}
            />
          ) : (
            <ListView
              tasks={currentTasks}
              membersById={membersById}
              categoriesById={categoriesById}
              onOpenTask={setOpenTaskId}
            />
          )}
        </div>
      </main>

      {/* Dialogs -------------------------------------------------- */}
      {openTaskId && (
        <TaskDialog
          key={openTaskId}
          taskId={openTaskId}
          members={members}
          categories={categories}
          currentMemberId={currentMember.id}
          onClose={() => setOpenTaskId(null)}
        />
      )}

      {newTask && (
        <NewTaskDialog
          members={members}
          categories={categories}
          defaultStatus={newTask.status}
          defaultAssigneeId={currentMember.id}
          defaultDueDate={newTask.dueDate}
          onClose={() => setNewTask(null)}
          // Just close and let the card appear on the board — opening the task
          // straight after creating it only gets in the way.
          onCreated={() => setNewTask(null)}
        />
      )}

      {settingsOpen && (
        <SettingsDialog onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}

function ViewToggle({
  active,
  onClick,
  label,
  icon,
  badge = 0,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        // Equal shares of the full-width row on a phone; intrinsic width from
        // sm up, where the row sits inline with the filters.
        "inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-1 text-[13px] font-medium transition sm:h-6 sm:flex-none sm:gap-1.5 sm:px-2 sm:text-xs",
        active
          ? "bg-surface text-ink card-shadow"
          : "text-ink-mute hover:text-ink-soft",
      )}
    >
      {/* Five labels have to share 375px — the icons are the first thing to
          go, since the words carry the meaning on their own. */}
      <span className="hidden sm:inline">{icon}</span>
      <span className="truncate">{label}</span>
      {badge > 0 && (
        <span className="shrink-0 rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white tabular-nums sm:text-[10px]">
          {badge}
        </span>
      )}
    </button>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition sm:h-8 sm:px-2.5 sm:text-xs",
        active
          ? "border-ink bg-ink text-white"
          : "border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function EmptyBoard({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
      <h2 className="text-base font-semibold text-ink">Nothing here yet</h2>
      <p className="mt-1 max-w-sm text-sm text-ink-soft">
        Add the first task and it&rsquo;ll show up on the board for everyone.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white transition hover:bg-ink/90"
      >
        <PlusIcon className="h-4 w-4" />
        Create a task
      </button>
    </div>
  );
}
