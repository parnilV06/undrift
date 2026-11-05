import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { AnimatedLogo } from "@/components/home/AnimatedLogo";
import { AboutSection } from "@/components/home/AboutSection";
import { BrandIntro } from "@/components/home/BrandIntro";
import { DriftTypesSection } from "@/components/home/DriftTypesSection";
import { FinalCTA } from "@/components/home/FinalCTA";
import { Footer } from "@/components/home/Footer";
import { HowItWorksSection } from "@/components/home/HowItWorksSection";
import { KineticGridHero } from "@/components/home/KineticGridHero";
import { Navbar } from "@/components/home/Navbar";
import { VSCodeSection } from "@/components/home/VSCodeSection";
import {
  useLogoTransition,
  useLogoTransitionRefs,
} from "@/components/home/useLogoTransition";

export default function Index() {
  const refs = useLogoTransitionRefs();
  useLogoTransition(refs);

  const { hash } = useLocation();
  useEffect(() => {
    if (hash)
      document
        .getElementById(hash.slice(1))
        ?.scrollIntoView({ behavior: "smooth" });
  }, [hash]);

  useEffect(() => {
    document.documentElement.classList.add("snap-proximity");
    return () => {
      document.documentElement.classList.remove("snap-proximity");
    };
  }, []);

  return (
    <div className="bg-background">
      <AnimatedLogo refs={refs} />
      <Navbar refs={refs} />
      <main>
        <BrandIntro refs={refs} />
        <KineticGridHero />
        <AboutSection />
        <DriftTypesSection />
        <HowItWorksSection />
        <VSCodeSection />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
