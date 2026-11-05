import { useState, type MouseEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { Wordmark } from "@/components/brand/LogoMark";
import { SectionLink } from "@/components/common/SectionLink";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";
import type { LogoTransitionRefs } from "./useLogoTransition";

const linkClass =
  "text-sm text-muted-foreground transition-colors duration-300 hover:text-foreground";

export function Navbar({ refs }: { refs: LogoTransitionRefs }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  const closeMenu = () => setMenuOpen(false);

  const onBrandClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (pathname !== "/") return;
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <>
      <header
        ref={refs.navBar}
        className="fixed inset-x-0 top-0 z-50 border-b border-transparent backdrop-blur-md"
      >
        <div className="mx-auto grid h-16 max-w-[1440px] grid-cols-[1fr_auto_1fr] items-center px-6 md:px-12">
          <div className="justify-self-start">
            <nav
              aria-label="Primary"
              data-nav-fade
              className="hidden items-center gap-8 md:flex"
            >
              <SectionLink id="features" className={linkClass}>
                Features
              </SectionLink>
              <Link to="/docs" className={linkClass}>
                Documentation
              </Link>
            </nav>
          </div>

          <Link
            to="/"
            onClick={onBrandClick}
            aria-label="UNDRIFT home"
            className="group flex items-center gap-2.5 sm:gap-3 justify-self-center"
          >
            <div
              ref={refs.navSlot}
              aria-hidden="true"
              className="size-9 sm:size-[38px] shrink-0"
            />
            <span data-nav-brand className="flex items-center opacity-0">
              <Wordmark className="text-[15px] sm:text-[16px] font-medium tracking-[0.24em] leading-none" />
            </span>
          </Link>

          <div className="flex items-center gap-6 justify-self-end">
            <div data-nav-fade className="hidden items-center gap-6 md:flex">
              <a
                href={siteConfig.githubUrl}
                target="_blank"
                rel="noreferrer"
                className={linkClass}
              >
                GitHub
              </a>
              <Button asChild size="sm">
                <a
                  href={siteConfig.extensionUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Get Extension
                </a>
              </Button>
            </div>

            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              className="-mr-2 flex size-10 items-center justify-center text-foreground md:hidden"
            >
              {menuOpen ? (
                <X className="size-5" />
              ) : (
                <Menu className="size-5" />
              )}
            </button>
          </div>
        </div>
      </header>

      <div
        id="mobile-menu"
        className={cn(
          "fixed inset-x-0 top-16 z-[70] flex-col gap-6 border-b border-border bg-background px-6 py-8 md:hidden",
          menuOpen ? "flex" : "hidden",
        )}
      >
        <SectionLink
          id="features"
          onClick={closeMenu}
          className="text-lg text-foreground"
        >
          Features
        </SectionLink>
        <Link
          to="/docs"
          onClick={closeMenu}
          className="text-lg text-foreground"
        >
          Documentation
        </Link>
        <a
          href={siteConfig.githubUrl}
          target="_blank"
          rel="noreferrer"
          className="text-lg text-foreground"
        >
          GitHub
        </a>
        <Button asChild className="mt-2 self-start">
          <a href={siteConfig.extensionUrl} target="_blank" rel="noreferrer">
            Get Extension
          </a>
        </Button>
      </div>
    </>
  );
}
