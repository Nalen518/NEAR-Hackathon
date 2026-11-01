"use client";
import { isSample, useCompany } from "@/lib/api";
import { RuleCard } from "../ui/data";
import { Play } from "../ui/motion";
import { cx, Mascot, Sample, Section, SectionHead } from "../ui/primitives";

const RULES = [
  {
    title: "Your money never touches the AI.",
    body: "Payments land in the contract. Shark only holds a small daily budget.",
  },
  {
    title: "Shark sets its price, inside the owners' band.",
    body: "Every quote has a reason. Out of band or under the floor is rejected.",
  },
  {
    title: "Workers are paid only when the work passes.",
    body: "One revision, then a refund. Disputes get a second model.",
  },
  {
    title: "Three strikes, then the cage.",
    body: "Upheld complaints and invalid briefs are strikes. At three, Shark is caged.",
  },
];

const CAGE = [
  { state: "idle", label: "0 strikes · taking orders" },
  { state: "strikes-1", label: "1 strike · one upheld complaint" },
  { state: "strikes-2", label: "2 strikes · last warning" },
  { state: "caged", label: "3 strikes · caged, orders refused" },
] as const;

export function Rules() {
  const { data, isError } = useCompany();
  const strikes = data?.strikes ?? { count: 0, threshold: 3 };
  const sample = isError || !data || isSample(data.sample, "strikes");
  const n = Math.min(strikes.count, CAGE.length - 1);
  return (
    <Section className="pt-[72px] pb-6">
      <SectionHead
        eyebrow="// the rules the agents can't break"
        title="Humans set the limits. The contract enforces them."
        lede="Owners set the bands, the worker cap, the budgets and the strike limit. Agents decide the rest."
      />
      <div className="grid grid-cols-4 gap-6 pt-7">
        {RULES.map((r, i) => (
          <RuleCard
            key={r.title}
            n={String(i + 1).padStart(2, "0")}
            title={r.title}
            body={r.body}
          />
        ))}
      </div>
      <div className="mt-5 flex flex-col gap-5 rounded-md border border-line bg-surface px-7 py-7">
        <div className="flex items-center justify-between">
          <p className="mono-label text-muted">
            {"// "}the cage meter · live from the contract
          </p>
          <p className="mono-data flex items-center gap-3 text-ink">
            <Sample show={sample} />
            strikes {strikes.count} / {strikes.threshold} ·{" "}
            {strikes.count >= strikes.threshold ? "caged" : "cage open"}
          </p>
        </div>
        <Play>
          <ol
            className="grid grid-cols-4 gap-6"
            aria-label={`Shark has ${strikes.count} of ${strikes.threshold} strikes`}
          >
            {CAGE.map((c, i) => (
              <li
                key={c.state}
                className="flex flex-col items-center gap-3"
                aria-current={i === n ? "step" : undefined}
              >
                <Mascot
                  name="shark"
                  state={c.state}
                  size={80}
                  className={cx(
                    i === n ? "ring-2 ring-ink" : "opacity-40",
                    i <= n && i > 0 && "anim-cage",
                  )}
                  style={{ animationDelay: `${(i - 1) * 420}ms` }}
                />
                <span
                  className={cx(
                    "mono-label text-center",
                    i === n ? "text-ink" : "text-muted",
                  )}
                >
                  {c.label}
                </span>
              </li>
            ))}
          </ol>
        </Play>
      </div>
    </Section>
  );
}
