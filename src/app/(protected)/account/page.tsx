import Link from 'next/link';
import { requireUser } from '@/lib/auth/current-user';
import ChangePasswordForm from './change-password-form';

export const metadata = { title: 'Account — BTC Risk Metric' };
export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <div
      className="min-h-screen px-4 py-10"
      style={{ background: 'var(--background)', color: 'var(--foreground)' }}
    >
      <div className="max-w-2xl mx-auto">
        <Link href="/" className="text-[12px] underline" style={{ color: 'var(--faint)' }}>
          ← back to dashboard
        </Link>
        <h1 className="font-display text-3xl mt-4">Account</h1>
        <p className="text-[13px] mt-2" style={{ color: 'var(--muted)' }}>
          {user.username} · {user.role}
          {user.lastLoginAt && (
            <span style={{ color: 'var(--faint)' }}>
              {' '}· last login {new Date(user.lastLoginAt).toLocaleString()}
            </span>
          )}
        </p>
        <div
          className="mt-8 border rounded-lg p-6"
          style={{ background: 'var(--surface)', borderColor: 'var(--hairline)' }}
        >
          <h2 className="text-sm font-medium mb-4">Change password</h2>
          <ChangePasswordForm />
        </div>
      </div>
    </div>
  );
}
