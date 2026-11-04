"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Database, Files, GitFork, House, Inbox, Star } from "lucide-react";

const navigation = [
  { label: "Home", href: "/", icon: House },
  { label: "Pages", href: "/pages", icon: Files },
  { label: "Inbox", href: "/inbox", icon: Inbox },
  { label: "Databases", href: "/databases", icon: Database },
  { label: "Favorites", href: "/favorites", icon: Star },
  { label: "Graph", href: "/graph", icon: GitFork },
];

export function WorkspaceNavigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();

  return <NavigationLinks pathname={pathname} mobile={mobile} />;
}

export function WorkspaceNavigationFallback({ mobile = false }: { mobile?: boolean }) {
  return <NavigationLinks pathname="" mobile={mobile} />;
}

function NavigationLinks({ pathname, mobile }: { pathname: string; mobile: boolean }) {
  const links = navigation.map(({ label, href, icon: Icon }) => {
    const active = href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(`${href}/`);

    return (
      <Link
        key={label}
        href={href}
        aria-current={active ? "page" : undefined}
        className={mobile
          ? `flex min-h-12 flex-col items-center justify-center gap-1 rounded-md text-[10px] font-medium transition-colors ${active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`
          : `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${active ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`}
      >
        <Icon size={mobile ? 18 : 16} aria-hidden="true" />
        {label}
      </Link>
    );
  });

  return mobile ? <>{links}</> : <nav className="space-y-1">{links}</nav>;
}
