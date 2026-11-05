import { Link } from "react-router-dom";
import { CodeBlock } from "@/components/docs/CodeBlock";
import { DocsTableOfContents } from "@/components/docs/DocsTableOfContents";
import {
  getAdjacentDocPages,
  getDocGroup,
  type DocPageDef,
  type DocSection,
} from "@/lib/docs";

export default function DocPage({ page }: { page: DocPageDef }) {
  const group = getDocGroup(page.path);
  const { previous, next } = getAdjacentDocPages(page.path);

  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_200px] xl:gap-16">
      <article className="min-w-0 max-w-[720px]">
        <nav
          aria-label="Breadcrumb"
          className="flex flex-wrap items-center gap-2 text-sm text-subtle"
        >
          <Link
            to="/docs"
            className="transition-colors duration-300 hover:text-foreground"
          >
            Docs
          </Link>
          <span>/</span>
          <span>{group?.title}</span>
          <span>/</span>
          <span aria-current="page" className="text-muted-foreground">
            {page.title}
          </span>
        </nav>

        <h1 className="mt-6 text-4xl font-medium tracking-[-0.03em] text-foreground md:text-5xl">
          {page.title}
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
          {page.description}
        </p>

        {page.sections ? (
          page.sections.map((section) => (
            <DocSectionView key={section.id} section={section} />
          ))
        ) : (
          <div className="mt-14 border border-dashed border-border p-6">
            <p className="text-sm font-medium text-foreground">
              Placeholder page
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              This page is part of the documentation structure, but its content
              has not been written or verified yet. Keep prompting to fill in
              this page when you are ready.
            </p>
          </div>
        )}

        <nav
          aria-label="Pagination"
          className="mt-20 grid gap-4 border-t border-border pt-8 sm:grid-cols-2"
        >
          {previous ? (
            <Link to={previous.path} className="group">
              <span className="text-xs uppercase tracking-[0.18em] text-subtle">
                Previous
              </span>
              <span className="mt-2 block text-foreground transition-colors duration-300 group-hover:text-muted-foreground">
                {previous.title}
              </span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link to={next.path} className="group sm:text-right">
              <span className="text-xs uppercase tracking-[0.18em] text-subtle">
                Next
              </span>
              <span className="mt-2 block text-foreground transition-colors duration-300 group-hover:text-muted-foreground">
                {next.title}
              </span>
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </article>

      {page.sections && <DocsTableOfContents sections={page.sections} />}
    </div>
  );
}

function DocSectionView({ section }: { section: DocSection }) {
  return (
    <section id={section.id} className="scroll-mt-24 pt-14">
      <h2 className="text-2xl font-medium tracking-[-0.02em] text-foreground">
        {section.title}
      </h2>
      {section.body.map((paragraph) => (
        <p
          key={paragraph}
          className="mt-4 leading-relaxed text-muted-foreground"
        >
          {paragraph}
        </p>
      ))}
      {section.list && (
        <ul className="mt-6 divide-y divide-border border-y border-border">
          {section.list.map((item) => (
            <li key={item.label} className="py-4">
              <p className="text-sm font-medium text-foreground">
                {item.label}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {item.text}
              </p>
            </li>
          ))}
        </ul>
      )}
      {section.code && (
        <CodeBlock title={section.code.title} source={section.code.source} />
      )}
    </section>
  );
}
