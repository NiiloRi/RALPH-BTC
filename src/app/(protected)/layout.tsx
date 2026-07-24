import AuthHeader from '@/components/auth/AuthHeader';
import { requireUser } from '@/lib/auth/current-user';

/**
 * Protected route group: defense-in-depth for initial page loads.
 * The real gate is src/proxy.ts — this layer catches anything that slips
 * past it and renders the session strip.
 */
export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  return (
    <>
      <AuthHeader user={user} />
      {children}
    </>
  );
}
