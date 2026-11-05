import { useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Eyebrow } from "@/components/common/Eyebrow";
import { SectionLink } from "@/components/common/SectionLink";
import { Button } from "@/components/ui/button";
import { useKineticGrid } from "./useKineticGrid";

export function KineticGridHero() {
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useKineticGrid(sectionRef, canvasRef);

  return (
    <section
      ref={sectionRef}
      aria-labelledby="hero-title"
      className="relative isolate flex min-h-[100svh] items-center overflow-hidden snap-start"
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="kinetic-mask pointer-events-none absolute inset-0 -z-10"
      />

      <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center px-6 py-32 text-center">
        <Eyebrow>API CONTRACT ANALYSIS</Eyebrow>
        <h2
          id="hero-title"
          className="mt-6 text-balance text-[2.75rem] font-medium leading-[1.04] tracking-[-0.035em] text-foreground sm:text-6xl lg:text-[4.5rem]"
        >
          Detect API contract drift before it breaks integrations.
        </h2>
        <p className="mt-6 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground md:text-lg">
          UNDRIFT statically analyzes frontend API usage and backend definitions
          to identify mismatches and surface actionable findings.
        </p>
        <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <SectionLink id="features">
              Explore UNDRIFT
              <ArrowRight />
            </SectionLink>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link to="/docs">Read Documentation</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
