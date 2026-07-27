import { Workspace } from '@/components/staff/Workspace';
import {
  getBoardData,
  getLinks,
  getNotifications,
  getSuggestions,
  getUnreadCount,
} from '@/lib/staff/data';
import { currentMember } from '@/lib/staff/session';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function TodosPage() {
  // The section guard in ../layout.tsx has already established a signed-in user with staff
  // access; currentMember() maps that session to (or creates) their tracker member row.
  const member = await currentMember();
  if (!member) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-sm text-gray-600">
        Couldn&apos;t match your login to a task-board profile. Ask Luke to check Staff settings.
      </div>
    );
  }

  // The due-date sweep used to run here on every render. It's a once-a-day job
  // (QUIET_PERIOD_HOURS = 20) that was firing on every load, every 20s poll and every window
  // focus — ~100ms plus writes each time. It now rides the followups cron instead.

  const [board, links, suggestions, notifications, unreadCount] = await Promise.all([
    getBoardData(),
    getLinks(),
    getSuggestions(),
    getNotifications(member.id),
    getUnreadCount(member.id),
  ]);

  return (
    <Workspace
      tasks={board.tasks}
      members={board.members}
      categories={board.categories}
      links={links}
      suggestions={suggestions}
      notifications={notifications}
      unreadCount={unreadCount}
      currentMember={member}
    />
  );
}
