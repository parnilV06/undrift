import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";

const entries = [
  {
    title: "Getting Started",
    description: "Prerequisites, repository setup, building from source, and running your first analysis.",
    to: "/docs/getting-started/installation",
  },
  {
    title: "Core Concepts",
    description: "API contract drift, consumer and provider observations, normalization, and finding lifecycles.",
    to: "/docs/concepts/api-contract-drift",
  },
  {
    title: "Drift Types & Rules",
    description: "Complete catalog of deterministic drift rules covering routes, methods, request shapes, and response shapes.",
    to: "/docs/drift-types",
  },
  {
    title: "Analysis Engine",
    description: "The 10-step static analysis pipeline, WebAssembly Tree-sitter parsing, and relationship matching.",
    to: "/docs/analysis-engine",
  },
  {
    title: "Supported Technologies",
    description: "Supported languages, Express.js and Next.js route extractors, Fetch, and Axios client patterns.",
    to: "/docs/compatibility",
  },
  {
    title: "VS Code Extension",
    description: "Dedicated Activity Bar item, sidebar overview, editor diagnostics, and theme-aware Integration Report.",
    to: "/docs/reference/vscode-extension",
  },
  {
    title: "Configuration & Reference",
    description: "Extension settings, default exclusions, palette commands, and system architecture.",
    to: "/docs/reference/configuration",
  },
  {
    title: "Roadmap & Release Status",
    description: "Completed engineering phases, current V1 release checklist, and future AI layer scope.",
    to: "/docs/reference/roadmap",
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
