import Link from 'next/link';
import { logoutAction } from '@/app/(protected)/account/actions';
import type { UserRecord } from '@/lib/auth/types';

/** Slim session strip on top of every protected page. Server component. */
export default function AuthHeader({ user }: { user: UserRecord }) {
  return (
    <div
      className="flex items-center justify-end gap-4 px-4 py-1.5 border-b text-[12px]"
      style={{
        background: 'var(--surface)',
        borderColor: 'var(--hairline)',
        color: 'var(--muted)',
      }}
    >
      <span>
        signed in as <span style={{ color: 'var(--foreground)' }}>{user.username}</span>
      </span>
      {user.role === 'admin' && (
        <Link href="/admin" className="underline hover:opacity-80">
          admin
        </Link>
      )}
      <Link href="/account" className="underline hover:opacity-80">
        account
      </Link>
      <form action={logoutAction}>
        <button type="submit" className="underline hover:opacity-80 cursor-pointer">
          sign out
        </button>
      </form>
    </div>
  );
}
