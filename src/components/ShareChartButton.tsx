'use client';

/**
 * ShareChartButton — capture an arbitrary chart card (a DOM node) to a PNG
 * and forward it via the shared ShareModal. The button itself carries
 * data-noshare so it is excluded from the capture.
 */

import { useCallback, useState, type RefObject } from 'react';
import { toPng } from 'html-to-image';
import ShareModal from './ShareShell';

export default function ShareChartButton({
  targetRef,
  title,
  filenamePrefix,
}: {
  targetRef: RefObject<HTMLElement | null>;
  /** used in the forwarded text summary */
  title: string;
  filenamePrefix: string;
}) {
  const [open, setOpen] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shareText = `${title} · ${new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })} · btc.dataniilo.fi`;

  const openAndCapture = useCallback(async () => {
    setOpen(true);
    setDataUrl(null);
    if (!targetRef.current) return;
    setBusy(true);
    try {
      await new Promise(r => setTimeout(r, 80));
      const url = await toPng(targetRef.current, {
        pixelRatio: 2,
        backgroundColor: '#101013',
        cacheBust: true,
        filter: node =>
          !(node instanceof HTMLElement && node.dataset && node.dataset.noshare === 'true'),
      });
      setDataUrl(url);
    } catch {
      /* modal shows the Preparing state; user can close and retry */
    } finally {
      setBusy(false);
    }
  }, [targetRef]);

  return (
    <>
      <button
        data-noshare="true"
        onClick={openAndCapture}
        className="ctl flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] transition-colors"
        style={{
          borderColor: 'var(--control-border)',
          background: 'var(--control-bg)',
          color: 'var(--control-text)',
        }}
        title={`Share a snapshot image of ${title}`}
      >
        <svg aria-hidden width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
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
        filenamePrefix={filenamePrefix}
      />
    </>
  );
}
