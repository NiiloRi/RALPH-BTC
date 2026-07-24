'use client';

import { useActionState } from 'react';
import { changePasswordAction, type ChangePasswordState } from './actions';

const inputClass =
  'w-full rounded border bg-transparent px-3 py-2 text-sm outline-none focus:border-yellow-600';
const inputStyle = { borderColor: 'var(--hairline)', color: 'var(--foreground)' } as const;

export default function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState<ChangePasswordState, FormData>(
    changePasswordAction,
    {}
  );

  return (
    <form action={formAction} className="space-y-4 max-w-sm">
      <div>
        <label htmlFor="current" className="block text-[12px] mb-1" style={{ color: 'var(--muted)' }}>
          Current password
        </label>
        <input
          id="current"
          name="current"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass}
          style={inputStyle}
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-[12px] mb-1" style={{ color: 'var(--muted)' }}>
          New password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={72}
          className={inputClass}
          style={inputStyle}
        />
      </div>
      <div>
        <label htmlFor="confirm" className="block text-[12px] mb-1" style={{ color: 'var(--muted)' }}>
          Confirm new password
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={72}
          className={inputClass}
          style={inputStyle}
        />
      </div>
      {state.error && (
        <p className="text-[12px] text-red-400" role="alert">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="text-[12px] text-emerald-400" role="status">
          Password changed. Other signed-in sessions were logged out.
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded px-4 py-2 text-sm font-medium disabled:opacity-50"
        style={{ background: 'var(--accent)', color: '#0b0b0d' }}
      >
        {pending ? 'Changing…' : 'Change password'}
      </button>
    </form>
  );
}
