/**
 * The word that turns a chat message into a proposed task.
 *
 * The group chat is a group chat — most of it is conversation, and triaging
 * every line was always going to guess wrong in both directions. So nothing is
 * proposed unless someone says so: write "task" anywhere in the message and it
 * lands in the Inbox; leave it out and the message is ignored entirely.
 *
 * Matching is deliberately loose about what follows the word, so all of these
 * work and nobody has to remember an exact form:
 *
 *     task          tasks          Task:         #task         task*
 *
 * It is strict about what comes *before* it, though — "multitask" and
 * "subtasks" are ordinary words and don't fire.
 *
 * NOTE: agent/imessage-listener.mjs mirrors this regex so that messages
 * without the word never leave the Mac at all. Keep the two in step.
 */
const TRIGGER = /(?:^|[^\p{L}\p{N}])task/iu;

export function mentionsTaskTrigger(text: string): boolean {
  return TRIGGER.test(text);
}

/**
 * Drop a bare marker from the ends of a message, so "Email Craig task*" is
 * titled "Email Craig" rather than keeping the bookkeeping.
 *
 * Only the ends, and only a standalone marker: "add this to the task list"
 * keeps its wording, because there the word is doing real work in the sentence.
 */
export function stripTaskTrigger(text: string): string {
  return text
    .replace(/^\s*#?task[s]?[*:—–-]*\s+/iu, "")
    .replace(/\s+#?task[s]?[*:]*\s*$/iu, "")
    // A message that is nothing but the marker carries no instruction at all.
    .replace(/^\s*#?task[s]?[*:]*\s*$/iu, "")
    .trim();
}
