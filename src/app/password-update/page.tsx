import { redirect } from 'next/navigation';
import { getCurrentUser, allowedSections, passwordExpired } from '@/lib/auth';
import { sectionHome } from '@/lib/guard';
import PasswordUpdateForm from '@/components/PasswordUpdateForm';

export const dynamic = 'force-dynamic';

// Standalone — deliberately does NOT call requireSection/requireOwner (they redirect here).
export default async function PasswordUpdatePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const secs = allowedSections(user);
  const redirectTo = secs.length ? sectionHome(secs[0]) : '/settings';
  if (!passwordExpired(user)) redirect(redirectTo); // already fresh, nothing to do — carry on to their dashboard, not Settings
  return <PasswordUpdateForm hasPassword={!!user.password_hash} redirectTo={redirectTo} />;
}
