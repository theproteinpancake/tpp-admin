'use client';
// Tab shell for Settings — content for each tab is rendered server-side and passed in as
// ReactNode props; this only handles which one is visible. Active tab is mirrored to ?tab=
// (replaceState, no navigation) so a refresh or shared link lands on the same tab.
import { useState, type ReactNode } from 'react';
import { KeyRound, Users, Plug } from 'lucide-react';

const TABS = [
  { id: 'account', label: 'My account', icon: KeyRound },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'integrations', label: 'Integrations', icon: Plug },
] as const;
type TabId = (typeof TABS)[number]['id'];

export default function SettingsTabs({ initial, account, team, integrations }: {
  initial?: string;
  account: ReactNode;
  team?: ReactNode;       // owner only
  integrations?: ReactNode; // owner only
}) {
  const panels: Record<TabId, ReactNode> = { account, team, integrations };
  const tabs = TABS.filter((t) => panels[t.id] != null);
  const [active, setActive] = useState<TabId>(
    tabs.some((t) => t.id === initial) ? (initial as TabId) : tabs[0].id
  );
  const pick = (id: TabId) => {
    setActive(id);
    const u = new URL(window.location.href);
    u.searchParams.set('tab', id);
    window.history.replaceState(null, '', u);
  };

  return (
    <div>
      {tabs.length > 1 && (
        <div className="mb-5 flex gap-1.5 overflow-x-auto border-b border-gray-200 pb-px">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => pick(id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-t-lg border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors ${
                active === id
                  ? 'border-caramel text-caramel'
                  : 'border-transparent text-gray-400 hover:bg-cream/50 hover:text-caramel'
              }`}>
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
      )}
      {panels[active]}
    </div>
  );
}
