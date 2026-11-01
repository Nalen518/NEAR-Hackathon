import type { Metadata } from "next";
import { IBM_Plex_Mono, Patrick_Hand, Schibsted_Grotesk } from "next/font/google";
import { Suspense } from "react";
import { Providers } from "./providers";
import "./globals.css";

const schibsted = Schibsted_Grotesk({ variable: "--font-schibsted", subsets: ["latin"], weight: ["400", "600", "800"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500", "600"] });
const patrick = Patrick_Hand({ variable: "--font-patrick", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  title: "Shark & Co. · the zero employee agency",
  description: "An agency with zero employees: Shark writes the brief and the price, a worker agent does the job, Owl checks it in a TEE. Fail twice and your money comes back.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${schibsted.variable} ${plexMono.variable} ${patrick.variable}`}>
      <body>
        {/* useSearchParams (network switch) needs a Suspense boundary under Cache Components */}
        <Suspense>
          <Providers>{children}</Providers>
        </Suspense>
      </body>
    </html>
  );
}
