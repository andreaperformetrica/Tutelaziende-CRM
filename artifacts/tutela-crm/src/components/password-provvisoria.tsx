import { useState } from "react";
import { Check, Copy, Eye, EyeOff, Wand2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { generaPassword } from "@/lib/format";

export function PasswordProvvisoria({ value, onChange, invalid }: { value: string; onChange: (v: string) => void; invalid?: boolean }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="flex gap-1.5">
        <Input
          type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)}
          autoComplete="new-password" className={`font-mono ${invalid ? "border-destructive" : ""}`} data-testid="input-password-provvisoria"
        />
        <Button type="button" variant="outline" onClick={() => { onChange(generaPassword(12)); setShow(true); }} data-testid="button-genera-password">
          <Wand2 className="size-4 mr-1.5" /> Genera
        </Button>
        <Button type="button" variant="outline" size="icon" onClick={() => setShow((s) => !s)} aria-label="Mostra o nascondi" data-testid="button-toggle-password">
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </Button>
        <Button type="button" variant="outline" size="icon" disabled={!value} aria-label="Copia" data-testid="button-copia-password"
          onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
          {copied ? <Check className="size-4 text-primary" /> : <Copy className="size-4" />}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mt-1.5">Minimo 8 caratteri. Comunicala all'interessato: al primo accesso gli verrà richiesto di sceglierne una nuova.</p>
    </div>
  );
}
