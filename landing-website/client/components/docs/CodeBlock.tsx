export function CodeBlock({
  title,
  source,
}: {
  title: string;
  source: string;
}) {
  return (
    <figure className="mt-8 overflow-hidden rounded-md border border-border bg-surface">
      <figcaption className="border-b border-border px-4 py-2.5 text-xs text-subtle">
        {title}
      </figcaption>
      <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-relaxed text-foreground">
        <code>{source}</code>
      </pre>
    </figure>
  );
}
