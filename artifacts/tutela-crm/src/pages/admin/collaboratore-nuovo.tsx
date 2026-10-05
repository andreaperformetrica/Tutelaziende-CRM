import { useLocation } from "wouter";
import { PageHeader } from "@/components/common";
import { CollaboratoreForm } from "@/components/collaboratori/collaboratore-form";

export default function CollaboratoreNuovo() {
  const [, nav] = useLocation();
  return (
    <div>
      <PageHeader kicker="Collaboratori" title="Nuovo collaboratore" subtitle="Il collaboratore dovrà cambiare la password provvisoria al primo accesso." />
      <CollaboratoreForm onSaved={(id) => nav(`/admin/collaboratori/${id}`)} onCancel={() => nav("/admin/collaboratori")} />
    </div>
  );
}
