import { AssistitiLista } from "@/components/assistiti/assistiti-lista";
import { useSession } from "@/lib/auth";

export default function AssistitiCollaboratore() {
  const { session } = useSession();
  return <AssistitiLista base="/collaboratore/assistiti" capogruppo={!!session?.collaboratore?.capogruppo} puoCreare />;
}
