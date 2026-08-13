import type { Metadata } from 'next';
import './globals.css';
import { AppNav } from '@/components/app-nav';

export const metadata: Metadata = {
  title: 'eSign',
  description: 'Local electronic signature platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <div className="flex h-screen flex-col">
          <AppNav />
          <div className="flex-1 overflow-hidden">{children}</div>
        </div>
      </body>
    </html>
  );
}
