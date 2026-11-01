import { Suspense } from "react";
import { Footer } from "@/components/landing/CtaFooter";
import { Nav } from "@/components/landing/Nav";
import { JobView } from "@/components/job/JobView";

export const metadata = { title: "Job · Shark & Co." };

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <Nav />
      <main>
        <Suspense>
          <JobView orderId={id} />
        </Suspense>
      </main>
      <Footer />
    </>
  );
}
