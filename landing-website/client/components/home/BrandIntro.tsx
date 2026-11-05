import { Eyebrow } from "@/components/common/Eyebrow";
import { Wordmark } from "@/components/brand/LogoMark";
import type { LogoTransitionRefs } from "./useLogoTransition";

export function BrandIntro({ refs }: { refs: LogoTransitionRefs }) {
  return (
    <section
      aria-labelledby="intro-title"
      className="relative h-[100svh] min-h-[620px] overflow-hidden snap-start"
    >
      <div
        ref={refs.introCopy}
        className="relative mx-auto flex h-full max-w-[1440px] flex-col justify-center px-6 md:grid md:grid-cols-[1fr_auto_1fr] md:items-center md:gap-10 md:px-12 lg:px-16"
      >
        <div className="absolute left-6 top-20 sm:top-24 md:static md:justify-self-start">
          <div className="flex max-w-[280px] flex-col gap-5 md:gap-6">
            <Wordmark className="text-xl sm:text-2xl md:text-[clamp(1.75rem,2.4vw,2.5rem)] font-semibold tracking-[0.24em] leading-none" />
            <span className="h-px w-12 bg-highlight" />
            <p className="hidden text-sm leading-relaxed text-subtle md:block">
              Open source developer tool
              <br />
              Visual Studio Code extension
            </p>
          </div>
        </div>

        <div
          ref={refs.introSlot}
          aria-hidden="true"
          className="mx-auto size-[min(62vw,34svh,320px)] md:size-[min(44svh,30vw,440px)]"
        />

        <div className="mt-12 text-center md:mt-0 md:justify-self-start md:text-left">
          <Eyebrow>API CONTRACT INTELLIGENCE</Eyebrow>
          <h1
            id="intro-title"
            className="mt-6 max-w-md text-balance text-3xl font-medium leading-[1.08] tracking-[-0.035em] text-foreground md:text-[2.75rem] lg:text-5xl"
          >
            Keep your frontend and backend in sync.
          </h1>
          <p className="mx-auto mt-6 max-w-sm text-pretty text-base leading-relaxed text-muted-foreground md:mx-0">
            Static analysis for detecting API contract mismatches across your
            codebase.
          </p>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-8 flex flex-col items-center gap-3">
        <span className="h-10 w-px bg-highlight" />
        <span className="text-[11px] uppercase tracking-[0.22em] text-subtle">
          Scroll
        </span>
      </div>
    </section>
  );
}
