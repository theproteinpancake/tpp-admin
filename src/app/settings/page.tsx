import { Settings as SettingsIcon, Mail, Users, Plug, KeyRound, Check, X } from 'lucide-react';
import { getConfig, listStaff, integrationStatus } from '@/lib/settings';
import { getCurrentUser, isOwner } from '@/lib/auth';
import StaffManager from '@/components/settings/StaffManager';
import TwoFA from '@/components/settings/TwoFA';
import AdminEmail from '@/components/settings/AdminEmail';
import ChangePassword from '@/components/settings/ChangePassword';
import SettingsTabs from '@/components/settings/SettingsTabs';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const Card = ({ icon: Icon, title, desc, children }: any) => (
  <div className="rounded-xl border border-gray-200 bg-paper p-5 shadow-sm">
    <div className="mb-3 flex items-center gap-2">
      <Icon className="h-5 w-5 text-caramel" />
      <div><h2 className="text-sm font-semibold text-caramel">{title}</h2>{desc && <p className="text-xs text-gray-400">{desc}</p>}</div>
    </div>
    {children}
  </div>
);

// One integration row: name + detail on the left, status pill + optional (re)connect action
// on the right. `href` present = OAuth-connectable; absent = configured via env/Vercel only.
function IntegrationRow({ label, detail, connected, href }: { label: string; detail?: string; connected: boolean; href?: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2.5 text-sm">
      <div className="min-w-0">
        <span className="font-medium text-caramel">{label}</span>
        {detail && <span className="ml-2 break-all text-xs text-gray-400">{detail}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${connected ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
          {connected ? <><Check className="h-3 w-3" /> Connected</> : <><X className="h-3 w-3" /> Not connected</>}
        </span>
        {href && (connected
          ? <a href={href} className="text-xs font-medium text-gray-400 underline decoration-dotted hover:text-caramel">Reconnect</a>
          : <a href={href} className="rounded-lg bg-caramel px-3 py-1.5 text-xs font-medium text-white hover:bg-maple">Connect</a>
        )}
      </div>
    </div>
  );
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ gmail?: string; which?: string; email?: string; tab?: string }> }) {
  const sp = await searchParams;
  const [adminEmail, staff, integ, me] = await Promise.all([
    getConfig('admin_email'), listStaff(), integrationStatus(), getCurrentUser(),
  ]);
  const owner = isOwner(me);
  const connLabel = sp.which === 'ads' ? 'Google Ads' : 'Gmail';
  // Land on the Integrations tab when arriving back from an OAuth connect flow.
  const initialTab = sp.tab || (sp.gmail ? 'integrations' : undefined);

  const accountTab = (
    <Card icon={KeyRound} title="Your account" desc={me ? `Signed in as ${me.email} (${me.role})` : 'Signed in'}>
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-xs font-medium text-gray-500">Change your password</p>
          <ChangePassword hasPassword={!!me?.password_hash} />
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-gray-500">Two-factor authentication</p>
          <TwoFA enabled={!!me?.totp_enabled} />
        </div>
      </div>
    </Card>
  );

  const teamTab = owner ? (
    <div className="space-y-5">
      <Card icon={Users} title="Staff & access" desc="Add people, set their role + which sections they see">
        <StaffManager initial={staff as any} />
      </Card>
      <Card icon={Mail} title="Admin email" desc="Primary owner / admin contact">
        <AdminEmail initial={adminEmail || 'luke@theproteinpancake.co'} />
      </Card>
    </div>
  ) : undefined;

  const integrationsTab = owner ? (
    <div className="space-y-5">
      <Card icon={Plug} title="Email & ads" desc="OAuth connections — reconnect if one starts failing">
        <div className="divide-y divide-gray-100">
          <IntegrationRow label="Gmail — ops inbox" detail={(integ.gmail_primary as any).email} connected={integ.gmail_primary.connected} href="/api/google/connect" />
          <IntegrationRow label="Gmail — Kate" detail={(integ.gmail_kate as any).email} connected={integ.gmail_kate.connected} href="/api/google/connect?account=kate" />
          <IntegrationRow label="Google Ads" detail={(integ.google_ads as any).email} connected={integ.google_ads.connected} href="/api/google/connect?account=ads" />
        </div>
      </Card>
      <Card icon={Plug} title="Sales & operations" desc="Configured with API keys (managed in Vercel, not here)">
        <div className="divide-y divide-gray-100">
          <IntegrationRow label="Xero" detail={(integ.xero as any).org} connected={integ.xero.connected} />
          <IntegrationRow label="Amazon — AU" detail="Selling Partner API" connected={integ.amazon_au.connected} />
          <IntegrationRow label="Amazon — UK" detail="Selling Partner API" connected={integ.amazon_uk.connected} />
          <IntegrationRow label="ShipBob — Altona (AU)" connected={integ.shipbob_au.connected} />
          <IntegrationRow label="ShipBob — Manchester (UK)" connected={integ.shipbob_uk.connected} />
        </div>
      </Card>
    </div>
  ) : undefined;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5 flex items-center gap-2.5">
        <SettingsIcon className="h-6 w-6 text-caramel" />
        <h1 className="text-xl font-bold text-caramel">Settings</h1>
      </div>

      {sp.gmail === 'connected' && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{connLabel} connected{sp.email ? `: ${sp.email}` : ''} ✓</div>
      )}
      {sp.gmail === 'error' && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{connLabel} connection failed. Try again.</div>
      )}

      <SettingsTabs initial={initialTab} account={accountTab} team={teamTab} integrations={integrationsTab} />
    </div>
  );
}
