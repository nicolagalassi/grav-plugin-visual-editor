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
     * Segnaposto scritto dall'editor -> lettore del video. Nel testo non si scrive l'iframe: il pannello
     * rifiuterebbe il salvataggio come possibile XSS. YouTube nella versione senza cookie di profilazione,
     * Vimeo con «do not track».
     */
    public static function inserisciVideo(string $html): string
    {
        return preg_replace_callback(
            '#<div class="ve-video" data-provider="(youtube|vimeo)" data-id="([\w-]+)" data-start="(\d+)" data-title="([^"]*)"></div>#',
            static function (array $m): string {
                [, $provider, $id, $inizio, $titolo] = $m;
                if ($provider === 'youtube' && preg_match('/^[\w-]{6,20}$/', $id)) {
                    $src = 'https://www.youtube-nocookie.com/embed/' . $id . ((int) $inizio > 0 ? '?start=' . (int) $inizio : '');
                } elseif ($provider === 'vimeo' && preg_match('/^\d{1,12}$/', $id)) {
                    $src = 'https://player.vimeo.com/video/' . $id . '?dnt=1';
                } else {
                    return $m[0];
                }
                // Il titolo arriva già codificato come attributo (&quot; &lt; …): si ricodifica in modo sicuro
                $titolo = htmlspecialchars(html_entity_decode($titolo, ENT_QUOTES | ENT_HTML5, 'UTF-8') ?: 'Video', ENT_QUOTES, 'UTF-8');

                return '<div class="ve-video"><iframe src="' . $src . '" title="' . $titolo . '" loading="lazy" '
                    . 'allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" '
                    . 'referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>';
            },
            $html
        ) ?? $html;
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
