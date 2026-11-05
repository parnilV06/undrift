import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Eyebrow } from "@/components/common/Eyebrow";
import { Reveal } from "@/components/common/Reveal";

const driftTypes = [
  {
    index: "01",
    title: "Route / Endpoint Drift",
    text: "Differences between the endpoints referenced by frontend code and the routes defined by the backend.",
    to: "/docs/drift-types/route-endpoint",
  },
  {
    index: "02",
    title: "HTTP Method Drift",
    text: "Inconsistencies between the HTTP methods expected by frontend API calls and those defined by backend endpoints.",
    to: "/docs/drift-types/http-method",
  },
  {
    index: "03",
    title: "Request / Response Shape Drift",
    text: "Differences between the expected data structures and the structures exposed by API definitions.",
    to: "/docs/drift-types/request-shape",
  },
];

export function DriftTypesSection() {
  return (
    <section
      aria-labelledby="detects-title"
      className="border-t border-border snap-start md:flex md:min-h-[100svh] md:items-center"
    >
      <div className="mx-auto w-full max-w-[1200px] px-6 py-20 md:px-12 md:py-24 lg:py-32">
        <Reveal>
          <Eyebrow>WHAT UNDRIFT DETECTS</Eyebrow>
          <h2
            id="detects-title"
            className="mt-6 max-w-2xl text-balance text-3xl font-medium leading-[1.1] tracking-[-0.03em] text-foreground md:text-5xl"
          >
            The main kinds of contract drift.
          </h2>
        </Reveal>

        <div className="mt-20 grid gap-14 md:grid-cols-3 md:gap-10">
          {driftTypes.map((type, index) => (
            <Reveal key={type.index} delay={index * 0.08}>
              <article className="flex h-full flex-col border-t border-border pt-8">
                <span className="font-mono text-xs text-subtle">
                  {type.index}
                </span>
                <h3 className="mt-6 text-xl font-medium tracking-[-0.02em] text-foreground">
                  {type.title}
                </h3>
                <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
                  {type.text}
                </p>
                <Link
                  to={type.to}
                  className="group mt-auto inline-flex items-center gap-2 pt-10 text-sm text-foreground"
                >
                  Read more
                  <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
                </Link>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
