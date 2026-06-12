import { Settings as SettingsIcon, Mail, Users, ShieldCheck, Plug, KeyRound, Check, X } from 'lucide-react';
import { getConfig, listStaff, integrationStatus } from '@/lib/settings';
import { getCurrentUser, isOwner } from '@/lib/auth';
import StaffManager from '@/components/settings/StaffManager';
import TwoFA from '@/components/settings/TwoFA';
import AdminEmail from '@/components/settings/AdminEmail';
import ChangePassword from '@/components/settings/ChangePassword';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function Conn({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-2 text-sm">
      <span className="text-caramel">{label}{detail ? <span className="ml-2 text-xs text-gray-400">{detail}</span> : ''}</span>
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${ok ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
        {ok ? <><Check className="h-3 w-3" /> Connected</> : <><X className="h-3 w-3" /> Not connected</>}
      </span>
    </div>
  );
}

const Card = ({ icon: Icon, title, desc, children }: any) => (
  <div className="rounded-xl border border-gray-200 bg-paper p-5 shadow-sm">
    <div className="mb-3 flex items-center gap-2">
      <Icon className="h-5 w-5 text-caramel" />
      <div><h2 className="text-sm font-semibold text-caramel">{title}</h2>{desc && <p className="text-xs text-gray-400">{desc}</p>}</div>
    </div>
    {children}
  </div>
);

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ gmail?: string; email?: string }> }) {
  const sp = await searchParams;
  const [adminEmail, staff, integ, me] = await Promise.all([
    getConfig('admin_email'), listStaff(), integrationStatus(), getCurrentUser(),
  ]);
  const owner = isOwner(me);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center gap-2.5">
        <SettingsIcon className="h-6 w-6 text-caramel" />
        <h1 className="text-xl font-bold text-caramel">Settings</h1>
      </div>

      {sp.gmail === 'connected' && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">Gmail connected{sp.email ? `: ${sp.email}` : ''} ✓</div>
      )}
      {sp.gmail === 'error' && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">Gmail connection failed. Try again.</div>
      )}

      <div className="space-y-5">
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

        {owner && (
          <Card icon={Mail} title="Admin email" desc="Primary owner / admin contact">
            <AdminEmail initial={adminEmail || 'luke@theproteinpancake.co'} />
          </Card>
        )}

        {owner && (
          <Card icon={Users} title="Staff & access" desc="Add people, set their role + which sections they see">
            <StaffManager initial={staff as any} />
          </Card>
        )}

        {owner && (
          <Card icon={Plug} title="Integrations">
            <div className="divide-y divide-gray-100">
              <Conn ok={integ.gmail_primary.connected} label="Gmail (ops inbox)" detail={(integ.gmail_primary as any).email} />
              <div className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="text-caramel">Gmail — Kate {(integ.gmail_kate as any).email ? <span className="ml-2 text-xs text-gray-400">{(integ.gmail_kate as any).email}</span> : ''}</span>
                <a href="/api/google/connect?account=kate" className="rounded-lg bg-caramel px-3 py-1.5 text-xs font-medium text-white hover:bg-maple">
                  {integ.gmail_kate.connected ? 'Reconnect' : 'Connect Kate’s Gmail'}
                </a>
              </div>
              <Conn ok={integ.xero.connected} label="Xero" detail={(integ.xero as any).org} />
              <Conn ok={integ.shipbob_au.connected} label="ShipBob — Altona (AU)" />
              <Conn ok={integ.shipbob_uk.connected} label="ShipBob — Manchester (UK)" />
              <div className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="text-caramel">Gmail (ops inbox)</span>
                <a href="/api/google/connect" className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">Reconnect</a>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
