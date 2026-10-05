import { Link } from "wouter";
import { FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-[100dvh] grid place-items-center bg-background paper p-6">
      <div className="text-center max-w-md rise">
        <div className="font-serif text-[9rem] leading-none font-bold text-primary/90">4<span className="text-accent">0</span>4</div>
        <FileQuestion className="size-8 mx-auto mt-2 text-muted-foreground" />
        <h1 className="text-2xl font-bold mt-3">Fascicolo non trovato</h1>
        <p className="text-muted-foreground mt-1">La pagina che cerchi non esiste o è stata spostata.</p>
        <Link href="/" className="inline-block mt-5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity" data-testid="link-home">Torna alla home</Link>
      </div>
    </div>
  );
}
