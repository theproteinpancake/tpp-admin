"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type CalendarDragState = {
  taskId: string;
  fromDate: string;
  /** The day cell under the pointer, or null if the pointer has left the grid. */
  targetDate: string | null;
  label: string;
  width: number;
  x: number;
  y: number;
};

type Pending = {
  taskId: string;
  fromDate: string;
  label: string;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  width: number;
  active: boolean;
  targetDate: string | null;
  pointerType: string;
};

const DRAG_THRESHOLD_PX = 6;

/**
 * A finger is nowhere near as steady as a mouse — 6px of travel is ordinary
 * noise during a tap, so on touch the chip has to move meaningfully further
 * before we decide it's a drag rather than a tap on the task.
 */
const TOUCH_DRAG_THRESHOLD_PX = 14;

/**
 * Drag a task chip from one day to another to reschedule it.
 *
 * Day cells are hit-tested on both axes rather than by column, because a month
 * view is a grid — the same x can belong to five different dates.
 */
export function useCalendarDrag(
  onDrop: (taskId: string, date: string) => void | Promise<void>,
) {
  const [drag, setDrag] = useState<CalendarDragState | null>(null);
  const pending = useRef<Pending | null>(null);
  const cells = useRef(new Map<string, HTMLElement>());
  const suppressClick = useRef(false);
  const onDropRef = useRef(onDrop);

  useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);

  const registerDay = useCallback(
    (date: string, element: HTMLElement | null) => {
      if (element) cells.current.set(date, element);
      else cells.current.delete(date);
    },
    [],
  );

  const dateAt = useCallback((x: number, y: number): string | null => {
    for (const [date, element] of cells.current) {
      const rect = element.getBoundingClientRect();
      if (
        x >= rect.left &&
        x <= rect.right &&
        y >= rect.top &&
        y <= rect.bottom
      ) {
        return date;
      }
    }
    return null;
  }, []);

  useEffect(() => {
    function handleMove(event: PointerEvent) {
      const current = pending.current;
      if (!current) return;

      const dx = event.clientX - current.startX;
      const dy = event.clientY - current.startY;

      if (!current.active) {
        const threshold =
          current.pointerType === "mouse"
            ? DRAG_THRESHOLD_PX
            : TOUCH_DRAG_THRESHOLD_PX;
        if (Math.hypot(dx, dy) < threshold) return;
        current.active = true;
        suppressClick.current = true;
        document.body.style.userSelect = "none";
      }

      event.preventDefault();
      current.targetDate = dateAt(event.clientX, event.clientY);

      setDrag({
        taskId: current.taskId,
        fromDate: current.fromDate,
        targetDate: current.targetDate,
        label: current.label,
        width: current.width,
        x: event.clientX - current.offsetX,
        y: event.clientY - current.offsetY,
      });
    }

    function handleUp() {
      const current = pending.current;
      pending.current = null;
      document.body.style.userSelect = "";

      if (current?.active) {
        if (current.targetDate && current.targetDate !== current.fromDate) {
          void onDropRef.current(current.taskId, current.targetDate);
        }
        window.setTimeout(() => {
          suppressClick.current = false;
        }, 0);
      } else {
        suppressClick.current = false;
      }

      setDrag(null);
    }

    /* A cancelled pointer is the system taking the gesture back, not a drop —
       reschedule nothing. */
    function handleCancel() {
      pending.current = null;
      document.body.style.userSelect = "";
      suppressClick.current = false;
      setDrag(null);
    }

    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
    };
  }, [dateAt]);

  const startDrag = useCallback(
    (
      event: React.PointerEvent,
      taskId: string,
      fromDate: string,
      label: string,
    ) => {
      if (event.button !== 0 && event.pointerType === "mouse") return;

      const chip = event.currentTarget as HTMLElement;
      const rect = chip.getBoundingClientRect();

      pending.current = {
        taskId,
        fromDate,
        label,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        width: rect.width,
        active: false,
        targetDate: fromDate,
        pointerType: event.pointerType,
      };
    },
    [],
  );

  const wasDragging = useCallback(() => suppressClick.current, []);

  return { drag, startDrag, registerDay, wasDragging };
}
