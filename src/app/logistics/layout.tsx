import { requireSection } from '@/lib/guard';

export default async function SectionLayout({ children }: { children: React.ReactNode }) {
  await requireSection('logistics');
  return <>{children}</>;
}
