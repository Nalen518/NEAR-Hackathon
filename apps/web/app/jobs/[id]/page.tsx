import { Suspense } from "react";
import { Footer } from "@/components/landing/CtaFooter";
import { Nav } from "@/components/landing/Nav";
import { JobView } from "@/components/job/JobView";

export const metadata = { title: "Job · Shark & Co." };

type Params = Promise<{ id: string }>;

// The job id is URL data, so it is read inside <Suspense> (Next 16 Cache Components: the shell stays instant).
export default function JobPage({ params }: { params: Params }) {
  return (
    <>
      <Nav />
      <main>
        <Suspense>
          <Job params={params} />
        </Suspense>
      </main>
      <Footer />
    </>
  );
}

async function Job({ params }: { params: Params }) {
  const { id } = await params;
  return <JobView orderId={id} />;
}
