import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

export function SectionLink({
  id,
  className,
  onClick,
  children,
}: {
  id: string;
  className?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  const { pathname } = useLocation();

  return (
    <Link
      to={`/#${id}`}
      className={className}
      onClick={(event) => {
        onClick?.();
        if (pathname !== "/") return;
        event.preventDefault();
        document
          .getElementById(id)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
    >
      {children}
    </Link>
  );
}
