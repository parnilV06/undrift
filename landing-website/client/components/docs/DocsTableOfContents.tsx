import type { DocSection } from "@/lib/docs";

export function DocsTableOfContents({ sections }: { sections: DocSection[] }) {
  return (
    <aside
      aria-label="On this page"
      className="sticky top-24 hidden self-start xl:block"
    >
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-subtle">
        On this page
      </p>
      <ul className="mt-5 space-y-3 border-l border-border">
        {sections.map((section) => (
          <li key={section.id}>
            <button
              type="button"
              onClick={() =>
                document
                  .getElementById(section.id)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              className="-ml-px block border-l border-transparent pl-4 text-left text-sm text-muted-foreground transition-colors duration-300 hover:text-foreground"
            >
              {section.title}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
