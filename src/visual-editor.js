// Campo «visual-editor» del pannello (Admin2): scrittura visuale come in un programma di videoscrittura, ma con
// stili sobri e coerenti. Il pannello passa il Markdown della pagina in `value` e riceve il nuovo Markdown
// dall'evento `change` (detail = testo). Contratto dei campi personalizzati: plugins/api,
// GpmController::customFieldBundle; il nome del tag arriva in window.__GRAV_FIELD_TAG. Le impostazioni del
// plugin arrivano in `field.ve` (visual-editor.php, onApiBlueprintResolved).
import { EditorState, Plugin, NodeSelection, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { Slice, Fragment } from 'prosemirror-model';
import { baseKeymap, toggleMark, setBlockType, wrapIn, lift, chainCommands, exitCode } from 'prosemirror-commands';
import { keymap } from 'prosemirror-keymap';
import { history, undo, redo } from 'prosemirror-history';
import { inputRules, wrappingInputRule, textblockTypeInputRule, smartQuotes, emDash, ellipsis } from 'prosemirror-inputrules';
import { wrapInList, liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import cssProsemirror from 'prosemirror-view/style/prosemirror.css';
import cssGapcursor from 'prosemirror-gapcursor/style/gapcursor.css';
import { schema, daMarkdown, aMarkdown, incompatibile, daIndirizzoVideo } from './markdown.js';

const TAG = window.__GRAV_FIELD_TAG;
const N = schema.nodes;
const M = schema.marks;

const server = () => (window.__GRAV_API_SERVER_URL || '').replace(/\/$/, '');

// Indirizzo del sito (es. «/prova» se Grav sta in una sottocartella): il pannello sta in <sito>/admin.
const sito = () => server() || (window.__GRAV_ADMIN_BASE || '/admin').replace(/\/[^/]*\/?$/, '');

// I caratteri del sito: @font-face vale solo nel documento, non dentro lo shadow DOM.
function caricaCaratteri(percorso) {
  if (!percorso || document.getElementById('visual-editor-caratteri')) return;
  const l = document.createElement('link');
  l.id = 'visual-editor-caratteri';
  l.rel = 'stylesheet';
  l.href = /^(https?:)?\/\//.test(percorso) ? percorso : `${sito()}/${percorso.replace(/^\//, '')}`;
  document.head.appendChild(l);
}

const ICONE = {
  sinistra: '<path d="M3 5h14M3 9h10M3 13h14M3 17h10"/>',
  centro: '<path d="M3 5h14M5 9h10M3 13h14M5 17h10"/>',
  destra: '<path d="M3 5h14M7 9h10M3 13h14M7 17h10"/>',
  giustificato: '<path d="M3 5h14M3 9h14M3 13h14M3 17h14"/>',
  'foto-linea': '<rect x="3" y="4" width="14" height="8" rx="1"/><path d="M3 15h14M3 18h10"/>',
  'foto-sinistra': '<rect x="2" y="4" width="7" height="7" rx="1"/><path d="M11 5h7M11 8h7M11 11h7M2 15h16M2 18h12"/>',
  'foto-centro': '<rect x="6" y="3" width="8" height="8" rx="1"/><path d="M2 14h16M2 17h16"/>',
  'foto-destra': '<rect x="11" y="4" width="7" height="7" rx="1"/><path d="M2 5h7M2 8h7M2 11h7M2 15h16M2 18h12"/>',
};
const icona = (nome) =>
  `<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">${ICONE[nome]}</svg>`;

// ---------- foto della pagina ----------

const mediaPagina = () => {
  try {
    return (window.__GRAV_PAGE_MEDIA?.() || []).filter((m) => /^image\//.test(m.type || '') || /\.(jpe?g|png|webp|gif|svg)$/i.test(m.filename));
  } catch {
    return [];
  }
};

function urlFoto(src) {
  if (/^(https?:)?\/\//.test(src) || src.startsWith('data:')) return src;
  const nome = decodeURIComponent(src);
  const m = mediaPagina().find((x) => x.filename === nome);
  if (m) return m.url;
  return src.startsWith('/') ? sito() + src : '';
}

class VistaFoto {
  constructor(node) {
    this.dom = document.createElement('span');
    this.img = document.createElement('img');
    this.nota = document.createElement('span');
    this.nota.className = 'foto__nota';
    this.dom.append(this.img, this.nota);
    this.update(node);
  }
  update(node) {
    if (node.type !== N.image) return false;
    const url = urlFoto(node.attrs.src);
    if (url) this.img.src = url;
    else this.img.removeAttribute('src');
    this.img.alt = node.attrs.alt || '';
    this.dom.className = `foto${node.attrs.align ? ` ve-img-${node.attrs.align}` : ''}${url ? '' : ' foto--mancante'}`;
    this.nota.textContent = url ? node.attrs.alt || 'Senza descrizione' : `Foto non trovata: ${node.attrs.src}`;
    return true;
  }
  ignoreMutation() {
    return true;
  }
}

// Il video nell'editor è un'anteprima: l'immagine di YouTube (o un riquadro per Vimeo) con il titolo.
class VistaVideo {
  constructor(node) {
    this.dom = document.createElement('div');
    this.dom.className = 'video';
    this.dom.contentEditable = 'false';
    this.update(node);
  }
  update(node) {
    if (node.type !== N.video) return false;
    const { provider, id, start, title } = node.attrs;
    this.dom.innerHTML = '<span class="video__play" aria-hidden="true">▶</span><span class="video__nota"></span>';
    if (provider === 'youtube') this.dom.style.backgroundImage = `url("https://i.ytimg.com/vi/${id}/hqdefault.jpg")`;
    else this.dom.style.backgroundImage = '';
    const da = start ? ` · da ${Math.floor(start / 60)}:${String(start % 60).padStart(2, '0')}` : '';
    this.dom.querySelector('.video__nota').textContent = `Video ${provider === 'youtube' ? 'YouTube' : 'Vimeo'}${da} · ${title || 'senza titolo'}`;
    return true;
  }
  ignoreMutation() {
    return true;
  }
  stopEvent() {
    return false;
  }
}

// ---------- comandi ----------

const segnaAttivo = (state, tipo) => {
  const { from, $from, to, empty } = state.selection;
  return empty ? !!tipo.isInSet(state.storedMarks || $from.marks()) : state.doc.rangeHasMark(from, to, tipo);
};

const bloccoAttivo = (state, tipo, attrs) => {
  const { $from, to } = state.selection;
  if (state.selection instanceof NodeSelection) return false;
  return to <= $from.end() && $from.parent.type === tipo && (!attrs || Object.entries(attrs).every(([k, v]) => $from.parent.attrs[k] === v));
};

const dentro = (state, tipo) => {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === tipo) return true;
  return false;
};

// Cambiare tipo di blocco tiene l'allineamento
const tipoBlocco = (tipo, attrs) => (state, dispatch, view) => {
  const align = state.selection.$from.parent.attrs.align ?? null;
  return setBlockType(tipo, { ...attrs, align })(state, dispatch, view);
};

// Sempre disponibile in un paragrafo, così il menu mostra lo stato attivo.
const testoNormale = (state, dispatch, view) => bloccoAttivo(state, N.paragraph) || tipoBlocco(N.paragraph)(state, dispatch, view);

const elenco = (tipo) => (state, dispatch, view) =>
  dentro(state, tipo) ? liftListItem(N.list_item)(state, dispatch, view) : wrapInList(tipo, { tight: true })(state, dispatch, view);

const citazione = (state, dispatch, view) => (dentro(state, N.blockquote) ? lift(state, dispatch, view) : wrapIn(N.blockquote)(state, dispatch, view));

const aCapo = chainCommands(exitCode, (state, dispatch) => {
  dispatch?.(state.tr.replaceSelectionWith(N.hard_break.create()).scrollIntoView());
  return true;
});

const riga = (state, dispatch) => {
  dispatch?.(state.tr.replaceSelectionWith(N.horizontal_rule.create()).scrollIntoView());
  return true;
};

// Paragrafi e titoli toccati dalla selezione
const blocchiTesto = (state) => {
  const out = [];
  const { from, to } = state.selection;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type === N.paragraph || node.type === N.heading) out.push({ node, pos });
  });
  return out;
};

