// Campo «visual-editor» del pannello (Admin2): scrittura visuale come in un programma di videoscrittura, ma con
// i soli stili del giornale. Il pannello passa il Markdown della pagina in `value` e riceve il nuovo
// Markdown dall'evento `change` (detail = testo). Contratto dei campi personalizzati: plugins/api,
// GpmController::customFieldBundle; il nome del tag arriva in window.__GRAV_FIELD_TAG.
import { EditorState, Plugin, NodeSelection } from 'prosemirror-state';
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
import { schema, daMarkdown, aMarkdown, incompatibile } from './markdown.js';

const TAG = window.__GRAV_FIELD_TAG;
const N = schema.nodes;
const M = schema.marks;

const server = () => (window.__GRAV_API_SERVER_URL || '').replace(/\/$/, '');

// Indirizzo del sito (es. «/prova» se Grav sta in una sottocartella): il pannello sta in <sito>/admin.
const sito = () => server() || (window.__GRAV_ADMIN_BASE || '/admin').replace(/\/[^/]*\/?$/, '');

// Caratteri del sito, dal tema (oggi quello del Giornale di Massa): @font-face vale solo nel documento, non dentro lo shadow DOM.
// (Il pannello passa al campo solo le proprietà note del blueprint: un percorso configurabile non arriverebbe.)
const CARATTERI = 'user/themes/giornale/css/fonts.css';

function caricaCaratteri() {
  if (document.getElementById('visual-editor-caratteri')) return;
  const l = document.createElement('link');
  l.id = 'visual-editor-caratteri';
  l.rel = 'stylesheet';
  l.href = `${sito()}/${CARATTERI}`;
  document.head.appendChild(l);
}

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
  const nome = decodeURIComponent(src.split('?')[0]);
  const m = mediaPagina().find((x) => x.filename === nome);
  if (m) return m.url;
  return src.startsWith('/') ? sito() + src : '';
}

class VistaFoto {
  constructor(node) {
    this.dom = document.createElement('span');
    this.dom.className = 'foto';
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
    this.dom.classList.toggle('foto--mancante', !url);
    this.nota.textContent = url ? node.attrs.alt || 'Senza descrizione' : `Foto non trovata: ${node.attrs.src}`;
    return true;
  }
  ignoreMutation() {
    return true;
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
  return to <= $from.end() && $from.parent.hasMarkup(tipo, attrs);
};

const dentro = (state, tipo) => {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === tipo) return true;
  return false;
};

const alterna = (tipo, attrs) => (state, dispatch, view) =>
  bloccoAttivo(state, tipo, attrs) ? setBlockType(N.paragraph)(state, dispatch, view) : setBlockType(tipo, attrs)(state, dispatch, view);

// Sempre disponibile in un paragrafo, così il bottone resta leggibile e mostra lo stato attivo.
const testoNormale = (state, dispatch, view) =>
  bloccoAttivo(state, N.paragraph) || setBlockType(N.paragraph)(state, dispatch, view);

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

