"use client";

import { useState } from "react";
import { getIngestSetup, type IngestSetup } from "@/lib/staff/actions/setup";
import {
  GhostButton,
  Modal,
  ModalHeader,
  Spinner,
  cx,
  labelClass,
} from "./primitives";

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  // The team-PIN form that lived here is gone: sign-in is TPP Control's (per-person account,
  // password policy, MFA), so there is no shared PIN to rotate. Only the Mac message-listener
  // setup remains, which is genuinely tracker-specific.
  return (
    <Modal open onClose={onClose} labelledBy="settings-title" width="max-w-md">
      <ModalHeader id="settings-title" title="Task settings" onClose={onClose} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <MessageListenerSection />
      </div>
    </Modal>
  );
}

/**
 * Configuration for the Mac agent that watches the team's iMessage thread.
 * The token is fetched on demand so it isn't sitting in every page payload.
 */
function MessageListenerSection() {
  const [setup, setSetup] = useState<IngestSetup | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function reveal() {
    setLoading(true);
    try {
      setSetup(await getIngestSetup());
    } finally {
      setLoading(false);
    }
  }

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard access can be blocked; the value is on screen to select.
    }
  }

  return (
    <section className="border-t border-line px-5 py-4">
      <h3 className="text-sm font-medium text-ink">Message listener</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-soft">
        Connects the agent on your Mac to this board. Paste these two values
        into the agent&rsquo;s <code className="text-ink">config.json</code>.
      </p>
      <p className="mt-2 text-xs leading-relaxed text-ink-soft">
        Only messages containing the word{" "}
        <strong className="font-semibold text-ink">task</strong> are read.
        Anything else in the chat stays on the Mac and is never sent here.
      </p>

      {!setup ? (
        <GhostButton type="button" onClick={reveal} disabled={loading} className="mt-3">
          {loading && <Spinner />}
          Show connection details
        </GhostButton>
      ) : (
        <div className="mt-3 space-y-2.5">
          <Field
            label="Endpoint"
            value={setup.endpoint}
            copied={copied === "Endpoint"}
            onCopy={() => copy("Endpoint", setup.endpoint)}
          />
          <Field
            label="Token"
            value={setup.token}
            secret
            copied={copied === "Token"}
            onCopy={() => copy("Token", setup.token)}
          />

          <ul className="space-y-1 pt-1 text-xs text-ink-soft">
            <li className="flex items-center gap-1.5">
              <span
                className={cx(
                  "h-1.5 w-1.5 rounded-full",
                  setup.parsingEnabled ? "bg-emerald-500" : "bg-line-strong",
                )}
              />
              {setup.parsingEnabled
                ? "Claude is reading messages."
                : "No ANTHROPIC_API_KEY — falling back to keyword matching."}
            </li>
            <li className="flex items-center gap-1.5">
              <span
                className={cx(
                  "h-1.5 w-1.5 rounded-full",
                  setup.shopifyEnabled ? "bg-emerald-500" : "bg-line-strong",
                )}
              />
              {setup.shopifyEnabled
                ? "Order numbers will pull customer details."
                : "Shopify not connected — order numbers stay as plain text."}
            </li>
          </ul>

          <p className="pt-1 text-[11px] leading-relaxed text-ink-mute">
            The token grants permission to post messages into this board. Treat
            it like a password; if it leaks, change the database key to rotate it.
          </p>
        </div>
      )}
    </section>
  );
}

function Field({
  label,
  value,
  secret = false,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  secret?: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div>
      <span className={labelClass}>{label}</span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 rounded-lg border border-line bg-sunken px-2.5 py-2 text-xs break-all text-ink sm:text-[11px]">
          {secret ? `${value.slice(0, 8)}${"•".repeat(16)}` : value}
        </code>
        <GhostButton type="button" onClick={onCopy} className="shrink-0">
          {copied ? "Copied" : "Copy"}
        </GhostButton>
      </div>
    </div>
  );
}
