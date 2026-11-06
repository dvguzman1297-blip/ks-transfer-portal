import './globals.css';

export const metadata = {
  title: 'K1886 Transfer Portal',
  description: 'Kingdom transfer prospect management for alliance leadership',
};
export const viewport = { width: 'device-width', initialScale: 1 };

// Runs before the page paints so the saved theme is applied without a flash.
const THEME_SCRIPT = `try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head>
      <body>
        {children}
        <footer className="px-4 py-6 text-center text-xs text-slate-500">
          <p>© 2026 j3ttybear. All rights reserved.</p>
          <p className="mt-1">Game assets and data are the property of their respective owners.</p>
        </footer>
      </body>
    </html>
  );
}
