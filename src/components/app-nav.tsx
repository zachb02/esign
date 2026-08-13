'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/dashboard', label: 'Documents' },
  { href: '/templates', label: 'Templates' },
];

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav className="flex h-12 shrink-0 items-center gap-1 border-b px-4">
      <span className="mr-4 font-semibold">eSign</span>
      {LINKS.map((link) => {
        const active = pathname?.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`rounded px-3 py-1.5 text-sm ${
              active ? 'bg-neutral-100 font-medium' : 'text-neutral-600 hover:bg-neutral-50'
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
