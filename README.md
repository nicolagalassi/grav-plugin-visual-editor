# Visual Editor

Plugin per Grav 2 con il pannello Admin2: aggiunge il campo `visual-editor`, una scrittura visuale (stile Word)
per il testo delle pagine. Il file della pagina resta Markdown.

- Barra: Testo, Titolo (`##`), Sottotitolo (`###`), grassetto, corsivo, link, citazione, elenchi, riga, foto della
  pagina (scelta, caricamento o trascinamento nel testo), descrizione della foto, «Markdown» per vedere il sorgente.
- Niente colori, caratteri o allineamenti: incollando da Word restano solo gli elementi ammessi.
- Un testo con HTML, tabelle, shortcode o Twig si apre direttamente in Markdown, così non si perde nulla.

Tecnica: ProseMirror + prosemirror-markdown, compilati con esbuild in `admin-next/fields/visual-editor.js`.
Il plugin API di Grav trova da solo i file in `admin-next/fields/` dei plugin abilitati: il nome del file è il
tipo di campo.

## Uso nel tema

Nel blueprint della pagina, al posto del campo `content`:

```yaml
content:
  type: visual-editor
  style: vertical   # etichetta sopra, editor a tutta larghezza
  label: Testo
```

Se il plugin è spento o manca, il pannello mostra al suo posto un riquadro di testo semplice.

Limite attuale: aspetto e caratteri dell'editor sono quelli del sito per cui è nato (Il Giornale di Massa); i
caratteri si caricano da `user/themes/giornale/css/fonts.css` (costante `CARATTERI` in `src/visual-editor.js`).
Senza quel file l'editor usa i caratteri di sistema.

## Installazione

Copiare la cartella in `user/plugins/visual-editor/` (bastano `visual-editor.php`, `visual-editor.yaml`,
`blueprints.yaml` e `admin-next/`). Chi ha il pannello aperto deve ricaricarlo: l'elenco dei campi si legge all'accesso.

## Sviluppo

Serve solo Docker. Dalla cartella del plugin, dentro un sito Grav (`user/plugins/visual-editor`):

```sh
d="docker run --rm -u $(id -u):$(id -g) -v $PWD/../../..:/w -w /w/user/plugins/visual-editor node:22-alpine"
$d npm ci                            # la prima volta
$d node build.mjs                    # compila src/ in admin-next/fields/visual-editor.js
$d node prova-andata-ritorno.mjs     # apre e risalva il testo di ogni pagina di user/pages: nulla deve cambiare
```

Il file compilato va nel repository: è quello che usa il sito.

## Licenza

MIT
