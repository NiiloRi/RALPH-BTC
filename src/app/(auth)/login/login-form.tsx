'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { loginAction, type LoginFormState } from './actions';

const inputClass =
  'w-full rounded border bg-transparent px-3 py-2 text-sm outline-none focus:border-yellow-600';
const inputStyle = { borderColor: 'var(--hairline)', color: 'var(--foreground)' } as const;

export default function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<LoginFormState, FormData>(
    loginAction,
    {}
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="username" className="block text-[12px] mb-1" style={{ color: 'var(--muted)' }}>
          Username
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          required
          autoFocus
          className={inputClass}
          style={inputStyle}
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-[12px] mb-1" style={{ color: 'var(--muted)' }}>
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
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
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
      <p className="text-[12px] text-center" style={{ color: 'var(--faint)' }}>
        No account?{' '}
        <Link href="/register" className="underline" style={{ color: 'var(--muted)' }}>
          Request one
        </Link>
      </p>
    </form>
  );
}
