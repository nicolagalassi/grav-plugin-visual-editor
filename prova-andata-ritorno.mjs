// Apre e risalva nell'editor (senza modifiche) il testo di ogni pagina del sito e controlla che:
// - il risultato sia stabile: risalvarlo una seconda volta non cambia più nulla;
// - il contenuto sia lo stesso: rileggendo il Markdown risalvato si ottiene lo stesso documento.
// Uso: node prova-andata-ritorno.mjs [cartella pagine]   (predefinita: ../../pages, cioè user/pages del sito)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { daMarkdown, aMarkdown, incompatibile } from './src/markdown.js';

const radice = process.argv[2] || new URL('../../pages', import.meta.url).pathname;
const file = [];
const cerca = (d) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) cerca(p);
    else if (n.endsWith('.md')) file.push(p);
  }
};
cerca(radice);

let errori = 0;
for (const f of file) {
  const testo = readFileSync(f, 'utf8').replace(/^---\n[\s\S]*?\n---\n?/, '');
  const nome = f.slice(radice.length + 1);
  const motivo = incompatibile(testo);
  if (motivo) {
    console.log(`MARKDOWN  ${nome}: ${motivo}`);
    continue;
  }
  const doc = daMarkdown(testo);
  const md1 = aMarkdown(doc);
  const doc2 = daMarkdown(md1);
  const md2 = aMarkdown(doc2);
  const ok = doc.eq(doc2) && md1 === md2;
  if (!ok) errori++;
  const uguale = md1.trim() === testo.trim();
  console.log(`${ok ? 'OK' : 'ERRORE'}${uguale ? '' : ' (riscritto)'}  ${nome}`);
  if (!ok || process.env.DIFF) {
    if (!uguale || !ok) console.log('--- prima\n' + testo.trim() + '\n--- dopo\n' + md1.trim() + '\n');
  }
}
console.log(`\n${file.length} pagine, ${errori} errori`);
process.exit(errori ? 1 : 0);
