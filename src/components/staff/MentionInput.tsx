"use client";

import { useMemo, useRef, useState } from "react";
import type { MemberRow } from "@/lib/staff/database.types";
import { Avatar, cx } from "./primitives";

/**
 * A text field that offers the team as you type "@".
 *
 * Picking someone inserts their exact name, which matters: the server resolves
 * mentions by matching whole names, so a typed "@Lukey" would silently fail to
 * tag anyone.
 */
export function MentionInput({
  value,
  onChange,
  onSubmit,
  members,
  placeholder,
  ariaLabel,
  className,
  multiline = false,
  rows = 2,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  members: MemberRow[];
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  multiline?: boolean;
  rows?: number;
  id?: string;
}) {
  const [query, setQuery] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);

  const matches = useMemo(() => {
    if (query === null) return [];
    const needle = query.toLowerCase();
    return members
      .filter((member) => member.name.toLowerCase().startsWith(needle))
      .slice(0, 6);
  }, [query, members]);

  const open = query !== null && matches.length > 0;

  /** Is the caret sitting inside an unfinished "@word"? */
  function detect(element: HTMLInputElement | HTMLTextAreaElement) {
    const caret = element.selectionStart ?? 0;
    const before = element.value.slice(0, caret);
    const active = before.match(/(?:^|\s)@([\p{L}]*)$/u);
    setQuery(active ? active[1] : null);
    setHighlight(0);
  }

  function accept(member: MemberRow) {
    const element = fieldRef.current;
    if (!element) return;

    const caret = element.selectionStart ?? 0;
    const before = element.value
      .slice(0, caret)
      .replace(/@([\p{L}]*)$/u, `@${member.name} `);
    const after = element.value.slice(caret);

    onChange(before + after);
    setQuery(null);

    // Put the caret back after the inserted name, not at the end of the field.
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(before.length, before.length);
    });
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (open) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlight((current) => (current + 1) % matches.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlight(
          (current) => (current - 1 + matches.length) % matches.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        accept(matches[highlight]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setQuery(null);
        return;
      }
    }

    if (!onSubmit) return;
    if (!multiline && event.key === "Enter") {
      event.preventDefault();
      onSubmit();
    }
    if (multiline && event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSubmit();
    }
  }

  const shared = {
    id,
    ref: fieldRef,
    value,
    placeholder,
    "aria-label": ariaLabel,
    "aria-expanded": open,
    "aria-autocomplete": "list" as const,
    role: "combobox" as const,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      onChange(event.target.value);
      detect(event.target);
    },
    onKeyUp: (
      event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => detect(event.currentTarget),
    onClick: (
      event: React.MouseEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => detect(event.currentTarget),
    onKeyDown,
    // Let a click on the list land before the field loses focus.
    onBlur: () => window.setTimeout(() => setQuery(null), 120),
    className,
  };

  return (
    <div className="relative min-w-0 flex-1">
      {multiline ? (
        <textarea {...shared} rows={rows} />
      ) : (
        <input {...shared} />
      )}

      {/*
        Opens upward from a multiline field — that's the comment composer at
        the bottom of a task, where an on-screen keyboard leaves no room below.
        Single-line fields sit higher up and open downward as usual.
      */}
      {open && (
        <ul
          role="listbox"
          className={cx(
            "animate-pop-in absolute left-0 z-30 max-w-[calc(100vw-2rem)] w-56 overflow-hidden rounded-xl border border-line bg-surface py-1 overlay-shadow",
            multiline ? "bottom-full mb-1" : "top-full mt-1",
          )}
        >
          {matches.map((member, index) => (
            <li key={member.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === highlight}
                onMouseEnter={() => setHighlight(index)}
                onMouseDown={(event) => {
                  // mousedown, not click — blur would close the list first.
                  event.preventDefault();
                  accept(member);
                }}
                className={cx(
                  "flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition sm:px-2.5 sm:py-1.5",
                  index === highlight
                    ? "bg-accent-soft text-ink"
                    : "text-ink-soft hover:bg-canvas",
                )}
              >
                <Avatar member={member} size="xs" />
                {member.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
