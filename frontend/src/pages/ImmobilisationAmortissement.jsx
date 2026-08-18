import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useCompany } from '../CompanyContext';
import CompanySelectGate from '../components/CompanySelectGate';
import { formatDateFR, todayISO } from '../utils/dateFr';
import DateInputFR from '../components/DateInputFR';

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Calcul local (aperçu instantané avant enregistrement) — reprend exactement
// la même logique que backend/services/amortissementService.js (linéaire,
// prorata temporis en mois de 30 jours sur l'année civile de démarrage).
function moisRestantsAnneeCivile(dateDebutISO) {
  if (!dateDebutISO) return 0;
  const d = new Date(dateDebutISO);
  if (Number.isNaN(d.getTime())) return 0;
  const jour = d.getDate();
  const mois = d.getMonth() + 1;
  const joursRestantsMoisDepart = 30 - jour + 1;
  const moisCompletsRestants = 12 - mois;
  const totalJours = Math.max(0, Math.min(360, joursRestantsMoisDepart + moisCompletsRestants * 30));
  return totalJours / 360;
}

function calculerApercu({ valeurOrigine, dureeAnnees, dateDebut }) {
  const valeur = Number(valeurOrigine);
  const duree = Number(dureeAnnees);
  if (!(valeur > 0) || !(duree > 0) || !dateDebut) return { taux: 0, lignes: [] };
  const tauxAnnuel = round2(100 / duree);
  const anneeDebut = new Date(dateDebut).getFullYear();
  const prorata0 = moisRestantsAnneeCivile(dateDebut);
  const lignes = [];
  let cumul = 0;
  let i = 0;
  const nbAnnees = prorata0 < 1 ? Math.ceil(duree) + 1 : Math.ceil(duree);
  while (cumul < valeur - 0.01 && i < nbAnnees + 1) {
    const prorata = i === 0 ? prorata0 : 1;
    let dotation = round2(valeur * (tauxAnnuel / 100) * prorata);
    if (round2(cumul + dotation) >= valeur - 0.01) dotation = round2(valeur - cumul);
    if (dotation <= 0) break;
    cumul = round2(cumul + dotation);
    const vnc = round2(valeur - cumul);
    lignes.push({ annee: anneeDebut + i, base_amortissable: valeur, taux: tauxAnnuel, prorata: round2(prorata), dotation, cumul, vnc });
    i += 1;
    if (vnc <= 0.01) break;
  }
  return { taux: tauxAnnuel, lignes };
}

