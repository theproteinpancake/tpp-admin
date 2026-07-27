import { Workspace } from '@/components/staff/Workspace';
import {
  getBoardData,
  getLinks,
  getNotifications,
  getSuggestions,
  getUnreadCount,
} from '@/lib/staff/data';
import { sweepDueDates } from '@/lib/staff/due-sweep';
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

  // Raises any "due tomorrow" / "overdue" alerts before the bell is rendered.
  await sweepDueDates();

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
