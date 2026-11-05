import { createRef, useEffect, useState, type RefObject } from "react";

export interface LogoTransitionRefs {
  logo: RefObject<HTMLDivElement>;
  introSlot: RefObject<HTMLDivElement>;
  introCopy: RefObject<HTMLDivElement>;
  navSlot: RefObject<HTMLDivElement>;
  navBar: RefObject<HTMLElement>;
}

interface Geometry {
  introX: number;
  introY: number;
  navX: number;
  navY: number;
  introWidth: number;
  introHeight: number;
  navSize: number;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const easeInOut = (t: number) => t * t * (3 - 2 * t);

export function useLogoTransitionRefs(): LogoTransitionRefs {
  const [refs] = useState<LogoTransitionRefs>(() => ({
    logo: createRef<HTMLDivElement>(),
    introSlot: createRef<HTMLDivElement>(),
    introCopy: createRef<HTMLDivElement>(),
    navSlot: createRef<HTMLDivElement>(),
    navBar: createRef<HTMLElement>(),
  }));
  return refs;
}

export function useLogoTransition(refs: LogoTransitionRefs) {
  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let geometry: Geometry | null = null;
    let frame = 0;

    const update = () => {
      frame = 0;
      const logo = refs.logo.current;
      const copy = refs.introCopy.current;
      const bar = refs.navBar.current;
      if (!geometry || !logo) return;

      const scrollY = window.scrollY;
      const range = Math.max(window.innerHeight * 0.6, 320);
      const linear = clamp(scrollY / range);
      const progress = reduceMotion.matches
        ? linear >= 0.5
          ? 1
          : 0
        : easeInOut(linear);

      const { introX, introY, navX, navY, introWidth, introHeight, navSize } =
        geometry;

      // Current position of intro slot center in viewport coordinates
      const currentIntroY = introY - scrollY;

      // Smoothly interpolate center position from intro slot to navbar slot
      const currentCenterX = introX + (navX - introX) * progress;
      const currentCenterY = currentIntroY + (navY - currentIntroY) * progress;

      // Smoothly scale down from 1.0 (hero size) to targetScale (navbar size)
      // Scaling DOWN from high native resolution prevents GPU texture blur and pixelation
      const targetScale = navSize / introWidth;
      const scale = 1.0 + (targetScale - 1.0) * progress;

      // Offset from origin (0, 0) since element has fixed left:0 top:0 and origin: center
      const dx = currentCenterX - introWidth / 2;
      const dy = currentCenterY - introHeight / 2;

      logo.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(${scale})`;
      logo.style.opacity = "1";

      if (copy) {
        copy.style.opacity = String(1 - clamp(linear / 0.6));
      }

      if (bar) {
        const links = clamp((linear - 0.45) / 0.55);
        bar
          .querySelectorAll<HTMLElement>("[data-nav-fade]")
          .forEach((element) => {
            element.style.opacity = String(links);
            element.style.visibility = links > 0 ? "visible" : "hidden";
          });

        const brand = clamp((linear - 0.55) / 0.45);
        bar
          .querySelectorAll<HTMLElement>("[data-nav-brand]")
          .forEach((element) => {
            element.style.opacity = String(brand);
          });

        const surface = clamp((linear - 0.85) / 0.15);
        bar.style.backgroundColor = `rgba(5, 5, 5, ${0.94 * surface})`;
        bar.style.borderBottomColor = `rgba(255, 255, 255, ${0.1 * surface})`;
      }
    };

    const measure = () => {
      const logo = refs.logo.current;
      const intro = refs.introSlot.current;
      const nav = refs.navSlot.current;
      if (!logo || !intro || !nav) return;

      const introRect = intro.getBoundingClientRect();
      const navRect = nav.getBoundingClientRect();
      if (introRect.width === 0 || navRect.width === 0) return;

      geometry = {
        introX: introRect.left + introRect.width / 2,
        introY: introRect.top + window.scrollY + introRect.height / 2,
        navX: navRect.left + navRect.width / 2,
        navY: navRect.top + navRect.height / 2,
        introWidth: introRect.width,
        introHeight: introRect.height,
        navSize: navRect.width,
      };

      // Set base element dimensions to the full hero size
      // so it rasterizes at native high resolution on desktop and mobile.
      logo.style.width = `${introRect.width}px`;
      logo.style.height = `${introRect.height}px`;
      update();
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measure);
    document.fonts?.ready.then(measure);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", measure);
    };
  }, [refs]);
}
