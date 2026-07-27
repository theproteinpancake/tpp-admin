/**
 * Finds "@Name" references and resolves them to team members.
 *
 * Names are matched whole and case-insensitively, so "@reece" works but
 * "@reeces" does not resolve to Reece.
 */
export function findMentions(
  text: string,
  members: ReadonlyArray<{ id: string; name: string }>,
): string[] {
  const found = new Set<string>();
  const byName = new Map(
    members.map((member) => [member.name.toLowerCase(), member.id]),
  );

  for (const match of text.matchAll(/@([\p{L}][\p{L}\p{N}_'-]{0,40})/gu)) {
    const id = byName.get(match[1].toLowerCase());
    if (id) found.add(id);
  }

  return [...found];
}
