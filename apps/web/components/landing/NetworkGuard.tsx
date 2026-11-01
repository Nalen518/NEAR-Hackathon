"use client";
// API §0.3 N1: shown under the nav on every page when the API host serves the other network.
import { NetworkMismatchError } from "@shark/shared";
import { useHealth } from "@/lib/api";
import { NetworkMismatchBanner } from "../ui/feedback";
import { Section } from "../ui/primitives";

export function NetworkGuard() {
  const { error } = useHealth();
  if (!(error instanceof NetworkMismatchError)) return null;
  return (
    <Section className="pt-4">
      <NetworkMismatchBanner selected={error.expected} got={error.got} />
    </Section>
  );
}
