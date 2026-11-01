"use client";
import { createSharkClient, type CompanySection } from "@shark/shared";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { createMockFetch, parseScenario } from "@/mocks/scenarios";
import { API_MODE, useNetwork } from "./network";

export function useShark() {
  const { network, config } = useNetwork();
  const scenario = parseScenario(useSearchParams().get("mock"));
  const client = useMemo(
    () =>
      // API §0.3 N1: every response must state the selected network, or it is rejected.
      API_MODE === "mock"
        ? createSharkClient("http://mock", createMockFetch(network, scenario), `near:${network}`)
        : createSharkClient(config.api, undefined, `near:${network}`),
    [network, scenario, config.api],
  );
  return { network, client, key: [network, API_MODE, scenario] as const };
}

export function usePrices() {
  const { client, key } = useShark();
  return useQuery({ queryKey: ["prices", ...key], queryFn: client.prices });
}

export function useHealth() {
  const { client, key } = useShark();
  return useQuery({ queryKey: ["health", ...key], queryFn: client.health, refetchInterval: 60_000, retry: false });
}

export function useCompany() {
  const { client, key } = useShark();
  return useQuery({ queryKey: ["company", ...key], queryFn: client.company, refetchInterval: 30_000 });
}

/**
 * FR-84: anything not read from this deployment's live contract says Sample.
 * Mock mode is always Sample; live mode follows the per-section flag (API §0).
 */
export function isSample(sample: Partial<Record<CompanySection, boolean>> | undefined, section: CompanySection) {
  return API_MODE === "mock" || sample?.[section] !== false;
}
