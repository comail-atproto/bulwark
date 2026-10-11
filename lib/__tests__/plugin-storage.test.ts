import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { pluginStorage } from '../plugin-storage';

// Use unique keys per test to avoid shared state (avoiding deleteDatabase which
// blocks on open connections that the module never closes).

describe('pluginStorage', () => {
  describe('plugin code', () => {
    it('saves and retrieves code', async () => {
      await pluginStorage.saveCode('code-save-1', 'console.log("hello")');
      const code = await pluginStorage.getCode('code-save-1');
      expect(code).toBe('console.log("hello")');
    });

    it('returns null for missing plugin', async () => {
      const code = await pluginStorage.getCode('code-missing-xyz');
      expect(code).toBeNull();
    });

    it('overwrites existing code', async () => {
      await pluginStorage.saveCode('code-overwrite-1', 'v1');
      await pluginStorage.saveCode('code-overwrite-1', 'v2');
      const code = await pluginStorage.getCode('code-overwrite-1');
      expect(code).toBe('v2');
    });

    it('deletes code', async () => {
      await pluginStorage.saveCode('code-del-1', 'code');
      await pluginStorage.deleteCode('code-del-1');
      const code = await pluginStorage.getCode('code-del-1');
      expect(code).toBeNull();
    });

    it('stores multiple plugins independently', async () => {
      await pluginStorage.saveCode('code-multi-a', 'code-a');
      await pluginStorage.saveCode('code-multi-b', 'code-b');
      expect(await pluginStorage.getCode('code-multi-a')).toBe('code-a');
      expect(await pluginStorage.getCode('code-multi-b')).toBe('code-b');
    });
  });

  describe('theme CSS', () => {
    it('saves and retrieves CSS', async () => {
      const css = ':root { --color-primary: blue; }';
      await pluginStorage.saveThemeCSS('css-save-1', css);
      const result = await pluginStorage.getThemeCSS('css-save-1');
      expect(result).toBe(css);
    });

    it('returns null for missing theme', async () => {
      const result = await pluginStorage.getThemeCSS('css-missing-xyz');
      expect(result).toBeNull();
    });

    it('deletes CSS', async () => {
      await pluginStorage.saveThemeCSS('css-del-1', 'css');
      await pluginStorage.deleteThemeCSS('css-del-1');
      expect(await pluginStorage.getThemeCSS('css-del-1')).toBeNull();
    });
  });

  describe('previews', () => {
    it('saves and retrieves preview data URI', async () => {
      const dataUri = 'data:image/png;base64,iVBORw0KGgo=';
      await pluginStorage.savePreview('prev-save-1', dataUri);
      const result = await pluginStorage.getPreview('prev-save-1');
      expect(result).toBe(dataUri);
    });

    it('returns null for missing preview', async () => {
      expect(await pluginStorage.getPreview('prev-missing-xyz')).toBeNull();
    });

    it('deletes preview', async () => {
      await pluginStorage.savePreview('prev-del-1', 'data:...');
      await pluginStorage.deletePreview('prev-del-1');
      expect(await pluginStorage.getPreview('prev-del-1')).toBeNull();
    });
  });
});
