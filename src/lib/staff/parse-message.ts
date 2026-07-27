import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { addDays, today } from "./dates";
import type { TaskPriority } from "./database.types";

const MODEL = "claude-opus-5";

export type Proposal = {
  isTask: boolean;
  title: string;
  description: string | null;
  assigneeNames: string[];
  priority: TaskPriority;
  dueDate: string | null;
  categoryName: string | null;
  orderReference: string | null;
  confidence: number;
  reasoning: string;
};

export type ParseInput = {
  text: string;
  senderName: string | null;
  memberNames: string[];
  categoryNames: string[];
  /**
   * The sender explicitly marked this as a task by writing "task" in the chat.
   * When true, the job is to extract the details well — not to second-guess
   * whether it counts.
   */
  flagged?: boolean;
};

const PROPOSAL_SCHEMA = {
  type: "object",
  properties: {
    isTask: {
      type: "boolean",
      description:
        "True only if this message asks for something to be done that someone would want tracked.",
    },
    title: {
      type: "string",
      description:
        "Short imperative task title, e.g. 'Email Craig about order #2627'. Empty string if isTask is false.",
    },
    description: {
      type: ["string", "null"],
      description: "Extra context worth keeping, or null.",
    },
    assigneeNames: {
      type: "array",
      items: { type: "string" },
      description:
        "Team members the task is for, using their exact names from the roster. Empty if unclear.",
    },
    priority: {
      type: "string",
      enum: ["urgent", "high", "medium", "low"],
    },
    dueDate: {
      type: ["string", "null"],
      description:
        "Due date as YYYY-MM-DD if the message implies one, otherwise null.",
    },
    categoryName: {
      type: ["string", "null"],
      description: "Best-fit category from the list, or null.",
    },
    orderReference: {
      type: ["string", "null"],
      description: "Order number mentioned, digits only, e.g. '2627'.",
    },
    confidence: {
      type: "number",
      description: "0 to 1 — how confident you are this is a real task.",
    },
    reasoning: {
      type: "string",
      description: "One short sentence explaining the call.",
    },
  },
  required: [
    "isTask",
    "title",
    "description",
    "assigneeNames",
    "priority",
    "dueDate",
    "categoryName",
    "orderReference",
    "confidence",
    "reasoning",
  ],
  additionalProperties: false,
} as const;

function systemPrompt(input: ParseInput): string {
  const shared = [
    `Today is ${today()} (Australia/Adelaide).`,
    `Team: ${input.memberNames.join(", ")}.`,
    `Categories: ${input.categoryNames.join(", ")}.`,
    "",
    "Rules:",
    "- Nicknames map to the roster: 'Deb'/'Debs' is Debbie, 'Kate'/'Katie' is Kate.",
    "  Only use names that appear in the roster above.",
    "- If the message names someone, they are the assignee. If the sender is",
    "  committing to do it themselves, the sender is the assignee.",
    "- Resolve relative dates ('Friday', 'tomorrow', 'end of month') against today.",
  ];

  if (input.flagged) {
    return [
      "You extract tasks from a small team's group chat at The Protein Pancake,",
      "an Australian protein pancake brand.",
      "",
      "The sender has already marked this message as a task by writing 'task'",
      "in the chat. That decision is theirs, not yours — always return",
      "isTask: true. Your job is to write the best possible title and pull out",
      "the details. Do not include the word 'task' in the title.",
      "",
      ...shared,
      "- Set confidence to reflect how well you understood the request, not",
      "  whether it deserves to be a task — that has already been decided.",
    ].join("\n");
  }

  return [
    "You triage messages from a small team's group chat at The Protein Pancake,",
    "an Australian protein pancake brand. Decide whether each message contains a",
    "task worth tracking, and if so extract it.",
    "",
    ...shared,
    "- Most chat is not a task. Banter, reactions, acknowledgements, questions",
    "  already answered, and thinking out loud are all isTask: false.",
    "- A task is a concrete thing someone is being asked to do, or is committing",
    "  to do, that would be lost if nobody wrote it down.",
    "- Set confidence honestly. Below 0.5 means you are guessing.",
  ].join("\n");
}

