/** Centered card layout for the public auth pages (login / register). */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'var(--background)', color: 'var(--foreground)' }}
    >
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-display text-3xl" style={{ color: 'var(--foreground)' }}>
            BTC Risk Metric
          </h1>
          <p className="text-[12px] mt-1" style={{ color: 'var(--faint)' }}>
            private dashboard
          </p>
        </div>
        <div
          className="border rounded-lg p-6"
          style={{ background: 'var(--surface)', borderColor: 'var(--hairline)' }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
