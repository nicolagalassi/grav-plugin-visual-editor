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
// Le forme proprie dell'editor (allineamento, dimensioni, foto affiancate, video): devono tornare identiche.
const ESEMPIO = `Paragrafo centrato con <span class="ve-size-grande">parole **grandi**</span> e altro. {.ve-centro}

## Titolo a destra {.ve-destra}

Testo giustificato  
su due righe. {.ve-giustificato}

![Il tiro alla fune](<Palio 2026_Paola (833).JPG?classes=ve-img-sinistra>)

![Altra](foto.jpg?cropResize=300,200&classes=ve-img-destra)

<div class="ve-video" data-provider="youtube" data-id="dQw4w9WgXcQ" data-start="42" data-title="Il &quot;video&quot; &lt;3"></div>

<div class="ve-video" data-provider="vimeo" data-id="76979871" data-start="0" data-title=""></div>

- punto <span class="ve-size-piccolo">piccolo</span> {.ve-centro}
`;
{
  const motivo = incompatibile(ESEMPIO);
  const md1 = motivo ? '' : aMarkdown(daMarkdown(ESEMPIO));
  const ok = !motivo && md1 === ESEMPIO;
  if (!ok) {
    errori++;
    console.log(`ERRORE  esempio delle forme dell'editor${motivo ? `: ${motivo}` : ''}\n--- prima\n${ESEMPIO}--- dopo\n${md1}`);
  } else console.log('OK  esempio delle forme dell\'editor');
  for (const [nome, t] of [
    ['span non chiuso', 'a <span class="ve-size-grande">b\n'],
    ['altro HTML', '<div class="x">a</div>\n'],
    ['iframe', '<iframe src="https://example.com"></iframe>\n'],
    ['video di altro sito', '<div class="ve-video" data-provider="altro" data-id="x" data-start="0" data-title=""></div>\n'],
  ]) {
    const m = incompatibile(t);
    if (!m) errori++;
    console.log(`${m ? 'OK' : 'ERRORE'}  ${nome} -> ${m || 'aperto nell\'editor visuale'}`);
  }
}

console.log(`\n${file.length} pagine, ${errori} errori`);
process.exit(errori ? 1 : 0);
