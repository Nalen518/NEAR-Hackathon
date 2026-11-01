import { Suspense } from "react";
import { CompanyDashboard, CompanyMeta } from "@/components/company/Company";
import { Footer } from "@/components/landing/CtaFooter";
import { Nav } from "@/components/landing/Nav";
import { Section } from "@/components/ui/primitives";

export const metadata = { title: "The company · Shark & Co." };

export default function CompanyPage() {
  return (
    <>
      <Nav />
      <main className="pb-24">
        <Suspense>
          <Section className="flex items-end justify-between gap-6 pt-14 pb-8 max-xl:flex-col max-xl:items-start">
            <div className="flex max-w-[720px] flex-col gap-3">
              <p className="hand-eyebrow text-accent">the company, out in the open</p>
              <h1 className="display-xl text-ink">THE COMPANY</h1>
              <p className="mono-lede text-muted">Every price Shark quoted, every worker it hired, every review and payout. Read straight from the contract.</p>
            </div>
            <CompanyMeta />
          </Section>
          <Section>
            <CompanyDashboard />
          </Section>
        </Suspense>
      </main>
      <Footer />
    </>
  );
}