const allineaTesto = (align) => (state, dispatch) => {
  const blocchi = blocchiTesto(state);
  if (!blocchi.length || state.selection instanceof NodeSelection) return false;
  if (dispatch) {
    const tr = state.tr;
    const valore = align === 'sinistra' ? null : align;
    for (const { node, pos } of blocchi) tr.setNodeMarkup(pos, null, { ...node.attrs, align: valore });
    dispatch(tr);
  }
  return true;
};

const allineamentoAttivo = (state, align) => {
  const blocchi = blocchiTesto(state);
  return blocchi.length > 0 && !(state.selection instanceof NodeSelection) && blocchi.every(({ node }) => (node.attrs.align || 'sinistra') === align);
};

// Dimensione del testo: un segno «size» sul testo selezionato (o su quello che si scrive dopo)
const dimensione = (key) => (state, dispatch) => {
  if (state.selection instanceof NodeSelection || !state.selection.$from.parent.inlineContent) return false;
  if (!dispatch) return true;
  const { from, to, empty } = state.selection;
  if (empty) {
    const altri = (state.storedMarks || state.selection.$from.marks()).filter((m) => m.type !== M.size);
    dispatch(state.tr.setStoredMarks(key ? [...altri, M.size.create({ key })] : altri));
    return true;
  }
  const tr = state.tr.removeMark(from, to, M.size);
  if (key) tr.addMark(from, to, M.size.create({ key }));
  dispatch(tr.scrollIntoView());
  return true;
};

const dimensioneAttiva = (state) => {
  const { from, to, empty, $from } = state.selection;
  if (empty) return M.size.isInSet(state.storedMarks || $from.marks())?.attrs.key ?? '';
  let chiave;
  let mista = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return;
    const k = M.size.isInSet(node.marks)?.attrs.key ?? '';
    if (chiave === undefined) chiave = k;
    else if (chiave !== k) mista = true;
  });
  return mista ? null : chiave ?? '';
};

const fotoSelezionata = (state) => state.selection instanceof NodeSelection && state.selection.node.type === N.image;

const allineaFoto = (align) => (state, dispatch) => {
  if (!fotoSelezionata(state)) return false;
  if (dispatch) {
    const { node, from } = state.selection;
    const tr = state.tr.setNodeMarkup(from, null, { ...node.attrs, align: align === 'linea' ? null : align });
    tr.setSelection(NodeSelection.create(tr.doc, from));
    dispatch(tr);
  }
  return true;
};

/** Confini del link intorno al cursore (o della selezione) */
function estendiLink(state) {
  const { $from, from, to, empty } = state.selection;
  if (!empty) return { from, to };
  const genitore = $from.parent;
  const start = $from.start();
  const link = M.link.isInSet($from.marks());
  if (!link) return { from, to };
  let inizio = null;
  let fine = null;
  genitore.forEach((figlio, offset) => {
    const ha = link.isInSet(figlio.marks);
    if (ha && offset <= $from.parentOffset && offset + figlio.nodeSize >= $from.parentOffset) {
      inizio = offset;
      fine = offset + figlio.nodeSize;
    }
  });
  if (inizio === null) return { from, to };
  // Pezzi contigui con lo stesso link (es. una parola in grassetto dentro il link)
  let cambiato = true;
  while (cambiato) {
    cambiato = false;
    genitore.forEach((figlio, offset) => {
      if (!link.isInSet(figlio.marks)) return;
      if (offset + figlio.nodeSize === inizio) (inizio = offset), (cambiato = true);
      if (offset === fine) (fine = offset + figlio.nodeSize), (cambiato = true);
    });
  }
  return { from: start + inizio, to: start + fine };
}

const normalizzaLink = (href) => {
  href = href.trim();
  if (!href) return '';
  if (/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(href)) return href;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(href)) return `mailto:${href}`;
  if (/^\+?[\d\s]{6,}$/.test(href)) return `tel:${href.replace(/\s/g, '')}`;
  return `https://${href}`;
};

// ---------- incolla da Word / pagine web ----------

