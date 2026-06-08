import { Truck, FileText, ArrowRight } from 'lucide-react';
import { listTransfers, transferUnits, transferValue } from '@/lib/transfers';
import { TRANSFER_DOCS } from '@/lib/transferPdf';
import BuildRestockButton from '@/components/transfers/BuildRestockButton';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const money = (n: number, ccy: string) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: ccy || 'AUD' }).format(n);
const fmtDate = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: '2-digit', month: 'short' }) : '—');

const STATUS: Record<string, { label: string; bg: string }> = {
  draft: { label: 'Draft', bg: '#9ca3af' },
  in_transit: { label: 'In transit', bg: '#2563eb' },
  customs: { label: 'Clearing customs', bg: '#d97706' },
  arrived: { label: 'Arrived at FC', bg: '#7c3aed' },
  received: { label: 'Received', bg: '#059669' },
  cancelled: { label: 'Cancelled', bg: '#b91c1c' },
};

export default async function TransfersPage() {
  const transfers = await listTransfers();
  const docKeys = Object.keys(TRANSFER_DOCS) as (keyof typeof TRANSFER_DOCS)[];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-caramel">Stock Transfers</h1>
          <p className="mt-1 text-gray-500">Internal Altona (AU) → Manchester (UK) pallets &amp; their shipping documents</p>
        </div>
        <BuildRestockButton />
      </div>

      {transfers.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-paper px-4 py-8 text-center text-sm text-gray-500">
          No transfers yet. Ask the assistant on WhatsApp to “build a transfer for everything Manchester is low on”.
        </p>
      ) : (
        <div className="space-y-5">
          {transfers.map((t) => {
            const st = STATUS[t.status] || STATUS.draft;
            return (
              <div key={t.id} className="rounded-xl border border-gray-200 bg-paper p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Truck className="h-5 w-5 text-caramel" />
                      <span className="text-lg font-bold text-caramel">{t.reference}</span>
                      <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: st.bg }}>{st.label}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-sm text-gray-500">
                      <span className="font-medium text-caramel">{t.origin_code || 'AU'}</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                      <span className="font-medium text-caramel">{t.destination_code || 'UK'}</span>
                      <span>· ETA {fmtDate(t.eta)}</span>
                      {t.bl_ref && <span>· BL {t.bl_ref}</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold text-caramel">{transferUnits(t).toLocaleString()} <span className="text-sm font-normal text-gray-400">units</span></div>
                    <div className="text-xs text-gray-500">{t.cartons ? `${t.cartons} cartons · ` : ''}{money(transferValue(t), t.currency || 'AUD')}</div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {docKeys.map((k) => (
                    <a key={k} href={`/api/transfers/${t.reference}/${k}`} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-caramel hover:bg-cream hover:text-maple">
                      <FileText className="h-3.5 w-3.5" /> {TRANSFER_DOCS[k].label}
                    </a>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
