"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles, Send } from "lucide-react";

export function NlpQueryBox() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<{
    summary?: string;
    rows?: unknown[];
    filter?: Record<string, unknown>;
    error?: string;
  } | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setPending(true);
    setResult(null);
    try {
      const res = await fetch("/api/nlp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = (await res.json()) as {
        summary?: string;
        rows?: unknown[];
        filter?: Record<string, unknown>;
        error?: string;
      };
      setResult(data);
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : "Failed" });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="surface-nlp rounded-xl border p-4">
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        <Sparkles className="size-3.5 text-primary" aria-hidden />
        <span className="text-[13px] font-semibold">
          Ask about your portfolio
        </span>
        <span className="ml-auto text-[10.5px] text-muted-foreground">
          Answers are filtered from computed alerts — not generated numbers
        </span>
      </div>

      <form onSubmit={submit} className="flex gap-2">
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. which clients need attention right now?"
          className="flex-1"
        />
        <Button type="submit" disabled={pending}>
          <Send className="size-3.5" aria-hidden />
          {pending ? "Thinking…" : "Ask"}
        </Button>
      </form>

      {result && (
        <div className="mt-3 space-y-3 rounded-lg border border-border bg-card p-3">
          {result.error ? (
            <p className="text-sm text-critical">{result.error}</p>
          ) : (
            <>
              <p className="text-[12.5px] text-foreground-secondary">
                {result.summary}
              </p>
              {result.filter && (
                <pre className="rounded bg-background p-2 text-xs text-muted-foreground">
                  {JSON.stringify(result.filter, null, 2)}
                </pre>
              )}
              {result.rows && result.rows.length > 0 && (
                <pre className="max-h-64 overflow-auto rounded bg-background p-2 text-xs text-muted-foreground">
                  {JSON.stringify(result.rows.slice(0, 10), null, 2)}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