// Lo schema tiene già solo gli elementi ammessi (via colori, caratteri, tabelle; l'allineamento resta). Qui si
// sistemano i titoli (h1 -> Titolo, h4-h6 -> Sottotitolo), gli elenchi diventano compatti e si scartano le
// immagini incollate, che non sono file della pagina.
function pulisci(fragment) {
  const nodi = [];
  fragment.forEach((n) => {
    if (n.type === N.image && !mediaPagina().some((m) => m.filename === n.attrs.src)) return;
    if (n.type === N.heading) {
      nodi.push(N.heading.create({ ...n.attrs, level: n.attrs.level <= 2 ? 2 : 3 }, pulisci(n.content)));
      return;
    }
    if (n.type === N.bullet_list || n.type === N.ordered_list) {
      nodi.push(n.type.create({ ...n.attrs, tight: true }, pulisci(n.content)));
      return;
    }
    nodi.push(n.isText || n.isLeaf ? n : n.copy(pulisci(n.content)));
  });
  return Fragment.from(nodi);
}

const pianoIncolla = new Plugin({
  props: {
    transformPasted: (slice) => new Slice(pulisci(slice.content), slice.openStart, slice.openEnd),
  },
});

// ---------- regole mentre si scrive ----------

const regole = inputRules({
  rules: [
    ...smartQuotes,
    ellipsis,
    emDash,
    textblockTypeInputRule(/^(#{2,3})\s$/, N.heading, (m) => ({ level: m[1].length })),
    wrappingInputRule(/^\s*>\s$/, N.blockquote),
    wrappingInputRule(/^\s*([-+*])\s$/, N.bullet_list, { tight: true }),
    wrappingInputRule(/^(\d+)\.\s$/, N.ordered_list, (m) => ({ order: +m[1], tight: true }), (m, n) => n.childCount + n.attrs.order === +m[1]),
  ],
});

// ---------- barra ----------

// Ogni voce: bottone (testo o icona) con comando; `gruppo` raccoglie le voci tra due separatori; `solo`
// mostra la voce solo quando vale (es. i comandi della foto con una foto selezionata).
const BARRA = [
  { tipo: 'stile' },
  { tipo: 'dimensione' },
  '|',
  { id: 'grassetto', testo: 'G', classe: 'b', titolo: 'Grassetto (Ctrl+B)', cmd: () => toggleMark(M.strong), attivo: (s) => segnaAttivo(s, M.strong) },
  { id: 'corsivo', testo: 'C', classe: 'i', titolo: 'Corsivo (Ctrl+I)', cmd: () => toggleMark(M.em), attivo: (s) => segnaAttivo(s, M.em) },
  { id: 'link', testo: 'Link', titolo: 'Inserisci o modifica un link (Ctrl+K)', cmd: (h) => h.comandoLink(), attivo: (s) => segnaAttivo(s, M.link) },
  '|',
  ...['sinistra', 'centro', 'destra', 'giustificato'].map((a) => ({
    id: `allinea-${a}`,
    icona: a,
    titolo: { sinistra: 'Allinea a sinistra', centro: 'Centra', destra: 'Allinea a destra', giustificato: 'Giustifica' }[a],
    cmd: () => allineaTesto(a),
    attivo: (s) => allineamentoAttivo(s, a),
    nascondi: fotoSelezionata,
  })),
  ...['linea', 'sinistra', 'centro', 'destra'].map((a) => ({
    id: `foto-${a}`,
    icona: `foto-${a}`,
    titolo: { linea: 'Foto a tutta larghezza', sinistra: 'Foto a sinistra, testo intorno', centro: 'Foto al centro, più piccola', destra: 'Foto a destra, testo intorno' }[a],
    cmd: () => allineaFoto(a),
    attivo: (s) => fotoSelezionata(s) && (s.selection.node.attrs.align || 'linea') === a,
    solo: fotoSelezionata,
  })),
  { id: 'descrizione', testo: 'Descrizione', titolo: 'Descrizione della foto (per chi non vede e per i motori di ricerca)', cmd: (h) => h.comandoDescrizione(), solo: fotoSelezionata },
  '|',
  { id: 'citazione', testo: 'Citazione', titolo: 'Citazione', cmd: () => citazione, attivo: (s) => dentro(s, N.blockquote) },
  { id: 'puntato', testo: '• Elenco', titolo: 'Elenco puntato', cmd: () => elenco(N.bullet_list), attivo: (s) => dentro(s, N.bullet_list) },
  { id: 'numerato', testo: '1. Elenco', titolo: 'Elenco numerato', cmd: () => elenco(N.ordered_list), attivo: (s) => dentro(s, N.ordered_list) },
  { id: 'riga', testo: '—', titolo: 'Riga di separazione', cmd: () => riga },
  '|',
  { id: 'foto', testo: 'Foto', titolo: 'Inserisci una foto della pagina', cmd: (h) => h.comandoFoto() },
  { id: 'video', testo: 'Video', titolo: 'Inserisci un video di YouTube o Vimeo', cmd: (h) => h.comandoVideo(), abilitato: (h) => h.config.video !== false },
  '|',
  { id: 'annulla', testo: '↶', titolo: 'Annulla (Ctrl+Z)', cmd: () => undo },
  { id: 'ripeti', testo: '↷', titolo: 'Ripeti (Ctrl+Y)', cmd: () => redo },
];

const STILI = [
  { valore: 'paragrafo', nome: 'Testo', cmd: () => testoNormale, attivo: (s) => bloccoAttivo(s, N.paragraph) },
  { valore: 'titolo', nome: 'Titolo', cmd: () => tipoBlocco(N.heading, { level: 2 }), attivo: (s) => bloccoAttivo(s, N.heading, { level: 2 }) },
  { valore: 'sottotitolo', nome: 'Sottotitolo', cmd: () => tipoBlocco(N.heading, { level: 3 }), attivo: (s) => bloccoAttivo(s, N.heading, { level: 3 }) },
];

const STILE = `
:host { display: block; --ve-testo: Georgia, 'Times New Roman', serif; --ve-titoli: var(--ve-testo); --ve-accento: #c4004a; }
${cssProsemirror}
${cssGapcursor}
.cornice { border: 1px solid #d4d4d8; border-radius: 10px; overflow: clip; background: #fbfaf7; }
.barra { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 2px;
  padding: 6px; background: #fff; border-bottom: 1px solid #e4e4e7; font: 13px/1 system-ui, sans-serif; }
.barra button, .barra select { min-height: 32px; border: 1px solid transparent; border-radius: 6px; background: none;
  color: #18181b; font: inherit; cursor: pointer; }
.barra button { padding: 0 8px; display: inline-flex; align-items: center; justify-content: center; }
.barra button.ico { width: 32px; padding: 0; }
.barra select { padding: 0 6px; border-color: #e4e4e7; }
.barra button:hover, .barra select:hover { background: #f4f4f5; }
.barra button[aria-pressed='true'] { background: #18181b; color: #fff; }
.barra button:disabled, .barra select:disabled { opacity: 0.35; cursor: default; background: none; }
.barra :focus-visible { outline: 2px solid var(--ve-accento); outline-offset: 1px; }
.barra .b { font-weight: 800; font-family: Georgia, serif; }
.barra .i { font-style: italic; font-family: Georgia, serif; }
.barra .sep { width: 1px; height: 20px; background: #e4e4e7; margin: 0 4px; }
.barra .destra { margin-left: auto; }
[hidden] { display: none !important; }

.ProseMirror { min-height: 420px; padding: 28px clamp(16px, 5%, 56px) 40px; outline: none; color: #17140f;
  font-family: var(--ve-testo); font-size: 19px; line-height: 1.7; max-width: 44rem; margin: 0 auto; }
.ProseMirror::after { content: ''; display: block; clear: both; }
.ProseMirror p { margin: 0 0 1em; }
.ProseMirror h2, .ProseMirror h3 { font-family: var(--ve-titoli); line-height: 1.15; margin: 1.4em 0 0.5em; clear: both; }
.ProseMirror h2 { font-size: 1.75em; }
.ProseMirror h3 { font-size: 1.3em; }
.ProseMirror .ve-centro { text-align: center; }
.ProseMirror .ve-destra { text-align: right; }
.ProseMirror .ve-giustificato { text-align: justify; hyphens: auto; }
.ProseMirror a { color: var(--ve-accento); text-decoration: underline; }
.ProseMirror blockquote { margin: 1.4em 0; padding: 0.1em 0 0.1em 1.1em; border-left: 3px solid var(--ve-accento);
  font-family: var(--ve-titoli); font-style: italic; font-size: 1.25em; line-height: 1.4; }
.ProseMirror blockquote p { margin: 0.3em 0; }
.ProseMirror ul, .ProseMirror ol { padding-left: 1.4em; margin: 0 0 1em; }
.ProseMirror li p { margin: 0.2em 0; }
.ProseMirror hr { border: 0; height: 1px; background: #d4d4d8; margin: 2em 15%; clear: both; }
.ProseMirror code { font-family: ui-monospace, monospace; font-size: 0.85em; background: #f4f4f5; padding: 0.1em 0.3em; border-radius: 3px; }
.ProseMirror .foto { display: inline-block; max-width: 100%; margin: 0.6em 0; vertical-align: top; }
.ProseMirror .foto img { display: block; max-width: 100%; height: auto; }
.ProseMirror .foto.ve-img-sinistra { float: left; width: min(45%, 22rem); margin: 0.35em 1.25em 0.8em 0; }
.ProseMirror .foto.ve-img-destra { float: right; width: min(45%, 22rem); margin: 0.35em 0 0.8em 1.25em; }
.ProseMirror .foto.ve-img-sinistra img, .ProseMirror .foto.ve-img-destra img { width: 100%; }
.ProseMirror .foto.ve-img-centro { display: block; width: 70%; margin: 1em auto; }
.ProseMirror .foto.ve-img-centro img { width: 100%; }
.ProseMirror .foto__nota { display: block; margin-top: 4px; font: 12px/1.3 system-ui, sans-serif; color: #52525b; text-align: left; }
.ProseMirror .foto--mancante { padding: 18px; border: 1px dashed var(--ve-accento); }
.ProseMirror .ProseMirror-selectednode img, .ProseMirror .video.ProseMirror-selectednode { outline: 3px solid var(--ve-accento); outline-offset: 2px; }
.ProseMirror .video { position: relative; display: grid; place-items: center; aspect-ratio: 16 / 9; margin: 1.2em 0; clear: both;
  background: #18181b center / cover no-repeat; color: #fff; border-radius: 4px; cursor: pointer; }
.ProseMirror .video__play { display: grid; place-items: center; width: 64px; height: 44px; border-radius: 12px; background: rgb(0 0 0 / 0.7); font-size: 20px; }
.ProseMirror .video__nota { position: absolute; left: 0; right: 0; bottom: 0; padding: 8px 12px; background: linear-gradient(transparent, rgb(0 0 0 / 0.75));
  font: 13px/1.3 system-ui, sans-serif; }
.ProseMirror p.vuoto:first-child::before { content: attr(data-invito); color: #8a8172; pointer-events: none; float: left; height: 0; }

.sorgente { display: block; width: 100%; min-height: 420px; box-sizing: border-box; padding: 20px; border: 0; resize: vertical;
  background: #fff; color: #18181b; font: 14px/1.6 ui-monospace, monospace; }
.avviso { margin: 0; padding: 10px 14px; background: #fff4d6; border-bottom: 1px solid #e8d49a; font: 13px/1.4 system-ui, sans-serif; color: #5a4300; }

.velo { position: fixed; inset: 0; z-index: 1000; background: rgb(0 0 0 / 0.35); }
.pannello { position: fixed; z-index: 1001; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(640px, 92vw); max-height: 75vh; overflow: auto; padding: 16px;
  background: #fff; border: 1px solid #d4d4d8; border-radius: 10px; box-shadow: 0 10px 30px rgb(0 0 0 / 0.18);
  font: 13px/1.4 system-ui, sans-serif; color: #18181b; }
.pannello h3 { margin: 0 0 12px; font-size: 15px; }
.pannello .griglia { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
.pannello .griglia button { display: grid; gap: 4px; padding: 6px; border: 1px solid #e4e4e7; border-radius: 8px; background: #fafafa; cursor: pointer; text-align: left; font: inherit; color: inherit; }
.pannello .griglia button:hover, .pannello .griglia button:focus-visible { border-color: var(--ve-accento); outline: none; }
.pannello .griglia img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 4px; background: #eee; }
.pannello .griglia span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pannello .azioni { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; align-items: center; }
.pannello button { min-height: 34px; padding: 0 14px; border-radius: 6px; border: 1px solid #d4d4d8; background: #fff; cursor: pointer; font: inherit; color: inherit; }
.pannello .primario { background: var(--ve-accento); border-color: var(--ve-accento); color: #fff; }
.pannello .pericolo { margin-left: auto; color: #b91c1c; }
.pannello form { display: grid; gap: 12px; }
.pannello label { display: grid; gap: 4px; font-weight: 600; }
.pannello label small { font-weight: 400; color: #52525b; }
.pannello input[type=text], .pannello input[type=url] { min-height: 36px; padding: 0 10px; border: 1px solid #d4d4d8; border-radius: 6px; font: inherit; font-weight: 400; }
.pannello .errore { margin: 0; color: #b91c1c; }
.pannello .vuoto { color: #52525b; }
.contenitore { position: relative; }
`;

class VisualEditor extends HTMLElement {
  _field = {};
  _value = '';
  _emesso = null;
  view = null;
  modo = 'visuale';

  set field(f) {
    this._field = f || {};
    if (this.view) this.view.setProps({ editable: () => !this.solaLettura });
    if (this.root) this.applicaConfig();
  }
  get field() {
    return this._field;
  }

  /** Impostazioni del plugin, passate dal server nella definizione del campo */
  get config() {
    return this._field.ve || {};
  }

  get dimensioni() {
    return Array.isArray(this.config.dimensioni) ? this.config.dimensioni : [];
  }

  get solaLettura() {
    return !!(this._field.disabled || this._field.readonly);
  }

  set value(v) {
    v = typeof v === 'string' ? v : '';
    // Il pannello ci rimanda il valore appena emesso: ignorarlo evita di ricaricare il documento e
    // spostare il cursore mentre si scrive.
    if (v === this._emesso || v === this._value) return;
    this._value = v;
    if (this.isConnected && this.root) this.carica(v);
  }
  get value() {
    return this._value;
  }

  connectedCallback() {
    if (this.root) return;
    this.root = this.attachShadow({ mode: 'open' });
    this.root.innerHTML = `<style>${STILE}</style><style class="config"></style>
      <div class="contenitore">
        <div class="cornice">
          <div class="barra" role="toolbar" aria-label="Formattazione del testo"></div>
          <p class="avviso" hidden></p>
          <div class="area"></div>
          <textarea class="sorgente" hidden spellcheck="true" aria-label="Testo in Markdown"></textarea>
        </div>
        <div class="velo" hidden></div>
        <div class="pannello" hidden role="dialog" aria-modal="true"></div>
      </div>`;
    this.barra = this.root.querySelector('.barra');
    this.avviso = this.root.querySelector('.avviso');
    this.area = this.root.querySelector('.area');
    this.sorgente = this.root.querySelector('.sorgente');
    this.pannello = this.root.querySelector('.pannello');
    this.velo = this.root.querySelector('.velo');
    this.velo.addEventListener('click', () => this.chiudiPannello());
    this.applicaConfig();
    this.sorgente.addEventListener('input', () => this.emetti(this.sorgente.value));
    this.carica(this._value);
  }

  disconnectedCallback() {
    this.scrivi();
  }

  applicaConfig() {
    const c = this.config;
    caricaCaratteri(c.caratteri);
    const pulito = (s) => String(s || '').replace(/[;{}<>]/g, '');
    let css = ':host {';
    if (c.font_testo) css += `--ve-testo: ${pulito(c.font_testo)};`;
    if (c.font_titoli) css += `--ve-titoli: ${pulito(c.font_titoli)};`;
    if (/^#[0-9a-f]{3,8}$/i.test(c.accento || '')) css += `--ve-accento: ${c.accento};`;
    css += '}';
    for (const d of this.dimensioni) css += `.ProseMirror .ve-size-${d.chiave} { font-size: ${pulito(d.valore)}; }`;
    this.root.querySelector('style.config').textContent = css;
    this.creaBarra();
    this.aggiornaBarra();
  }

  // ---------- caricamento ----------

  carica(md) {
    const motivo = incompatibile(md);
    if (motivo) {
      this.mostraSorgente(md, `Questo testo ${motivo}: si modifica in Markdown, per non perdere nulla.`);
      return;
    }
    if (this.modo === 'sorgente' && this.sceltaSorgente) {
      this.sorgente.value = md;
      return;
    }
    this.mostraVisuale(md);
  }

  statoDa(md) {
    return EditorState.create({
      doc: daMarkdown(md),
      plugins: [
        regole,
        keymap({
          'Mod-z': undo,
          'Shift-Mod-z': redo,
          'Mod-y': redo,
          'Mod-b': toggleMark(M.strong),
          'Mod-i': toggleMark(M.em),
          'Mod-k': this.comandoLink(),
          'Mod-Alt-0': testoNormale,
          'Mod-Alt-2': tipoBlocco(N.heading, { level: 2 }),
          'Mod-Alt-3': tipoBlocco(N.heading, { level: 3 }),
          'Mod-Shift-l': allineaTesto('sinistra'),
          'Mod-Shift-e': allineaTesto('centro'),
          'Mod-Shift-r': allineaTesto('destra'),
          'Mod-Shift-j': allineaTesto('giustificato'),
          'Shift-Enter': aCapo,
          Enter: splitListItem(N.list_item),
          Tab: sinkListItem(N.list_item),
          'Shift-Tab': liftListItem(N.list_item),
        }),
        keymap(baseKeymap),
        history(),
        dropCursor({ color: 'currentColor', width: 3 }),
        gapCursor(),
        pianoIncolla,
        this.pianoFile(),
        this.pianoInvito(),
      ],
    });
  }

  mostraVisuale(md) {
    this.modo = 'visuale';
    this.sorgente.hidden = true;
    this.area.hidden = false;
    this.avviso.hidden = true;
    const stato = this.statoDa(md);
    if (this.view) {
      this.view.updateState(stato);
    } else {
      this.view = new EditorView(this.area, {
        state: stato,
        editable: () => !this.solaLettura,
        nodeViews: { image: (node) => new VistaFoto(node), video: (node) => new VistaVideo(node) },
        attributes: { 'aria-label': this._field.label || 'Testo', 'aria-multiline': 'true', role: 'textbox', spellcheck: 'true', lang: 'it' },
        dispatchTransaction: (tr) => {
          const nuovo = this.view.state.apply(tr);
          this.view.updateState(nuovo);
          if (tr.docChanged) this.programma();
          this.aggiornaBarra();
        },
        handleDOMEvents: { blur: () => (this.scrivi(), false) },
        // Doppio clic su un video: modificarlo; su una foto: la descrizione
        handleDoubleClickOn: (view, _pos, node, nodePos) => {
          if (node.type === N.video) return this.comandoVideo(nodePos)(view.state, view.dispatch, view);
          if (node.type === N.image) return this.comandoDescrizione()(view.state, view.dispatch, view);
          return false;
        },
      });
    }
    this.aggiornaBarra();
  }

  mostraSorgente(md, avviso) {
    this.scrivi();
    this.modo = 'sorgente';
    this.sorgente.value = md;
    this.sorgente.hidden = false;
    this.sorgente.readOnly = this.solaLettura;
    this.area.hidden = true;
    this.avviso.textContent = avviso || '';
    this.avviso.hidden = !avviso;
    this.aggiornaBarra();
  }

  // ---------- emissione del Markdown ----------

  programma() {
    this._sporco = true;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.scrivi(), 150);
  }

  scrivi() {
    clearTimeout(this._timer);
    this._timer = null;
    if (this.modo !== 'visuale' || !this.view || !this._sporco) return;
    this.emetti(aMarkdown(this.view.state.doc));
  }

  emetti(md) {
    this._sporco = false;
    if (md === this._value) return;
    this._value = md;
    this._emesso = md;
    this.dispatchEvent(new CustomEvent('change', { detail: md, bubbles: true, composed: true }));
  }

  // ---------- barra ----------

  esegui(cmd) {
    if (!this.view || this.modo !== 'visuale') return;
    cmd(this.view.state, this.view.dispatch, this.view);
    // Se il comando ha aperto un pannello (foto, link, video, descrizione) il fuoco resta lì
    if (this.pannello.hidden) this.view.focus();
  }

  creaSelect(etichetta, opzioni, scegli) {
    const el = document.createElement('select');
    el.setAttribute('aria-label', etichetta);
    el.title = etichetta;
    for (const [valore, nome] of opzioni) {
      const o = document.createElement('option');
      o.value = valore;
      o.textContent = nome;
      el.append(o);
    }
    el.addEventListener('change', () => scegli(el.value));
    return el;
  }

  creaBarra() {
    this.barra.innerHTML = '';
    this.bottoni = [];
    for (const b of BARRA) {
      if (b === '|') {
        const s = document.createElement('span');
        s.className = 'sep';
        s.setAttribute('aria-hidden', 'true');
        this.barra.append(s);
        continue;
      }
      if (b.tipo === 'stile') {
        this.selStile = this.creaSelect('Stile del paragrafo', STILI.map((s) => [s.valore, s.nome]), (v) => this.esegui(STILI.find((s) => s.valore === v).cmd()));
        this.barra.append(this.selStile);
        continue;
      }
      if (b.tipo === 'dimensione') {
        if (!this.dimensioni.length) {
          this.selDimensione = null;
          continue;
        }
        this.selDimensione = this.creaSelect('Dimensione del testo', [['', 'Normale'], ...this.dimensioni.map((d) => [d.chiave, d.nome])], (v) =>
          this.esegui(dimensione(v || null)),
        );
        this.barra.append(this.selDimensione);
        continue;
      }
      if (b.abilitato && !b.abilitato(this)) continue;
      const el = document.createElement('button');
      el.type = 'button';
      if (b.icona) {
        el.innerHTML = icona(b.icona);
        el.className = 'ico';
      } else el.textContent = b.testo;
      if (b.classe) el.classList.add(b.classe);
      el.title = b.titolo;
      el.setAttribute('aria-label', b.titolo.replace(/ \(.*\)$/, ''));
      // mousedown: il clic non deve togliere la selezione dal testo
      el.addEventListener('mousedown', (e) => e.preventDefault());
      el.addEventListener('click', () => this.esegui(b.cmd(this)));
      this.barra.append(el);
      this.bottoni.push({ b, el });
    }
    const modo = document.createElement('button');
    modo.type = 'button';
    modo.className = 'destra';
    modo.addEventListener('click', () => this.cambiaModo());
    this.barra.append(modo);
    this.bottoneModo = modo;
  }

  cambiaModo() {
    if (this.modo === 'visuale') {
      this.sceltaSorgente = true;
      this.mostraSorgente(this.view ? (this._sporco ? aMarkdown(this.view.state.doc) : this._value) : this._value);
      this.sorgente.focus();
      return;
    }
    const md = this.sorgente.value;
    const motivo = incompatibile(md);
    if (motivo) {
      this.avviso.textContent = `Il testo ${motivo}: resta in Markdown, per non perdere nulla.`;
      this.avviso.hidden = false;
      return;
    }
    this.sceltaSorgente = false;
    this.mostraVisuale(md);
    this.view.focus();
  }

  aggiornaBarra() {
    if (!this.bottoni) return;
    const visuale = this.modo === 'visuale' && this.view;
    const s = visuale ? this.view.state : null;
    const attiva = visuale && !this.solaLettura;
    for (const { b, el } of this.bottoni) {
      el.hidden = (!!b.solo && !(visuale && b.solo(s))) || (!!b.nascondi && !!visuale && b.nascondi(s));
      el.disabled = !(attiva && b.cmd(this)(s, undefined, this.view));
      if (b.attivo) el.setAttribute('aria-pressed', String(!!(visuale && b.attivo(s))));
    }
    if (this.selStile) {
      const stile = visuale && STILI.find((x) => x.attivo(s));
      this.selStile.disabled = !(attiva && s.selection.$from.parent.isTextblock && !(s.selection instanceof NodeSelection));
      this.selStile.value = stile ? stile.valore : 'paragrafo';
    }
    if (this.selDimensione) {
      const k = visuale ? dimensioneAttiva(s) : '';
      this.selDimensione.disabled = !(attiva && dimensione(null)(s));
      this.selDimensione.value = k ?? '';
      if (k === null) this.selDimensione.selectedIndex = -1;
    }
    this.bottoneModo.textContent = this.modo === 'visuale' ? 'Markdown' : 'Torna alla scrittura visuale';
    this.bottoneModo.title = this.modo === 'visuale' ? 'Mostra il testo in Markdown' : 'Torna alla scrittura visuale';
  }

  // ---------- pannelli (foto, link, video, descrizione) ----------

  chiudiPannello() {
    this.pannello.hidden = true;
    this.velo.hidden = true;
    this.pannello.innerHTML = '';
    this.view?.focus();
  }

  apriPannello(contenuto, etichetta) {
    this.pannello.innerHTML = '';
    this.pannello.append(...contenuto);
    this.pannello.setAttribute('aria-label', etichetta || '');
    this.pannello.hidden = false;
    this.velo.hidden = false;
    this.pannello.onkeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.chiudiPannello();
      }
    };
    const primo = this.pannello.querySelector('input, .griglia button, button');
    (primo || this.pannello).focus();
    if (primo?.select) primo.select();
  }

  /**
   * Modulo nel pannello. campi: [{ nome, etichetta, valore, aiuto, tipo }]; azioni extra: [{ testo, classe, fai }].
   * invia(valori, errore) chiude il pannello se non chiama errore(messaggio).
   */
  modulo({ titolo, campi, conferma = 'OK', azioni = [], invia }) {
    const form = document.createElement('form');
    const h = document.createElement('h3');
    h.textContent = titolo;
    form.append(h);
    const input = {};
    for (const c of campi) {
      const l = document.createElement('label');
      l.textContent = c.etichetta;
      const i = document.createElement('input');
      i.type = c.tipo || 'text';
      i.value = c.valore || '';
      i.autocomplete = 'off';
      l.append(i);
      if (c.aiuto) {
        const s = document.createElement('small');
        s.textContent = c.aiuto;
        l.append(s);
      }
      form.append(l);
      input[c.nome] = i;
    }
    const errore = document.createElement('p');
    errore.className = 'errore';
    errore.hidden = true;
    errore.setAttribute('role', 'alert');
    const bar = document.createElement('div');
    bar.className = 'azioni';
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.className = 'primario';
    ok.textContent = conferma;
    const annulla = document.createElement('button');
    annulla.type = 'button';
    annulla.textContent = 'Annulla';
    annulla.onclick = () => this.chiudiPannello();
    bar.append(ok, annulla);
    for (const a of azioni) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = a.testo;
      if (a.classe) b.className = a.classe;
      b.onclick = () => {
        this.chiudiPannello();
        a.fai();
      };
      bar.append(b);
    }
    form.append(errore, bar);
    form.onsubmit = (e) => {
      e.preventDefault();
      const valori = Object.fromEntries(Object.entries(input).map(([k, i]) => [k, i.value]));
      let fallito = false;
      invia(valori, (msg) => {
        fallito = true;
        errore.textContent = msg;
        errore.hidden = false;
      });
      if (!fallito) this.chiudiPannello();
    };
    this.apriPannello([form], titolo);
  }

  // Un blocco (foto in paragrafo, video) va dove si sta scrivendo se il paragrafo è vuoto, altrimenti subito
  // dopo il blocco di primo livello in cui sta il cursore (anche se è un elenco o una citazione).
  inserisciBlocco(nodo, { selezionaDentro = false } = {}) {
    const v = this.view;
    const { $from } = v.state.selection;
    const sel = v.state.selection;
    let tr = v.state.tr;
    let pos;
    if (sel instanceof NodeSelection && sel.$from.depth === 0) {
      pos = sel.to;
      tr = tr.insert(pos, nodo);
    } else if ($from.parent.isTextblock && $from.parent.content.size === 0 && $from.depth === 1) {
      pos = $from.before(1);
      tr = tr.replaceWith(pos, $from.after(1), nodo);
    } else {
      pos = $from.depth > 0 ? $from.after(1) : v.state.doc.content.size;
      tr = tr.insert(pos, nodo);
    }
    tr.setSelection(NodeSelection.create(tr.doc, selezionaDentro ? pos + 1 : pos));
    v.dispatch(tr.scrollIntoView());
    v.focus();
  }

  inserisciFoto(nome) {
    this.inserisciBlocco(N.paragraph.create(null, N.image.create({ src: nome, alt: '' })), { selezionaDentro: true });
  }

  comandoFoto() {
    return (state, dispatch) => {
      if (!dispatch) return true;
      this.mostraFoto();
      return true;
    };
  }

  mostraFoto() {
    const titolo = document.createElement('h3');
    titolo.textContent = 'Foto della pagina';
    const griglia = document.createElement('div');
    griglia.className = 'griglia';
    const foto = mediaPagina();
    if (!foto.length) {
      const p = document.createElement('p');
      p.className = 'vuoto';
      p.textContent = 'Questa pagina non ha ancora foto: caricane una qui sotto, o trascinala nel testo.';
      griglia.append(p);
    }
    for (const m of foto) {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = '<img alt=""><span></span>';
      b.querySelector('img').src = m.thumb || m.url;
      b.querySelector('span').textContent = m.filename;
      b.title = m.filename;
      b.onclick = () => {
        this.chiudiPannello();
        this.inserisciFoto(m.filename);
      };
      griglia.append(b);
    }
    const azioni = document.createElement('div');
    azioni.className = 'azioni';
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'image/jpeg,image/png,image/webp';
    file.multiple = true;
    file.hidden = true;
    const carica = document.createElement('button');
    carica.type = 'button';
    carica.className = 'primario';
    carica.textContent = 'Carica una nuova foto…';
    carica.onclick = () => file.click();
    file.onchange = async () => {
      const elenco = [...file.files];
      this.chiudiPannello();
      await this.caricaEInserisci(elenco);
    };
    const annulla = document.createElement('button');
    annulla.type = 'button';
    annulla.textContent = 'Annulla';
    annulla.onclick = () => this.chiudiPannello();
    azioni.append(carica, annulla, file);
    this.apriPannello([titolo, griglia, azioni], 'Foto della pagina');
  }

  comandoDescrizione() {
    return (state, dispatch) => {
      if (!fotoSelezionata(state)) return false;
      if (!dispatch) return true;
      const { node, from } = state.selection;
      this.modulo({
        titolo: 'Descrizione della foto',
        campi: [{ nome: 'alt', etichetta: 'Cosa si vede', valore: node.attrs.alt, aiuto: 'La leggono i lettori di schermo per chi non vede, e i motori di ricerca.' }],
        invia: ({ alt }) => {
          const v = this.view;
          v.dispatch(v.state.tr.setNodeMarkup(from, null, { ...node.attrs, alt: alt.trim() }));
        },
      });
      return true;
    };
  }

  comandoLink() {
    return (state, dispatch) => {
      if (state.selection instanceof NodeSelection || !state.selection.$from.parent.inlineContent) return false;
      if (!dispatch) return true;
      const { from, to } = estendiLink(state);
      const link = segnaAttivo(state, M.link) ? (M.link.isInSet(state.selection.$from.marks()) || this.linkNelTratto(state, from, to)) : null;
      const vuoto = from === to;
      const campi = [];
      if (vuoto) campi.push({ nome: 'testo', etichetta: 'Testo del link', valore: '' });
      campi.push({
        nome: 'href',
        etichetta: 'Indirizzo',
        valore: link?.attrs.href || '',
        aiuto: 'Un sito (www.esempio.it), una pagina di questo sito (/contatti), un indirizzo email o un numero di telefono.',
      });
      this.modulo({
        titolo: link ? 'Modifica il link' : 'Inserisci un link',
        campi,
        conferma: link ? 'Salva' : 'Inserisci',
        azioni: link ? [{ testo: 'Togli il link', classe: 'pericolo', fai: () => this.view.dispatch(this.view.state.tr.removeMark(from, to, M.link)) }] : [],
        invia: (val, errore) => {
          const href = normalizzaLink(val.href);
          if (!href) return errore("Scrivi l'indirizzo del link.");
          const v = this.view;
          const segno = M.link.create({ href });
          if (vuoto) {
            const testo = (val.testo || '').trim() || val.href.trim();
            const tr = v.state.tr.insert(from, schema.text(testo, [...v.state.selection.$from.marks().filter((m) => m.type !== M.link), segno]));
            tr.setSelection(TextSelection.create(tr.doc, from + testo.length));
            v.dispatch(tr.removeStoredMark(M.link));
          } else {
            v.dispatch(v.state.tr.removeMark(from, to, M.link).addMark(from, to, segno));
          }
        },
      });
      return true;
    };
  }

  linkNelTratto(state, from, to) {
    let trovato = null;
    state.doc.nodesBetween(from, to, (n) => {
      trovato = trovato || M.link.isInSet(n.marks);
    });
    return trovato;
  }

  /** Inserisce un video, o modifica quello in posizione `pos` */
  comandoVideo(pos = null) {
    return (state, dispatch) => {
      if (this.config.video === false) return false;
      if (!dispatch) return true;
      const esistente = pos !== null ? state.doc.nodeAt(pos) : null;
      const a = esistente?.attrs;
      const indirizzoPagina = a ? (a.provider === 'youtube' ? `https://www.youtube.com/watch?v=${a.id}${a.start ? `&t=${a.start}` : ''}` : `https://vimeo.com/${a.id}`) : '';
      this.modulo({
        titolo: esistente ? 'Modifica il video' : 'Inserisci un video',
        campi: [
          { nome: 'url', etichetta: 'Indirizzo del video', tipo: 'url', valore: indirizzoPagina, aiuto: "Copia l'indirizzo dalla pagina del video su YouTube o Vimeo. Per partire da un minuto preciso usa «Condividi» → «Inizia da»." },
          { nome: 'titolo', etichetta: 'Titolo del video', valore: a?.title || '', aiuto: 'Una frase che dice di cosa parla: la leggono i lettori di schermo.' },
        ],
        conferma: esistente ? 'Salva' : 'Inserisci',
        invia: (val, errore) => {
          const video = daIndirizzoVideo(val.url);
          if (!video) return errore('Indirizzo non riconosciuto: deve essere un video di YouTube o di Vimeo.');
          const attrs = { ...video, title: val.titolo.trim() };
          if (esistente) {
            const v = this.view;
            const tr = v.state.tr.setNodeMarkup(pos, null, attrs);
            tr.setSelection(NodeSelection.create(tr.doc, pos));
            v.dispatch(tr);
          } else this.inserisciBlocco(N.video.create(attrs));
        },
      });
      return true;
    };
  }

  async caricaEInserisci(files) {
    const immagini = files.filter((f) => /^image\/(jpeg|png|webp|gif)$/.test(f.type));
    if (!immagini.length) return;
    if (typeof window.__GRAV_UPLOAD_PAGE_MEDIA !== 'function') {
      window.__GRAV_TOAST?.error?.('Caricamento non disponibile: usa il riquadro dei file della pagina.');
      return;
    }
    const prima = new Set(mediaPagina().map((m) => m.filename));
    try {
      await window.__GRAV_UPLOAD_PAGE_MEDIA(immagini);
    } catch (e) {
      window.__GRAV_TOAST?.error?.(`Caricamento non riuscito: ${e?.message || e}`);
      return;
    }
    // Grav può cambiare il nome del file (es. gli spazi diventano trattini): si inseriscono i file comparsi
    // nell'elenco della pagina dopo il caricamento, che il pannello aggiorna poco dopo.
    let nuovi = [];
    for (let i = 0; i < 50; i++) {
      nuovi = mediaPagina().map((m) => m.filename).filter((f) => !prima.has(f));
      if (nuovi.length >= immagini.length) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    // Un file con lo stesso nome di uno già presente lo sostituisce: in quel caso il nome resta quello
    const nomi = nuovi.length ? nuovi : immagini.map((f) => f.name.replace(/\s+/g, '-'));
    for (const nome of nomi) this.inserisciFoto(nome);
  }

  // Foto trascinate dal computer dentro il testo: si caricano tra i file della pagina e si inseriscono lì.
  pianoFile() {
    return new Plugin({
      props: {
        handleDrop: (view, event) => {
          const files = [...(event.dataTransfer?.files || [])];
          if (!files.length) return false;
          event.preventDefault();
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (pos) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos.pos))));
          this.caricaEInserisci(files);
          return true;
        },
        handlePaste: (view, event) => {
          const files = [...(event.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
          if (!files.length || event.clipboardData.getData('text/html')) return false;
          this.caricaEInserisci(files.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `incollata-${Date.now()}-${i}.png`, { type: f.type }))));
          return true;
        },
      },
    });
  }

  // Invito nel testo vuoto
  pianoInvito() {
    return new Plugin({
      view: () => ({
        update: (view) => {
          const vuoto = view.state.doc.childCount === 1 && view.state.doc.firstChild.isTextblock && view.state.doc.firstChild.content.size === 0;
          const p = view.dom.firstChild;
          if (p && p.nodeType === 1) {
            p.classList.toggle('vuoto', vuoto);
            if (vuoto) p.setAttribute('data-invito', 'Scrivi qui il testo…');
          }
        },
      }),
    });
  }
}

customElements.define(TAG, VisualEditor);
