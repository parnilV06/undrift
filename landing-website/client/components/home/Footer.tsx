import { LogoMark, Wordmark } from "@/components/brand/LogoMark";
import { SectionLink } from "@/components/common/SectionLink";
import { siteConfig } from "@/lib/site-config";
import { Link } from "react-router-dom";

const linkClass = "transition-colors duration-300 hover:text-foreground";

export function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-10 px-6 py-12 md:flex-row md:items-center md:justify-between md:px-12">
        <div className="flex items-center gap-3">
          <span className="block size-6 text-foreground">
            <LogoMark />
          </span>
          <Wordmark className="text-xs" />
        </div>

        <nav
          aria-label="Footer"
          className="flex flex-wrap gap-x-8 gap-y-3 text-sm text-muted-foreground"
        >
          <SectionLink id="features" className={linkClass}>
            Features
          </SectionLink>
          <Link to="/docs" className={linkClass}>
            Documentation
          </Link>
          <a
            href={siteConfig.githubUrl}
            target="_blank"
            rel="noreferrer"
            className={linkClass}
          >
            GitHub
          </a>
          <a
            href={siteConfig.extensionUrl}
            target="_blank"
            rel="noreferrer"
            className={linkClass}
          >
            VS Code Extension
          </a>
        </nav>

        <p className="text-xs text-subtle">
          © {new Date().getFullYear()} UNDRIFT
        </p>
      </div>
    </footer>
  );
}
