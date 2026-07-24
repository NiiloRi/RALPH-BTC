'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { registerAction, type RegisterFormState } from './actions';

const inputClass =
  'w-full rounded border bg-transparent px-3 py-2 text-sm outline-none focus:border-yellow-600';
const inputStyle = { borderColor: 'var(--hairline)', color: 'var(--foreground)' } as const;

export default function RegisterForm({ formToken }: { formToken: string }) {
  const [state, formAction, pending] = useActionState<RegisterFormState, FormData>(
    registerAction,
    {}
  );

  if (state.success) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm" style={{ color: 'var(--foreground)' }}>
          Account created.
        </p>
        <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
          An admin needs to approve it before you can sign in.
        </p>
        <Link
          href="/login"
          className="inline-block rounded px-4 py-2 text-sm font-medium"
          style={{ background: 'var(--accent)', color: '#0b0b0d' }}
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="ft" value={formToken} />
      {/* Honeypot: humans never see or fill this. Off-screen, not display:none. */}
      <div
        aria-hidden="true"
        style={{ position: 'absolute', left: '-9999px', top: 'auto', width: 1, height: 1, overflow: 'hidden' }}
      >
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <div>
        <label htmlFor="username" className="block text-[12px] mb-1" style={{ color: 'var(--muted)' }}>
          Username
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          required
          minLength={3}
          maxLength={32}
          pattern="[a-zA-Z0-9_.\-]+"
          className={inputClass}
          style={inputStyle}
        />
        <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>
          3–32 characters: letters, numbers, _ . -
        </p>
      </div>
      <div>
        <label htmlFor="password" className="block text-[12px] mb-1" style={{ color: 'var(--muted)' }}>
          Password
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
          Confirm password
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
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded py-2 text-sm font-medium disabled:opacity-50"
        style={{ background: 'var(--accent)', color: '#0b0b0d' }}
      >
        {pending ? 'Creating…' : 'Request account'}
      </button>
      <p className="text-[12px] text-center" style={{ color: 'var(--faint)' }}>
        Accounts are activated manually by the admin.
      </p>
      <p className="text-[12px] text-center" style={{ color: 'var(--faint)' }}>
        Already approved?{' '}
        <Link href="/login" className="underline" style={{ color: 'var(--muted)' }}>
          Sign in
        </Link>
      </p>
    </form>
  );
}