function userPrompt(input: ParseInput): string {
  return [
    input.senderName ? `From: ${input.senderName}` : "From: unknown sender",
    "Message:",
    input.text,
  ].join("\n");
}

/**
 * Turn a chat message into a proposed task.
 *
 * Uses Claude when an API key is configured, and falls back to a keyword pass
 * otherwise — so the listener is useful before anyone has set up billing, just
 * blunter about what counts as a task.
 */
export async function parseMessage(input: ParseInput): Promise<Proposal> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return heuristicParse(input);

  try {
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: systemPrompt(input),
      output_config: {
        // Triage is a short, scoped task — deep reasoning would just add latency.
        effort: "low",
        format: { type: "json_schema", schema: PROPOSAL_SCHEMA },
      },
      messages: [{ role: "user", content: userPrompt(input) }],
    });

    // Safety classifiers can decline. Falling back to the keyword pass keeps
    // the message in play rather than silently discarding it.
    if (response.stop_reason === "refusal") return heuristicParse(input);

    const text = response.content.find((block) => block.type === "text");
    if (!text || text.type !== "text") return heuristicParse(input);

    return normalise(JSON.parse(text.text) as Partial<Proposal>, input);
  } catch {
    // A model outage shouldn't drop the message — fall back and keep going.
    return heuristicParse(input);
  }
}

function notATask(reasoning: string): Proposal {
  return {
    isTask: false,
    title: "",
    description: null,
    assigneeNames: [],
    priority: "medium",
    dueDate: null,
    categoryName: null,
    orderReference: null,
    confidence: 0,
    reasoning,
  };
}

const PRIORITIES: TaskPriority[] = ["urgent", "high", "medium", "low"];

/** Clamp model output into the shape the database expects. */
function normalise(raw: Partial<Proposal>, input: ParseInput): Proposal {
  const known = new Map(
    input.memberNames.map((name) => [name.toLowerCase(), name]),
  );

  return {
    isTask: Boolean(raw.isTask),
    title: (raw.title ?? "").trim().slice(0, 300),
    description: raw.description?.trim() || null,
    assigneeNames: (raw.assigneeNames ?? [])
      .map((name) => known.get(String(name).toLowerCase()))
      .filter((name): name is string => Boolean(name)),
    priority: PRIORITIES.includes(raw.priority as TaskPriority)
      ? (raw.priority as TaskPriority)
      : "medium",
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(raw.dueDate ?? "")
      ? (raw.dueDate as string)
      : null,
    categoryName:
      input.categoryNames.find(
        (name) => name.toLowerCase() === raw.categoryName?.toLowerCase(),
      ) ?? null,
    orderReference: (raw.orderReference ?? "").replace(/[^0-9]/g, "") || null,
    confidence: Math.min(1, Math.max(0, Number(raw.confidence) || 0)),
    reasoning: (raw.reasoning ?? "").trim().slice(0, 500),
  };
}

/* ------------------------------------------------------------------ *
 * Keyword fallback
 * ------------------------------------------------------------------ */

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tues: 2, tue: 2,
  wednesday: 3, weds: 3, wed: 3,
  thursday: 4, thurs: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

