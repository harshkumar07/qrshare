import type { Metadata } from 'next';
import '../src/styles.css';

export const metadata: Metadata = {
  title: 'QRShare',
  description: 'Peer-to-peer file sharing between nearby devices.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
