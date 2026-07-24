'use client';

/**
 * Overview-layout settings: which cards the front page shows for this user.
 * The main verdict card is always visible and not listed. Toggles apply
 * optimistically and persist via the server action; on failure the toggle
 * reverts and an error note appears.
 */

import { useState, useTransition } from 'react';
import {
  OVERVIEW_CARDS,
  type OverviewCardKey,
  type OverviewCardPrefs,
} from '@/lib/auth/types';
import { Toggle } from '@/components/chart-ui';
import { updateOverviewCardsAction } from './actions';

export default function OverviewCardsForm({ initial }: { initial: OverviewCardPrefs }) {
  const [cards, setCards] = useState<OverviewCardPrefs>(initial);
  const [note, setNote] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const toggle = (key: OverviewCardKey, value: boolean) => {
    const next = { ...cards, [key]: value };
    setCards(next); // optimistic
    setNote(null);
    startTransition(async () => {
      try {
        const res = await updateOverviewCardsAction(next);
        if (res.error) throw new Error(res.error);
        setNote('Saved');
        setTimeout(() => setNote(null), 2000);
      } catch {
        setCards(cards); // revert
        setNote('Saving failed — try again');
      }
    });
  };

  return (
    <div>
      <p className="text-[12px] mb-3" style={{ color: 'var(--muted)' }}>
        The main verdict card is always shown. Choose which additional cards the
        overview displays for your account:
      </p>
      <div className="flex flex-wrap gap-2">
        {OVERVIEW_CARDS.map(c => (
          <Toggle
            key={c.key}
            checked={cards[c.key]}
            onChange={v => toggle(c.key, v)}
            label={c.label}
          />
        ))}
      </div>
      <p className="text-[11px] mt-2 h-4" style={{ color: note === 'Saved' ? '#22c55e' : '#ef4444' }}>
        {note ?? ''}
      </p>
    </div>
  );
}
