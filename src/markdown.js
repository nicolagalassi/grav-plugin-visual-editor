// Markdown <-> documento dell'editor. Il file della pagina resta Markdown; quello che il Markdown non sa dire
// si scrive in forme piccole e leggibili, che il plugin (visual-editor.php) e Grav sanno impaginare:
//
//   allineamento di paragrafi e titoli   Testo del paragrafo {.ve-centro}       (anche ve-destra, ve-giustificato)
//   dimensione del testo                 <span class="ve-size-grande">parole</span>
//   foto affiancata al testo             ![descrizione](foto.jpg?classes=ve-img-sinistra)   (Grav: azione «classes»)
//   video YouTube / Vimeo                <div class="ve-video" data-provider="youtube" data-id="…" data-start="0" data-title="…"></div>
//                                        (il plugin lo trasforma nell'iframe: un iframe scritto nel testo il
//                                        pannello lo rifiuta come possibile XSS)
//
// Quello che l'editor non sa rappresentare (altro HTML, tabelle, shortcode, Twig) non lo tocca: la pagina si
// apre direttamente in modalità Markdown, così nulla va perso.
import MarkdownIt from 'markdown-it';
import { Schema } from 'prosemirror-model';
import {
  schema as base,
  MarkdownParser,
  MarkdownSerializer,
  defaultMarkdownParser,
  defaultMarkdownSerializer,
} from 'prosemirror-markdown';

export const ALLINEAMENTI = ['centro', 'destra', 'giustificato'];
export const ALLINEAMENTI_FOTO = ['sinistra', 'centro', 'destra'];

const daStileAllineamento = (dom) =>
  ({ center: 'centro', right: 'destra', justify: 'giustificato' })[dom.style?.textAlign] ||
  ALLINEAMENTI.find((a) => dom.classList?.contains(`ve-${a}`)) ||
  null;

const attrsAllineamento = { align: { default: null } };
const classeAllineamento = (node) => (node.attrs.align ? { class: `ve-${node.attrs.align}` } : {});

export const schema = new Schema({
  nodes: base.spec.nodes
    .update('paragraph', {
      ...base.spec.nodes.get('paragraph'),
      attrs: attrsAllineamento,
      parseDOM: [{ tag: 'p', getAttrs: (dom) => ({ align: daStileAllineamento(dom) }) }],
      toDOM: (node) => ['p', classeAllineamento(node), 0],
    })
    .update('heading', {
      ...base.spec.nodes.get('heading'),
      attrs: { level: { default: 2 }, ...attrsAllineamento },
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, getAttrs: (dom) => ({ level, align: daStileAllineamento(dom) }) })),
      toDOM: (node) => [`h${node.attrs.level}`, classeAllineamento(node), 0],
    })
    .update('image', {
      ...base.spec.nodes.get('image'),
      // query: il resto dell'indirizzo dopo «?» (altre azioni di Grav, es. cropResize), tenuto com'è
      attrs: { src: {}, alt: { default: null }, title: { default: null }, align: { default: null }, query: { default: '' } },
      parseDOM: [
        {
          tag: 'img[src]',
          getAttrs: (dom) => ({
            src: dom.getAttribute('src'),
            alt: dom.getAttribute('alt'),
            title: dom.getAttribute('title'),
            align: ALLINEAMENTI_FOTO.find((a) => dom.classList.contains(`ve-img-${a}`)) || null,
          }),
        },
      ],
      toDOM: (node) => ['img', { src: node.attrs.src, alt: node.attrs.alt, title: node.attrs.title, class: node.attrs.align ? `ve-img-${node.attrs.align}` : null }],
    })
    .addToEnd('video', {
      group: 'block',
      atom: true,
      draggable: true,
      attrs: { provider: {}, id: {}, start: { default: 0 }, title: { default: '' } },
      parseDOM: [
        {
          tag: 'div.ve-video',
          getAttrs: (dom) => {
            const v = videoValido(dom.dataset.provider, dom.dataset.id, dom.dataset.start);
            return v ? { ...v, title: dom.dataset.title || '' } : false;
          },
        },
      ],
      toDOM: (node) => ['div', { class: 've-video', 'data-provider': node.attrs.provider, 'data-id': node.attrs.id, 'data-start': String(node.attrs.start || 0), 'data-title': node.attrs.title || '' }],
    }),
  marks: base.spec.marks.addToEnd('size', {
    attrs: { key: {} },
    parseDOM: [
      {
        tag: 'span[class]',
        getAttrs: (dom) => {
          const m = /(?:^|\s)ve-size-([\w-]+)/.exec(dom.className);
          return m ? { key: m[1] } : false;
        },
      },
    ],
    toDOM: (mark) => ['span', { class: `ve-size-${mark.attrs.key}` }, 0],
  }),
});

