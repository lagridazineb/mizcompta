// Génère un document (PDF, Excel ou Word) à partir d'une description de
// tableau normalisée, avec le même en-tête que l'impression écran (société +
// IF + titre + période) — réutilisé pour le Bilan, les Factures et le Relevé
// Bancaire, afin de garder un seul moteur d'export à maintenir.
//
// Format attendu :
// {
//   company: { raison_sociale, if_fiscal },
//   title: "BILAN ACTIF",
//   periodeDebut: "2025-01-01", periodeFin: "2025-12-31",   // optionnel
//   compte: "3421   Clients",                                // optionnel
//   columns: [{ label: "Compte", width: 3, align: "left" }, { label: "Débit", width: 2, align: "right" }, ...],
//   rows: [{ cells: ["...", "1 234.00"], bold: false, indent: false }, ...],
// }

const PDFDocument = require('pdfkit');
const XLSX = require('xlsx');
const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, AlignmentType, WidthType, Header } = require('docx');

function formatDateFR(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

// ---------------------------------------------------------------------------
// PDF (pdfkit) — page A4, en-tête société/IF, titre centré souligné, période,
// tableau avec bordures fines, ligne totaux en gras.
function buildPdf({ company, title, periodeDebut, periodeFin, compte, columns, rows, landscape }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true, layout: landscape ? 'landscape' : 'portrait' });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    function drawHeader() {
      doc.font('Helvetica-Bold').fontSize(11);
      doc.text(company?.raison_sociale || '', doc.page.margins.left, doc.y, { continued: false });
      doc.font('Helvetica-Bold').fontSize(11);
      doc.text(company?.if_fiscal ? `IF:${company.if_fiscal}` : '', doc.page.margins.left, doc.y - doc.currentLineHeight(), {
        width: pageWidth,
        align: 'right',
      });
      doc.moveDown(0.6);
      doc.font('Helvetica-Bold').fontSize(13);
      doc.text(title, { align: 'center', underline: true });
      if (periodeDebut || periodeFin) {
        doc.moveDown(0.2);
        doc.font('Helvetica').fontSize(9);
        doc.text(`Du: ${formatDateFR(periodeDebut)} au: ${formatDateFR(periodeFin)}`, { align: 'center' });
      }
      if (compte) {
        doc.moveDown(0.3);
        doc.font('Helvetica-Bold').fontSize(9.5);
        doc.text(`Compte : ${compte}`, { align: 'left' });
      }
      doc.moveDown(0.5);
    }

    drawHeader();

    const totalUnits = columns.reduce((s, c) => s + (c.width || 1), 0);
    const colWidths = columns.map((c) => (pageWidth * (c.width || 1)) / totalUnits);

    function drawRow(cells, { bold = false, header = false, indent = false, sub = false } = {}) {
      const rowHeight = 16;
      if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        drawHeader();
      }
      let x = doc.page.margins.left;
      const y = doc.y;
      const leftPad = sub ? 20 : indent ? 10 : 2;
      doc.font(bold || header ? 'Helvetica-Bold' : 'Helvetica').fontSize(sub ? 7.4 : 8.2).fillColor(sub ? '#555555' : '#000000');
      cells.forEach((text, i) => {
        const w = colWidths[i];
        const align = columns[i]?.align || (i === 0 ? 'left' : 'right');
        doc.text(String(text ?? ''), x + (i === 0 ? leftPad : 2), y + 3, { width: w - (i === 0 ? leftPad + 2 : 4), align });
        x += w;
      });
      doc.fillColor('#000000');
      // ligne de séparation
      doc
        .moveTo(doc.page.margins.left, y + rowHeight)
        .lineTo(doc.page.margins.left + pageWidth, y + rowHeight)
        .strokeColor(header ? '#16233d' : '#dddddd')
        .lineWidth(header ? 1 : 0.5)
        .stroke();
      doc.y = y + rowHeight;
    }

    drawRow(
      columns.map((c) => c.label),
      { header: true }
    );
    for (const r of rows) {
      drawRow(r.cells, { bold: r.bold, indent: r.indent, sub: r.sub });
    }

    doc.end();
  });
}

