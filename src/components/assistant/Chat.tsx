'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, FileText } from 'lucide-react';

interface Msg { role: 'user' | 'assistant'; text: string; media?: string | null }

const SUGGESTIONS = [
  'What needs my attention today?',
  'How much Maple stock at Altona?',
  "What's our PO schedule for the next 3 months?",
  'Build a transfer for everything Manchester is low on',
  'What stock is expiring soonest?',
  'What did we spend on shipping last month?',
];

export default function Chat() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, busy]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setInput('');
    setMsgs((m) => [...m, { role: 'user', text }]);
    setBusy(true);
    try {
      const res = await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text }) });
      const data = await res.json();
      setMsgs((m) => [...m, { role: 'assistant', text: data.text || '…', media: data.media }]);
    } catch {
      setMsgs((m) => [...m, { role: 'assistant', text: '⚠️ Network error — try again.' }]);
    } finally { setBusy(false); }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3">
        <h1 className="flex items-center gap-2 text-xl font-bold text-caramel sm:text-2xl"><Sparkles className="h-5 w-5 text-caramel sm:h-6 sm:w-6" /> Assistant</h1>
        <p className="mt-0.5 text-xs text-gray-500 sm:text-sm">Chat to your logistics hub — same brain as the WhatsApp agent.</p>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-xl border border-gray-200 bg-paper p-4 shadow-sm">
        {msgs.length === 0 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)} className="rounded-full border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:border-caramel hover:text-maple">{s}</button>
            ))}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${m.role === 'user' ? 'bg-caramel text-white' : 'bg-gray-100 text-caramel'}`}>
              {m.text}
              {m.media && (
                <a href={m.media} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 rounded-lg bg-paper/90 px-2 py-1 text-xs font-medium text-maple">
                  <FileText className="h-3.5 w-3.5" /> attachment
                </a>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="flex justify-start"><div className="rounded-2xl bg-gray-100 px-3.5 py-2 text-sm text-gray-400">thinking…</div></div>}
        <div ref={endRef} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="mt-3 flex items-center gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about stock, POs, transfers, expiry, shipping…"
          className="flex-1 rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-caramel focus:outline-none" />
        <button type="submit" disabled={busy || !input.trim()} className="inline-flex items-center gap-1.5 rounded-xl bg-caramel px-4 py-3 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50">
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
