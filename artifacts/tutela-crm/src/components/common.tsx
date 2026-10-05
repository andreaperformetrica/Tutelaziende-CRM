import type { ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function PageHeader({ title, subtitle, actions, kicker }: { title: string; subtitle?: ReactNode; actions?: ReactNode; kicker?: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4 mb-5 rise">
      <div>
        {kicker && <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-1">{kicker}</div>}
        <h1 className="text-3xl font-bold leading-none" data-testid="text-page-title">{title}</h1>
        {subtitle && <div className="text-sm text-muted-foreground mt-2">{subtitle}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="rise flex flex-col items-center text-center py-14 px-6 border border-dashed border-input rounded-lg bg-card/60 paper" data-testid="empty-state">
      <div className="size-14 rounded-full bg-secondary text-secondary-foreground grid place-items-center mb-4 ring-4 ring-secondary/40">{icon}</div>
      <h3 className="text-lg font-bold">{title}</h3>
      {text && <p className="text-sm text-muted-foreground mt-1 max-w-sm">{text}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rise flex flex-col items-center text-center py-12 px-6 border border-destructive/30 rounded-lg bg-destructive/5" data-testid="error-state">
      <AlertTriangle className="size-8 text-destructive mb-3" />
      <p className="text-sm font-medium max-w-md">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry} data-testid="button-retry">
          <RefreshCw className="size-3.5 mr-2" /> Riprova
        </Button>
      )}
    </div>
  );
}

export function StatoBadge({ attivo }: { attivo: boolean }) {
  return (
    <Badge variant="outline" className={attivo ? "border-primary/30 bg-primary/10 text-primary gap-1.5" : "border-muted-foreground/30 bg-muted text-muted-foreground gap-1.5"}>
      <span className={`size-1.5 rounded-full ${attivo ? "bg-primary" : "bg-muted-foreground/60"}`} />
      {attivo ? "Attivo" : "Disattivato"}
    </Badge>
  );
}

export function FieldError({ children, id }: { children?: ReactNode; id?: string }) {
  if (!children) return null;
  return <p className="text-xs font-medium text-destructive mt-1" data-testid={id}>{children}</p>;
}
