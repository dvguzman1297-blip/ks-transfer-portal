import SiteHeader from '@/components/SiteHeader';

// Shared frame for the public pages (landing, rules, alliances, assignments).
// 4.75rem = height of the copyright footer in the root layout, so page + footer fill the screen exactly.
export default function SiteLayout({ children }) {
  return (
    <div className="flex min-h-[calc(100vh-4.75rem)] flex-col overflow-x-clip">
      <SiteHeader />
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
