import { sanitizeNextParam } from '@/lib/auth/gate';
import LoginForm from './login-form';

export const metadata = { title: 'Sign in — BTC Risk Metric' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <LoginForm next={sanitizeNextParam(next ?? null)} />;
}
