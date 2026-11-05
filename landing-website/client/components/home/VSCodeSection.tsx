import { Eyebrow } from "@/components/common/Eyebrow";
import { Reveal } from "@/components/common/Reveal";
import { VSCodeIntegration3D } from "../../../undrift-vscode-illustration/src";

export function VSCodeSection() {
  return (
    <section
      id="vscode"
      aria-labelledby="vscode-title"
      className="border-t border-border snap-start md:flex md:min-h-[100svh] md:items-center"
    >
      <div className="mx-auto grid w-full max-w-[1440px] items-center gap-10 px-4 sm:px-6 md:px-12 lg:grid-cols-[42fr_58fr] lg:gap-14 lg:px-16 xl:gap-16 py-16 md:py-24 lg:py-32">
        <Reveal className="flex flex-col justify-center">
          <Eyebrow>VISUAL STUDIO CODE</Eyebrow>
          <h2
            id="vscode-title"
            className="mt-6 text-balance text-3xl font-medium leading-[1.1] tracking-[-0.03em] text-foreground sm:text-4xl md:text-5xl"
          >
            Understand API drift without leaving your workflow.
          </h2>
          <p className="mt-6 max-w-md text-pretty text-base leading-relaxed text-muted-foreground">
            UNDRIFT brings API contract analysis into Visual Studio Code, making
            mismatches easier to discover and investigate.
          </p>
        </Reveal>

        <Reveal delay={0.1} className="w-full">
          <div className="relative w-full">
            <VSCodeIntegration3D />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
