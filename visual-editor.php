<?php

namespace Grav\Plugin;

use Grav\Common\Plugin;
use RocketTheme\Toolbox\Event\Event;

/**
 * Visual Editor: il campo «visual-editor» per il pannello Admin2 (Grav 2).
 *
 * - Pannello: l'editor è admin-next/fields/visual-editor.js, che il plugin API trova da solo. Qui gli si passano
 *   le impostazioni del plugin (dimensioni del testo, caratteri, video) dentro la definizione del campo.
 * - Sito: allineamenti scritti come «{.ve-centro}» in fondo a paragrafi e titoli diventano classi HTML, i
 *   segnaposto dei video diventano il lettore di YouTube o Vimeo, e si aggiunge il foglio di stile per
 *   allineamenti, dimensioni, foto affiancate e video.
 */
class VisualEditorPlugin extends Plugin
{
    /** Marcatore a fine blocco, già passato da Parsedown: « {.ve-centro}» prima della chiusura del blocco. */
    private const RE_MARCATORE = '#\s*\{((?:\.ve-[a-z0-9-]+\s*)+)\}\s*(?=</(?:p|h[1-6]|li)>|\n?<(?:ul|ol)[\s>])#';

    public static function getSubscribedEvents(): array
    {
        return [
            'onApiBlueprintResolved' => ['onApiBlueprintResolved', 0],
            'onPageContentProcessed' => ['onPageContentProcessed', 0],
            'onTwigSiteVariables' => ['onTwigSiteVariables', 0],
        ];
    }

    /** Le impostazioni del plugin arrivano all'editor come proprietà `ve` di ogni campo visual-editor. */
    public function onApiBlueprintResolved(Event $event): void
    {
        $fields = $event['fields'];
        if (!is_array($fields)) {
            return;
        }
        $config = $this->configEditor();
        $this->aggiungiConfig($fields, $config);
        $event['fields'] = $fields;
    }

    private function aggiungiConfig(array &$fields, array $config): void
    {
        foreach ($fields as &$field) {
            if (!is_array($field)) {
                continue;
            }
            if (($field['type'] ?? null) === 'visual-editor') {
                $field['ve'] = $config;
            }
            if (isset($field['fields']) && is_array($field['fields'])) {
                $this->aggiungiConfig($field['fields'], $config);
            }
        }
    }

    /** @return array{dimensioni: list<array{chiave: string, nome: string, valore: string}>, caratteri: string, font_testo: string, font_titoli: string, accento: string, video: bool} */
    private function configEditor(): array
    {
        $c = $this->config->get('plugins.visual-editor', []);

        return [
            'dimensioni' => $this->dimensioni(),
            'caratteri' => (string) ($c['caratteri'] ?? ''),
            'font_testo' => (string) ($c['font_testo'] ?? ''),
            'font_titoli' => (string) ($c['font_titoli'] ?? ''),
            'accento' => (string) ($c['accento'] ?? ''),
            'video' => (bool) ($c['video'] ?? true),
        ];
    }

    /** Dimensioni valide: chiave in minuscolo con trattini, valore CSS semplice (es. 1.25em, 120%, 18px). */
    private function dimensioni(): array
    {
        $out = [];
        foreach ((array) $this->config->get('plugins.visual-editor.dimensioni', []) as $d) {
            $chiave = strtolower(trim((string) ($d['chiave'] ?? '')));
            $valore = trim((string) ($d['valore'] ?? ''));
            if (!preg_match('/^[a-z0-9-]+$/', $chiave) || !preg_match('/^\d+(\.\d+)?(em|rem|%|px)$/', $valore)) {
                continue;
            }
            $out[] = ['chiave' => $chiave, 'nome' => trim((string) ($d['nome'] ?? '')) ?: $chiave, 'valore' => $valore];
        }

        return $out;
    }

    public function onPageContentProcessed(Event $event): void
    {
        $page = $event['page'];
        $html = $page->getRawContent();
        if (!is_string($html) || (!str_contains($html, '{.ve-') && !str_contains($html, 've-video'))) {
            return;
        }
        $page->setRawContent(self::inserisciVideo(self::applicaClassi($html)));
    }

