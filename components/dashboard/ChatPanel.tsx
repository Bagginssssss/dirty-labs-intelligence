'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { GripHorizontal } from 'lucide-react';
import { resolvePeriod } from '@/lib/dashboard/period';
import { fmtDate } from '@/lib/dashboard/format';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  title?: string;
};

const MIN_HEIGHT = 200;
const MAX_HEIGHT = 500;
const DEFAULT_HEIGHT = 320;
const STORAGE_KEY = 'dl:chat:height';

const PRESETS = [
  { key: 'last_7d',  label: 'Last 7d' },
  { key: 'last_30d', label: 'Last 30d' },
  { key: 'custom',   label: 'Custom' },
];

export function ChatPanel({ brandId }: { brandId: string }) {
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [analysisPeriod, setAnalysisPeriod] = useState<string>('last_7d');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const h = parseInt(saved, 10);
      if (!Number.isNaN(h)) setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, h)));
    }
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startH: height };
  }, [height]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const delta = e.clientY - dragRef.current.startY;
    const next = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, dragRef.current.startH + delta));
    setHeight(next);
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    (e.target as Element).releasePointerCapture(e.pointerId);
    window.localStorage.setItem(STORAGE_KEY, String(height));
    dragRef.current = null;
  }, [height]);

  // Compute date range readout from active analysis period.
  const resolved = resolvePeriod(analysisPeriod === 'custom' ? 'last_7d' : analysisPeriod, new Date());
  const yearSuffix = new Date(resolved.end).getFullYear();
  const dateRangeReadout = `${fmtDate(resolved.start)} – ${fmtDate(resolved.end)}, ${yearSuffix}`;

  function setPeriod(key: string) {
    if (key === 'custom') {
      const r = prompt('Custom range (YYYY-MM-DD:YYYY-MM-DD)', '');
      if (r && /^\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(r)) {
        setAnalysisPeriod(r);
        return;
      }
      return;
    }
    setAnalysisPeriod(key);
  }

  async function send(prompt: string, kind: 'chat' | 'briefing' | 'anomaly' | 'opportunity' = 'chat', title?: string) {
    const trimmed = prompt.trim();
    if (!trimmed || busy) return;

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: trimmed, ts: Date.now() };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setBusy(true);

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand_id: brandId,
          analysis_type: kind,
          prompt: trimmed,
          period: analysisPeriod,
          start_date: resolved.start,
          end_date: resolved.end,
          history: messages.slice(-6).map(({ role, content }) => ({ role, content })),
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => 'Analysis request failed.');
        setMessages((m) => [...m, {
          id: crypto.randomUUID(), role: 'assistant', content: `⚠ ${text}`, ts: Date.now()
        }]);
        return;
      }

      const data = await res.json();
      let text = '';
      if (typeof data?.content === 'string') text = data.content;
      else if (Array.isArray(data?.content)) {
        text = data.content
          .filter((b: { type: string }) => b?.type === 'text')
          .map((b: { text: string }) => b.text).join('\n\n');
      } else if (typeof data?.text === 'string') text = data.text;
      else text = '(empty response)';

      setMessages((m) => [...m, { id: crypto.randomUUID(), role: 'assistant', content: text, ts: Date.now(), title }]);
    } catch (err) {
      setMessages((m) => [...m, {
        id: crypto.randomUUID(), role: 'assistant',
        content: `⚠ ${err instanceof Error ? err.message : 'Network error'}`,
        ts: Date.now(),
      }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Chat Intelligence"
      className="relative bg-[#16161a] border border-[#1e1e2e] rounded-md overflow-hidden flex flex-col"
      style={{ height }}
    >
      {/* Top header row */}
      <div className="flex items-center gap-3 px-3 pt-2.5 pb-1.5 border-b border-[#1e1e2e]">
        <span className="text-[10px] tracking-[0.1em] text-[#3b82f6]">INTELLIGENCE · CHAT</span>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          {PRESETS.map((p) => {
            const isActive = analysisPeriod === p.key
              || (p.key === 'custom' && !PRESETS.some((pp) => pp.key === analysisPeriod && pp.key !== 'custom') && analysisPeriod !== 'last_7d' && analysisPeriod !== 'last_30d');
            return (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`text-[8px] px-2 py-[3px] rounded-[3px] border transition-colors ${
                  isActive
                    ? 'bg-[#3b82f6]/15 border-[#3b82f6] text-[#3b82f6]'
                    : 'bg-[#111113] border-[#1e1e2e] text-[#64748b] hover:text-[#94a3b8]'
                }`}
              >
                {p.label}
              </button>
            );
          })}
          <span className="text-[8px] text-[#475569] ml-1.5">{dateRangeReadout}</span>
        </div>
      </div>

      {/* Quick action briefing buttons */}
      <div className="flex gap-[5px] px-3 py-2 border-b border-[#1e1e2e]">
        <button
          onClick={() => send('Run my weekly briefing.', 'briefing', 'Weekly Briefing')}
          disabled={busy}
          className="text-[9px] px-2.5 py-1 rounded-[3px] bg-[#10b981]/10 border border-[#10b981]/25 text-[#10b981] hover:bg-[#10b981]/15 disabled:opacity-30 transition-colors"
        >
          Weekly briefing ↗
        </button>
        <button
          onClick={() => send('Run an anomaly scan on the current period.', 'anomaly', 'Anomaly Scan')}
          disabled={busy}
          className="text-[9px] px-2.5 py-1 rounded-[3px] bg-[#3b82f6]/10 border border-[#3b82f6]/25 text-[#3b82f6] hover:bg-[#3b82f6]/15 disabled:opacity-30 transition-colors"
        >
          Anomaly scan ↗
        </button>
        <button
          onClick={() => send('Find me opportunities to act on.', 'opportunity', 'Opportunities')}
          disabled={busy}
          className="text-[9px] px-2.5 py-1 rounded-[3px] bg-[#f59e0b]/10 border border-[#f59e0b]/25 text-[#f59e0b] hover:bg-[#f59e0b]/15 disabled:opacity-30 transition-colors"
        >
          Find opportunities ↗
        </button>
      </div>

      {/* Message stream */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-[#111113] mx-3 my-2 rounded-[3px] p-2.5">
        {messages.length === 0 ? (
          <div className="text-[9px] text-[#64748b] leading-[1.5]">
            Pick a quick action above, or ask anything about the account. Analysis uses the period selected at top right.
          </div>
        ) : (
          <div className="space-y-1.5">
            {messages.map((m) => <MessageRow key={m.id} message={m} />)}
            {busy && <div className="text-[9px] text-[#475569] italic animate-pulse">analyzing…</div>}
          </div>
        )}
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => { e.preventDefault(); send(input, 'chat'); }}
        className="flex items-center gap-[5px] px-3 pb-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your account, request analysis, or build a campaign packet..."
          className="flex-1 bg-[#111113] border border-[#1e1e2e] rounded-[3px] px-2 py-1.5 text-[10px] text-[#e2e8f0] placeholder:text-[#64748b] focus:outline-none focus:border-[#3b82f6]/40"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="text-[9px] px-2.5 py-1.5 rounded-[3px] bg-[#3b82f6]/15 border border-[#3b82f6]/40 text-[#3b82f6] hover:bg-[#3b82f6]/25 disabled:opacity-30 transition-colors whitespace-nowrap"
        >
          Send ↗
        </button>
      </form>

      <div
        role="separator"
        aria-label="Resize chat panel"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="absolute left-0 right-0 -bottom-1 h-2 cursor-row-resize flex items-center justify-center group"
      >
        <span className="opacity-0 group-hover:opacity-100 transition-opacity">
          <GripHorizontal size={12} className="text-[#475569]" />
        </span>
      </div>
    </section>
  );
}

function MessageRow({ message }: { message: Message }) {
  const ts = new Date(message.ts);
  const day = ts.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  if (message.role === 'user') {
    return (
      <div className="text-[9px] text-[#64748b] bg-[#16161a] rounded-[3px] px-2 py-1.5 border-r-2 border-[#1e1e2e] text-right leading-[1.5]">
        {message.content}
      </div>
    );
  }

  return (
    <div className="text-[9px] text-[#94a3b8] bg-[#16161a] rounded-[3px] px-2 py-1.5 border-l-2 border-[#3b82f6] leading-[1.5]">
      <span className="block text-[7px] text-[#1e1e3a] mb-0.5">
        {day}{message.title ? ` · ${message.title}` : ''}
      </span>
      <span className="whitespace-pre-wrap">{message.content}</span>
    </div>
  );
}
