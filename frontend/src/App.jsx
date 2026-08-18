import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import { CompanyProvider } from './CompanyContext';
import { ToolbarProvider } from './ToolbarContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import Societes from './pages/Societes';
import SocieteModifier from './pages/SocieteModifier';
import Saisie from './pages/Saisie';
import Ecritures from './pages/Ecritures';
import GrandLivre from './pages/GrandLivre';
import SaisiePaiementFournisseur from './pages/SaisiePaiementFournisseur';
import Cnss from './pages/Cnss';
import Balance from './pages/Balance';
import Bilan from './pages/Bilan';
import Tva from './pages/Tva';
import Tiers from './pages/Tiers';
import Factures from './pages/Factures';
import BalanceAgee from './pages/BalanceAgee';
import Lettrage from './pages/Lettrage';
import SaisieReleveBancaire from './pages/SaisieReleveBancaire';
import Banque from './pages/Banque';
import Import from './pages/Import';
import ScanFacture from './pages/ScanFacture';
import Convertisseur from './pages/Convertisseur';
import PlanComptable from './pages/PlanComptable';
import Journaux from './pages/Journaux';
import ImmobilisationAmortissement from './pages/ImmobilisationAmortissement';
import Parametres from './pages/Parametres';

function PrivateArea() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/bienvenue" replace />;
  return (
    <CompanyProvider>
      <ToolbarProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/societes" element={<Societes />} />
            <Route path="/societes/:id/modifier" element={<SocieteModifier />} />
            <Route path="/saisie" element={<Saisie />} />
            <Route path="/tiers" element={<Tiers />} />
            <Route path="/factures" element={<Factures />} />
            <Route path="/ecritures" element={<Ecritures />} />
            <Route path="/grand-livre" element={<GrandLivre />} />
            <Route path="/paiement-fournisseur" element={<SaisiePaiementFournisseur />} />
            <Route path="/cnss" element={<Cnss />} />
            <Route path="/balance" element={<Balance />} />
            <Route path="/balance-agee" element={<BalanceAgee />} />
            <Route path="/lettrage" element={<Lettrage />} />
            <Route path="/releve-bancaire" element={<SaisieReleveBancaire />} />
            <Route path="/banque" element={<Banque />} />
            <Route path="/import" element={<Import />} />
            <Route path="/scan" element={<ScanFacture />} />
            <Route path="/convertisseur" element={<Convertisseur />} />
            <Route path="/etats" element={<Bilan />} />
            <Route path="/tva" element={<Tva />} />
            <Route path="/plan-comptable" element={<PlanComptable />} />
            <Route path="/journaux" element={<Journaux />} />
            <Route path="/immobilisations/amortissement" element={<ImmobilisationAmortissement />} />
            <Route path="/parametres/cloture" element={<Parametres />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </ToolbarProvider>
    </CompanyProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/bienvenue" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/*" element={<PrivateArea />} />
      </Routes>
    </AuthProvider>
  );
}
