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
import ShareModal from './ShareShell';

export default function SharePanel({ card }: { card: ShareCardProps }) {
  const [open, setOpen] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const shareText = buildShareText(card);

  const generate = useCallback(async () => {
    if (!cardRef.current) return;
    setBusy(true);
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
      /* modal shows the Preparing state; user can close and retry */
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

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="ctl flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] transition-colors"
        style={{
          borderColor: 'var(--control-border)',
          background: 'var(--control-bg)',
          color: 'var(--control-text-active)',
        }}
        title="Compose a phone-readable snapshot image and forward it (Telegram, WhatsApp, ...)"
      >
        <svg aria-hidden width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
          <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" strokeLinecap="round" />
          <path d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Share
      </button>

      <ShareModal
        open={open}
        onClose={() => setOpen(false)}
        dataUrl={dataUrl}
        busy={busy}
        shareText={shareText}
        filenamePrefix="btc-risk"
        extra={
          <div
            aria-hidden
            style={{ position: 'fixed', left: -10000, top: 0, width: SHARE_CARD_WIDTH, pointerEvents: 'none' }}
          >
            <div ref={cardRef}>
              <ShareCard {...card} />
            </div>
          </div>
        }
      />
    </>
  );
}
