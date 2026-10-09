import { useState } from "react";
import { PageHeader } from "@/components/common";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ResocontoTab } from "@/components/compensi/resoconto-tab";
import { EstrattiTab } from "@/components/compensi/estratti-tab";
import { DareAvereTab } from "@/components/compensi/dare-avere-tab";
import { ImportazioniTab } from "@/components/compensi/importazioni-tab";
import { StampatiTab } from "@/components/compensi/stampati-tab";

const TAB = ["resoconto", "estratti", "dare-avere", "importazioni", "stampati"];

export default function CompensiPage() {
  const iniziale = new URLSearchParams(window.location.search).get("tab") ?? "";
  const [tab, setTab] = useState(TAB.includes(iniziale) ? iniziale : "resoconto");
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
          <TabsTrigger value="resoconto" data-testid="tab-resoconto">Resoconto</TabsTrigger>
          <TabsTrigger value="estratti" data-testid="tab-estratti">Estratti</TabsTrigger>
          <TabsTrigger value="dare-avere" data-testid="tab-dare-avere">Dare e avere</TabsTrigger>
          <TabsTrigger value="importazioni" data-testid="tab-importazioni">Importazioni</TabsTrigger>
          <TabsTrigger value="stampati" data-testid="tab-stampati">Impostazioni stampati</TabsTrigger>
        </TabsList>
        <TabsContent value="resoconto"><ResocontoTab /></TabsContent>
        <TabsContent value="estratti"><EstrattiTab /></TabsContent>
        <TabsContent value="dare-avere"><DareAvereTab /></TabsContent>
        <TabsContent value="importazioni"><ImportazioniTab /></TabsContent>
        <TabsContent value="stampati"><StampatiTab /></TabsContent>
      </Tabs>
    </div>
  );
}
