import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { getDocGroup } from "@/lib/docs";
import { DocsHeader } from "./DocsHeader";
import { DocsSidebar } from "./DocsSidebar";

export default function DocsLayout() {
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const group = getDocGroup(pathname);

  return (
    <div className="min-h-svh bg-background text-foreground">
      <DocsHeader
        section={group?.title}
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen((open) => !open)}
      />
      <div className="mx-auto grid max-w-[1440px] lg:grid-cols-[264px_minmax(0,1fr)]">
        <DocsSidebar open={menuOpen} />
        <main className="min-w-0 px-6 pb-24 pt-12 md:px-12 lg:px-16 lg:pt-16">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
