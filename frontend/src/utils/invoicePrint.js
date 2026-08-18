// Génère et imprime une facture (vente ou achat) au format A4 professionnel,
// dans une nouvelle fenêtre dédiée — indépendante du CSS d'écran de
// l'application, pour un rendu fiable quel que soit l'appareil (desktop ou
// mobile) plutôt qu'un simple export de la table à l'écran.

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmt(n) {
  return (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Extrait HT / TVA / TTC à partir des lignes comptables d'une facture
// (compte tiers, compte de TVA le cas échéant, compte produit/charge).
export function decomposeFacture(facture) {
  const lignes = facture.lignes || [];
  const tiersLigne = lignes.find((l) => l.tiers);
  const tvaLigne = lignes.find((l) => l.taux_tva != null);
  const htLigne = lignes.find((l) => l !== tiersLigne && l !== tvaLigne);
  const montant = (l) => (l ? (l.debit || l.credit || 0) : 0);
  return {
    ttc: montant(tiersLigne),
    tva: montant(tvaLigne),
    tauxTva: tvaLigne ? tvaLigne.taux_tva : null,
    ht: montant(htLigne) || montant(tiersLigne) - montant(tvaLigne),
    compteNumero: htLigne?.account_numero,
    compteIntitule: htLigne?.account_intitule,
  };
}

export function printFacture({ company, tiers, facture, type }) {
  const { ht, tva, tauxTva, ttc, compteIntitule } = decomposeFacture(facture);
  const isVente = type === 'vente';
  const titre = isVente ? 'FACTURE' : "FACTURE D'ACHAT";
  const tiersLabel = isVente ? 'Client' : 'Fournisseur';

  const infosSociete = [
    company.adresse,
    company.ville,
    company.telephone && `Tél : ${company.telephone}`,
    company.email,
  ]
    .filter(Boolean)
    .join(' — ');

  const refsSociete = [
    company.ice && `ICE : ${company.ice}`,
    company.if_fiscal && `IF : ${company.if_fiscal}`,
    company.rc && `RC : ${company.rc}`,
    company.patente && `Patente : ${company.patente}`,
  ]
    .filter(Boolean)
    .join(' — ');

  const refsTiers = [
    tiers?.ice && `ICE : ${tiers.ice}`,
    tiers?.if_fiscal && `IF : ${tiers.if_fiscal}`,
    tiers?.rc && `RC : ${tiers.rc}`,
  ]
    .filter(Boolean)
    .join(' — ');

  const reglement = (facture.reglements || [])[0];
  const modeReglement = reglement?.lignes?.find((l) => l.mode_paiement)?.mode_paiement;
  const montantRegle = facture.montant_regle || 0;
  const resteAPayer = Math.max(0, ttc - montantRegle);

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<title>${esc(titre)} ${esc(facture.numero_piece || '')}</title>
<style>
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Helvetica, Arial, sans-serif; color: #1c2333; font-size: 13px; margin: 0; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #16233d; padding-bottom: 14px; margin-bottom: 24px; }
  .company-name { font-size: 20px; font-weight: 700; color: #16233d; margin: 0 0 4px; }
  .muted { color: #6b7280; font-size: 11.5px; line-height: 1.5; }
  .doc-title { text-align: right; }
  .doc-title h1 { font-size: 24px; letter-spacing: 0.06em; margin: 0; color: #16233d; }
  .doc-title .num { font-size: 15px; font-weight: 700; margin-top: 4px; }
  .meta-row { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 26px; }
  .meta-box { flex: 1; border: 1px solid #e3ded0; border-radius: 6px; padding: 12px 14px; }
  .meta-box h3 { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; margin: 0 0 6px; }
  .meta-box .name { font-weight: 700; font-size: 14px; margin-bottom: 3px; }
  table.lines { width: 100%; border-collapse: collapse; margin-bottom: 22px; }
  table.lines th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; border-bottom: 2px solid #16233d; padding: 8px 6px; }
  table.lines td { padding: 10px 6px; border-bottom: 1px solid #e4ddc9; }
  table.lines td.num, table.lines th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .totals { width: 320px; margin-left: auto; }
  .totals tr td { padding: 6px 8px; }
  .totals tr td:first-child { color: #6b7280; }
  .totals tr td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .totals tr.grand td { font-weight: 700; font-size: 15px; border-top: 2px solid #16233d; padding-top: 10px; }
  .footer-note { margin-top: 40px; font-size: 11px; color: #6b7280; border-top: 1px solid #e4ddc9; padding-top: 10px; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  .badge-ok { background: #e3f3ec; color: #1f7a5c; }
  .badge-warn { background: #fbe9e4; color: #a8432c; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
  <div class="header">
    <div>
      <p class="company-name">${esc(company.raison_sociale)}</p>
      <div class="muted">${esc(infosSociete)}</div>
      <div class="muted">${esc(refsSociete)}</div>
    </div>
    <div class="doc-title">
      <h1>${esc(titre)}</h1>
      <div class="num">N° ${esc(facture.numero_piece || '—')}</div>
      <div class="muted">Date : ${esc(facture.date_ecriture)}</div>
    </div>
  </div>

  <div class="meta-row">
    <div class="meta-box">
      <h3>${esc(tiersLabel)}</h3>
      <div class="name">${esc(tiers?.nom || '—')}</div>
      <div class="muted">${esc(tiers?.adresse || '')}</div>
      <div class="muted">${esc(refsTiers)}</div>
    </div>
    <div class="meta-box">
      <h3>Règlement</h3>
      <div class="muted">Mode : ${esc(modeReglement || 'Non renseigné')}</div>
      <div class="muted">Réglé : ${fmt(montantRegle)} DH</div>
      <div class="muted">Reste à payer : ${fmt(resteAPayer)} DH</div>
      <div style="margin-top:6px;">
        ${resteAPayer <= 0.01 ? '<span class="badge badge-ok">Soldée</span>' : '<span class="badge badge-warn">Non soldée</span>'}
      </div>
    </div>
  </div>

  <table class="lines">
    <thead>
      <tr>
        <th>Désignation</th>
        <th class="num">Montant HT</th>
        <th class="num">TVA</th>
        <th class="num">Montant TTC</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${esc(facture.libelle)}<br/><span class="muted">${esc(compteIntitule || '')}</span></td>
        <td class="num">${fmt(ht)}</td>
        <td class="num">${tauxTva != null ? `${tauxTva}% (${fmt(tva)})` : '—'}</td>
        <td class="num">${fmt(ttc)}</td>
      </tr>
    </tbody>
  </table>

  <table class="totals">
    <tr><td>Total HT</td><td class="num">${fmt(ht)} DH</td></tr>
    <tr><td>TVA${tauxTva != null ? ` (${tauxTva}%)` : ''}</td><td class="num">${fmt(tva)} DH</td></tr>
    <tr class="grand"><td>Total TTC</td><td class="num">${fmt(ttc)} DH</td></tr>
  </table>

  <div class="footer-note">
    Document généré par MizCompta le ${esc(new Date().toLocaleString('fr-FR'))}.
    ${company.mode_declaration ? `Régime TVA : ${esc(company.regime_tva || '')}.` : ''}
  </div>
</body>
</html>`;

  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.onload = () => {
    w.focus();
    w.print();
  };
}
