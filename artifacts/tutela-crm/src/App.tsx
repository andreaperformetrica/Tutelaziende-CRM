import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { useSession, homeFor } from '@/lib/auth';
import { BackofficeShell, CollaboratoreShell } from '@/components/layout/shells';
import { ErrorState } from '@/components/common';
import { Skeleton } from '@/components/ui/skeleton';
import LoginPage from '@/pages/login';
import QuestionarioPubblico from '@/pages/questionario-pubblico';
import CambiaPasswordPage from '@/pages/cambia-password';
import TipiPraticaPage from '@/pages/admin/tipi-pratica';
import TipoPraticaDettaglioPage from '@/pages/admin/tipo-pratica-dettaglio';
import MandatiPage from '@/pages/admin/mandati';
import NewsPage from '@/pages/admin/news';
import StatiPraticaPage from '@/pages/admin/stati-pratica';
import OrariPage from '@/pages/admin/orari';
import CollaboratoriPage from '@/pages/admin/collaboratori';
import CollaboratoreNuovo from '@/pages/admin/collaboratore-nuovo';
import CollaboratoreDettaglioPage from '@/pages/admin/collaboratore-dettaglio';
import UtentiPage from '@/pages/admin/utenti';
import LogPage from '@/pages/admin/log';
import DashboardPage from '@/pages/admin/dashboard';
import ChatPage from '@/pages/admin/chat';
import AlertPage from '@/pages/admin/alert';
import StatisticheOperatoriPage from '@/pages/admin/statistiche';
import NotifichePage from '@/pages/admin/notifiche';
import AssistitiBackoffice from '@/pages/admin/assistiti';
import AssistitoDettaglioBackoffice from '@/pages/admin/assistito-dettaglio';
import PraticheBackoffice from '@/pages/admin/pratiche';
import LeMiePraticheBackoffice from '@/pages/admin/le-mie-pratiche';
import PraticaDettaglioBackoffice from '@/pages/admin/pratica-dettaglio';
import SegnalazioniPage from '@/pages/admin/segnalazioni';
import PraticheCollaboratore from '@/pages/collaboratore/pratiche';
import PraticaDettaglioCollaboratore from '@/pages/collaboratore/pratica-dettaglio';
import AssistitiCollaboratore from '@/pages/collaboratore/assistiti';
import AssistitoNuovo from '@/pages/collaboratore/assistito-nuovo';
import AssistitoDettaglioCollaboratore from '@/pages/collaboratore/assistito-dettaglio';
import EventiBackoffice from '@/pages/admin/eventi';
import CompensiPage from '@/pages/admin/compensi';
import PagamentiFatturePage from '@/pages/admin/pagamenti-fatture';
import RicevutaDettaglioPage from '@/pages/admin/ricevuta-dettaglio';
import ImportazioneDettaglioPage from '@/pages/admin/importazione-dettaglio';
import EstrattoDettaglioPage from '@/pages/admin/estratto-dettaglio';
import EventoDettaglioBackoffice from '@/pages/admin/evento-dettaglio';
import EventoCheckIn from '@/pages/admin/evento-check-in';
import EventiCollaboratore from '@/pages/collaboratore/eventi';
import EventoDettaglioCollaboratore from '@/pages/collaboratore/evento-dettaglio';
import HomeCollaboratore from '@/pages/home-collaboratore';
import ImpostazioniCollaboratore from '@/pages/collaboratore/impostazioni';

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

const ADMIN = ['super_admin', 'admin'];
const TUTTI_BO = ['super_admin', 'admin', 'operatore'];

function Gate({ area, roles, children }: { area?: 'backoffice' | 'collaboratore'; roles?: string[]; children: ReactNode }) {
  const { session, isLoading, failed, refetch } = useSession();
  const [loc] = useLocation();
  if (isLoading) return <div className="min-h-[100dvh] p-10 space-y-3"><Skeleton className="h-10 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (failed) return <div className="p-10"><ErrorState message="Impossibile verificare la sessione." onRetry={() => refetch()} /></div>;
  if (!session) return <Redirect to={loc === "/" ? "/login" : `/login?ritorno=${encodeURIComponent(loc + window.location.search)}`} />;
  const forzato = session.deveCambiarePassword;
  if (forzato && loc !== '/cambia-password') return <Redirect to="/cambia-password" />;
  if (!forzato && area && session.area !== area) return <Redirect to={homeFor(session.area)} />;
  if (!forzato && roles && !roles.includes(session.ruolo)) return <Redirect to={homeFor(session.area)} />;
  if (forzato) return <>{children}</>;
  return session.area === 'collaboratore'
    ? <CollaboratoreShell s={session}>{children}</CollaboratoreShell>
    : <BackofficeShell s={session}>{children}</BackofficeShell>;
}

function Root() {
  const { session, isLoading } = useSession();
  if (isLoading) return null;
  return <Redirect to={session ? (session.deveCambiarePassword ? '/cambia-password' : homeFor(session.area)) : '/login'} />;
}