function chiediLink(host) {
  return (state, dispatch, view) => {
    if (state.selection.empty && !segnaAttivo(state, M.link)) return false;
    if (!dispatch) return true;
    if (segnaAttivo(state, M.link)) {
      // Già un link: si toglie (per cambiarlo basta toglierlo e rimetterlo)
      const { from, to } = estendiLink(state);
      dispatch(state.tr.removeMark(from, to, M.link));
      return true;
    }
    host.chiedi('Indirizzo del link', 'https://', (href) => {
      href = href.trim();
      if (!href || href === 'https://') return;
      if (!/^([a-z]+:|\/|#)/i.test(href)) href = /@/.test(href) && !/\//.test(href) ? `mailto:${href}` : `https://${href}`;
      const { from, to } = view.state.selection;
      view.dispatch(view.state.tr.addMark(from, to, M.link.create({ href })));
      view.focus();
    });
    return true;
  };
}

function estendiLink(state) {
  const { $from, from, to } = state.selection;
  if (!state.selection.empty) return { from, to };
  const genitore = $from.parent;
  let inizio = $from.parentOffset;
  let fine = inizio;
  const start = $from.start();
  // Confini del testo con il link intorno al cursore
  genitore.forEach((figlio, offset) => {
    if (M.link.isInSet(figlio.marks) && offset <= $from.parentOffset && offset + figlio.nodeSize >= $from.parentOffset) {
      inizio = Math.min(inizio, offset);
      fine = Math.max(fine, offset + figlio.nodeSize);
    }
  });
  return { from: start + inizio, to: start + fine };
}

// ---------- incolla da Word / pagine web ----------

// Lo schema tiene già solo gli elementi ammessi (via colori, caratteri, tabelle). Qui si sistemano i titoli
// (h1 -> Titolo, h4-h6 -> Sottotitolo), gli elenchi diventano compatti e si scartano le immagini incollate, che non sono file della pagina.
function pulisci(fragment) {
  const nodi = [];
  fragment.forEach((n) => {
    if (n.type === N.image && !mediaPagina().some((m) => m.filename === n.attrs.src)) return;
    if (n.type === N.heading) {
      nodi.push(N.heading.create({ level: n.attrs.level <= 2 ? 2 : 3 }, pulisci(n.content)));
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

const BOTTONI = [
  { id: 'paragrafo', testo: 'Testo', titolo: 'Testo normale (Ctrl+Alt+0)', cmd: () => testoNormale, attivo: (s) => bloccoAttivo(s, N.paragraph) },
  { id: 'titolo', testo: 'Titolo', titolo: 'Titolo di sezione (Ctrl+Alt+2)', cmd: () => alterna(N.heading, { level: 2 }), attivo: (s) => bloccoAttivo(s, N.heading, { level: 2 }) },
  { id: 'sottotitolo', testo: 'Sottotitolo', titolo: 'Sottotitolo (Ctrl+Alt+3)', cmd: () => alterna(N.heading, { level: 3 }), attivo: (s) => bloccoAttivo(s, N.heading, { level: 3 }) },
  '|',
  { id: 'grassetto', testo: 'G', classe: 'b', titolo: 'Grassetto (Ctrl+B)', cmd: () => toggleMark(M.strong), attivo: (s) => segnaAttivo(s, M.strong) },
  { id: 'corsivo', testo: 'C', classe: 'i', titolo: 'Corsivo (Ctrl+I)', cmd: () => toggleMark(M.em), attivo: (s) => segnaAttivo(s, M.em) },
  { id: 'link', testo: 'Link', titolo: 'Link: seleziona il testo e premi (Ctrl+K). Su un link, lo toglie', cmd: (h) => chiediLink(h), attivo: (s) => segnaAttivo(s, M.link) },
  '|',
  { id: 'citazione', testo: 'Citazione', titolo: 'Citazione', cmd: () => citazione, attivo: (s) => dentro(s, N.blockquote) },
  { id: 'puntato', testo: '• Elenco', titolo: 'Elenco puntato', cmd: () => elenco(N.bullet_list), attivo: (s) => dentro(s, N.bullet_list) },
  { id: 'numerato', testo: '1. Elenco', titolo: 'Elenco numerato', cmd: () => elenco(N.ordered_list), attivo: (s) => dentro(s, N.ordered_list) },
  { id: 'riga', testo: '—', titolo: 'Riga di separazione', cmd: () => riga },
  '|',
  { id: 'foto', testo: 'Foto', titolo: 'Inserisci una foto della pagina', cmd: (h) => h.comandoFoto() },
  { id: 'descrizione', testo: 'Descrizione foto', titolo: 'Descrizione della foto selezionata (per chi non vede e per i motori di ricerca)', cmd: (h) => h.comandoDescrizione(), solo: (s) => s.selection instanceof NodeSelection && s.selection.node.type === N.image },
  '|',
  { id: 'annulla', testo: '↶', titolo: 'Annulla (Ctrl+Z)', cmd: () => undo },
  { id: 'ripeti', testo: '↷', titolo: 'Ripeti (Ctrl+Y)', cmd: () => redo },
];

const STILE = `
:host { display: block; }
${cssProsemirror}
${cssGapcursor}
.cornice { border: 1px solid #d4d4d8; border-radius: 10px; overflow: clip; background: #f4efe4; }
.barra { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 4px;
  padding: 6px; background: #fbf8f2; border-bottom: 1px solid #d9d0bf; font: 13px/1 system-ui, sans-serif; }
.barra button { min-height: 32px; padding: 0 8px; border: 1px solid transparent; border-radius: 6px; background: none;
  color: #17140f; font: inherit; cursor: pointer; }
.barra button:hover { background: #ebe4d5; }
.barra button[aria-pressed='true'] { background: #17140f; color: #f4efe4; }
.barra button:disabled { opacity: 0.35; cursor: default; background: none; }
.barra button:focus-visible { outline: 2px solid #c4004a; outline-offset: 1px; }
.barra .b { font-weight: 800; font-family: Georgia, serif; }
.barra .i { font-style: italic; font-family: Georgia, serif; }
.barra .sep { width: 1px; height: 20px; background: #d9d0bf; margin: 0 2px; }
.barra .destra { margin-left: auto; }
[hidden] { display: none !important; }

.ProseMirror { min-height: 420px; padding: 28px clamp(16px, 5%, 56px) 40px; outline: none; color: #17140f;
  font-family: 'Newsreader Variable', Georgia, serif; font-size: 19px; line-height: 1.7; max-width: 44rem; margin: 0 auto; }
.ProseMirror > * + * { margin-top: 0; }
.ProseMirror p { margin: 0 0 1em; }
.ProseMirror h2, .ProseMirror h3 { font-family: Tinos, 'Times New Roman', serif; line-height: 1.15; margin: 1.4em 0 0.5em; }
.ProseMirror h2 { font-size: 1.75em; }
.ProseMirror h3 { font-size: 1.3em; }
.ProseMirror a { color: #c4004a; text-decoration: underline; text-decoration-color: #fd005b; }
.ProseMirror blockquote { margin: 1.4em 0; padding: 0.1em 0 0.1em 1.1em; border-left: 3px solid #fd005b;
  font-family: Tinos, 'Times New Roman', serif; font-style: italic; font-size: 1.25em; line-height: 1.4; }
.ProseMirror blockquote p { margin: 0.3em 0; }
.ProseMirror ul, .ProseMirror ol { padding-left: 1.4em; margin: 0 0 1em; }
.ProseMirror li p { margin: 0.2em 0; }
.ProseMirror hr { border: 0; height: 1px; background: #cfc5b2; margin: 2em 15%; }
.ProseMirror code { font-family: ui-monospace, monospace; font-size: 0.85em; background: #ebe4d5; padding: 0.1em 0.3em; border-radius: 3px; }
.ProseMirror .foto { display: inline-block; max-width: 100%; margin: 0.6em 0; vertical-align: top; }
.ProseMirror .foto img { display: block; max-width: 100%; height: auto; }
.ProseMirror .foto__nota { display: block; margin-top: 4px; font: 12px/1.3 system-ui, sans-serif; color: #5f574c; }
.ProseMirror .foto--mancante { padding: 18px; border: 1px dashed #c4004a; }
.ProseMirror .ProseMirror-selectednode img { outline: 3px solid #fd005b; outline-offset: 2px; }
.ProseMirror p.vuoto:first-child::before { content: attr(data-invito); color: #8a8172; pointer-events: none; float: left; height: 0; }

.sorgente { display: block; width: 100%; min-height: 420px; box-sizing: border-box; padding: 20px; border: 0; resize: vertical;
  background: #fbf8f2; color: #17140f; font: 14px/1.6 ui-monospace, monospace; }
.avviso { margin: 0; padding: 10px 14px; background: #fff4d6; border-bottom: 1px solid #e8d49a; font: 13px/1.4 system-ui, sans-serif; color: #5a4300; }

.velo { position: fixed; inset: 0; z-index: 1000; background: rgb(23 20 15 / 0.35); }
.pannello { position: fixed; z-index: 1001; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(640px, 92vw); max-height: 70vh; overflow: auto; padding: 14px;
  background: #fff; border: 1px solid #d4d4d8; border-radius: 10px; box-shadow: 0 10px 30px rgb(0 0 0 / 0.18);
  font: 13px/1.4 system-ui, sans-serif; color: #17140f; }
.pannello h3 { margin: 0 0 10px; font-size: 14px; }
.pannello .griglia { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
.pannello .griglia button { display: grid; gap: 4px; padding: 6px; border: 1px solid #e4e4e7; border-radius: 8px; background: #fafafa; cursor: pointer; text-align: left; font: inherit; color: inherit; }
.pannello .griglia button:hover, .pannello .griglia button:focus-visible { border-color: #c4004a; outline: none; }
.pannello .griglia img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 4px; background: #eee; }
.pannello .griglia span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pannello .azioni { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; align-items: center; }
.pannello .azioni button, .pannello form button { min-height: 34px; padding: 0 14px; border-radius: 6px; border: 1px solid #d4d4d8; background: #fff; cursor: pointer; font: inherit; }
.pannello .azioni .primario, .pannello form .primario { background: #c4004a; border-color: #c4004a; color: #fff; }
.pannello form { display: grid; gap: 8px; }
.pannello input[type=text] { min-height: 36px; padding: 0 10px; border: 1px solid #d4d4d8; border-radius: 6px; font: inherit; }
.pannello .vuoto { color: #5f574c; }
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
  }
  get field() {
    return this._field;
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
    if (this.isConnected) this.carica(v);
  }
  get value() {
    return this._value;
  }

  connectedCallback() {
    if (this.root) return;
    caricaCaratteri();
    this.root = this.attachShadow({ mode: 'open' });
    this.root.innerHTML = `<style>${STILE}</style>
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
    this.creaBarra();
    this.sorgente.addEventListener('input', () => this.emetti(this.sorgente.value));
    this.carica(this._value);
  }

  disconnectedCallback() {
    this.scrivi();
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
          'Mod-k': chiediLink(this),
          'Mod-Alt-0': testoNormale,
          'Mod-Alt-2': alterna(N.heading, { level: 2 }),
          'Mod-Alt-3': alterna(N.heading, { level: 3 }),
          'Shift-Enter': aCapo,
          Enter: splitListItem(N.list_item),
          Tab: sinkListItem(N.list_item),
          'Shift-Tab': liftListItem(N.list_item),
        }),
        keymap(baseKeymap),
        history(),
        dropCursor({ color: '#fd005b', width: 3 }),
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
        nodeViews: { image: (node) => new VistaFoto(node) },
        attributes: { 'aria-label': this._field.label || 'Testo', 'aria-multiline': 'true', role: 'textbox', spellcheck: 'true', lang: 'it' },
        dispatchTransaction: (tr) => {
          const nuovo = this.view.state.apply(tr);
          this.view.updateState(nuovo);
          if (tr.docChanged) this.programma();
          this.aggiornaBarra();
        },
        handleDOMEvents: { blur: () => (this.scrivi(), false) },
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

  creaBarra() {
    this.bottoni = [];
    for (const b of BOTTONI) {
      if (b === '|') {
        const s = document.createElement('span');
        s.className = 'sep';
        s.setAttribute('aria-hidden', 'true');
        this.barra.append(s);
        continue;
      }
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = b.testo;
      el.title = b.titolo;
      el.setAttribute('aria-label', b.titolo.replace(/ \(.*\)$/, ''));
      if (b.classe) el.className = b.classe;
      // mousedown: il clic non deve togliere la selezione dal testo
      el.addEventListener('mousedown', (e) => e.preventDefault());
      el.addEventListener('click', () => {
        if (!this.view || this.modo !== 'visuale') return;
        b.cmd(this)(this.view.state, this.view.dispatch, this.view);
        // Se il comando ha aperto un pannello (foto, link, descrizione) il fuoco resta lì
        if (this.pannello.hidden) this.view.focus();
      });
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
    const visuale = this.modo === 'visuale' && this.view;
    const s = visuale ? this.view.state : null;
    for (const { b, el } of this.bottoni) {
      const ok = visuale && !this.solaLettura && b.cmd(this)(s, undefined, this.view);
      el.disabled = !ok;
      el.hidden = !!b.solo && !(visuale && b.solo(s));
      if (b.attivo) el.setAttribute('aria-pressed', String(!!(visuale && b.attivo(s))));
    }
    this.bottoneModo.textContent = this.modo === 'visuale' ? 'Markdown' : 'Torna alla scrittura visuale';
    this.bottoneModo.title = this.modo === 'visuale' ? 'Mostra il testo in Markdown' : 'Torna alla scrittura visuale';
  }

  // ---------- pannelli (foto, link, descrizione) ----------

  chiudiPannello() {
    this.pannello.hidden = true;
    this.velo.hidden = true;
    this.pannello.innerHTML = '';
    this.view?.focus();
  }

  apriPannello(contenuto) {
    this.pannello.innerHTML = '';
    this.pannello.append(...contenuto);
    this.pannello.hidden = false;
    this.velo.hidden = false;
    const tasti = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.chiudiPannello();
      }
    };
    this.pannello.onkeydown = tasti;
    (this.pannello.querySelector('input, .griglia button, button') || this.pannello).focus();
  }

  chiedi(etichetta, iniziale, fatto) {
    const form = document.createElement('form');
    form.innerHTML = `<label><b></b></label><input type="text"><div class="azioni"><button type="submit" class="primario">OK</button><button type="button">Annulla</button></div>`;
    form.querySelector('b').textContent = etichetta;
    const input = form.querySelector('input');
    input.value = iniziale || '';
    input.setAttribute('aria-label', etichetta);
    form.querySelector('button[type=button]').onclick = () => this.chiudiPannello();
    form.onsubmit = (e) => {
      e.preventDefault();
      const v = input.value;
      this.chiudiPannello();
      fatto(v);
    };
    this.apriPannello([form]);
    input.select();
  }

  // La foto va in un paragrafo tutto suo: in un paragrafo vuoto al posto del cursore, altrimenti
  // subito dopo il blocco in cui si sta scrivendo (anche se è un elenco o una citazione).
  inserisciFoto(nome) {
    const v = this.view;
    const nodo = N.image.create({ src: nome, alt: '' });
    const { $from } = v.state.selection;
    let tr;
    if ($from.parent.isTextblock && $from.parent.content.size === 0) {
      tr = v.state.tr.replaceSelectionWith(nodo);
    } else {
      const dopo = $from.depth > 0 ? $from.after(1) : v.state.doc.content.size;
      tr = v.state.tr.insert(dopo, N.paragraph.create(null, nodo));
      tr.setSelection(NodeSelection.create(tr.doc, dopo + 1));
    }
    v.dispatch(tr.scrollIntoView());
    v.focus();
  }

  comandoFoto() {
    return (state, dispatch) => {
      if (!state.selection.$from.parent.inlineContent && !(state.selection instanceof NodeSelection)) return false;
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
    this.apriPannello([titolo, griglia, azioni]);
  }

  comandoDescrizione() {
    return (state, dispatch) => {
      const sel = state.selection;
      if (!(sel instanceof NodeSelection) || sel.node.type !== N.image) return false;
      if (!dispatch) return true;
      const pos = sel.from;
      this.chiedi('Descrizione della foto (cosa si vede)', sel.node.attrs.alt, (alt) => {
        const v = this.view;
        v.dispatch(v.state.tr.setNodeMarkup(pos, null, { ...sel.node.attrs, alt: alt.trim() }));
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
          if (pos) view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.near(view.state.doc.resolve(pos.pos))));
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
            if (vuoto) p.setAttribute('data-invito', 'Scrivi qui il testo dell\u2019articolo…');
          }
        },
      }),
    });
  }
}

customElements.define(TAG, VisualEditor);
