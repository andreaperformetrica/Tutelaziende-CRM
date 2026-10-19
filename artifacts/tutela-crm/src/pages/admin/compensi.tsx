import { useState } from "react";
import { PageHeader } from "@/components/common";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ResocontoTab } from "@/components/compensi/resoconto-tab";
import { EstrattiTab } from "@/components/compensi/estratti-tab";
import { DareAvereTab } from "@/components/compensi/dare-avere-tab";
import { useSession } from "@/lib/auth";
import { StampatiTab } from "@/components/compensi/stampati-tab";

const TAB = ["resoconto", "estratti", "dare-avere", "stampati"];

export default function CompensiPage() {
  const { session } = useSession();
  // L'operatore vede solo il dare e avere (in sola lettura, per creare le ricevute).
  const soloDareAvere = session?.ruolo === "operatore";
  const iniziale = new URLSearchParams(window.location.search).get("tab") ?? "";
  const [tabScelto, setTab] = useState(TAB.includes(iniziale) ? iniziale : "resoconto");
  const tab = soloDareAvere ? "dare-avere" : tabScelto;
  const cambia = (v: string) => {
    setTab(v);
    const u = new URL(window.location.href);
    u.searchParams.set("tab", v);
    window.history.replaceState(null, "", u);
  };
  return (
    <div>
      <PageHeader title="Compensi" subtitle="Resoconto delle pratiche chiuse, estratti, pagamenti e dare e avere dei collaboratori." />
      <Tabs value={tab} onValueChange={cambia}>
        <TabsList className="mb-6 flex-wrap h-auto">
          {!soloDareAvere && <TabsTrigger value="resoconto" data-testid="tab-resoconto">Resoconto</TabsTrigger>}
          {!soloDareAvere && <TabsTrigger value="estratti" data-testid="tab-estratti">Estratti</TabsTrigger>}
          <TabsTrigger value="dare-avere" data-testid="tab-dare-avere">Dare e avere</TabsTrigger>
          {!soloDareAvere && <TabsTrigger value="stampati" data-testid="tab-stampati">Impostazioni stampati</TabsTrigger>}
        </TabsList>
        <TabsContent value="resoconto"><ResocontoTab /></TabsContent>
        <TabsContent value="estratti"><EstrattiTab /></TabsContent>
        <TabsContent value="dare-avere"><DareAvereTab /></TabsContent>
        <TabsContent value="stampati"><StampatiTab /></TabsContent>
      </Tabs>
    </div>
  );
}
