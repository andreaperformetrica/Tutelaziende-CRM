import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/common";
import { AssistitoForm } from "@/components/assistiti/assistito-form";

export default function AssistitoNuovo() {
  const [, nav] = useLocation();
  const { toast } = useToast();
  return (
    <div>
      <PageHeader kicker="Assistiti" title="Nuovo assistito" subtitle="Il codice fiscale viene calcolato in automatico e resta modificabile." />
      <AssistitoForm base="/collaboratore/assistiti" onCancel={() => nav("/collaboratore/assistiti")}
        onSaved={(id) => { toast({ title: "Assistito creato" }); nav(`/collaboratore/assistiti/${id}`); }} />
    </div>
  );
}
