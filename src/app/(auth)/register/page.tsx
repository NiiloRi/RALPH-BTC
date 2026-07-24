import { signFormToken } from '@/lib/auth/session';
import RegisterForm from './register-form';

export const metadata = { title: 'Request account — BTC Risk Metric' };

// The timing token must be minted per request, never baked in at build time
// (a static token would expire and also always pass the min-fill-time check).
export const dynamic = 'force-dynamic';

export default async function RegisterPage() {
  const formToken = await signFormToken('register');
  return <RegisterForm formToken={formToken} />;
}
