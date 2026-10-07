import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

export function ConfermaElimina({ aperto, titolo, testo, onConferma, onAnnulla }: {
  aperto: boolean; titolo: string; testo: string; onConferma: () => void; onAnnulla: () => void;
}) {
  return (
    <AlertDialog open={aperto} onOpenChange={(o) => { if (!o) onAnnulla(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{titolo}</AlertDialogTitle>
          <AlertDialogDescription>{testo}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-annulla-elimina">Annulla</AlertDialogCancel>
          <AlertDialogAction onClick={onConferma} data-testid="button-conferma-elimina">Elimina</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
