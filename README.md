# Visual Editor

Plugin per Grav 2 con il pannello Admin2: aggiunge il campo `visual-editor`, una scrittura visuale (stile Word)
per il testo delle pagine. Il file della pagina resta Markdown.

- **Barra**: stile del paragrafo (Testo, Titolo, Sottotitolo), dimensione del testo, grassetto, corsivo, link,
  allineamento (sinistra, centro, destra, giustificato), citazione, elenchi, riga, foto, video, annulla/ripeti,
  «Markdown» per vedere il sorgente.
- **Foto** della pagina: scelta, caricamento o trascinamento nel testo. Con la foto selezionata: a tutta larghezza,
  a sinistra o a destra con il testo intorno, al centro più piccola; descrizione per chi non vede.
  Sul telefono le foto affiancate vanno a tutta larghezza.
- **Video** di YouTube e Vimeo: si incolla l'indirizzo della pagina del video (anche con il minuto di inizio).
  Doppio clic sul video per cambiarlo.
- **Link**: inserire (anche senza selezionare il testo), modificare, togliere. Accetta siti, pagine del sito,
  email e numeri di telefono.
- Incollando da Word restano solo gli elementi ammessi (e l'allineamento): niente colori né caratteri.
- Un testo con altro HTML, tabelle, shortcode o Twig si apre direttamente in Markdown, così non si perde nulla.

## Come si scrive nel file

| Cosa | Nel Markdown | Sul sito |
|---|---|---|
| Allineamento | `Testo del paragrafo {.ve-centro}` (anche `ve-destra`, `ve-giustificato`) | il plugin mette la classe sul paragrafo o titolo |
| Dimensione | `<span class="ve-size-grande">parole</span>` | regola CSS dalle impostazioni |
| Foto affiancata | `![descrizione](foto.jpg?classes=ve-img-sinistra)` | azione `classes` di Grav |
| Video | `<div class="ve-video" data-provider="youtube" data-id="…" data-start="0" data-title="…"></div>` | il plugin lo trasforma nel lettore |

Il video non si scrive come iframe perché il pannello rifiuterebbe il salvataggio come possibile XSS.

## Uso nel tema

Nel blueprint della pagina, al posto del campo `content`:

```yaml
content:
  type: visual-editor
  style: vertical   # etichetta sopra, editor a tutta larghezza
  label: Testo
```

Il tema deve stampare i CSS dei plugin nel `<head>`, prima del suo foglio di stile: `{{ assets.css()|raw }}`.
Le classi (`ve-centro`, `ve-img-sinistra`, `ve-video`…) si possono ridefinire nel CSS del tema.

Se il plugin è spento o manca, il pannello mostra al posto dell'editor un riquadro di testo semplice.

## Impostazioni

Pannello → Plugin → Visual Editor:

- **Dimensioni del testo**: le voci del menu «Dimensione» (nome, chiave, valore in em, rem, % o px). Non cambiare
  la chiave di una dimensione già usata: quel testo tornerebbe normale.
- **Video**: mostra o nasconde il pulsante «Video».
- **Aspetto dell'editor**: foglio con i @font-face del sito (percorso dalla radice, es.
  `user/themes/mio-tema/css/fonts.css`), carattere del testo e dei titoli, colore di accento.

Le impostazioni arrivano all'editor dentro la definizione del campo (evento `onApiBlueprintResolved`).

## Privacy

Un video incorporato carica il lettore di YouTube o Vimeo quando il lettore apre la pagina. L'editor usa
`youtube-nocookie.com` e Vimeo con `dnt=1`, ma è comunque un servizio di terzi: va indicato nell'informativa.

## Installazione

Copiare la cartella in `user/plugins/visual-editor/` (bastano `visual-editor.php`, `visual-editor.yaml`,
`blueprints.yaml`, `css/` e `admin-next/`). Chi ha il pannello aperto deve ricaricarlo: l'elenco dei campi si
legge all'accesso.

## Sviluppo

Serve solo Docker. Dalla cartella del plugin, dentro un sito Grav (`user/plugins/visual-editor`):

```sh
d="docker run --rm -u $(id -u):$(id -g) -v $PWD/../../..:/w -w /w/user/plugins/visual-editor node:22-alpine"
$d npm ci                            # la prima volta
$d node build.mjs                    # compila src/ in admin-next/fields/visual-editor.js
$d node prova-andata-ritorno.mjs     # risalva ogni pagina di user/pages e le forme dell'editor: nulla deve cambiare
```

Il file compilato va nel repository: è quello che usa il sito.

## Licenza

MIT
