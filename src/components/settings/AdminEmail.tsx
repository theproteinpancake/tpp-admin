'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminEmail({ initial }: { initial: string }) {
  const [email, setEmail] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const router = useRouter();
  const save = async () => {
    setBusy(true); setSaved(false);
    try { await fetch('/api/settings/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'admin_email', value: email }) }); setSaved(true); router.refresh(); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input value={email} onChange={(e) => { setEmail(e.target.value); setSaved(false); }} className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
      <button disabled={busy || !email} onClick={save} className="rounded-lg bg-caramel px-3.5 py-2 text-sm font-medium text-white hover:bg-maple disabled:opacity-50">Save</button>
      {saved && <span className="text-xs text-emerald-600">Saved</span>}
    </div>
  );
}
