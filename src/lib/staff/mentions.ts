/**
 * Finds "@Name" references and resolves them to team members.
 *
 * Matches a full name ("@Luke Rolls") or an unambiguous first name ("@Luke"), case-insensitively.
 * Both matter: the mention picker inserts the FULL name, while people type just the first — and
 * the original single-word matcher could resolve NEITHER for anyone with a surname on their
 * account, so tagging "Luke Rolls" or "Kate Koimtsidis" silently did nothing at all.
 *
 * A bare first name only resolves when exactly one member has it. With two Lukes on the board
 * "@Luke" is genuinely ambiguous, and assigning nobody beats assigning the wrong person.
 * A trailing possessive is ignored, so "@Reece's step" still resolves to Reece.
 */
export function findMentions(
  text: string,
  members: ReadonlyArray<{ id: string; name: string }>,
): string[] {
  const found = new Set<string>();

  const byFullName = new Map<string, string>();
  const firstNameCounts = new Map<string, number>();
  for (const member of members) {
    const name = member.name.trim().toLowerCase();
    if (!name) continue;
    byFullName.set(name, member.id);
    const first = name.split(/\s+/)[0];
    firstNameCounts.set(first, (firstNameCounts.get(first) ?? 0) + 1);
  }
  const byFirstName = new Map<string, string>();
  for (const member of members) {
    const first = member.name.trim().toLowerCase().split(/\s+/)[0];
    if (first && firstNameCounts.get(first) === 1) byFirstName.set(first, member.id);
  }

  const WORD = String.raw`[\p{L}][\p{L}\p{N}_'-]{0,40}`;
  // Capture an optional second word, so "@Luke Rolls" is tried as a full name before
  // falling back to "@Luke" on its own.
  const pattern = new RegExp(`@(${WORD})(?:\\s+(${WORD}))?`, 'gu');

  for (const match of text.matchAll(pattern)) {
    const first = match[1].toLowerCase().replace(/'s$/, '');
    const second = match[2]?.toLowerCase().replace(/'s$/, '');

    if (second) {
      const full = byFullName.get(`${first} ${second}`);
      if (full) { found.add(full); continue; }
    }

    const single = byFullName.get(first) ?? byFirstName.get(first);
    if (single) found.add(single);
  }

  return [...found];
}
