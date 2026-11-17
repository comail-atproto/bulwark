import { mkdir, readFile, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';

const source = new URL('../themes/comail/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', source), 'utf8'));
const zip = new JSZip();
// ZIP's earliest timestamp keeps rebuilds byte-identical without source mtimes.
const options = { date: new Date('1980-01-01T00:00:00Z') };
for (const name of ['manifest.json', 'theme.css', 'skin.css']) {
  zip.file(name, await readFile(new URL(name, source)), options);
}
zip.file('LICENSE', await readFile(new URL('../LICENSE', import.meta.url)), options);
const destination = new URL('../public/branding/comail/', import.meta.url);
await mkdir(destination, { recursive: true });
await writeFile(new URL(`${manifest.id}-${manifest.version}.zip`, destination),
  await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } }));
