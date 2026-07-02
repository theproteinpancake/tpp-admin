import { redirect } from 'next/navigation';
import { getCurrentUser, allowedSections } from '@/lib/auth';
import { sectionHome } from '@/lib/guard';
import MfaSetupForm from '@/components/MfaSetupForm';

export const dynamic = 'force-dynamic';

// Standalone — deliberately does NOT call requireSection/requireOwner (they redirect here).
export default async function MfaSetupPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.totp_enabled) redirect('/settings'); // already enrolled, nothing to do here

  const secs = allowedSections(user);
  const redirectTo = secs.length ? sectionHome(secs[0]) : '/settings';
  return <MfaSetupForm redirectTo={redirectTo} />;
}
