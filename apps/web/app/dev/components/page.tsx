import { notFound } from "next/navigation";
import { Gallery } from "./Gallery";

// Dev-only gallery of every component variant (prompt §3.5). Never served in production.
export default function ComponentsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Gallery />;
}