const g = (node: ReactNode, area?: 'backoffice' | 'collaboratore', roles?: string[]) => () => <Gate area={area} roles={roles}>{node}</Gate>;

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Root} />
        <Route path="/login" component={LoginPage} />
        <Route path="/questionario/:token" component={QuestionarioPubblico} />
        <Route path="/cambia-password" component={g(<CambiaPasswordPage />)} />
        <Route path="/admin/dashboard" component={g(<DashboardPage />, 'backoffice', TUTTI_BO)} />
        <Route path="/admin/chat" component={g(<ChatPage />, 'backoffice', TUTTI_BO)} />
        <Route path="/admin/alert" component={g(<AlertPage />, 'backoffice', ADMIN)} />
        <Route path="/admin/statistiche" component={g(<StatisticheOperatoriPage />, 'backoffice', ['super_admin'])} />
        <Route path="/admin/pratiche" component={g(<PraticheBackoffice />, 'backoffice', TUTTI_BO)} />
        <Route path="/admin/le-mie-pratiche" component={g(<LeMiePraticheBackoffice />, 'backoffice', TUTTI_BO)} />
        <Route path="/admin/pratiche/:id" component={g(<PraticaDettaglioBackoffice />, 'backoffice', TUTTI_BO)} />
        <Route path="/admin/collaboratori" component={g(<CollaboratoriPage />, 'backoffice', TUTTI_BO)} />
        <Route path="/admin/collaboratori/nuovo" component={g(<CollaboratoreNuovo />, 'backoffice', ADMIN)} />
        <Route path="/admin/collaboratori/:id" component={g(<CollaboratoreDettaglioPage />, 'backoffice', TUTTI_BO)} />
        <Route path="/admin/assistiti" component={g(<AssistitiBackoffice />, 'backoffice', TUTTI_BO)} />
        <Route path="/admin/assistiti/:id" component={g(<AssistitoDettaglioBackoffice />, 'backoffice', TUTTI_BO)} />
        <Route path="/admin/news" component={g(<NewsPage />, 'backoffice', TUTTI_BO)} />
        <Route path="/admin/segnalazioni" component={g(<SegnalazioniPage />, 'backoffice', ADMIN)} />
        <Route path="/admin/tipi-pratica" component={g(<TipiPraticaPage />, 'backoffice', ADMIN)} />
        <Route path="/admin/tipi-pratica/:id" component={g(<TipoPraticaDettaglioPage />, 'backoffice', ADMIN)} />
        <Route path="/admin/mandati" component={g(<MandatiPage />, 'backoffice', ADMIN)} />
        <Route path="/admin/stati-pratica" component={g(<StatiPraticaPage />, 'backoffice', ADMIN)} />
        <Route path="/admin/orari" component={g(<OrariPage />, 'backoffice', ADMIN)} />
        <Route path="/admin/utenti" component={g(<UtentiPage />, 'backoffice', ADMIN)} />
        <Route path="/admin/log" component={g(<LogPage />, 'backoffice', ADMIN)} />
        <Route path="/admin/notifiche" component={g(<NotifichePage />, 'backoffice', ADMIN)} />
        <Route path="/admin/compensi" component={g(<CompensiPage />, 'backoffice', TUTTI_BO)} />
        <Route path="/admin/pagamenti-fatture" component={g(<PagamentiFatturePage />, 'backoffice', TUTTI_BO)} />
        <Route path="/admin/pagamenti-fatture/:id" component={g(<RicevutaDettaglioPage />, 'backoffice', TUTTI_BO)} />
        <Route path="/admin/compensi/estratti/:id" component={g(<EstrattoDettaglioPage />, 'backoffice', ADMIN)} />
        <Route path="/admin/compensi/importazioni/:id" component={g(<ImportazioneDettaglioPage />, 'backoffice', ADMIN)} />
        <Route path="/admin/eventi" component={g(<EventiBackoffice />, 'backoffice', ADMIN)} />
        <Route path="/admin/eventi/:id/check-in" component={g(<EventoCheckIn />, 'backoffice', ADMIN)} />
        <Route path="/admin/eventi/:id" component={g(<EventoDettaglioBackoffice />, 'backoffice', ADMIN)} />
        <Route path="/collaboratore/eventi" component={g(<EventiCollaboratore />, 'collaboratore', ['collaboratore'])} />
        <Route path="/collaboratore/eventi/:id" component={g(<EventoDettaglioCollaboratore />, 'collaboratore', ['collaboratore'])} />
        <Route path="/collaboratore/assistiti" component={g(<AssistitiCollaboratore />, 'collaboratore', ['collaboratore'])} />
        <Route path="/collaboratore/assistiti/nuovo" component={g(<AssistitoNuovo />, 'collaboratore', ['collaboratore'])} />
        <Route path="/collaboratore/assistiti/:id" component={g(<AssistitoDettaglioCollaboratore />, 'collaboratore', ['collaboratore'])} />
        <Route path="/collaboratore/impostazioni" component={g(<ImpostazioniCollaboratore />, 'collaboratore', ['collaboratore'])} />
        <Route path="/collaboratore/pratiche" component={g(<PraticheCollaboratore />, 'collaboratore', ['collaboratore'])} />
        <Route path="/collaboratore/pratiche/:id" component={g(<PraticaDettaglioCollaboratore />, 'collaboratore', ['collaboratore'])} />
        <Route path="/collaboratore" component={g(<HomeCollaboratore />, 'collaboratore', ['collaboratore'])} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
