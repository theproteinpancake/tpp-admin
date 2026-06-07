import { redirect } from 'next/navigation';
import { getCurrentUser, allowedSections, isOwner } from '@/lib/auth';
import { sectionHome } from '@/lib/guard';

// Land each user on a section they can access. Owner → Stock Overview (the ops default).
export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (isOwner(user)) redirect('/logistics/stock');
  const secs = allowedSections(user);
  redirect(secs.length ? sectionHome(secs[0]) : '/settings');
}
