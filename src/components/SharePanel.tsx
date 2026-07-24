'use client';

/**
 * SharePanel — "forward this as a message".
 *
 * Opens a modal, renders the ShareCard off-screen at its natural size,
 * captures it to a PNG (html-to-image, 2× pixel ratio → crisp on phones)
 * and offers forwarding actions:
 *   - native share sheet with the image attached (Telegram/WhatsApp/… picker
 *     on phones, wherever the Web Share API supports files)
 *   - copy image to clipboard (paste straight into a chat)
 *   - download PNG
 *   - Telegram / WhatsApp text-share links (URL schemes carry text only —
 *     the image goes via native share or copy+paste)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import ShareCard, { buildShareText, SHARE_CARD_WIDTH, type ShareCardProps } from './ShareCard';

const FILENAME = () => `btc-risk-${new Date().toISOString().split('T')[0]}.png`;

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(',');
  const mime = meta.match(/data:(.*?);/)?.[1] ?? 'image/png';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export default function SharePanel({ card }: { card: ShareCardProps }) {
  const [open, setOpen] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const shareText = buildShareText(card);
  const canNativeShareFiles =
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] });

  const generate = useCallback(async () => {
    if (!cardRef.current) return;
    setBusy(true);
    setNote(null);
    try {
      // Double render pass: fonts/SVG settle on the first, capture the second.
      await new Promise(r => setTimeout(r, 120));
      const url = await toPng(cardRef.current, {
        pixelRatio: 2,
        backgroundColor: '#0b0b0d',
        cacheBust: true,
      });
      setDataUrl(url);
    } catch {
      setNote('Image generation failed — try again');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setDataUrl(null);
      void generate();
    }
  }, [open, generate]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const flash = (msg: string) => {
    setNote(msg);
    setTimeout(() => setNote(null), 2500);
  };

  const nativeShare = async () => {
    if (!dataUrl) return;
    try {
      const file = new File([dataUrlToBlob(dataUrl)], FILENAME(), { type: 'image/png' });
      await navigator.share({ files: [file], text: shareText });
    } catch {
      /* user cancelled the sheet — not an error */
    }
  };

  const copyImage = async () => {
    if (!dataUrl) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': dataUrlToBlob(dataUrl) }),
      ]);
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
    a.download = FILENAME();
    a.click();
  };

  const btn =
    'ctl rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const btnStyle = {
    borderColor: 'var(--control-border)',
    background: 'var(--control-bg)',
    color: 'var(--control-text-active)',
  } as const;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="ctl flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] transition-colors"
        style={btnStyle}
        title="Compose a phone-readable snapshot image and forward it (Telegram, WhatsApp, …)"
      >
        <svg aria-hidden width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
          <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" strokeLinecap="round" />
          <path d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Share
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto"
          style={{ background: 'rgba(0,0,0,0.72)' }}
          onClick={() => setOpen(false)}
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
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="ctl rounded px-2 text-[15px] leading-none"
                style={{ color: 'var(--muted)' }}
              >
                ×
              </button>
            </div>

            {/* preview */}
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

            {/* actions */}
            <div className="flex flex-wrap items-center gap-2 mt-3">
              {canNativeShareFiles && (
                <button onClick={nativeShare} disabled={!dataUrl} className={btn} style={{ ...btnStyle, borderColor: 'rgba(234,179,8,0.4)', color: 'var(--accent)' }}>
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

          {/* off-screen natural-size card used for capture */}
          <div
            aria-hidden
            style={{ position: 'fixed', left: -10000, top: 0, width: SHARE_CARD_WIDTH, pointerEvents: 'none' }}
          >
            <div ref={cardRef}>
              <ShareCard {...card} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
