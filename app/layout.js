import './globals.css';

export const metadata = {
  title: 'K1886 Transfer Portal',
  description: 'Kingdom transfer prospect management for alliance leadership',
};
export const viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
