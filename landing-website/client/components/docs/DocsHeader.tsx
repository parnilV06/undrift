import { Link } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { LogoMark, Wordmark } from "@/components/brand/LogoMark";
import { siteConfig } from "@/lib/site-config";

export function DocsHeader({
  section,
  menuOpen,
  onToggleMenu,
}: {
  section?: string;
  menuOpen: boolean;
  onToggleMenu: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 h-14 border-b border-border bg-background/90 backdrop-blur-md">
      <div className="flex h-full items-center gap-4 px-4 md:px-6">
        <button
          type="button"
          onClick={onToggleMenu}
          aria-expanded={menuOpen}
          aria-controls="docs-sidebar"
          aria-label={
            menuOpen ? "Close documentation menu" : "Open documentation menu"
          }
          className="-ml-2 flex size-10 items-center justify-center text-foreground lg:hidden"
        >
          {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>

        <Link
          to="/"
          aria-label="UNDRIFT home"
          className="flex items-center gap-2.5 sm:gap-3"
        >
          <span className="block size-8 shrink-0 text-foreground">
            <LogoMark />
          </span>
          <Wordmark className="text-sm font-medium leading-none tracking-[0.24em] sm:text-[15px]" />
        </Link>

        <span className="hidden h-4 w-px bg-border sm:block" />

        <p className="hidden truncate text-sm text-muted-foreground sm:block">
          Documentation
          {section && (
            <>
              <span className="mx-2 text-subtle">/</span>
              <span className="text-foreground">{section}</span>
            </>
          )}
        </p>

        <div className="ml-auto flex items-center gap-6 text-sm text-muted-foreground">
          <Link
            to="/"
            className="transition-colors duration-300 hover:text-foreground"
          >
            Home
          </Link>
          <a
            href={siteConfig.githubUrl}
            target="_blank"
            rel="noreferrer"
            className="transition-colors duration-300 hover:text-foreground"
          >
            GitHub
          </a>
        </div>
      </div>
    </header>
  );
}
