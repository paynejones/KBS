
import Link from "next/link";
import {
  Database,
  FileText,
  Search,
  Settings,
  Star,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";

const navigation = [
  { label: "Home", href: "/", icon: FileText },
  { label: "Pages", href: "/#pages", icon: FileText },
  { label: "Databases", href: "/#databases", icon: Database },
  { label: "Favorites", href: "/#favorites", icon: Star },
];

export function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-60 shrink-0 border-r bg-muted/30 p-4 md:flex md:flex-col">
        <Link href="/" className="mb-8 text-lg font-semibold">
          Knowledge Base
        </Link>

        <div className="mb-2 px-2 text-xs font-medium text-muted-foreground">
          WORKSPACE
        </div>

        <nav className="space-y-1">
          {navigation.map(({ label, href, icon: Icon }) => (
            <Link
              key={label}
              href={href}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
            >
              <Icon size={16} />
              {label}
            </Link>
          ))}
        </nav>

        <Separator className="my-5" />

        <div className="mt-auto flex items-center gap-2 px-2 text-sm text-muted-foreground">
          <Settings size={16} />
          Personal workspace
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <header className="flex h-14 items-center border-b px-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Search size={16} />
            <span>Knowledge Base</span>
          </div>
        </header>

        <div className="mx-auto w-full max-w-5xl p-6 md:p-10">
          {children}
        </div>
      </main>
    </div>
  );
}
