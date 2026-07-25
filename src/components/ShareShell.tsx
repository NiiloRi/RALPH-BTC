'use client';

/**
 * Shared share-modal shell — preview + forward actions (native share sheet
 * with the image attached, copy image, download, Telegram/WhatsApp text
 * links, copy text). Used by the hero SharePanel (composed card) and by
 * ShareChartButton (arbitrary chart capture).
 */

import { useEffect, useState } from 'react';

export function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(',');
  const mime = meta.match(/data:(.*?);/)?.[1] ?? 'image/png';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function shareFilename(prefix: string): string {
  return `${prefix}-${new Date().toISOString().split('T')[0]}.png`;
}

const btn =
  'ctl rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const btnStyle = {
  borderColor: 'var(--control-border)',
  background: 'var(--control-bg)',
  color: 'var(--control-text-active)',
} as const;

export default function ShareModal({
  open,
  onClose,
  dataUrl,
  busy,
  shareText,
  filenamePrefix,
  extra,
}: {
  open: boolean;
  onClose: () => void;
  dataUrl: string | null;
  busy: boolean;
  shareText: string;
  filenamePrefix: string;
  /** optional off-screen capture source rendered inside the overlay */
  extra?: React.ReactNode;
}) {
  const [note, setNote] = useState<string | null>(null);

  const canNativeShareFiles =
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] });

  const close = () => {
    setNote(null);
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const flash = (msg: string) => {
    setNote(msg);
    setTimeout(() => setNote(null), 2500);
  };

  const nativeShare = async () => {
    if (!dataUrl) return;
    try {
      const file = new File([dataUrlToBlob(dataUrl)], shareFilename(filenamePrefix), {
        type: 'image/png',
      });
      await navigator.share({ files: [file], text: shareText });
    } catch {
      /* user cancelled the sheet — not an error */
    }
  };

  const copyImage = async () => {
    if (!dataUrl) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': dataUrlToBlob(dataUrl) })]);
      flash('Image copied — paste it into the chat');
    } catch {
      flash('Copy failed — use Download instead');
    }
  };

  const copyTextSummary = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      flash('Text copied');
    } catch {
      flash('Copy failed');
    }
  };

  const download = () => {
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = shareFilename(filenamePrefix);
    a.click();
  };

  return (
    <div
      data-noshare="true"
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.72)' }}
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Share snapshot"
    >
      <div
        className="w-full max-w-xl rounded-xl border p-4"
        style={{ background: 'var(--surface)', borderColor: 'var(--hairline)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-[13px] font-medium" style={{ color: 'var(--foreground)' }}>
            Share snapshot
          </span>
          <button
            onClick={close}
            aria-label="Close"
            className="ctl rounded px-2 text-[15px] leading-none"
            style={{ color: 'var(--muted)' }}
          >
            ×
          </button>
        </div>

        <div
          className="rounded-lg border overflow-hidden flex items-center justify-center"
          style={{ borderColor: 'var(--hairline)', background: '#0b0b0d', minHeight: 220 }}
        >
          {dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={dataUrl} alt="Snapshot preview" className="w-full h-auto" />
          ) : (
            <span className="text-[12px] py-16" style={{ color: 'var(--faint)' }}>
              {busy ? 'Composing image…' : 'Preparing…'}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-3">
          {canNativeShareFiles && (
            <button
              onClick={nativeShare}
              disabled={!dataUrl}
              className={btn}
              style={{ ...btnStyle, borderColor: 'rgba(234,179,8,0.4)', color: 'var(--accent)' }}
            >
              Share…
            </button>
          )}
          <button onClick={copyImage} disabled={!dataUrl} className={btn} style={btnStyle}>
            Copy image
          </button>
          <button onClick={download} disabled={!dataUrl} className={btn} style={btnStyle}>
            Download
          </button>
          <span className="mx-1 h-4 w-px" style={{ background: 'var(--hairline)' }} aria-hidden />
          <a
            href={`https://t.me/share/url?url=${encodeURIComponent('https://btc.dataniilo.fi')}&text=${encodeURIComponent(shareText)}`}
            target="_blank"
            rel="noopener noreferrer"
            className={btn}
            style={btnStyle}
          >
            Telegram
          </a>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(shareText + '\nhttps://btc.dataniilo.fi')}`}
            target="_blank"
            rel="noopener noreferrer"
            className={btn}
            style={btnStyle}
          >
            WhatsApp
          </a>
          <button onClick={copyTextSummary} className={btn} style={btnStyle}>
            Copy text
          </button>
        </div>

        <p className="text-[11px] mt-2" style={{ color: 'var(--faint)' }}>
          {note ??
            'Telegram/WhatsApp buttons forward the text summary — attach the image with Share… or Copy image → paste.'}
        </p>
      </div>
      {extra}
    </div>
  );
}
