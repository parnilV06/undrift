import { Eyebrow } from "@/components/common/Eyebrow";
import { Reveal } from "@/components/common/Reveal";

const steps = [
  {
    index: "01",
    title: "Inspect",
    text: "Analyze relevant frontend API usage and backend API definitions.",
  },
  {
    index: "02",
    title: "Extract",
    text: "Extract route, method, and request/response shape observations.",
  },
  {
    index: "03",
    title: "Compare",
    text: "Normalize and compare the observations to identify potential contract mismatches.",
  },
  {
    index: "04",
    title: "Explain",
    text: "Present findings with explanations and source-code evidence.",
  },
];

export function HowItWorksSection() {
  return (
    <section
      aria-labelledby="how-title"
      className="border-t border-border snap-start md:flex md:min-h-[100svh] md:items-center"
    >
      <div className="mx-auto w-full max-w-[1200px] px-6 py-20 md:px-12 md:py-24 lg:py-32">
        <Reveal>
          <Eyebrow>HOW IT WORKS</Eyebrow>
          <h2
            id="how-title"
            className="mt-6 max-w-2xl text-balance text-3xl font-medium leading-[1.1] tracking-[-0.03em] text-foreground md:text-5xl"
          >
            From source code to explained findings.
          </h2>
        </Reveal>

        <div className="relative mt-20">
          <span
            aria-hidden="true"
            className="absolute left-0 right-0 top-[5px] hidden h-px bg-border md:block"
          />
          <ol className="grid gap-14 md:grid-cols-4 md:gap-8">
            {steps.map((step, index) => (
              <li key={step.index} className="relative">
                <Reveal delay={index * 0.08}>
                  <span
                    aria-hidden="true"
                    className="block size-[11px] rounded-full border border-foreground bg-background"
                  />
                  <p className="mt-10 font-mono text-xs text-subtle">
                    {step.index}
                  </p>
                  <h3 className="mt-3 text-xl font-medium tracking-[-0.02em] text-foreground">
                    {step.title}
                  </h3>
                  <p className="mt-3 max-w-xs text-pretty leading-relaxed text-muted-foreground">
                    {step.text}
                  </p>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
