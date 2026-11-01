import { Auction } from "@/components/landing/Auction";
import { Cta, Footer } from "@/components/landing/CtaFooter";
import { ForAgents } from "@/components/landing/ForAgents";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Ledger } from "@/components/landing/Ledger";
import { Nav } from "@/components/landing/Nav";
import { Rules } from "@/components/landing/Rules";
import { WhatWeDo } from "@/components/landing/WhatWeDo";

// Landing v2.0 (Figma 149:3998): the 9 slots of D-169.
export default function Landing() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <WhatWeDo />
        <HowItWorks />
        <Rules />
        <Auction />
        <ForAgents />
        <Ledger />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
