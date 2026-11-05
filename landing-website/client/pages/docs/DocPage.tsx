import { Link } from "react-router-dom";
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { CodeBlock } from "@/components/docs/CodeBlock";
import { DocsTableOfContents } from "@/components/docs/DocsTableOfContents";
import {
  getAdjacentDocPages,
  getDocGroup,
  type DocCallout,
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

function CalloutBox({ callout }: { callout: DocCallout }) {
  const styles = {
    info: {
      border: "border-blue-500/30 bg-blue-500/5 text-blue-200",
      icon: <Info className="size-4 shrink-0 text-blue-400" />,
      defaultTitle: "Note",
    },
    note: {
      border: "border-border bg-surface/80 text-foreground",
      icon: <Info className="size-4 shrink-0 text-subtle" />,
      defaultTitle: "Note",
    },
    warning: {
      border: "border-amber-500/30 bg-amber-500/5 text-amber-200",
      icon: <AlertTriangle className="size-4 shrink-0 text-amber-400" />,
      defaultTitle: "Important",
    },
    tip: {
      border: "border-emerald-500/30 bg-emerald-500/5 text-emerald-200",
      icon: <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />,
      defaultTitle: "Tip",
    },
  }[callout.type];

  return (
    <div
      className={`mt-6 rounded-md border p-4 text-sm leading-relaxed ${styles.border}`}
    >
      <div className="flex items-start gap-3">
        {styles.icon}
        <div className="space-y-1">
          <p className="font-medium text-foreground">
            {callout.title || styles.defaultTitle}
          </p>
          <p className="text-muted-foreground">{callout.text}</p>
        </div>
      </div>
    </div>
  );
}

function DocSectionView({ section }: { section: DocSection }) {
  return (
    <section id={section.id} className="scroll-mt-24 pt-14">
      <h2 className="text-2xl font-medium tracking-[-0.02em] text-foreground">
        {section.title}
      </h2>
      {section.body.map((paragraph, index) => (
        <p
          key={index}
          className="mt-4 leading-relaxed text-muted-foreground"
        >
          {paragraph}
        </p>
      ))}

      {section.callout && <CalloutBox callout={section.callout} />}

      {section.table && (
        <div className="mt-6 overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-surface text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <tr>
                {section.table.headers.map((header, i) => (
                  <th key={i} className="px-4 py-3">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {section.table.rows.map((row, rIdx) => (
                <tr
                  key={rIdx}
                  className="transition-colors hover:bg-surface/50"
                >
                  {row.map((cell, cIdx) => (
                    <td
                      key={cIdx}
                      className="px-4 py-3 align-top text-muted-foreground"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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

      {section.codes &&
        section.codes.map((c, i) => (
          <CodeBlock key={i} title={c.title} source={c.source} />
        ))}
    </section>
  );
}
