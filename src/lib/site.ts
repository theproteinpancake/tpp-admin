// Compact site label for dense tables: Altona → AU, Manchester → UK.
export function siteShort(s?: string | null): string {
  const v = (s || '').toUpperCase();
  if (v.includes('ALT')) return 'AU';
  if (v.includes('MAN')) return 'UK';
  return s || '—';
}
