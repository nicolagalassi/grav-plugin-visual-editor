// Compila l'editor in un unico file, dove il plugin API cerca i campi dei plugin abilitati:
// admin-next/fields/visual-editor.js  (il nome del file è il tipo di campo: «visual-editor»).
import { build } from 'esbuild';

await build({
  entryPoints: ['src/visual-editor.js'],
  outfile: 'admin-next/fields/visual-editor.js',
  bundle: true,
  format: 'esm',
  minify: true,
  target: 'es2020',
  loader: { '.css': 'text' },
  legalComments: 'eof',
  banner: { js: '// Visual Editor per Grav 2 (Admin2). File generato: i sorgenti sono in src/ (node build.mjs).' },
});
