import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Eyebrow } from "@/components/common/Eyebrow";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname,
    );
  }, [location.pathname]);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center px-6 text-center">
      <Eyebrow>ERROR 404</Eyebrow>
      <h1 className="mt-6 text-4xl font-medium tracking-[-0.03em] text-foreground md:text-5xl">
        This page has drifted.
      </h1>
      <p className="mt-5 max-w-md text-muted-foreground">
        Nothing exists at this address. Head back to the homepage or the
        documentation.
      </p>
      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        <Button asChild>
          <Link to="/">Back to home</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/docs">Documentation</Link>
        </Button>
      </div>
    </div>
  );
};

export default NotFound;
