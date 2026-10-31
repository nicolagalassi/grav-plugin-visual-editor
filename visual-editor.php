<?php

namespace Grav\Plugin;

use Grav\Common\Plugin;

/**
 * Visual Editor: il campo «visual-editor» per il pannello Admin2 (Grav 2).
 *
 * Tutto il lavoro lo fa admin-next/fields/visual-editor.js: il plugin API lo trova da solo nei plugin abilitati
 * e il pannello lo usa per ogni campo con `type: visual-editor` nei blueprint. Qui non serve codice PHP.
 */
class VisualEditorPlugin extends Plugin
{
    public static function getSubscribedEvents(): array
    {
        return [];
    }
}
