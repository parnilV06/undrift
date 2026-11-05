import { Link } from "react-router-dom";
import { Reveal } from "@/components/common/Reveal";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/lib/site-config";

export function FinalCTA() {
  return (
    <section
      aria-labelledby="cta-title"
      className="relative isolate overflow-hidden border-t border-border snap-start md:flex md:min-h-[100svh] md:items-center"
    >
      <svg
        viewBox="0 0 1440 640"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 size-full"
      >
        <g
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          vectorEffect="non-scaling-stroke"
        >
          <path
            vectorEffect="non-scaling-stroke"
            d="M-40 480 C 360 300, 1080 660, 1480 260"
          />
          <path
            vectorEffect="non-scaling-stroke"
            d="M-40 540 C 380 360, 1060 720, 1480 340"
          />
          <path
            vectorEffect="non-scaling-stroke"
            d="M-40 600 C 400 420, 1040 780, 1480 420"
          />
        </g>
      </svg>

      <div className="mx-auto flex w-full max-w-[900px] flex-col items-center px-6 py-20 text-center md:py-28 lg:py-36">
        <Reveal className="flex flex-col items-center">
          <h2
            id="cta-title"
            className="text-balance text-4xl font-medium leading-[1.04] tracking-[-0.035em] text-foreground md:text-6xl"
          >
            Keep your APIs in sync with UNDRIFT.
          </h2>
          <p className="mt-6 text-base text-muted-foreground md:text-lg">
            Open source. Free to use. Built for developers.
          </p>
          <div className="mt-12 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <a
                href={siteConfig.extensionUrl}
                target="_blank"
                rel="noreferrer"
              >
                Get the VS Code Extension
              </a>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link to="/docs">Read the Documentation</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <a href={siteConfig.githubUrl} target="_blank" rel="noreferrer">
                View on GitHub
              </a>
            </Button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
