"use client";
// OrderForm (Figma 136:3143): job type tabs, instructions, source (URL / upload / text), optional params, payer.
// Everything typed here is untrusted data: it is only ever sent as JSON and shown as plain text.
import type { JobType, OrderRequest, UploadResult } from "@shark/shared";
import { useState, type ReactNode } from "react";
import { cx } from "../ui/primitives";

export type SourceKind = "url" | "upload" | "text";
type Field = { name: string; type: "string" | "number" | "date" | "url"; required: boolean };
export type FormState = {
  jobType: JobType;
  instructions: string;
  source: SourceKind;
  url: string;
  text: string;
  upload: (UploadResult & { name: string }) | null;
  maxWords: string;
  mustMention: string[];
  format: "paragraph" | "bullets";
  posts: string;
  mustInclude: string[];
  tone: "neutral" | "friendly" | "bold";
  fields: Field[];
  many: boolean;
  payer: string;
  referrer: string;
};

export const EMPTY_FORM: FormState = {
  jobType: "summary",
  instructions: "",
  source: "url",
  url: "",
  text: "",
  upload: null,
  maxWords: "",
  mustMention: [],
  format: "paragraph",
  posts: "",
  mustInclude: [],
  tone: "neutral",
  fields: [{ name: "", type: "string", required: true }],
  many: true,
  payer: "",
  referrer: "",
};

const PLACEHOLDER: Record<JobType, string> = {
  extract: "Get the name, price and release date of every product on this page.",
  summary: "Summarise this article in 150 words or fewer. Mention NEAR Intents and fees.",
  thread: "Write a 5 post X thread for @example_brand about our launch. Friendly tone. Include the launch link and #NEAR.",
};

/** Form → POST /v1/orders body (§1.2, params per §4.1). Only filled params are sent; Shark fills the rest. */
export function toRequest(f: FormState): OrderRequest {
  const input = f.source === "url" ? (f.url.trim() ? { url: f.url.trim() } : undefined) : f.source === "text" ? (f.text.trim() ? { text: f.text } : undefined) : f.upload ? { fileId: f.upload.fileId } : undefined;
  const params =
    f.jobType === "summary"
      ? { ...(f.maxWords ? { maxWords: Number(f.maxWords) } : {}), ...(f.mustMention.length ? { mustMention: f.mustMention } : {}), format: f.format }
      : f.jobType === "thread"
        ? { ...(f.posts ? { posts: Number(f.posts) } : {}), ...(f.mustInclude.length ? { mustInclude: f.mustInclude } : {}), tone: f.tone }
        : f.fields.some((x) => x.name.trim())
          ? { schema: { fields: f.fields.filter((x) => x.name.trim()).map((x) => ({ ...x, name: x.name.trim() })) }, many: f.many }
          : undefined;
  return {
    jobType: f.jobType,
    instructions: f.instructions,
    ...(input ? { input } : {}),
    ...(params ? { params } : {}),
    payer: f.payer.trim(),
    ...(f.referrer.trim() ? { referrer: f.referrer.trim() } : {}),
  };
}

/** A priced fix from Shark (`details.fixes[].params`, API §4.1 shapes) → the form fields it changes. */
export function fromParams(p: Record<string, unknown>): Partial<FormState> {
  const out: Partial<FormState> = {};
  if (typeof p.maxWords === "number") out.maxWords = String(p.maxWords);
  if (Array.isArray(p.mustMention)) out.mustMention = p.mustMention.map(String);
  if (typeof p.posts === "number") out.posts = String(p.posts);
  if (Array.isArray(p.mustInclude)) out.mustInclude = p.mustInclude.map(String);
  return out;
}

export function canSubmit(f: FormState) {
  const hasSource = f.jobType === "thread" || (f.source === "url" ? !!f.url.trim() : f.source === "text" ? !!f.text.trim() : !!f.upload);
  return !!f.instructions.trim() && hasSource && !!f.payer.trim();
}

function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mono-label text-ink">
      {children}
    </label>
  );
}
const input = "body-default w-full rounded-md border border-line-strong bg-surface px-4 py-3 text-ink outline-none placeholder:text-faint focus:border-accent";
const hint = "mono-small text-muted";

