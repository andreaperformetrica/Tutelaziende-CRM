import { useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { FORMATI_FILE } from "@/lib/upload";

/** Pulsante che apre la scelta del file e restituisce il file selezionato. */
export function SelettoreFile({ onFile, children, disabled, testId, accept = FORMATI_FILE, variant = "outline", size = "sm" }: {
  onFile: (f: File) => void; children: ReactNode; disabled?: boolean; testId?: string; accept?: string;
  variant?: "outline" | "default" | "ghost"; size?: "sm" | "default";
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept={accept} className="hidden" data-testid={testId ? `${testId}-input` : undefined}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
      <Button type="button" variant={variant} size={size} disabled={disabled} onClick={() => ref.current?.click()} data-testid={testId}>{children}</Button>
    </>
  );
}
