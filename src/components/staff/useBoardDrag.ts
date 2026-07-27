"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TaskStatus } from "@/lib/staff/database.types";

export type DragState = {
  taskId: string;
  fromStatus: TaskStatus;
  targetStatus: TaskStatus;
  /** Insertion index within the target column, ignoring the dragged card. */
  targetIndex: number;
  width: number;
  height: number;
  /** Top-left of the floating card, in viewport coordinates. */
  x: number;
  y: number;
};

type Pending = {
  taskId: string;
  fromStatus: TaskStatus;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  active: boolean;
  targetStatus: TaskStatus;
  targetIndex: number;
};

const DRAG_THRESHOLD_PX = 6;
const EDGE_SCROLL_ZONE_PX = 90;
const EDGE_SCROLL_SPEED = 14;

/**
 * Pointer-driven drag and drop for the board.
 *
 * Built on pointer events rather than HTML5 drag-and-drop, which does not fire
 * on touch devices at all. Cards can be dragged with a mouse anywhere on the
 * card; on touch, dragging starts from the grip so the column can still be
 * scrolled with a finger.
 */
export function useBoardDrag(
  onDrop: (
    taskId: string,
    status: TaskStatus,
    targetIndex: number,
  ) => void | Promise<void>,
) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const pending = useRef<Pending | null>(null);
  const columns = useRef(new Map<TaskStatus, HTMLElement>());
  const scroller = useRef<HTMLElement | null>(null);
  const suppressClick = useRef(false);
  const onDropRef = useRef(onDrop);

  useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);

  const registerColumn = useCallback(
    (status: TaskStatus, element: HTMLElement | null) => {
      if (element) columns.current.set(status, element);
      else columns.current.delete(status);
    },
    [],
  );

  const registerScroller = useCallback((element: HTMLElement | null) => {
    scroller.current = element;
  }, []);

  /** Which column the pointer is over, and where the card would land in it. */
  const resolveTarget = useCallback(
    (x: number, y: number, taskId: string, fallback: Pending) => {
      let status: TaskStatus | null = null;

      for (const [candidate, element] of columns.current) {
        const rect = element.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right) {
          status = candidate;
          break;
        }
      }

      if (!status) {
        return { status: fallback.targetStatus, index: fallback.targetIndex };
      }

      const element = columns.current.get(status);
      if (!element) {
        return { status: fallback.targetStatus, index: fallback.targetIndex };
      }

      const cards = [...element.querySelectorAll<HTMLElement>("[data-card-id]")]
        .filter((card) => card.dataset.cardId !== taskId);

      let index = cards.length;
      for (let i = 0; i < cards.length; i += 1) {
        const rect = cards[i].getBoundingClientRect();
        if (y < rect.top + rect.height / 2) {
          index = i;
          break;
        }
      }

      return { status, index };
    },
    [],
  );

  useEffect(() => {
    function handleMove(event: PointerEvent) {
      const current = pending.current;
      if (!current) return;

      const dx = event.clientX - current.startX;
      const dy = event.clientY - current.startY;

      if (!current.active) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        current.active = true;
        suppressClick.current = true;
        document.body.style.userSelect = "none";
      }

      event.preventDefault();

      const { status, index } = resolveTarget(
        event.clientX,
        event.clientY,
        current.taskId,
        current,
      );
      current.targetStatus = status;
      current.targetIndex = index;

      // Nudge the board sideways when dragging near either edge. The zone is
      // capped as a fraction of the board so it doesn't swallow a phone —
      // two 90px zones on a 375px screen would leave almost no neutral middle.
      const board = scroller.current;
      if (board) {
        const rect = board.getBoundingClientRect();
        const zone = Math.min(EDGE_SCROLL_ZONE_PX, rect.width * 0.12);
        if (event.clientX < rect.left + zone) {
          board.scrollLeft -= EDGE_SCROLL_SPEED;
        } else if (event.clientX > rect.right - zone) {
          board.scrollLeft += EDGE_SCROLL_SPEED;
        }
      }

      setDrag({
        taskId: current.taskId,
        fromStatus: current.fromStatus,
        targetStatus: status,
        targetIndex: index,
        width: current.width,
        height: current.height,
        x: event.clientX - current.offsetX,
        y: event.clientY - current.offsetY,
      });
    }

    function handleUp() {
      const current = pending.current;
      pending.current = null;
      document.body.style.userSelect = "";

      if (current?.active) {
        void onDropRef.current(
          current.taskId,
          current.targetStatus,
          current.targetIndex,
        );
        // Let the click that follows pointerup pass by without opening the card.
        window.setTimeout(() => {
          suppressClick.current = false;
        }, 0);
      } else {
        suppressClick.current = false;
      }

      setDrag(null);
    }

    /*
     * A cancelled pointer is the system taking the gesture away — an incoming
     * call, the app switcher, a palm on the screen. It is not a drop, so it
     * must not commit the move the way pointerup does.
     */
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
  }, [resolveTarget]);

  const startDrag = useCallback(
    (
      event: React.PointerEvent,
      taskId: string,
      status: TaskStatus,
      options: { fromHandle?: boolean } = {},
    ) => {
      // Without a handle, only a mouse may drag — a finger needs to scroll.
      if (!options.fromHandle && event.pointerType !== "mouse") return;
      if (event.button !== 0 && event.pointerType === "mouse") return;

      const card = (event.currentTarget as HTMLElement).closest<HTMLElement>(
        "[data-card-id]",
      );
      if (!card) return;

      const rect = card.getBoundingClientRect();

      pending.current = {
        taskId,
        fromStatus: status,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        width: rect.width,
        height: rect.height,
        active: false,
        targetStatus: status,
        targetIndex: 0,
      };
    },
    [],
  );

  const wasDragging = useCallback(() => suppressClick.current, []);

  return { drag, startDrag, registerColumn, registerScroller, wasDragging };
}
