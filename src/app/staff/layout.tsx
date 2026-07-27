import { requireSection } from '@/lib/guard';

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  await requireSection('staff');
  return <>{children}</>;
}