export default function ImmobilisationAmortissement() {
  const { activeCompany, activeFiscalYear } = useCompany();
  const location = useLocation();
  const navigate = useNavigate();
  const prefill = location.state?.prefill || {};

  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState({
    facture_entry_id: prefill.facture_entry_id || null,
    nature: prefill.nature || '',
    objet: prefill.objet || '',
    compte_immo_numero: prefill.compte_immo_numero || '',
    compte_amort_numero: '',
    compte_dotation_numero: '',
    date_acquisition: prefill.date_acquisition || todayISO(),
    valeur_origine: prefill.valeur_origine || '',
    duree_annees: '5',
    date_debut_amortissement: prefill.date_acquisition || todayISO(),
    mode: 'lineaire',
  });
  const [savedImmo, setSavedImmo] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeCompany) return;
    api.getAccounts(activeCompany.id).then(setAccounts).catch(() => {});
  }, [activeCompany]);

  const comptesAmort = useMemo(() => accounts.filter((a) => a.numero.startsWith('28')), [accounts]);
  const comptesDotation = useMemo(
    () => accounts.filter((a) => a.numero.startsWith('619') || a.numero.startsWith('68')),
    [accounts]
  );
  const comptesImmo = useMemo(
    () => accounts.filter((a) => /^2[123]/.test(a.numero) && !a.numero.startsWith('28')),
    [accounts]
  );

  // Suggère automatiquement, à partir du numéro de compte d'immobilisation
  // saisi, le compte d'amortissement (classe 28) et le compte de dotation
  // (619x/68) correspondants, en s'appuyant sur la correspondance standard
  // du plan comptable marocain :
  //   21 (non-valeurs)   -> 281x amortissement / 6191 dotation
  //   22 (incorporelles) -> 282x amortissement / 6192 dotation
  //   23 (corporelles)   -> 283x amortissement / 6193 dotation
  // (le compte 28xx "miroir" reprend les mêmes chiffres que le compte
  // d'immobilisation en préfixant par 28 au lieu de 2). On ne retient une
  // suggestion que si un compte correspondant existe réellement dans le
  // plan comptable de la société ; sinon l'utilisateur choisit à la main.
  function suggererComptesLies(compteImmoNumero) {
    const num = (compteImmoNumero || '').trim();
    if (!/^2[123]/.test(num)) return { amort: '', dotation: '' };
    const prefixeAmort = `28${num.slice(1)}`; // ex: "234" -> "2834", "2340" -> "28340"
    const prefixeDotation = num.startsWith('21') ? '6191' : num.startsWith('22') ? '6192' : '6193';

    let amort = accounts.find((a) => a.numero === prefixeAmort)?.numero || '';
    if (!amort) {
      // essaie des préfixes de plus en plus courts (au cas où le plan de la
      // société ne détaille pas jusqu'au même nombre de chiffres)
      for (let len = prefixeAmort.length - 1; len >= 3 && !amort; len -= 1) {
        const p = prefixeAmort.slice(0, len);
        amort = comptesAmort.find((a) => a.numero.startsWith(p))?.numero || '';
      }
    }
    const dotation = accounts.find((a) => a.numero === prefixeDotation)?.numero
      || comptesDotation.find((a) => a.numero.startsWith(prefixeDotation.slice(0, 3)))?.numero
      || comptesDotation[0]?.numero
      || '';
    return { amort, dotation };
  }

  // Le compte immo saisi/choisi déclenche le remplissage automatique de
  // Compte Amortis. et Compte D.E.A. — tant que l'utilisateur ne les a pas
  // corrigés lui-même à la main (comptesLiesAuto reste vrai après un
  // remplissage automatique, mais passe à faux dès qu'il édite le champ).
  const [comptesLiesAuto, setComptesLiesAuto] = useState(true);
  useEffect(() => {
    if (savedImmo || !comptesLiesAuto) return;
    const { amort, dotation } = suggererComptesLies(form.compte_immo_numero);
    setForm((f) => ({
      ...f,
      compte_amort_numero: amort || f.compte_amort_numero,
      compte_dotation_numero: dotation || f.compte_dotation_numero,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.compte_immo_numero, accounts, savedImmo, comptesLiesAuto]);

  function update(patch) {
    setForm((f) => ({ ...f, ...patch }));
  }

  const apercu = useMemo(
    () => calculerApercu({ valeurOrigine: form.valeur_origine, dureeAnnees: form.duree_annees, dateDebut: form.date_debut_amortissement }),
    [form.valeur_origine, form.duree_annees, form.date_debut_amortissement]
  );

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    if (!form.compte_immo_numero) return setError("Le compte d'immobilisation est requis.");
    if (!form.compte_amort_numero) return setError("Choisissez le compte d'amortissement (classe 28).");
    if (!form.compte_dotation_numero) return setError('Choisissez le compte de dotation (classe 619/68).');
    setLoading(true);
    try {
      const immo = await api.createImmobilisation(activeCompany.id, {
        facture_entry_id: form.facture_entry_id,
        nature: form.nature,
        objet: form.objet,
        compte_immo_numero: form.compte_immo_numero,
        compte_amort_numero: form.compte_amort_numero,
        compte_dotation_numero: form.compte_dotation_numero,
        date_acquisition: form.date_acquisition,
        valeur_origine: Number(form.valeur_origine),
        duree_annees: Number(form.duree_annees),
        date_debut_amortissement: form.date_debut_amortissement,
      });
      setSavedImmo(immo);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleGenererEcriture(annee) {
    setError('');
    try {
      const res = await api.genererEcritureAmortissement(activeCompany.id, savedImmo.id, {
        annee,
        fiscal_year_id: activeFiscalYear?.id,
      });
      setSavedImmo(res.immobilisation);
    } catch (err) {
      setError(err.message);
    }
  }

  const [generatingAll, setGeneratingAll] = useState(false);
  // "Activation" de la génération : au lieu de cliquer année par année, un
  // seul bouton génère toutes les dotations déjà échues (jusqu'à
  // aujourd'hui) qui n'ont pas encore d'écriture — la fiscal_year_id de
  // chaque année est laissée au backend (résolue via la date du 31/12).
  async function handleGenererToutesEcheances() {
    if (!savedImmo) return;
    setError('');
    setGeneratingAll(true);
    try {
      const anneeCourante = new Date().getFullYear();
      const aGenerer = savedImmo.lignes.filter((l) => !l.journal_entry_id && l.annee <= anneeCourante);
      let immoCourant = savedImmo;
      for (const l of aGenerer) {
        // eslint-disable-next-line no-await-in-loop
        const res = await api.genererEcritureAmortissement(activeCompany.id, immoCourant.id, { annee: l.annee });
        immoCourant = res.immobilisation;
      }
      setSavedImmo(immoCourant);
    } catch (err) {
      setError(err.message);
    } finally {
      setGeneratingAll(false);
    }
  }

  const lignesAffichees = savedImmo ? savedImmo.lignes : apercu.lignes;
  const tauxAffiche = savedImmo ? savedImmo.taux : apercu.taux;
  const echeancesEnAttente = savedImmo
    ? savedImmo.lignes.filter((l) => !l.journal_entry_id && l.annee <= new Date().getFullYear()).length
    : 0;

  return (
    <CompanySelectGate title="Amortissement">
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Saisie : Amortissement</h2>
        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSave}>
          <div className="grid-3">
            <div className="field">
              <label>Immobilisation</label>
              <input value={form.objet} onChange={(e) => update({ objet: e.target.value })} placeholder="Objet (ex : FA N°201 - ABC)" disabled={!!savedImmo} />
            </div>
            <div className="field">
              <label>Nature</label>
              <input value={form.nature} onChange={(e) => update({ nature: e.target.value })} placeholder="Ex : Matériel de transport" disabled={!!savedImmo} />
            </div>
            <div className="field">
              <label>Compte immobilisation</label>
              <input
                list="comptes-immo-datalist"
                value={form.compte_immo_numero}
                onChange={(e) => { update({ compte_immo_numero: e.target.value }); setComptesLiesAuto(true); }}
                placeholder="Ex : 2340"
                disabled={!!savedImmo}
              />
              <datalist id="comptes-immo-datalist">
                {comptesImmo.map((a) => (
                  <option key={a.id} value={a.numero}>{a.numero} — {a.intitule}</option>
                ))}
              </datalist>
            </div>
            <div className="field">
              <label>Date d'acquisition</label>
              <DateInputFR value={form.date_acquisition} onChange={(e) => update({ date_acquisition: e.target.value })} disabled={!!savedImmo} />
            </div>
            <div className="field">
              <label>Valeur d'origine</label>
              <input type="number" step="0.01" className="num" value={form.valeur_origine} onChange={(e) => update({ valeur_origine: e.target.value })} disabled={!!savedImmo} />
            </div>
            <div className="field">
              <label>Durée d'amortissement (années)</label>
              <input type="number" step="1" className="num" value={form.duree_annees} onChange={(e) => update({ duree_annees: e.target.value })} disabled={!!savedImmo} />
            </div>
            <div className="field">
              <label>Taux d'amortissement</label>
              <input value={tauxAffiche ? `${tauxAffiche} %` : ''} disabled />
            </div>
            <div className="field">
              <label>Date de début d'amortissement</label>
              <DateInputFR value={form.date_debut_amortissement} onChange={(e) => update({ date_debut_amortissement: e.target.value })} disabled={!!savedImmo} />
            </div>
            <div className="field">
              <label>Mode d'amortissement</label>
              <input value="Linéaire" disabled />
            </div>
            <div className="field">
              <label>Compte Amortis. <span className="text-muted" style={{ fontWeight: 400 }}>(auto)</span></label>
              <select
                value={form.compte_amort_numero}
                onChange={(e) => { update({ compte_amort_numero: e.target.value }); setComptesLiesAuto(false); }}
                disabled={!!savedImmo}
              >
                <option value="">Choisir…</option>
                {comptesAmort.map((a) => (
                  <option key={a.id} value={a.numero}>{a.numero} — {a.intitule}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Compte D.E.A. (dotation) <span className="text-muted" style={{ fontWeight: 400 }}>(auto)</span></label>
              <select
                value={form.compte_dotation_numero}
                onChange={(e) => { update({ compte_dotation_numero: e.target.value }); setComptesLiesAuto(false); }}
                disabled={!!savedImmo}
              >
                <option value="">Choisir…</option>
                {comptesDotation.map((a) => (
                  <option key={a.id} value={a.numero}>{a.numero} — {a.intitule}</option>
                ))}
              </select>
            </div>
          </div>
          {comptesLiesAuto && (form.compte_amort_numero || form.compte_dotation_numero) && !savedImmo && (
            <p className="text-muted" style={{ fontSize: 12.5, marginTop: -6 }}>
              Comptes Amortis. et D.E.A. remplis automatiquement d'après le compte d'immobilisation {form.compte_immo_numero} — modifiables si besoin.
            </p>
          )}

          {!savedImmo && (
            <div style={{ marginTop: 12 }}>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Enregistrement…' : 'Enregistrer le plan d\'amortissement'}
              </button>
              <button type="button" className="btn" style={{ marginLeft: 8 }} onClick={() => navigate('/factures')}>Annuler</button>
            </div>
          )}
        </form>

        <h3 style={{ marginTop: 24 }}>Tableau d'amortissement (linéaire)</h3>
        {savedImmo && echeancesEnAttente > 0 && (
          <button type="button" className="btn btn-primary btn-tiny" style={{ marginBottom: 8 }} onClick={handleGenererToutesEcheances} disabled={generatingAll}>
            {generatingAll ? 'Génération…' : `Générer les ${echeancesEnAttente} dotation(s) échue(s)`}
          </button>
        )}
        <table className="ledger">
          <thead>
            <tr>
              <th>Année</th>
              <th className="num">Base amortissable</th>
              <th className="num">Taux</th>
              <th className="num">Prorata</th>
              <th className="num">Dotation</th>
              <th className="num">Amort. cumulé</th>
              <th className="num">VNC</th>
              {savedImmo && <th>Écriture</th>}
            </tr>
          </thead>
          <tbody>
            {lignesAffichees.map((l) => (
              <tr key={l.annee}>
                <td>{l.annee}</td>
                <td className="num">{l.base_amortissable.toFixed(2)}</td>
                <td className="num">{l.taux} %</td>
                <td className="num">{Math.round(l.prorata * 12)}/12</td>
                <td className="num">{l.dotation.toFixed(2)}</td>
                <td className="num">{l.cumul.toFixed(2)}</td>
                <td className="num">{l.vnc.toFixed(2)}</td>
                {savedImmo && (
                  <td>
                    {l.journal_entry_id ? (
                      <span style={{ color: 'green' }}>Générée ✓</span>
                    ) : (
                      <button type="button" className="btn btn-tiny" onClick={() => handleGenererEcriture(l.annee)}>
                        Générer l'écriture
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {lignesAffichees.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Renseignez la valeur d'origine, la durée et la date de début pour voir l'aperçu du tableau.</td></tr>
            )}
          </tbody>
        </table>
        {savedImmo && (
          <p style={{ marginTop: 12 }}>
            Chaque écriture générée passe au débit le compte {form.compte_dotation_numero} (Dotation aux amortissements — classe 6)
            et au crédit le compte {form.compte_amort_numero} (Amortissement — classe 2/8), dans le journal des Opérations Diverses (OD),
            à la date du 31/12 de l'exercice. Enregistrée le {formatDateFR(todayISO())}.
          </p>
        )}
      </div>
    </CompanySelectGate>
  );
}
