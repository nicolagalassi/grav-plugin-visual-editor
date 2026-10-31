// Markdown <-> documento dell'editor. Il file della pagina resta Markdown: l'editor lo legge e lo riscrive
// solo con gli elementi che il tema sa impaginare (paragrafi, titoli, grassetto, corsivo, link, citazioni,
// elenchi, righe, foto). Quello che non sa rappresentare (HTML, tabelle, shortcode) non lo tocca: la pagina
// si apre direttamente in modalità Markdown, così nulla va perso.
import MarkdownIt from 'markdown-it';
import {
  schema,
  MarkdownParser,
  MarkdownSerializer,
  defaultMarkdownParser,
  defaultMarkdownSerializer,
} from 'prosemirror-markdown';

export { schema };

// CommonMark senza HTML: un tag scritto a mano non diventa mai un elemento dell'editor.
export const parser = new MarkdownParser(
  schema,
  MarkdownIt('commonmark', { html: false }),
  defaultMarkdownParser.tokens,
);

// Indirizzi con spazi o parentesi (es. «Palio 2026_Paola (1098).JPG») tra < >, come li scrive il pannello.
// markdown-it codifica gli spazi (%20): nel file torna il nome com'è, perché Grav cerca il file con quel nome.
const decodifica = (u) => {
  try {
    return decodeURI(u);
  } catch {
    return u;
  }
};
const indirizzo = (src) => {
  const u = decodifica(src);
  return /[\s()<>]/.test(u) ? `<${u.replace(/[<>]/g, encodeURIComponent)}>` : u;
};
const titolo = (t) => (t ? ` "${t.replace(/"/g, '\\"')}"` : '');

export const serializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    bullet_list(state, node) {
      state.renderList(node, '  ', () => '- ');
    },
    image(state, node) {
      state.write(`![${state.esc(node.attrs.alt || '')}](${indirizzo(node.attrs.src)}${titolo(node.attrs.title)})`);
    },
    // Grav usa Parsedown: l'a capo con «\» di CommonMark non lo conosce, i due spazi finali sì.
    hard_break(state, node, parent, index) {
      for (let i = index + 1; i < parent.childCount; i++) {
        if (parent.child(i).type !== node.type) {
          state.write('  \n');
          return;
        }
      }
    },
    heading(state, node) {
      // Il titolo della pagina è già l'h1: nel testo si parte da ##.
      const livello = Math.min(Math.max(node.attrs.level, 2), 6);
      state.write(state.repeat('#', livello) + ' ');
      state.renderInline(node, false);
      state.closeBlock(node);
    },
  },
  {
    ...defaultMarkdownSerializer.marks,
    link: {
      ...defaultMarkdownSerializer.marks.link,
      close(state, mark, parent, index) {
        const auto = state.inAutolink;
        state.inAutolink = undefined;
        return auto ? '>' : `](${indirizzo(mark.attrs.href)}${titolo(mark.attrs.title)})`;
      },
    },
  },
);

const analizzatore = MarkdownIt('commonmark', { html: true }).enable('table');

/**
 * Motivo per cui il testo non si può aprire nell'editor visuale senza perdere qualcosa, o null se si può.
 */
export function incompatibile(md) {
  const tipi = new Set();
  const visita = (tokens) => {
    for (const t of tokens) {
      tipi.add(t.type);
      if (t.children) visita(t.children);
    }
  };
  visita(analizzatore.parse(md || '', {}));
  if (tipi.has('html_block') || tipi.has('html_inline')) return 'contiene codice HTML';
  if (tipi.has('table_open')) return 'contiene una tabella';
  if (/\[\/[a-z][\w-]*\]|\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(md)) return 'contiene blocchi speciali (shortcode o avvisi)';
  if (/\{\{|\{%/.test(md)) return 'contiene codice Twig';
  return null;
}

export const daMarkdown = (md) => parser.parse(md || '');

export const aMarkdown = (doc) => serializer.serialize(doc, { tightLists: true }).replace(/\s+$/, '') + '\n';