/** Resolve "tomorrow", "by Friday", "next week" against today in Adelaide. */
function guessDueDate(lower: string): string | null {
  const base = today();

  if (/\b(today|tonight|this arvo|this afternoon)\b/.test(lower)) return base;
  if (/\b(tomorrow|tmr|tmrw|2moro)\b/.test(lower)) return addDays(base, 1);
  if (/\bnext week\b/.test(lower)) return addDays(base, 7);
  if (/\b(end of (the )?week|eow)\b/.test(lower)) {
    const day = new Date(`${base}T00:00:00Z`).getUTCDay();
    return addDays(base, (5 - day + 7) % 7 || 7); // the coming Friday
  }

  const named = lower.match(
    /\b(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|weds|wed|thursday|thurs|thu|friday|fri|saturday|sat)\b/,
  );
  if (named) {
    const target = WEEKDAY_INDEX[named[1]];
    const day = new Date(`${base}T00:00:00Z`).getUTCDay();
    // "on Friday" said on a Friday means the next one, not today.
    const delta = (target - day + 7) % 7 || 7;
    return addDays(base, delta);
  }

  return null;
}

/**
 * Words that point at a category without naming it. Checked only after a
 * direct name match fails.
 */
const CATEGORY_HINTS: Record<string, string[]> = {
  website: ["website", "site", "landing page", "homepage", "product page", "theme", "announcement bar", "banner"],
  content: ["content", "reel", "tiktok", "video", "shoot", "recipe", "caption", "ugc"],
  "email & sms": ["email", "sms", "klaviyo", "newsletter", "flow", "broadcast"],
  marketing: ["ad", "ads", "meta", "facebook", "campaign", "creative"],
  amazon: ["amazon", "seller central", "fba"],
  ops: ["stock", "inventory", "freight", "supplier", "packaging", "shipping", "3pl"],
  product: ["product", "flavour", "flavor", "formulation", "sku"],
  wholesale: ["wholesale", "stockist", "retailer", "distributor"],
};

function guessCategory(lower: string, names: string[]): string | null {
  const direct = names.find((name) => lower.includes(name.toLowerCase()));
  if (direct) return direct;

  for (const name of names) {
    const hints = CATEGORY_HINTS[name.toLowerCase()] ?? [];
    if (hints.some((hint) => lower.includes(hint))) return name;
  }
  return null;
}

const REQUEST_CUES = [
  "can you",
  "could you",
  "please",
  "need to",
  "needs to",
  "make sure",
  "don't forget",
  "dont forget",
  "remember to",
  "we should",
  "i'll",
  "ill ",
  "todo",
  "to do",
  "chase",
  "follow up",
];

function heuristicParse(input: ParseInput): Proposal {
  const text = input.text.trim();
  const lower = text.toLowerCase();

  const named = input.memberNames.filter((name) => {
    // Match the name or a prefix of at least three letters, so "Deb" finds Debbie.
    const stem = name.slice(0, 3).toLowerCase();
    return new RegExp(`(^|[^a-z])@?${stem}[a-z]*\\b`, "i").test(lower);
  });

  const order = text.match(/(?:order\s*#?|#)\s*(\d{3,8})/i)?.[1] ?? null;
  const cued = REQUEST_CUES.some((cue) => lower.includes(cue));
  // A flagged message is already a task by the sender's own say-so; the cues
  // only decide the question for unflagged chat.
  const isTask =
    input.flagged ||
    (text.length > 8 && (cued || named.length > 0 || Boolean(order)));

  const dueDate = guessDueDate(lower);
  const categoryName = guessCategory(lower, input.categoryNames);

  // Each thing we managed to pin down is a little more evidence this is real.
  const extracted = [named.length > 0, Boolean(order), Boolean(dueDate)].filter(
    Boolean,
  ).length;

  return {
    isTask,
    title: text.replace(/\s+/g, " ").slice(0, 120),
    description: text.length > 120 ? text : null,
    assigneeNames: named,
    priority: /\b(urgent|asap|right now|today|tonight)\b/.test(lower)
      ? "high"
      : "medium",
    dueDate,
    categoryName,
    orderReference: order,
    confidence: isTask ? Math.min(0.45 + extracted * 0.1, 0.7) : 0.1,
    reasoning: input.flagged
      ? "Flagged as a task in the chat. Details were matched with keywords, not a language model — check the title and dates."
      : "Matched with keywords, not a language model — check the title and dates.",
  };
}
