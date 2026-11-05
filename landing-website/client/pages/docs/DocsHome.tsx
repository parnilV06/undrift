import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";

const entries = [
  {
    title: "Getting Started",
    description: "Install UNDRIFT and run your first analysis.",
    to: "/docs/getting-started/installation",
  },
  {
    title: "Core Concepts",
    description: "The ideas behind contract drift and how matches are made.",
    to: "/docs/concepts/api-contract-drift",
  },
  {
    title: "Drift Types",
    description: "The categories of mismatch UNDRIFT reports.",
    to: "/docs/drift-types",
  },
  {
    title: "Analysis Engine",
    description: "How source code becomes comparable observations.",
    to: "/docs/analysis-engine",
  },
];

export default function DocsHome() {
  return (
    <div className="max-w-[720px]">
      <h1 className="text-4xl font-medium tracking-[-0.03em] text-foreground md:text-5xl">
        UNDRIFT Documentation
      </h1>
      <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
        Everything you need to understand, install, configure, and work with
        UNDRIFT.
      </p>

      <ul className="mt-16 border-t border-border">
        {entries.map((entry) => (
          <li key={entry.to} className="border-b border-border">
            <Link
              to={entry.to}
              className="group flex items-center justify-between gap-6 py-7"
            >
              <div>
                <h2 className="text-lg font-medium text-foreground">
                  {entry.title}
                </h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {entry.description}
                </p>
              </div>
              <ArrowUpRight className="size-5 shrink-0 text-subtle transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