// ---------------------------------------------------------------------------
// Excel (SheetJS) — même contenu, une feuille, en-tête sur les 3 premières
// lignes puis le tableau avec la ligne d'en-tête de colonnes.
function buildXlsx({ company, title, periodeDebut, periodeFin, compte, columns, rows }) {
  const aoa = [];
  aoa.push([company?.raison_sociale || '', ...Array(Math.max(0, columns.length - 2)).fill(''), company?.if_fiscal ? `IF:${company.if_fiscal}` : '']);
  aoa.push([title]);
  if (periodeDebut || periodeFin) aoa.push([`Du: ${formatDateFR(periodeDebut)} au: ${formatDateFR(periodeFin)}`]);
  if (compte) aoa.push([`Compte : ${compte}`]);
  aoa.push([]);
  aoa.push(columns.map((c) => c.label));
  for (const r of rows) aoa.push(r.cells.map((c, i) => (i === 0 && r.sub ? `    ${c}` : c)));

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = columns.map((c) => ({ wch: Math.max(12, (c.width || 1) * 14) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31) || 'Feuille1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// ---------------------------------------------------------------------------
// Word (docx) — même contenu, sous forme de tableau natif Word.
async function buildDocx({ company, title, periodeDebut, periodeFin, compte, columns, rows, landscape }) {
  const totalUnits = columns.reduce((s, c) => s + (c.width || 1), 0);

  const headerRow = new TableRow({
    tableHeader: true,
    children: columns.map(
      (c) =>
        new TableCell({
          width: { size: Math.round(((c.width || 1) / totalUnits) * 100), type: WidthType.PERCENTAGE },
          shading: { fill: '16233D' },
          children: [new Paragraph({ children: [new TextRun({ text: c.label, bold: true, color: 'FFFFFF' })], alignment: AlignmentType.CENTER })],
        })
    ),
  });

  const bodyRows = rows.map(
    (r) =>
      new TableRow({
        children: r.cells.map(
          (text, i) =>
            new TableCell({
              width: { size: Math.round(((columns[i]?.width || 1) / totalUnits) * 100), type: WidthType.PERCENTAGE },
              children: [
                new Paragraph({
                  indent: i === 0 && r.sub ? { left: 340 } : undefined,
                  children: [new TextRun({ text: String(text ?? ''), bold: !!r.bold, size: r.sub ? 16 : undefined, color: r.sub ? '555555' : undefined })],
                  alignment: (columns[i]?.align || (i === 0 ? 'left' : 'right')) === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT,
                }),
              ],
            })
        ),
      })
  );

  const doc = new Document({
    sections: [
      {
        properties: { page: { size: { orientation: landscape ? 'landscape' : 'portrait' } } },
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: company?.raison_sociale || '', bold: true }),
              new TextRun({ text: '\t\t\t\t\t\t' }),
              new TextRun({ text: company?.if_fiscal ? `IF:${company.if_fiscal}` : '', bold: true }),
            ],
          }),
          new Paragraph({ children: [new TextRun({ text: title, bold: true, underline: {}, size: 28 })], alignment: AlignmentType.CENTER, spacing: { before: 200, after: 100 } }),
          ...(periodeDebut || periodeFin
            ? [new Paragraph({ children: [new TextRun({ text: `Du: ${formatDateFR(periodeDebut)} au: ${formatDateFR(periodeFin)}`, size: 18 })], alignment: AlignmentType.CENTER, spacing: { after: 200 } })]
            : []),
          ...(compte ? [new Paragraph({ children: [new TextRun({ text: `Compte : ${compte}`, bold: true })], spacing: { after: 150 } })] : []),
          new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...bodyRows] }),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

async function buildExport(format, tableDef) {
  if (format === 'pdf') return { buffer: await buildPdf(tableDef), contentType: 'application/pdf', ext: 'pdf' };
  if (format === 'xlsx') return { buffer: buildXlsx(tableDef), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' };
  if (format === 'docx') return { buffer: await buildDocx(tableDef), contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' };
  throw new Error(`Format d'export inconnu : ${format}`);
}

module.exports = { buildExport };