    /**
     * Segnaposto scritto dall'editor -> riquadro del video. Il lettore di YouTube o Vimeo si carica solo quando
     * il lettore preme ▶: fino ad allora la pagina non contatta servizi di terzi. Senza JavaScript resta il link
     * al video. Nel testo non si scrive l'iframe: il pannello rifiuterebbe il salvataggio come possibile XSS.
     * YouTube nella versione senza cookie di profilazione, Vimeo con «do not track».
     */
    public static function inserisciVideo(string $html): string
    {
        $trovati = 0;
        $html = preg_replace_callback(
            '#<div class="ve-video" data-provider="(youtube|vimeo)" data-id="([\w-]+)" data-start="(\d+)" data-title="([^"]*)"></div>#',
            static function (array $m) use (&$trovati): string {
                [, $provider, $id, $inizio, $titolo] = $m;
                $inizio = (int) $inizio;
                if ($provider === 'youtube' && preg_match('/^[\w-]{6,20}$/', $id)) {
                    $src = 'https://www.youtube-nocookie.com/embed/' . $id . '?autoplay=1' . ($inizio > 0 ? '&start=' . $inizio : '');
                    $pagina = 'https://www.youtube.com/watch?v=' . $id . ($inizio > 0 ? '&t=' . $inizio : '');
                    $nome = 'YouTube';
                } elseif ($provider === 'vimeo' && preg_match('/^\d{1,12}$/', $id)) {
                    $src = 'https://player.vimeo.com/video/' . $id . '?dnt=1&autoplay=1';
                    $pagina = 'https://vimeo.com/' . $id;
                    $nome = 'Vimeo';
                } else {
                    return $m[0];
                }
                $trovati++;
                $e = static fn (string $t): string => htmlspecialchars($t, ENT_QUOTES, 'UTF-8');
                // Il titolo arriva già codificato come attributo (&quot; &lt; …): si decodifica e ricodifica
                $titolo = html_entity_decode($titolo, ENT_QUOTES | ENT_HTML5, 'UTF-8') ?: 'Video';

                return '<div class="ve-video ve-video--attesa" data-src="' . $e($src) . '" data-title="' . $e($titolo) . '">'
                    . '<button type="button" class="ve-video__avvia" hidden>'
                    . '<span class="ve-video__play" aria-hidden="true">▶</span>'
                    . '<span class="ve-video__titolo">' . $e($titolo) . '</span>'
                    . '<span class="ve-video__nota">Premi per guardare: il video si carica da ' . $nome . '.</span>'
                    . '</button>'
                    . '<a class="ve-video__link" href="' . $e($pagina) . '" rel="noopener" target="_blank">'
                    . $e($titolo) . ' · guarda su ' . $nome . '</a>'
                    . '</div>';
            },
            $html
        ) ?? $html;

        if ($trovati === 0) {
            return $html;
        }

        // Con JavaScript: al posto del link il pulsante ▶, che al clic mette l'iframe
        return $html . <<<'HTML'
<script>
document.querySelectorAll('.ve-video--attesa').forEach(function (box) {
  var avvia = box.querySelector('.ve-video__avvia');
  var link = box.querySelector('.ve-video__link');
  if (!avvia) return;
  avvia.hidden = false;
  link.hidden = true;
  avvia.addEventListener('click', function () {
    var f = document.createElement('iframe');
    f.src = box.dataset.src;
    f.title = box.dataset.title;
    f.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen';
    f.referrerPolicy = 'strict-origin-when-cross-origin';
    f.allowFullscreen = true;
    box.classList.remove('ve-video--attesa');
    box.replaceChildren(f);
    f.focus();
  });
});
</script>
HTML;
    }

    /**
     * « {.ve-centro}» in fondo a un paragrafo, titolo o punto d'elenco diventa class="ve-centro" sul suo tag.
     * Si lavora dall'ultimo al primo marcatore, così le posizioni già trovate restano valide.
     */
    public static function applicaClassi(string $html): string
    {
        if (!preg_match_all(self::RE_MARCATORE, $html, $marcatori, PREG_OFFSET_CAPTURE | PREG_SET_ORDER)) {
            return $html;
        }
        foreach (array_reverse($marcatori) as $m) {
            [$testo, $pos] = $m[0];
            $classi = implode(' ', array_map(static fn ($c) => substr($c, 1), preg_split('/\s+/', trim($m[1][0]))));
            if (!preg_match_all('#<(p|h[1-6]|li)(\s[^>]*)?>#', substr($html, 0, $pos), $aperture, PREG_OFFSET_CAPTURE | PREG_SET_ORDER)) {
                continue;
            }
            $tag = end($aperture);
            [$apertura, $inizio] = $tag[0];
            $attributi = $tag[2][0] ?? '';
            $attributi = preg_match('/\sclass="([^"]*)"/', $attributi)
                ? preg_replace('/\sclass="([^"]*)"/', ' class="$1 ' . $classi . '"', $attributi, 1)
                : $attributi . ' class="' . $classi . '"';
            $nuova = '<' . $tag[1][0] . $attributi . '>';
            $html = substr($html, 0, $pos) . substr($html, $pos + strlen($testo));
            $html = substr($html, 0, $inizio) . $nuova . substr($html, $inizio + strlen($apertura));
        }

        return $html;
    }

    /** Sul sito: il foglio di stile del plugin e le dimensioni del testo scelte nelle impostazioni. */
    public function onTwigSiteVariables(): void
    {
        if ($this->isAdmin()) {
            return;
        }
        $assets = $this->grav['assets'];
        $assets->addCss('plugin://visual-editor/css/visual-editor.css');
        $css = '';
        foreach ($this->dimensioni() as $d) {
            $css .= ".ve-size-{$d['chiave']}{font-size:{$d['valore']}}";
        }
        if ($css !== '') {
            $assets->addInlineCss($css);
        }
    }
}
