import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetImpostazioniStampaQueryKey, useDeleteLogoStampa, useGetImpostazioniStampa, useUpdateImpostazioniStampa } from "@workspace/api-client-react";
import { ImagePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState } from "@/components/common";
import { useToast } from "@/hooks/use-toast";
import { parseApiError } from "@/lib/format";
import { formatoDimensione, inviaFile, messaggioErrore, urlLogoStampa } from "@/lib/upload";

const VUOTO = { nome: "", motto: "", indirizzo: "", telefono: "", email: "", nota1: "", nota2: "" };

export function StampatiTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const dati = useGetImpostazioniStampa();
  const salva = useUpdateImpostazioniStampa();
  const togli = useDeleteLogoStampa();
  const [f, setF] = useState(VUOTO);
  const [err, setErr] = useState<string | null>(null);
  const [errLogo, setErrLogo] = useState<string | null>(null);
  const [carico, setCarico] = useState(false);
  const [versione, setVersione] = useState(0);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (dati.data) { const { logo: _l, ...resto } = dati.data; setF({ ...VUOTO, ...resto }); }
  }, [dati.data]);

  if (dati.isLoading) return <Skeleton className="h-64 w-full" />;
  if (dati.isError) return <ErrorState message={parseApiError(dati.error).message} onRetry={() => dati.refetch()} />;
  const logo = dati.data?.logo ?? null;
  const campo = (k: keyof typeof VUOTO) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value })) });
  const aggiorna = () => qc.invalidateQueries({ queryKey: getGetImpostazioniStampaQueryKey() });

  return (
    <div className="max-w-3xl space-y-8">
      <p className="text-sm text-muted-foreground">Intestazione e note che compaiono sull'estratto delle pratiche chiuse. Le modifiche valgono per ogni nuova stampa e invio.</p>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setErr(null);
          salva.mutate({ data: f }, {
            onSuccess: () => { aggiorna(); toast({ title: "Impostazioni salvate" }); },
            onError: (x) => setErr(parseApiError(x).message),
          });
        }}
      >
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5"><Label htmlFor="s-nome">Nome del patronato</Label><Input id="s-nome" maxLength={80} {...campo("nome")} data-testid="input-stampa-nome" /></div>
          <div className="space-y-1.5"><Label htmlFor="s-motto">Motto</Label><Input id="s-motto" maxLength={120} {...campo("motto")} data-testid="input-stampa-motto" /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="s-ind">Indirizzo</Label><Input id="s-ind" maxLength={160} {...campo("indirizzo")} data-testid="input-stampa-indirizzo" /></div>
          <div className="space-y-1.5"><Label htmlFor="s-tel">Telefono</Label><Input id="s-tel" maxLength={40} {...campo("telefono")} data-testid="input-stampa-telefono" /></div>
          <div className="space-y-1.5"><Label htmlFor="s-mail">Email</Label><Input id="s-mail" maxLength={120} {...campo("email")} data-testid="input-stampa-email" /></div>
        </div>
        <div className="space-y-1.5"><Label htmlFor="s-n1">Prima nota</Label><Textarea id="s-n1" rows={4} maxLength={1000} {...campo("nota1")} data-testid="input-stampa-nota1" /></div>
        <div className="space-y-1.5"><Label htmlFor="s-n2">Seconda nota</Label><Textarea id="s-n2" rows={2} maxLength={1000} {...campo("nota2")} data-testid="input-stampa-nota2" /></div>
        {err && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 text-destructive px-3 py-2 text-sm">{err}</div>}
        <Button type="submit" disabled={salva.isPending} data-testid="button-salva-stampa">{salva.isPending ? "Salvataggio…" : "Salva"}</Button>
      </form>

      <section className="space-y-3 border-t border-border pt-6">
        <h3 className="font-serif text-lg font-semibold">Logo</h3>
        <p className="text-sm text-muted-foreground">Immagine PNG o JPG che compare in alto a sinistra sull'estratto.</p>
        {logo ? (
          <div className="flex items-center gap-4">
            <img src={urlLogoStampa(String(versione))} alt="Logo attuale" className="size-20 object-contain rounded border border-border bg-card p-1" data-testid="anteprima-logo" />
            <div className="text-sm"><div className="font-medium">{logo.nome}</div><div className="text-muted-foreground">{formatoDimensione(logo.dimensione)}</div></div>
          </div>
        ) : <p className="text-sm">Nessun logo caricato.</p>}
        {errLogo && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 text-destructive px-3 py-2 text-sm">{errLogo}</div>}
        <div className="flex gap-2">
          <input ref={file} type="file" accept=".png,.jpg,.jpeg" className="hidden" data-testid="input-logo"
            onChange={async (e) => {
              const sel = e.target.files?.[0];
              e.target.value = "";
              if (!sel) return;
              setErrLogo(null); setCarico(true);
              try {
                await inviaFile("PUT", "/backoffice/compensi/impostazioni-stampa/logo", {}, sel);
                setVersione((v) => v + 1); aggiorna(); toast({ title: "Logo caricato" });
              } catch (x) { setErrLogo(messaggioErrore(x)); } finally { setCarico(false); }
            }} />
          <Button type="button" variant="outline" disabled={carico} onClick={() => file.current?.click()} data-testid="button-carica-logo"><ImagePlus className="size-4 mr-2" />{carico ? "Caricamento…" : logo ? "Sostituisci" : "Carica logo"}</Button>
          {logo && (
            <Button type="button" variant="outline" disabled={togli.isPending} data-testid="button-elimina-logo"
              onClick={() => { setErrLogo(null); togli.mutate(undefined, { onSuccess: () => { aggiorna(); toast({ title: "Logo eliminato" }); }, onError: (x) => setErrLogo(parseApiError(x).message) }); }}>
              <Trash2 className="size-4 mr-2" />Elimina
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
