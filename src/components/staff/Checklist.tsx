"use client";

import { useEffect, useRef, useState } from "react";
import type { MemberRow, SubtaskRow } from "@/lib/staff/database.types";
import { MentionInput } from "./MentionInput";
import { MentionText, cx, labelClass } from "./primitives";
import { CloseIcon, PlusIcon } from "./icons";

const DRAG_THRESHOLD_PX = 5;

export function Checklist({
  subtasks,
  members,
  onAdd,
  onToggle,
  onDelete,
  onReorder,
}: {
  subtasks: SubtaskRow[];
  members: MemberRow[];
  onAdd: (title: string) => void;
  onToggle: (subtaskId: string, done: boolean) => void;
  onDelete: (subtaskId: string) => void;
  onReorder: (orderedIds: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  // Local copy so a drag reorders instantly; the server's order wins on refresh.
  const [steps, setSteps] = useState(subtasks);
  useEffect(() => setSteps(subtasks), [subtasks]);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const pending = useRef<{ id: string; startY: number; active: boolean } | null>(
    null,
  );

  const done = steps.filter((step) => step.done).length;

  useEffect(() => {
    function move(event: PointerEvent) {
      const current = pending.current;
      if (!current) return;

      if (!current.active) {
        if (Math.abs(event.clientY - current.startY) < DRAG_THRESHOLD_PX) return;
        current.active = true;
        setDraggingId(current.id);
        document.body.style.userSelect = "none";
      }

      event.preventDefault();

      const rows = [...(listRef.current?.children ?? [])] as HTMLElement[];
      const from = steps.findIndex((step) => step.id === current.id);
      if (from === -1) return;

      // Land where the pointer is, by comparing against each row's midpoint.
      let to = rows.length - 1;
      for (let i = 0; i < rows.length; i += 1) {
        const rect = rows[i].getBoundingClientRect();
        if (event.clientY < rect.top + rect.height / 2) {
          to = i;
          break;
        }
      }

      if (to !== from) {
        setSteps((previous) => {
          const next = [...previous];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          return next;
        });
      }
    }

    function up() {
      const current = pending.current;
      pending.current = null;
      document.body.style.userSelect = "";

      if (current?.active) {
        setSteps((previous) => {
          onReorder(previous.map((step) => step.id));
          return previous;
        });
      }
      setDraggingId(null);
    }

    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [steps, onReorder]);

  function submit() {
    const value = draft.trim();
    if (!value) return;
    setDraft("");
    onAdd(value);
  }

  return (
    <section>
      <h3 className={cx(labelClass, "flex items-center gap-2")}>
        Checklist
        {steps.length > 0 && (
          <span className="text-ink-soft normal-case tabular-nums">
            {done}/{steps.length}
          </span>
        )}
      </h3>

      {steps.length > 0 && (
        <>
          <div
            className="mb-2 h-1 overflow-hidden rounded-full bg-sunken"
            role="progressbar"
            aria-valuenow={done}
            aria-valuemin={0}
            aria-valuemax={steps.length}
          >
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
              style={{ width: `${(done / steps.length) * 100}%` }}
            />
          </div>

          <ul ref={listRef} className="mb-2">
            {steps.map((step) => (
              <li
                key={step.id}
                className={cx(
                  "group flex min-h-11 items-center gap-1.5 rounded-lg transition sm:min-h-0",
                  draggingId === step.id && "bg-sunken opacity-70",
                )}
              >
                <button
                  type="button"
                  aria-label={`Reorder: ${step.title}`}
                  onPointerDown={(event) => {
                    pending.current = {
                      id: step.id,
                      startY: event.clientY,
                      active: false,
                    };
                  }}
                  className="reveal-on-hover shrink-0 cursor-grab touch-none rounded p-2 text-ink-mute/50 transition hover:text-ink-soft active:cursor-grabbing sm:p-1"
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

                <input
                  type="checkbox"
                  id={`step-${step.id}`}
                  checked={step.done}
                  onChange={(event) => onToggle(step.id, event.target.checked)}
                  className="h-5 w-5 shrink-0 accent-emerald-600 sm:h-4 sm:w-4"
                />

                <label
                  htmlFor={`step-${step.id}`}
                  className={cx(
                    // The label is the tap target for the checkbox, so it takes
                    // the full row height on a phone.
                    "min-w-0 flex-1 cursor-pointer py-2.5 text-sm sm:py-1",
                    step.done ? "text-ink-mute line-through" : "text-ink",
                  )}
                >
                  <MentionText text={step.title} />
                </label>

                <button
                  type="button"
                  onClick={() => onDelete(step.id)}
                  aria-label={`Remove step: ${step.title}`}
                  className="reveal-on-hover shrink-0 rounded p-2 text-ink-mute transition hover:bg-sunken hover:text-urgent sm:p-1"
                >
                  <CloseIcon className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="flex items-center gap-2">
        <PlusIcon className="h-4 w-4 shrink-0 text-ink-mute" />
        <MentionInput
          value={draft}
          onChange={setDraft}
          onSubmit={submit}
          members={members}
          placeholder="Add a step — type @ to tag someone"
          ariaLabel="Add a checklist step"
          className="w-full rounded-lg border border-transparent bg-transparent px-2 py-2.5 text-base text-ink outline-none transition placeholder:text-ink-mute hover:bg-sunken focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent/15 sm:py-1.5 sm:text-sm"
        />
      </div>
    </section>
  );
}
