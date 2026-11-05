import { LogoMark } from "@/components/brand/LogoMark";
import type { LogoTransitionRefs } from "./useLogoTransition";

export function AnimatedLogo({ refs }: { refs: LogoTransitionRefs }) {
  return (
    <div
      ref={refs.logo}
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-[60] origin-center text-foreground opacity-0 will-change-transform"
    >
      <LogoMark />
    </div>
  );
}
