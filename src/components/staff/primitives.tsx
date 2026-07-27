"use client";

import { Fragment, useEffect, useRef } from "react";
import type { MemberRow } from "@/lib/staff/database.types";
import { PRIORITY_META } from "@/lib/staff/constants";
import type { TaskPriority } from "@/lib/staff/database.types";
import { ChevronDownIcon, CloseIcon } from "./icons";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ */

const AVATAR_SIZES = {
  xs: "h-5 w-5 text-[10px]",
  sm: "h-6 w-6 text-[11px]",
  md: "h-8 w-8 text-xs",
  lg: "h-10 w-10 text-sm",
} as const;

export function Avatar({
  member,
  size = "sm",
  ring = false,
}: {
  member: MemberRow | null | undefined;
  size?: keyof typeof AVATAR_SIZES;
  ring?: boolean;
}) {
  if (!member) {
    return (
      <span
        className={cx(
          "inline-flex items-center justify-center rounded-full border border-dashed border-line-strong text-ink-mute",
          AVATAR_SIZES[size],
        )}
        title="Unassigned"
      >
        ?
      </span>
    );
  }

  return (
    <span
      className={cx(
        "inline-flex items-center justify-center rounded-full font-semibold text-white select-none",
        AVATAR_SIZES[size],
        ring && "ring-2 ring-white",
      )}
      style={{ backgroundColor: member.color }}
      title={member.name}
    >
      {member.initials}
    </span>
  );
}

/**
 * The people on a task: overlapping avatars followed by names, because an
 * initial alone doesn't tell you who it is at a glance.
 */
export function AssigneeStack({
  members,
  size = "xs",
}: {
  members: MemberRow[];
  size?: keyof typeof AVATAR_SIZES;
}) {
  if (!members || members.length === 0) {
    return <span className="text-[11px] text-ink-mute">Unassigned</span>;
  }

  const shown = members.slice(0, 3);
  const label =
    members.length === 1
      ? members[0].name
      : members.length === 2
        ? `${members[0].name}, ${members[1].name}`
        : `${members[0].name} +${members.length - 1}`;

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="flex shrink-0 -space-x-1.5">
        {shown.map((member) => (
          <Avatar key={member.id} member={member} size={size} ring />
        ))}
      </span>
      <span className="truncate text-[11px] font-medium text-ink-soft">
        {label}
      </span>
    </span>
  );
}

/** Renders text with @mentions picked out, so a tag is visible after the fact. */
export function MentionText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const parts = text.split(/(@[\p{L}][\p{L}\p{N}_'-]{0,40})/gu);

  return (
    <span className={className}>
      {parts.map((part, index) =>
        part.startsWith("@") ? (
          <span
            key={index}
            className="rounded bg-accent-soft px-1 font-semibold text-accent"
          >
            {part}
          </span>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */

export function PriorityDot({
  priority,
  withLabel = false,
}: {
  priority: TaskPriority;
  withLabel?: boolean;
}) {
  const meta = PRIORITY_META[priority];

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: meta.color }}
      />
      {withLabel && (
        <span className="text-xs font-medium text-ink-soft">{meta.label}</span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */

export function Chip({
  color,
  children,
  className,
}: {
  color?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        className,
      )}
      style={
        color
          ? { backgroundColor: `${color}14`, color }
          : { backgroundColor: "var(--color-sunken)", color: "var(--color-ink-soft)" }
      }
    >
      {color && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      <span className="truncate">{children}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
      role="status"
      aria-label="Working"
    />
  );
}

/* ------------------------------------------------------------------ */

/**
 * Centred dialog with a scrim. Traps nothing fancy — it moves focus in, closes
 * on Escape, and restores focus on the way out.
 */
export function Modal({
  open,
  onClose,
  labelledBy,
  children,
  width = "max-w-2xl",
}: {
  open: boolean;
  onClose: () => void;
  labelledBy?: string;
  children: React.ReactNode;
  width?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    restoreTo.current = document.activeElement as HTMLElement | null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    // Focus the panel so Escape and tabbing start from inside the dialog.
    const focusTimer = window.setTimeout(() => panelRef.current?.focus(), 0);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      window.clearTimeout(focusTimer);
      restoreTo.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="animate-fade-in absolute inset-0 cursor-default bg-ink/25 backdrop-blur-[2px]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={cx(
          "animate-slide-up relative flex max-h-[92svh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface outline-none overlay-shadow sm:rounded-2xl",
          width,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function ModalHeader({
  title,
  onClose,
  id,
  children,
}: {
  title?: React.ReactNode;
  onClose: () => void;
  id?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0 flex-1">
        {title && (
          <h2 id={id} className="text-base font-semibold text-ink">
            {title}
          </h2>
        )}
        {children}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="-m-1.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-mute transition hover:bg-sunken hover:text-ink sm:-m-1 sm:h-8 sm:w-8"
      >
        <CloseIcon className="h-5 w-5 sm:h-4.5 sm:w-4.5" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Every control in the toolbar is pinned to the same height. Native selects,
 * bordered buttons and inputs all compute their own height otherwise, which is
 * what made the row look ragged.
 */
export const CONTROL_HEIGHT = "h-8";

export const controlClass =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-xs font-medium text-ink-soft transition hover:border-line-strong hover:text-ink";

/**
 * A select with our own chevron. The browser's built-in arrow sits hard against
 * the right edge with padding we can't control, so the field is stripped back
 * and the icon positioned deliberately.
 */
export function SelectControl({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={cx("relative inline-flex shrink-0", className)}>
      <select
        {...props}
        className={cx(
          // 44px and 16px on touch (iOS zooms the page for anything smaller),
          // back to the compact toolbar control from sm up.
          "h-11 w-full appearance-none rounded-lg border border-line bg-surface py-0 pr-8 pl-3 text-base font-medium text-ink-soft outline-none transition sm:h-8 sm:pl-2.5 sm:text-xs",
          "hover:border-line-strong hover:text-ink focus:border-accent focus:ring-2 focus:ring-accent/15",
        )}
      >
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-2.5 h-3.5 w-3.5 -translate-y-1/2 text-ink-mute" />
    </span>
  );
}

/**
 * 16px on a phone, 14px from `sm` up.
 *
 * iOS Safari zooms the whole page in when a field under 16px takes focus, and
 * it never zooms back out — you're left panned into a magnified layout. The
 * `sm:` restores desktop density.
 */
export const fieldClass =
  "w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-base text-ink outline-none transition placeholder:text-ink-mute focus:border-accent focus:ring-2 focus:ring-accent/15 sm:py-2 sm:text-sm";

export const labelClass =
  "mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink-mute";

export function PrimaryButton({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg bg-ink px-3.5 py-2 text-sm font-medium text-white transition hover:bg-ink/90 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-50",
        className,
      )}
    />
  );
}

export function GhostButton({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink-soft transition hover:border-line-strong hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:opacity-50",
        className,
      )}
    />
  );
}
