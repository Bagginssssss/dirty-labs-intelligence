'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { GripHorizontal, FileText } from 'lucide-react';
import { ChatSummaryModal } from './ChatSummaryModal';

// ── Types ─────────────────────────────────────────────────────────────────────

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  title?: string;
  stop_reason?: string;
  actionable?: boolean;
};

type RateLimit = {
  limit: number;
  remaining: number;
  resetAt: string;
};

type SessionMeta = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
};

type PersistedMessages = {
  version: 1;
  created_at: string;
  updated_at: string;
  messages: Message[];
};

// ── Storage constants ──────────────────────────────────────────────────────────

const MIN_HEIGHT    = 200;
const MAX_HEIGHT    = 500;
const DEFAULT_HEIGHT = 320;
const MAX_SESSIONS  = 5;

const HEIGHT_KEY    = 'dl:chat:height';
const SESSIONS_KEY  = 'dl:chat:sessions';
const SESSION_PFX   = 'dl:chat:session:';
const ACTIVE_KEY    = 'dl:chat:active-session-id';
const LEGACY_KEY    = 'dl:chat:current-session'; // Phase 1 — migrated on first load

// ── Storage helpers ────────────────────────────────────────────────────────────

function loadIndex(): SessionMeta[] {
  try {
    const raw = window.localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function saveIndex(sessions: SessionMeta[]): void {
  try { window.localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions)); } catch {}
}

