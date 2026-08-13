import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'eSign',
  description: 'Local electronic signature platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
