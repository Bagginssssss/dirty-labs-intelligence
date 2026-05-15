'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Copy, Download } from 'lucide-react';

type Props = {
  open: boolean;
  loading: boolean;
  content: string | null;
  error: string | null;
  sessionTitle: string;
  onClose: () => void;
  onRetry: () => void;
};

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'session';
}

export function ChatSummaryModal({ open, loading, content, error, sessionTitle, onClose, onRetry }: Props) {
  const [copied, setCopied] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Reset copied state when modal closes
  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  if (!open) return null;

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) onClose();
  }

  async function copyToClipboard() {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  function download() {
    if (!content) return;
    const date = new Date().toISOString().slice(0, 10);
    const filename = `dl-chat-summary-${slugify(sessionTitle)}-${date}.md`;
    const blob = new Blob([content], { type: 'text/markdown; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
    >
      <div className="bg-[#16161a] border border-[#1e1e2e] rounded-[6px] w-full max-w-2xl max-h-[80vh] flex flex-col shadow-xl shadow-black/80">

        {/* Modal header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1e1e2e] flex-shrink-0">
          <span className="text-[10px] tracking-[0.1em] text-[#3b82f6]">SESSION SUMMARY</span>
          <span className="text-[8px] text-[#475569] truncate flex-1" title={sessionTitle}>
            {sessionTitle}
          </span>
          <button
            onClick={onClose}
            className="text-[#475569] hover:text-[#94a3b8] transition-colors flex-shrink-0"
            aria-label="Close summary"
          >
            <X size={13} />
          </button>
        </div>

        {/* Modal body */}
        <div className="flex-1 overflow-y-auto min-h-0 p-4">
          {loading && (
            <div className="flex items-center justify-center py-12 text-[10px] text-[#475569] animate-pulse">
              Generating summary…
            </div>
          )}

          {!loading && error && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <span className="text-[10px] text-[#ef4444]">{error}</span>
              <button
                onClick={onRetry}
                className="text-[9px] px-3 py-1.5 rounded-[3px] bg-[#3b82f6]/15 border border-[#3b82f6]/40 text-[#3b82f6] hover:bg-[#3b82f6]/25 transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {!loading && content && (
            <pre className="text-[10px] text-[#94a3b8] whitespace-pre-wrap leading-[1.75] font-mono">
              {content}
            </pre>
          )}
        </div>

        {/* Modal footer — only when content is ready */}
        {!loading && content && (
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#1e1e2e] flex-shrink-0">
            <button
              onClick={copyToClipboard}
              className="flex items-center gap-1.5 text-[9px] px-3 py-1.5 rounded-[3px] bg-[#1e1e2e] text-[#64748b] hover:text-[#94a3b8] transition-colors"
            >
              <Copy size={9} />
              {copied ? 'Copied!' : 'Copy to clipboard'}
            </button>
            <button
              onClick={download}
              className="flex items-center gap-1.5 text-[9px] px-3 py-1.5 rounded-[3px] bg-[#3b82f6]/15 border border-[#3b82f6]/40 text-[#3b82f6] hover:bg-[#3b82f6]/25 transition-colors"
            >
              <Download size={9} />
              Download .md
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
