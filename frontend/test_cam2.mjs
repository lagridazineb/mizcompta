import { parseReleveDepuisResultatOcr } from './src/utils/releveExtract.test.mjs';
import fs from 'fs';

const results = JSON.parse(fs.readFileSync('/tmp/cam_ocr_combo.json', 'utf8'));
let texteComplet = '';
for (let i = 0; i < results.length; i++) {
  const data = results[i];
  texteComplet += (data.text || '') + '\n';
  const ops = parseReleveDepuisResultatOcr(data, texteComplet);
  console.log(`page ${i+1}: ${ops.length} opérations`);
}
