import { File } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { extractTheme } from '@/lib/plugin-validator';

const result = await extractTheme(new File([
  readFileSync('public/branding/comail/builtin-comail-1.0.1.zip'),
], 'comail.zip') as unknown as globalThis.File);
if (!result.valid || !result.manifest) throw new Error(result.errors.join('; '));

export const COMAIL_THEME = {
  ...result.manifest, css: result.css, skin: result.skin ?? undefined,
};
