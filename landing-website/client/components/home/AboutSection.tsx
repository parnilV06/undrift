import { Eyebrow } from "@/components/common/Eyebrow";
import { Reveal } from "@/components/common/Reveal";
import { AboutArchitecture3D } from "../../../undrift-about-illustration/src";

export function AboutSection() {
  return (
    <section
      id="features"
      aria-labelledby="about-title"
      className="scroll-mt-16 border-t border-border snap-start md:flex md:min-h-[100svh] md:items-center"
    >
      <div className="mx-auto grid w-full max-w-[1440px] items-center gap-10 px-4 sm:px-6 md:px-12 lg:grid-cols-[2fr_3fr] lg:gap-14 lg:px-16 xl:gap-16 py-16 md:py-24 lg:py-32">
        <Reveal>
          <Eyebrow>ABOUT UNDRIFT</Eyebrow>
          <h2
            id="about-title"
            className="mt-6 text-balance text-3xl font-medium leading-[1.1] tracking-[-0.03em] text-foreground md:text-5xl"
          >
            Your frontend and backend should speak the same language.
          </h2>
          <p className="mt-6 max-w-md text-pretty text-base leading-relaxed text-muted-foreground">
            UNDRIFT compares frontend API usage with backend definitions to
            identify inconsistencies between them.
          </p>
        </Reveal>

        <Reveal delay={0.1} className="w-full">
          <div className="relative w-full overflow-visible">
            <AboutArchitecture3D />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