function Segmented<T extends string>({ value, options, onChange, label, size = "md" }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string; size?: "md" | "sm" }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex w-fit gap-1 rounded-pill bg-surface-2 p-1">
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={v === value}
          onClick={() => onChange(v)}
          className={cx("rounded-pill px-3 py-1", size === "md" ? "mono-chip" : "mono-small", v === value ? "border border-ink bg-surface text-ink" : "border border-transparent text-muted hover:text-ink")}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function Tags({ values, onChange, label, add }: { values: string[]; onChange: (v: string[]) => void; label: string; add: string }) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const v = draft.trim();
    if (v && !values.includes(v) && values.length < 5) onChange([...values, v]);
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {values.map((v) => (
        <span key={v} className="mono-small inline-flex items-center gap-1 rounded-pill border border-line-strong bg-surface px-3 py-1 text-ink">
          {v}
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="text-muted hover:text-ink">
            ×
          </button>
        </span>
      ))}
      {values.length < 5 && (
        <input
          aria-label={label}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit();
            }
          }}
          onBlur={commit}
          placeholder={add}
          className="mono-small w-36 bg-transparent text-accent outline-none placeholder:text-accent"
        />
      )}
    </div>
  );
}

export function OrderForm({
  form,
  set,
  onSubmit,
  onUpload,
  uploading,
  errors,
  busy,
}: {
  form: FormState;
  set: (patch: Partial<FormState>) => void;
  onSubmit: () => void;
  onUpload: (file: File) => void;
  uploading: boolean;
  errors: Partial<Record<"instructions" | "source" | "payer" | "referrer" | "form", string>>;
  busy: boolean;
}) {
  const f = form;
  const ready = canSubmit(f);
  const err = (k: keyof typeof errors) =>
    errors[k] ? (
      <p className="mono-small text-ink" role="alert">
        {errors[k]} Nothing was charged.
      </p>
    ) : null;
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !busy) onSubmit();
      }}
    >
      <Segmented
        label="Job type"
        value={f.jobType}
        onChange={(jobType) => set({ jobType })}
        options={[
          ["extract", "extract"],
          ["summary", "summary"],
          ["thread", "thread"],
        ]}
      />
      <div className="flex flex-col gap-2">
        <Label htmlFor="instructions">Instructions</Label>
        <textarea id="instructions" maxLength={2000} rows={3} value={f.instructions} onChange={(e) => set({ instructions: e.target.value })} placeholder={PLACEHOLDER[f.jobType]} className={cx(input, "resize-none")} />
        <p className={hint}>Up to 2 000 characters. Treated as data, never as commands.</p>
        {err("instructions")}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="source">{f.jobType === "thread" ? "Source · optional" : "Source"}</Label>
          <Segmented
            size="sm"
            label="Source type"
            value={f.source}
            onChange={(source) => set({ source })}
            options={[
              ["url", "URL"],
              ["upload", "Upload"],
              ["text", "Paste text"],
            ]}
          />
        </div>
        {f.source === "url" && <input id="source" type="url" inputMode="url" value={f.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://example.com/blog/intents-explained" className={input} />}
        {f.source === "text" && <textarea id="source" rows={4} value={f.text} onChange={(e) => set({ text: e.target.value })} placeholder="Paste the text Shark should work from." className={cx(input, "resize-none")} />}
        {f.source === "upload" && (
          <div className="flex items-center gap-3 rounded-md border border-dashed border-line-strong bg-surface px-4 py-3">
            <input
              id="source"
              type="file"
              accept=".pdf,.html,.htm,.txt,.md,application/pdf,text/html,text/plain,text/markdown"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUpload(file);
              }}
              className="mono-small text-muted file:mr-3 file:rounded-pill file:border file:border-ink file:bg-surface file:px-3 file:py-1 file:text-ink"
            />
            <span className="mono-small text-muted" aria-live="polite">
              {uploading ? "Uploading…" : f.upload ? `${f.upload.name} · ${f.upload.pages} pages · ${f.upload.words.toLocaleString("en").replace(/,/g, " ")} words` : ""}
            </span>
          </div>
        )}
        <p className={hint}>PDF, HTML, TXT or MD up to 2 MB, 20 pages or 40 000 words. Shark saves one snapshot.</p>
        {err("source")}
      </div>

      <fieldset className="flex flex-col gap-3 rounded-md bg-surface-2 px-4 py-3">
        <legend className="mono-label float-left pb-1 text-muted">Optional · Shark fills in the rest</legend>
        {f.jobType === "summary" && (
          <>
            <Row label="Word limit" htmlFor="maxWords">
              <input id="maxWords" type="number" min={30} max={500} value={f.maxWords} onChange={(e) => set({ maxWords: e.target.value })} placeholder="none" className="mono-data w-24 rounded-md border border-line-strong bg-surface px-3 py-1 text-ink" />
            </Row>
            <Row label="Must mention">
              <Tags label="Add a phrase" add="+ add a phrase" values={f.mustMention} onChange={(mustMention) => set({ mustMention })} />
            </Row>
            <Row label="Format">
              <Segmented size="sm" label="Format" value={f.format} onChange={(format) => set({ format })} options={[["paragraph", "Paragraph"], ["bullets", "Bullets"]]} />
            </Row>
          </>
        )}
        {f.jobType === "thread" && (
          <>
            <Row label="Posts" htmlFor="posts">
              <input id="posts" type="number" min={2} max={10} value={f.posts} onChange={(e) => set({ posts: e.target.value })} placeholder="5" className="mono-data w-24 rounded-md border border-line-strong bg-surface px-3 py-1 text-ink" />
            </Row>
            <Row label="Must include">
              <Tags label="Add a link or tag" add="+ add" values={f.mustInclude} onChange={(mustInclude) => set({ mustInclude })} />
            </Row>
            <Row label="Tone">
              <Segmented size="sm" label="Tone" value={f.tone} onChange={(tone) => set({ tone })} options={[["neutral", "Neutral"], ["friendly", "Friendly"], ["bold", "Bold"]]} />
            </Row>
          </>
        )}
        {f.jobType === "extract" && (
          <>
            <div className="mono-label grid grid-cols-[1fr_120px_90px_24px] gap-2 text-muted">
              <span>Field</span>
              <span>Type</span>
              <span>Required</span>
              <span />
            </div>
            {f.fields.map((x, i) => {
              const upd = (p: Partial<Field>) => set({ fields: f.fields.map((y, j) => (j === i ? { ...y, ...p } : y)) });
              return (
                <div key={i} className="grid grid-cols-[1fr_120px_90px_24px] items-center gap-2">
                  <input aria-label={`Field ${i + 1} name`} value={x.name} onChange={(e) => upd({ name: e.target.value })} placeholder="name" className="mono-data rounded-md border border-line-strong bg-surface px-3 py-1.5 text-ink" />
                  <select aria-label={`Field ${i + 1} type`} value={x.type} onChange={(e) => upd({ type: e.target.value as Field["type"] })} className="mono-data rounded-md border border-line-strong bg-surface px-2 py-1.5 text-ink">
                    {["string", "number", "date", "url"].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                  <select aria-label={`Field ${i + 1} required`} value={x.required ? "yes" : "no"} onChange={(e) => upd({ required: e.target.value === "yes" })} className="mono-data rounded-md border border-line-strong bg-surface px-2 py-1.5 text-ink">
                    <option>yes</option>
                    <option>no</option>
                  </select>
                  <button type="button" aria-label={`Remove field ${i + 1}`} onClick={() => set({ fields: f.fields.filter((_, j) => j !== i) })} className="text-muted hover:text-ink">
                    ×
                  </button>
                </div>
              );
            })}
            {f.fields.length < 20 && (
              <button type="button" onClick={() => set({ fields: [...f.fields, { name: "", type: "string", required: false }] })} className="mono-small w-fit text-accent">
                + add field
              </button>
            )}
            <Row label="Records">
              <Segmented size="sm" label="Records" value={f.many ? "many" : "one"} onChange={(v) => set({ many: v === "many" })} options={[["one", "One"], ["many", "Many"]]} />
            </Row>
          </>
        )}
      </fieldset>

      <div className="flex flex-col gap-2">
        <Label htmlFor="payer">Your NEAR account</Label>
        <input id="payer" value={f.payer} onChange={(e) => set({ payer: e.target.value })} placeholder="name.testnet" autoComplete="off" className={input} />
        <p className={hint}>Pays, and receives any refund. Bots send it as payer.</p>
        {err("payer")}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="referrer">Referrer · optional</Label>
        <input id="referrer" value={f.referrer} onChange={(e) => set({ referrer: e.target.value })} placeholder="ref-agent.testnet" autoComplete="off" className={input} />
        {err("referrer")}
      </div>
      {err("form")}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={!ready || busy} className="mono-button rounded-pill bg-accent px-6 py-4 text-surface hover:bg-[#1f47e0] disabled:opacity-50">
          Get brief &amp; price
        </button>
        <span className={hint}>{ready ? "Free. Nothing is charged yet." : "Fill in the instructions and a source first."}</span>
      </div>
    </form>
  );
}

function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-3">
      <label htmlFor={htmlFor} className="mono-small text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}
