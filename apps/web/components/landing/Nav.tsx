"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useHref } from "@/lib/network";
import { NetworkSwitch } from "../ui/NetworkSwitch";
import { NetworkGuard } from "./NetworkGuard";
import { Button } from "../ui/primitives";

export function Wordmark() {
  return (
    <span className="brand-wordmark inline-flex items-center gap-2 text-ink">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/fin-mark.svg" alt="" width={26} height={26} />
      <span className="rounded-sm bg-accent px-2 py-1 text-surface">SHARK</span>
      <span>&amp; CO._</span>
    </span>
  );
}

export function Nav() {
  const href = useHref();
  const pathname = usePathname();
  const links: [string, string][] = [
    ["Order", "/order"],
    ["How it works", "/#how-it-works"],
    ["For agents", "/#for-agents"],
    ["The company", "/company"],
  ];
  return (
    <header className="border-b border-line bg-bg">
      <nav aria-label="Main" className="mx-auto flex max-w-[1440px] items-center justify-between gap-6 px-[72px] py-6 max-xl:px-10">
        <Link href={href("/")} aria-label="Shark & Co. home">
          <Wordmark />
        </Link>
        <ul className="mono-label flex gap-9 whitespace-nowrap text-ink max-[1360px]:gap-5 max-[1180px]:tracking-[0.1em]">
          {links.map(([label, to]) => (
            <li key={label}>
              <Link
                href={href(to)}
                aria-current={to.startsWith("/#") ? undefined : pathname === to || pathname.startsWith(`${to}/`) ? "page" : undefined}
                className="hover:text-accent aria-[current=page]:text-accent aria-[current=page]:underline aria-[current=page]:underline-offset-4"
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-4">
          <NetworkSwitch />
          <Button href={href("/order")} arrow={false}>
            Order a job
          </Button>
        </div>
      </nav>
      <NetworkGuard />
    </header>
  );
}