// ---------- video ----------

/** Indirizzo di pagina YouTube / Vimeo (quello che si copia dal browser) -> { provider, id, start } */
export function daIndirizzoVideo(testo) {
  let u;
  try {
    u = new URL(testo.trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m)\./, '');
  const secondi = (t) => {
    if (!t) return 0;
    if (/^\d+$/.test(t)) return +t;
    const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
    return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
  };
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
    id = u.searchParams.get('v') || (/^\/(?:embed|shorts|live)\/([\w-]+)/.exec(u.pathname) || [])[1] || null;
  }
  if (id && /^[\w-]{6,}$/.test(id)) {
    return { provider: 'youtube', id, start: secondi(u.searchParams.get('t') || u.searchParams.get('start')) };
  }
  if (/(^|\.)vimeo\.com$/.test(host)) {
    const m = /\/(?:video\/)?(\d+)(?:\/|$)/.exec(u.pathname);
    if (m) return { provider: 'vimeo', id: m[1], start: 0 };
  }
  return null;
}

/** Fornitore e codice ammessi (gli stessi controlli li fa il plugin sul sito) */
export function videoValido(provider, id, start) {
  if (provider === 'youtube' && /^[\w-]{6,20}$/.test(id || '')) return { provider, id, start: +start || 0 };
  if (provider === 'vimeo' && /^\d{1,12}$/.test(id || '')) return { provider, id, start: 0 };
  return null;
}

const attributo = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const htmlVideo = (a) =>
  `<div class="ve-video" data-provider="${a.provider}" data-id="${a.id}" data-start="${a.start || 0}" data-title="${attributo(a.title || '')}"></div>`;

const RE_VIDEO = /^<div class="ve-video" data-provider="(youtube|vimeo)" data-id="([\w-]+)" data-start="(\d+)" data-title="([^"]*)"><\/div>$/;
const testoAttributo = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// ---------- lettura ----------

const RE_CLASSI_BLOCCO = /\s*\{((?:\.ve-[a-z0-9-]+\s*)+)\}\s*$/;
const RE_SPAN = /^<span class="ve-size-([\w-]+)">$/;

// Regola di markdown-it: trasforma le forme qui sopra in token che il parser dell'editor conosce.
function regolaEditor(md) {
  md.core.ruler.push('visual_editor', (state) => {
    const t = state.tokens;
    for (let i = 0; i < t.length; i++) {
      const tok = t[i];
      if ((tok.type === 'paragraph_open' || tok.type === 'heading_open') && t[i + 1]?.type === 'inline') {
        const inline = t[i + 1];
        const ultimo = inline.children[inline.children.length - 1];
        const m = ultimo?.type === 'text' && RE_CLASSI_BLOCCO.exec(ultimo.content);
        if (m) {
          const classi = m[1].trim().split(/\s+/).map((c) => c.slice(4));
          const align = classi.find((c) => ALLINEAMENTI.includes(c));
          if (align && classi.length === 1) {
            ultimo.content = ultimo.content.slice(0, m.index);
            if (!ultimo.content) inline.children.pop();
            tok.meta = { ...(tok.meta || {}), align };
          }
        }
      }
      if (tok.type === 'html_block') {
        const m = RE_VIDEO.exec(tok.content.trim());
        const v = m && videoValido(m[1], m[2], m[3]);
        if (v) {
          tok.type = 've_video';
          tok.meta = { ...v, title: testoAttributo(m[4]) };
        }
      }
      if (tok.type === 'inline' && tok.children) {
        const aperti = [];
        for (const c of tok.children) {
          if (c.type !== 'html_inline') continue;
          const m = RE_SPAN.exec(c.content);
          if (m) {
            c.type = 've_size_open';
            c.meta = { key: m[1] };
            aperti.push(c);
          } else if (c.content === '</span>' && aperti.length) {
            c.type = 've_size_close';
            aperti.pop();
          }
        }
        // Uno span aperto e mai chiuso resta HTML: lo nota incompatibile()
        for (const c of aperti) c.type = 'html_inline';
      }
    }
  });
}

