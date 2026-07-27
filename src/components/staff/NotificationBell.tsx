"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/staff/actions/notifications";
import { timeAgo } from "@/lib/staff/dates";
import type { NotificationItem } from "@/lib/staff/types";
import { Avatar, cx } from "./primitives";
import { AlertIcon, BellIcon, InboxIcon } from "./icons";

export function NotificationBell({
  notifications,
  unreadCount,
  onOpenTask,
}: {
  notifications: NotificationItem[];
  unreadCount: number;
  onOpenTask: (taskId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapper} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
        aria-expanded={open}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-lg text-ink-soft transition hover:bg-sunken hover:text-ink sm:h-9 sm:w-9"
      >
        <BellIcon className="h-[18px] w-[18px]" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-urgent px-1 text-[10px] font-semibold text-white tabular-nums sm:top-0.5 sm:right-0.5">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="animate-pop-in fixed inset-x-3 top-16 z-40 overflow-hidden rounded-xl border border-line bg-surface overlay-shadow sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:w-[min(22rem,calc(100vw-1.5rem))]">
          <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
            <h2 className="text-[13px] font-semibold text-ink">Notifications</h2>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() =>
                  startTransition(() => {
                    void markAllNotificationsRead();
                  })
                }
                className="text-xs font-medium text-accent transition hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[26rem] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <InboxIcon className="h-6 w-6 text-ink-mute" />
                <p className="text-sm text-ink-mute">You&rsquo;re all caught up.</p>
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {notifications.map((item) => {
                  const isAlert =
                    item.type === "overdue" || item.type === "due_soon";

                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => {
                          if (!item.read) {
                            startTransition(() => {
                              void markNotificationRead(item.id);
                            });
                          }
                          if (item.task_id) {
                            setOpen(false);
                            onOpenTask(item.task_id);
                          }
                        }}
                        className={cx(
                          "flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left transition hover:bg-canvas",
                          !item.read && "bg-accent-soft/60",
                        )}
                      >
                        {item.actor ? (
                          <Avatar member={item.actor} size="sm" />
                        ) : (
                          <span
                            className={cx(
                              "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                              item.type === "overdue"
                                ? "bg-urgent/10 text-urgent"
                                : "bg-sunken text-ink-mute",
                            )}
                          >
                            <AlertIcon className="h-3.5 w-3.5" />
                          </span>
                        )}

                        <span className="min-w-0 flex-1">
                          <span
                            className={cx(
                              "block text-[13px] leading-snug",
                              item.read ? "text-ink-soft" : "text-ink",
                              isAlert && !item.read && "font-medium",
                            )}
                          >
                            {item.body}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-ink-mute">
                            {timeAgo(item.created_at)}
                          </span>
                        </span>

                        {!item.read && (
                          <span
                            aria-hidden
                            className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                          />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