function loadMessages(id: string): Message[] {
  try {
    const raw = window.localStorage.getItem(`${SESSION_PFX}${id}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersistedMessages;
    if (parsed?.version === 1 && Array.isArray(parsed.messages)) return parsed.messages;
  } catch {}
  return [];
}

function saveMessages(id: string, messages: Message[], createdAt: string): void {
  const payload: PersistedMessages = {
    version: 1,
    created_at: createdAt,
    updated_at: new Date().toISOString(),
    messages,
  };
  // Quota retry: drop oldest messages one at a time until the payload fits.
  let toSave = messages;
  while (true) {
    try {
      window.localStorage.setItem(`${SESSION_PFX}${id}`, JSON.stringify({ ...payload, messages: toSave }));
      return;
    } catch (e) {
      const isQuota = e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22);
      if (!isQuota || toSave.length === 0) return;
      toSave = toSave.slice(1);
    }
  }
}

function newSession(title = 'New session'): SessionMeta {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), title, created_at: now, updated_at: now, message_count: 0 };
}

// ── ChatPanel ─────────────────────────────────────────────────────────────────

export function ChatPanel({ brandId }: { brandId: string }) {
  const [height,       setHeight]       = useState(DEFAULT_HEIGHT);
  const [sessions,     setSessions]     = useState<SessionMeta[]>([]);
  const [activeId,     setActiveId]     = useState<string>('');
  const [messages,     setMessages]     = useState<Message[]>([]);
  const [input,        setInput]        = useState('');
  const [busy,         setBusy]         = useState(false);
  const [rateLimit,    setRateLimit]    = useState<RateLimit | null>(null);
  const [,             setTick]         = useState(0);
  const [editingId,    setEditingId]    = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [closingId,    setClosingId]    = useState<string | null>(null);
  const [summaryOpen,    setSummaryOpen]    = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryContent, setSummaryContent] = useState<string | null>(null);
  const [summaryError,   setSummaryError]   = useState<string | null>(null);

  const dragRef       = useRef<{ startY: number; startH: number } | null>(null);
  const scrollRef     = useRef<HTMLDivElement>(null);
  const sessionsRef   = useRef<SessionMeta[]>([]);
  const activeIdRef   = useRef<string>('');
  // Tracks which sessions have already had a title generation request fired.
  const titleFiredRef = useRef<Set<string>>(new Set());
  // Tracks which message ID the current summary modal is capturing (null = session summary).
  const captureMsgRef = useRef<string | null>(null);

  // ── 1: Restore panel height ────────────────────────────────────────────────
  useEffect(() => {
    const saved = window.localStorage.getItem(HEIGHT_KEY);
    if (saved) {
      const h = parseInt(saved, 10);
      if (!Number.isNaN(h)) setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, h)));
    }
  }, []);

  // ── 2: Mount initialisation — Phase 1 migration + load sessions ───────────
  useEffect(() => {
    // Phase 1 migration: if old single-session key exists, import it as first session.
    let migrated: SessionMeta | null = null;
    const legacyRaw = window.localStorage.getItem(LEGACY_KEY);
    if (legacyRaw) {
      try {
        const parsed = JSON.parse(legacyRaw) as PersistedMessages;
        if (parsed?.version === 1 && Array.isArray(parsed.messages) && parsed.messages.length > 0) {
          migrated = {
            id:            crypto.randomUUID(),
            title:         'Previous session',
            created_at:    parsed.created_at ?? new Date().toISOString(),
            updated_at:    parsed.updated_at ?? new Date().toISOString(),
            message_count: parsed.messages.length,
          };
          // Re-save under the new per-session key then remove the legacy key.
          window.localStorage.setItem(`${SESSION_PFX}${migrated.id}`, legacyRaw);
        }
      } catch {}
      window.localStorage.removeItem(LEGACY_KEY);
    }

    let index = loadIndex();
    if (migrated) {
      index = [migrated, ...index];
      saveIndex(index);
    }
    if (index.length === 0) {
      const fresh = newSession();
      index = [fresh];
      saveIndex(index);
    }

    const savedActiveId = window.localStorage.getItem(ACTIVE_KEY);
    const active = index.find(s => s.id === savedActiveId) ?? index[0];

    setSessions(index);
    setActiveId(active.id);
    setMessages(loadMessages(active.id));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 3: Keep refs in sync (declared before persist effect so they're fresh) ─
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

  // ── 4: Persist messages whenever they or the active session changes ─────────
  // Skip empty arrays — the initial [] before mount-init fires must not wipe storage.
  // Explicit close/clear goes through session operations which call removeItem directly.
  useEffect(() => {
    if (!activeId || messages.length === 0) return;
    const sess = sessionsRef.current.find(s => s.id === activeId);
    if (!sess) return;
    saveMessages(activeId, messages, sess.created_at);
    const now = new Date().toISOString();
    setSessions(prev => {
      const updated = prev.map(s =>
        s.id === activeId
          ? { ...s, updated_at: now, message_count: messages.length }
          : s,
      );
      saveIndex(updated);
      return updated;
    });
  }, [messages, activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 5: Auto-scroll ────────────────────────────────────────────────────────
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // ── 6: Rate limit countdown ───────────────────────────────────────────────
  useEffect(() => {
    if (!rateLimit || rateLimit.remaining > 5000) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [rateLimit]);

  // ── 7: Cross-tab sync via storage events ──────────────────────────────────
  useEffect(() => {
    function handleStorage(e: StorageEvent) {
      if (e.key === SESSIONS_KEY) {
        const updated = loadIndex();
        setSessions(updated);
        // If the active session was removed in another tab, switch to the most recent.
        if (updated.length > 0 && !updated.find(s => s.id === activeIdRef.current)) {
          const next = [...updated].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
          setActiveId(next.id);
          setMessages(loadMessages(next.id));
          try { window.localStorage.setItem(ACTIVE_KEY, next.id); } catch {}
        } else if (updated.length === 0) {
          const fresh = newSession();
          setSessions([fresh]);
          saveIndex([fresh]);
          setActiveId(fresh.id);
          setMessages([]);
          try { window.localStorage.setItem(ACTIVE_KEY, fresh.id); } catch {}
        }
      }
      // Another tab updated the messages for our current session — refresh.
      if (e.key === `${SESSION_PFX}${activeIdRef.current}`) {
        setMessages(loadMessages(activeIdRef.current));
      }
    }
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // ── Session operations ────────────────────────────────────────────────────

  function switchSession(id: string) {
    if (id === activeId) return;
    setActiveId(id);
    setMessages(loadMessages(id));
    setEditingId(null);
    setClosingId(null);
    try { window.localStorage.setItem(ACTIVE_KEY, id); } catch {}
  }

  function createSession() {
    if (sessions.length >= MAX_SESSIONS) return;
    const sess = newSession();
    const updated = [...sessions, sess];
    setSessions(updated);
    saveIndex(updated);
    setActiveId(sess.id);
    setMessages([]);
    setEditingId(null);
    setClosingId(null);
    try { window.localStorage.setItem(ACTIVE_KEY, sess.id); } catch {}
  }

  function closeSession(id: string) {
    try { window.localStorage.removeItem(`${SESSION_PFX}${id}`); } catch {}
    const remaining = sessions.filter(s => s.id !== id);
    if (remaining.length === 0) {
      // Last session closed — create a fresh one.
      const fresh = newSession();
      const next = [fresh];
      setSessions(next);
      saveIndex(next);
      setActiveId(fresh.id);
      setMessages([]);
      try { window.localStorage.setItem(ACTIVE_KEY, fresh.id); } catch {}
    } else {
      setSessions(remaining);
      saveIndex(remaining);
      if (id === activeId) {
        // Switch to the most recently updated remaining session.
        const next = [...remaining].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
        setActiveId(next.id);
        setMessages(loadMessages(next.id));
        try { window.localStorage.setItem(ACTIVE_KEY, next.id); } catch {}
      }
    }
    setClosingId(null);
    setEditingId(null);
  }

  function commitRename(id: string, title: string) {
    const trimmed = title.trim() || 'New session';
    setSessions(prev => {
      const updated = prev.map(s => s.id === id ? { ...s, title: trimmed } : s);
      saveIndex(updated);
      return updated;
    });
    setEditingId(null);
  }

  // ── Session summary ───────────────────────────────────────────────────────

  async function summarizeSession() {
    if (messages.length === 0) return;
    captureMsgRef.current = null;
    setSummaryOpen(true);
    setSummaryLoading(true);
    setSummaryContent(null);
    setSummaryError(null);

    try {
      const res = await fetch('/api/chat-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope:        'session',
          messages:     messages.map(({ role, content }) => ({ role, content })),
          sessionTitle: activeSession?.title ?? 'Chat Session',
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(errData.error ?? `HTTP ${res.status}`);
      }

      const data = await res.json() as { summary: string; generated_at: string };
      setSummaryContent(data.summary);
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : 'Failed to generate summary. Please try again.');
    } finally {
      setSummaryLoading(false);
    }
  }

  async function captureExchange(messageId: string) {
    const msgIdx = messages.findIndex(m => m.id === messageId);
    if (msgIdx < 0) return;
    captureMsgRef.current = messageId;
    setSummaryOpen(true);
    setSummaryLoading(true);
    setSummaryContent(null);
    setSummaryError(null);

    try {
      const res = await fetch('/api/chat-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope:        'message',
          messages:     messages.slice(0, msgIdx + 1).map(({ role, content }) => ({ role, content })),
          sessionTitle: activeSession?.title ?? 'Chat Session',
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(errData.error ?? `HTTP ${res.status}`);
      }

      const data = await res.json() as { summary: string; generated_at: string };
      setSummaryContent(data.summary);
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : 'Failed to generate capture. Please try again.');
    } finally {
      setSummaryLoading(false);
    }
  }

  function handleRetry() {
    if (captureMsgRef.current) {
      captureExchange(captureMsgRef.current);
    } else {
      summarizeSession();
    }
  }

  // ── Drag resize ───────────────────────────────────────────────────────────

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startH: height };
  }, [height]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const delta = e.clientY - dragRef.current.startY;
    setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, dragRef.current.startH + delta)));
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    (e.target as Element).releasePointerCapture(e.pointerId);
    try { window.localStorage.setItem(HEIGHT_KEY, String(height)); } catch {}
    dragRef.current = null;
  }, [height]);

  // ── send ──────────────────────────────────────────────────────────────────

  async function send(prompt: string, kind: 'chat' | 'briefing' | 'anomaly' | 'opportunity' = 'chat', title?: string) {
    const trimmed = prompt.trim();
    if (!trimmed || busy) return;

    // Capture state before any async ops — used by auto-title callback.
    const capturedSessionId = activeIdRef.current;
    const shouldAutoTitle =
      messages.length === 0 &&
      sessionsRef.current.find(s => s.id === capturedSessionId)?.title === 'New session' &&
      !titleFiredRef.current.has(capturedSessionId);

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: trimmed, ts: Date.now() };
    setMessages(m => [...m, userMsg]);
    setInput('');
    setBusy(true);

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand_id:      brandId,
          analysis_type: kind,
          query:         trimmed,
          history:       messages.slice(-6).map(({ role, content }) => ({ role, content })),
        }),
      });

      if (res.status === 429) {
        const errData = await res.json().catch(() => ({})) as { reset_at?: string };
        if (errData.reset_at) setRateLimit({ limit: 30000, remaining: 0, resetAt: errData.reset_at });
        const secsLeft = errData.reset_at
          ? Math.max(0, Math.ceil((new Date(errData.reset_at).getTime() - Date.now()) / 1000))
          : '?';
        setMessages(m => [...m, { id: crypto.randomUUID(), role: 'assistant', content: `⚠ Rate limited — wait ${secsLeft}s before retrying`, ts: Date.now() }]);
        return;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => 'Analysis request failed.');
        setMessages(m => [...m, { id: crypto.randomUUID(), role: 'assistant', content: `⚠ ${text}`, ts: Date.now() }]);
        return;
      }

      const data = await res.json();

      if (data.rate_limit) {
        setRateLimit({ limit: data.rate_limit.limit, remaining: data.rate_limit.remaining, resetAt: data.rate_limit.reset_at });
      }

      let text = '';
      if (typeof data?.content === 'string') text = data.content;
      else if (Array.isArray(data?.content)) {
        text = data.content
          .filter((b: { type: string }) => b?.type === 'text')
          .map((b: { text: string }) => b.text).join('\n\n');
      } else if (typeof data?.text === 'string') text = data.text;
      else text = '(empty response)';

      setMessages(m => [...m, {
        id: crypto.randomUUID(), role: 'assistant', content: text,
        ts: Date.now(), title, stop_reason: data.stop_reason ?? undefined,
        actionable: Boolean(data?.actionable),
      }]);

      // Auto-title: fire once per new session after the first exchange.
      if (shouldAutoTitle) {
        titleFiredRef.current.add(capturedSessionId);
        fetch('/api/chat-title', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ firstUserMessage: trimmed, firstAssistantResponse: text.slice(0, 500) }),
        })
          .then(r => r.ok ? r.json() : null)
          .then((d: { title?: string } | null) => {
            if (!d?.title || d.title === 'New session') return;
            setSessions(prev => {
              const updated = prev.map(s => s.id === capturedSessionId ? { ...s, title: d.title! } : s);
              saveIndex(updated);
              return updated;
            });
          })
          .catch(() => {});
      }
    } catch (err) {
      setMessages(m => [...m, {
        id: crypto.randomUUID(), role: 'assistant',
        content: `⚠ ${err instanceof Error ? err.message : 'Network error'}`, ts: Date.now(),
      }]);
    } finally {
      setBusy(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const activeSession = sessions.find(s => s.id === activeId);

  return (
    <>
    <section
      aria-label="Chat Intelligence"
      className="relative bg-[#16161a] border border-[#1e1e2e] rounded-md overflow-hidden flex flex-col"
      style={{ height }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-3 pt-2.5 pb-1.5 border-b border-[#1e1e2e]">
        <span className="text-[10px] tracking-[0.1em] text-[#3b82f6]">INTELLIGENCE · CHAT</span>
        <div className="flex-1" />
        <button
          onClick={summarizeSession}
          disabled={messages.length === 0 || summaryLoading}
          title={messages.length === 0 ? 'No messages to summarize' : 'Summarize this chat tab'}
          className="flex-shrink-0 flex items-center gap-1.5 text-[9px] px-2.5 py-1 rounded-[3px] bg-[#3b82f6]/10 border border-[#3b82f6]/25 text-[#3b82f6] hover:bg-[#3b82f6]/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <FileText size={10} />
          {summaryLoading ? 'Generating…' : 'Summarize this chat'}
        </button>
        <span className="text-[8px] text-[#475569]">12-month rolling window</span>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-[#1e1e2e] overflow-x-auto">
        {sessions.map(sess => {
          const isActive  = sess.id === activeId;
          const isClosing = closingId === sess.id;
          const isEditing = editingId === sess.id;
          return (
            <div
              key={sess.id}
              className={`group relative flex items-center flex-shrink-0 rounded-[3px] text-[9px] transition-colors ${
                isActive
                  ? 'bg-[#1e1e2e] text-[#94a3b8]'
                  : 'text-[#475569] hover:text-[#64748b] hover:bg-[#1e1e2e]/50'
              }`}
            >
              {isClosing ? (
                <span className="flex items-center gap-1.5 px-2 py-1 whitespace-nowrap">
                  <span className="text-[#64748b]">Close?</span>
                  <button onClick={() => closeSession(sess.id)} className="text-[#ef4444] hover:text-red-300 transition-colors">Yes</button>
                  <button onClick={() => setClosingId(null)} className="text-[#475569] hover:text-[#64748b] transition-colors">Cancel</button>
                </span>
              ) : isEditing ? (
                <input
                  value={editingTitle}
                  onChange={e => setEditingTitle(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitRename(sess.id, editingTitle);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  onBlur={() => commitRename(sess.id, editingTitle)}
                  autoFocus
                  className="bg-transparent border-none outline-none text-[9px] text-[#94a3b8] w-[90px] px-2 py-1"
                />
              ) : (
                <>
                  <span
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => switchSession(sess.id)}
                    onDoubleClick={() => { setEditingId(sess.id); setEditingTitle(sess.title); }}
                    className="px-2 py-1 truncate max-w-[110px] cursor-pointer select-none"
                    title={sess.title}
                  >
                    {sess.title}
                  </span>
                  <button
                    onClick={e => { e.stopPropagation(); setClosingId(sess.id); }}
                    aria-label={`Close ${sess.title}`}
                    className="opacity-0 group-hover:opacity-50 hover:!opacity-100 pr-1.5 text-[#475569] hover:text-[#94a3b8] transition-opacity flex-shrink-0 leading-none"
                  >
                    ×
                  </button>
                </>
              )}
            </div>
          );
        })}

        <button
          onClick={createSession}
          disabled={sessions.length >= MAX_SESSIONS}
          title={sessions.length >= MAX_SESSIONS ? 'Maximum 5 sessions' : undefined}
          className="flex-shrink-0 ml-0.5 text-[9px] px-1.5 py-1 text-[#334155] hover:text-[#475569] disabled:opacity-30 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
        >
          + New chat
        </button>
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
        <div className="flex-1" />
        {activeSession && (
          <span className="text-[8px] text-[#334155] self-center select-none" title={activeSession.created_at}>
            {activeSession.message_count} msg{activeSession.message_count !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Message stream */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-[#111113] mx-3 my-2 rounded-[3px] p-2.5">
        {messages.length === 0 ? (
          <div className="text-[9px] text-[#64748b] leading-[1.5]">
            Ask anything about your account performance. The chat has access to the past 12 months of data across PPC, sales, customers, competitive landscape, and more.
          </div>
        ) : (
          <div className="space-y-1.5">
            {messages.map(m => (
              <MessageRow
                key={m.id}
                message={m}
                onCapture={m.role === 'assistant' && m.actionable
                  ? () => captureExchange(m.id)
                  : undefined}
              />
            ))}
            {busy && <div className="text-[9px] text-[#475569] italic animate-pulse">analyzing…</div>}
          </div>
        )}
      </div>

      {/* Composer */}
      <form
        onSubmit={e => { e.preventDefault(); send(input, 'chat'); }}
        className="flex items-center gap-[5px] px-3 pb-3"
      >
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask about your account, request analysis, or build a campaign packet..."
          className="flex-1 bg-[#111113] border border-[#1e1e2e] rounded-[3px] px-2 py-1.5 text-[10px] text-[#e2e8f0] placeholder:text-[#64748b] focus:outline-none focus:border-[#3b82f6]/40"
          disabled={busy}
        />
        <RateLimitBadge rl={rateLimit} />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="text-[9px] px-2.5 py-1.5 rounded-[3px] bg-[#3b82f6]/15 border border-[#3b82f6]/40 text-[#3b82f6] hover:bg-[#3b82f6]/25 disabled:opacity-30 transition-colors whitespace-nowrap"
        >
          Send ↗
        </button>
      </form>

      {/* Drag resize handle */}
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

    <ChatSummaryModal
      open={summaryOpen}
      loading={summaryLoading}
      content={summaryContent}
      error={summaryError}
      sessionTitle={activeSession?.title ?? 'Chat Session'}
      onClose={() => setSummaryOpen(false)}
      onRetry={handleRetry}
    />
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RateLimitBadge({ rl }: { rl: RateLimit | null }) {
  if (!rl) return null;

  const secsLeft  = Math.max(0, Math.ceil((new Date(rl.resetAt).getTime() - Date.now()) / 1000));
  const resetTime = new Date(rl.resetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const used      = rl.limit - rl.remaining;
  const tooltip   = `Tokens used: ${used.toLocaleString()}/${rl.limit.toLocaleString()} in current window. Resets at ${resetTime}`;

  if (rl.remaining === 0 && secsLeft > 0) {
    return (
      <span title={tooltip} className="flex items-center gap-1 text-[8px] text-red-400 whitespace-nowrap select-none cursor-default">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
        Wait {secsLeft}s
      </span>
    );
  }
  if (rl.remaining < 5000 && secsLeft > 0) {
    return (
      <span title={tooltip} className="flex items-center gap-1 text-[8px] text-yellow-400 whitespace-nowrap select-none cursor-default">
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 flex-shrink-0" />
        Slow · {secsLeft}s
      </span>
    );
  }
  return (
    <span title={tooltip} className="flex items-center gap-1 text-[8px] text-emerald-400 whitespace-nowrap select-none cursor-default">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
      Ready
    </span>
  );
}

function MessageRow({ message, onCapture }: { message: Message; onCapture?: () => void }) {
  const ts  = new Date(message.ts);
  const day = ts.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  if (message.role === 'user') {
    return (
      <div className="text-[9px] text-[#64748b] bg-[#3b82f6]/15 rounded-[3px] px-3 py-1.5 border-l-2 border-[#3b82f6] text-right leading-[1.5]">
        {message.content}
      </div>
    );
  }

  return (
    <div className="text-[9px] text-[#94a3b8] bg-[#16161a] rounded-[3px] px-2 py-1.5 border-l-2 border-[#334155] leading-[1.5]">
      <span className="block text-[7px] text-[#1e1e3a] mb-0.5">
        {day}{message.title ? ` · ${message.title}` : ''}
      </span>
      <span className="whitespace-pre-wrap">{message.content}</span>
      {message.stop_reason === 'max_tokens' && (
        <span className="block text-[8px] text-amber-500 mt-1 pt-1 border-t border-amber-500/20">
          ⚠ Response truncated at token limit — ask a follow-up to continue.
        </span>
      )}
      {onCapture && (
        <button
          onClick={onCapture}
          className="block mt-1.5 text-[8px] text-[#f59e0b]/60 hover:text-[#f59e0b] transition-colors"
        >
          Capture for Claude →
        </button>
      )}
    </div>
  );
}