const md = MarkdownIt('commonmark', { html: true }).enable('table').use(regolaEditor);

const dividiQuery = (src) => {
  const i = src.indexOf('?');
  return i < 0 ? [src, ''] : [src.slice(0, i), src.slice(i + 1)];
};

const tokens = {
  ...defaultMarkdownParser.tokens,
  paragraph: { block: 'paragraph', getAttrs: (tok) => ({ align: tok.meta?.align || null }) },
  heading: { block: 'heading', getAttrs: (tok) => ({ level: +tok.tag.slice(1), align: tok.meta?.align || null }) },
  image: {
    node: 'image',
    getAttrs: (tok) => {
      const [src, query] = dividiQuery(tok.attrGet('src'));
      const params = new URLSearchParams(query);
      const classi = (params.get('classes') || '').split(',').filter(Boolean);
      const align = ALLINEAMENTI_FOTO.find((a) => classi.includes(`ve-img-${a}`)) || null;
      const resto = classi.filter((c) => !c.startsWith('ve-img-'));
      if (resto.length) params.set('classes', resto.join(','));
      else params.delete('classes');
      return {
        src,
        query: params.toString(),
        align,
        title: tok.attrGet('title') || null,
        alt: (tok.children[0] && tok.children[0].content) || null,
      };
    },
  },
  ve_video: { node: 'video', noCloseToken: true, getAttrs: (tok) => tok.meta },
  ve_size: { mark: 'size', getAttrs: (tok) => ({ key: tok.meta.key }) },
};

export const parser = new MarkdownParser(schema, md, tokens);

// ---------- scrittura ----------

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
const fineBlocco = (state, node) => {
  if (node.attrs.align) state.write(` {.ve-${node.attrs.align}}`);
};

export const serializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    paragraph(state, node) {
      state.renderInline(node);
      fineBlocco(state, node);
      state.closeBlock(node);
    },
    heading(state, node) {
      // Il titolo della pagina è già l'h1: nel testo si parte da ##.
      const livello = Math.min(Math.max(node.attrs.level, 2), 6);
      state.write(state.repeat('#', livello) + ' ');
      state.renderInline(node, false);
      fineBlocco(state, node);
      state.closeBlock(node);
    },
    bullet_list(state, node) {
      state.renderList(node, '  ', () => '- ');
    },
    image(state, node) {
      const params = new URLSearchParams(node.attrs.query || '');
      if (node.attrs.align) {
        const altre = (params.get('classes') || '').split(',').filter(Boolean);
        params.set('classes', [...altre, `ve-img-${node.attrs.align}`].join(','));
      }
      const query = params.toString().replace(/%2C/gi, ',');
      const src = decodifica(node.attrs.src) + (query ? `?${query}` : '');
      state.write(`![${state.esc(node.attrs.alt || '')}](${indirizzo(src)}${titolo(node.attrs.title)})`);
    },
    video(state, node) {
      state.write(htmlVideo(node.attrs));
      state.closeBlock(node);
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
    size: {
      open: (_s, mark) => `<span class="ve-size-${mark.attrs.key}">`,
      close: '</span>',
      mixable: true,
      expelEnclosingWhitespace: true,
    },
  },
);

// ---------- compatibilità ----------

/**
 * Motivo per cui il testo non si può aprire nell'editor visuale senza perdere qualcosa, o null se si può.
 */
export function incompatibile(testo) {
  const tipi = new Set();
  const visita = (lista) => {
    for (const t of lista) {
      tipi.add(t.type);
      if (t.children) visita(t.children);
    }
  };
  visita(md.parse(testo || '', {}));
  if (tipi.has('html_block') || tipi.has('html_inline')) return 'contiene codice HTML';
  if (tipi.has('table_open')) return 'contiene una tabella';
  if (/\[\/[a-z][\w-]*\]|\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(testo)) return 'contiene blocchi speciali (shortcode o avvisi)';
  if (/\{\{|\{%/.test(testo)) return 'contiene codice Twig';
  return null;
}

export const daMarkdown = (testo) => parser.parse(testo || '');

export const aMarkdown = (doc) => serializer.serialize(doc, { tightLists: true }).replace(/\s+$/, '') + '\n';
