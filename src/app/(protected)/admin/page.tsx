import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/current-user';
import { listUsers } from '@/lib/auth/user-store';
import type { PublicUser } from '@/lib/auth/types';
import { activateUserAction, deleteUserAction, disableUserAction } from './actions';

export const metadata = { title: 'Admin — BTC Risk Metric' };
export const dynamic = 'force-dynamic';

const STATUS_COLOR: Record<PublicUser['status'], string> = {
  pending: 'var(--accent)',
  active: '#22c55e',
  disabled: '#ef4444',
};

function fmt(iso?: string): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

function ActionButton({
  action,
  label,
  danger,
}: {
  action: () => Promise<void>;
  label: string;
  danger?: boolean;
}) {
  return (
    <form action={action} className="inline">
      <button
        type="submit"
        className="rounded border px-2 py-0.5 text-[11px] hover:opacity-80 cursor-pointer"
        style={{
          borderColor: danger ? 'rgba(239,68,68,0.4)' : 'var(--hairline)',
          color: danger ? '#ef4444' : 'var(--foreground)',
        }}
      >
        {label}
      </button>
    </form>
  );
}

export default async function AdminPage() {
  await requireAdmin();
  const users = await listUsers();
  const pending = users.filter(u => u.status === 'pending').length;
  const activeAdmins = users.filter(u => u.role === 'admin' && u.status === 'active');

  return (
    <div
      className="min-h-screen px-4 py-10"
      style={{ background: 'var(--background)', color: 'var(--foreground)' }}
    >
      <div className="max-w-4xl mx-auto">
        <Link href="/" className="text-[12px] underline" style={{ color: 'var(--faint)' }}>
          ← back to dashboard
        </Link>
        <h1 className="font-display text-3xl mt-4">User administration</h1>
        <p className="text-[13px] mt-2" style={{ color: 'var(--muted)' }}>
          {users.length} account{users.length === 1 ? '' : 's'}
          {pending > 0 && (
            <span style={{ color: 'var(--accent)' }}> · {pending} awaiting approval</span>
          )}
        </p>

        <div
          className="mt-8 border rounded-lg overflow-x-auto"
          style={{ background: 'var(--surface)', borderColor: 'var(--hairline)' }}
        >
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left" style={{ color: 'var(--faint)' }}>
                {['User', 'Status', 'Created', 'Last login', 'Registered from', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 font-normal border-b" style={{ borderColor: 'var(--hairline)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const isLastActiveAdmin =
                  u.role === 'admin' && u.status === 'active' && activeAdmins.length <= 1;
                return (
                  <tr
                    key={u.id}
                    className="border-b last:border-b-0"
                    style={{
                      borderColor: 'var(--hairline)',
                      background: u.status === 'pending' ? 'rgba(234,179,8,0.06)' : undefined,
                    }}
                  >
                    <td className="px-4 py-3">
                      <span style={{ color: 'var(--foreground)' }}>{u.username}</span>
                      {u.role === 'admin' && (
                        <span className="ml-2" style={{ color: 'var(--faint)' }}>admin</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span style={{ color: STATUS_COLOR[u.status] }}>{u.status}</span>
                    </td>
                    <td className="px-4 py-3" style={{ color: 'var(--muted)' }}>{fmt(u.createdAt)}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--muted)' }}>{fmt(u.lastLoginAt)}</td>
                    <td className="px-4 py-3" style={{ color: 'var(--faint)' }}>
                      {u.registrationIp ?? '—'}
                      {u.registrationUserAgent && (
                        <span
                          className="block max-w-[220px] truncate"
                          title={u.registrationUserAgent}
                        >
                          {u.registrationUserAgent}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 space-x-1.5 whitespace-nowrap">
                      {u.status !== 'active' && (
                        <ActionButton action={activateUserAction.bind(null, u.id)} label="Activate" />
                      )}
                      {u.status === 'active' && !isLastActiveAdmin && (
                        <ActionButton action={disableUserAction.bind(null, u.id)} label="Disable" />
                      )}
                      {!isLastActiveAdmin && (
                        <ActionButton action={deleteUserAction.bind(null, u.id)} label="Delete" danger />
                      )}
                      {isLastActiveAdmin && (
                        <span style={{ color: 'var(--faint)' }}>last admin</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] mt-4" style={{ color: 'var(--faint)' }}>
          Pending accounts cannot sign in until activated. Disabling a user ends their
          sessions immediately. Registration IP/UA shown to help spot bots.
        </p>
      </div>
    </div>
  );
}
