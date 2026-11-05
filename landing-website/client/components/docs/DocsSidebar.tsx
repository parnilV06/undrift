import { useState, type FormEvent } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { ChevronDown, Search } from "lucide-react";
import { docGroups, docPages, type DocGroup } from "@/lib/docs";
import { cn } from "@/lib/utils";

export function DocsSidebar({ open }: { open: boolean }) {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const normalized = query.trim().toLowerCase();
  const matches = normalized
    ? docPages.filter((page) =>
        `${page.title} ${page.description}`.toLowerCase().includes(normalized),
      )
    : [];

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!matches[0]) return;
    navigate(matches[0].path);
    setQuery("");
  };

  return (
    <aside
      id="docs-sidebar"
      className={cn(
        "border-b border-border lg:sticky lg:top-14 lg:h-[calc(100svh-3.5rem)] lg:overflow-y-auto lg:border-b-0 lg:border-r",
        open ? "block" : "hidden lg:block",
      )}
    >
      <div className="px-5 py-6 lg:px-6 lg:py-8">
        <form onSubmit={onSubmit} role="search">
          <label className="relative block">
            <span className="sr-only">Search documentation</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search documentation"
              className="h-10 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm text-foreground placeholder:text-subtle focus:border-highlight focus:outline-none"
            />
          </label>
        </form>

        <nav aria-label="Documentation" className="mt-8">
          {normalized ? (
            matches.length > 0 ? (
              <ul className="space-y-1">
                {matches.map((page) => (
                  <li key={page.path}>
                    <NavLink
                      to={page.path}
                      className="block py-1.5 text-sm text-muted-foreground transition-colors duration-300 hover:text-foreground"
                    >
                      {page.title}
                    </NavLink>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-subtle">No matching pages.</p>
            )
          ) : (
            docGroups.map((group) => <DocsGroup key={group.id} group={group} />)
          )}
        </nav>
      </div>
    </aside>
  );
}

function DocsGroup({ group }: { group: DocGroup }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="mb-7">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-subtle transition-colors duration-300 hover:text-muted-foreground"
      >
        {group.title}
        <ChevronDown
          className={cn(
            "size-3.5 transition-transform duration-300",
            !expanded && "-rotate-90",
          )}
        />
      </button>
      {expanded && (
        <ul className="mt-2 border-l border-border">
          {group.pages.map((page) => (
            <li key={page.path}>
              <NavLink
                to={page.path}
                end
                className={({ isActive }) =>
                  cn(
                    "-ml-px block border-l py-1.5 pl-4 text-sm transition-colors duration-300",
                    isActive
                      ? "border-foreground text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )
                }
              >
                {page.title}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
