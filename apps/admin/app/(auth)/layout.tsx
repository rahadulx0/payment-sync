import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-lg font-semibold">payment-sync</div>
          <div className="text-sm text-muted">operator dashboard</div>
        </div>
        {children}
      </div>
    </div>
  );
}
