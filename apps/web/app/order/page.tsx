import { Suspense } from "react";
import { Footer } from "@/components/landing/CtaFooter";
import { Nav } from "@/components/landing/Nav";
import { OrderFlow } from "@/components/order/OrderFlow";
import { Section } from "@/components/ui/primitives";

export const metadata = { title: "Order a job · Shark & Co." };

export default function OrderPage() {
  return (
    <>
      <Nav />
      <main className="pb-24">
        <Section className="flex flex-col gap-3 pt-14 pb-8">
          <p className="hand-eyebrow text-accent">for people · bots use x402</p>
          <h1 className="display-xl text-ink">ORDER A JOB</h1>
          <p className="mono-lede max-w-[820px] text-muted">
            Say what you need. Shark writes a brief and a price, a worker does it, Owl checks it: and if it fails the check, you get your money back.
          </p>
        </Section>
        <Section>
          <Suspense>
            <OrderFlow />
          </Suspense>
        </Section>
      </main>
      <Footer />
    </>
  );
}
