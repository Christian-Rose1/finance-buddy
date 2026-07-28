import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Finance Buddy',
  description: 'An AI financial copilot that finds money you are leaving on the table.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
