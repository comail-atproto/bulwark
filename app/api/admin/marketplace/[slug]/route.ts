import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/admin/session';
import { logger } from '@/lib/logger';
import {
  getPluginRegistry,
  getThemeRegistry,
} from '@/lib/admin/plugin-registry';
import JSZip from 'jszip';
import { MAX_PLUGIN_SIZE, MAX_THEME_SIZE } from '@/lib/plugin-types';
import { configManager } from '@/lib/admin/config-manager';

async function getDirectoryUrl(): Promise<string> {
  await configManager.ensureLoaded();
  return configManager.get<string>('extensionDirectoryUrl') || 'https://extensions.bulwarkmail.org';
}

const MAX_PREVIEW_SOURCE_LEN = 100_000;

/**
 * GET /api/admin/marketplace/[slug]
 * Returns full preview info for an extension: directory metadata,
 * the bundle's manifest, a (truncated) source preview, and install status.
 * Lets admins audit what they're about to install before pressing the button.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const result = await requireAdminAuth(request);
    if ('error' in result) return result.error;

    const { slug } = await params;
    const directoryUrl = await getDirectoryUrl();

    // 1. Extension metadata + screenshots + theme previews from the directory
    const detailUrl = new URL(`/api/v1/extension/${encodeURIComponent(slug)}`, directoryUrl);
    const detailRes = await fetch(detailUrl.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!detailRes.ok) {
      const status = detailRes.status === 404 ? 404 : 502;
      return NextResponse.json(
        { error: status === 404 ? 'Extension not found' : 'Directory request failed' },
        { status },
      );
    }

    const detailJson = await detailRes.json();
    const extension = detailJson.data as Record<string, unknown> | undefined;
    if (!extension) {
      return NextResponse.json({ error: 'Extension not found' }, { status: 404 });
    }

    const type = extension.type as 'plugin' | 'theme';
    const latestVersion = (extension.latestVersion as { version?: string } | null)?.version
      ?? null;

    // 2. Pull the bundle so we can show what's actually inside.
    let manifest: Record<string, unknown> | null = null;
    let sourcePreview: { name: string; content: string; truncated: boolean } | null = null;
    let bundleError: string | null = null;
    let bundleSize = 0;

    if (latestVersion) {
      try {
        const bundleUrl = new URL(
          `/api/v1/bundle/${encodeURIComponent(slug)}/${encodeURIComponent(latestVersion)}`,
          directoryUrl,
        );
        const bundleRes = await fetch(bundleUrl.toString(), {
          signal: AbortSignal.timeout(30000),
        });

        if (!bundleRes.ok) {
          bundleError = `Bundle download failed (${bundleRes.status})`;
        } else {
          const buffer = await bundleRes.arrayBuffer();
          bundleSize = buffer.byteLength;
          const maxSize = type === 'theme' ? MAX_THEME_SIZE : MAX_PLUGIN_SIZE;
          if (buffer.byteLength > maxSize) {
            bundleError = `Bundle exceeds ${type === 'theme' ? '1 MB' : '5 MB'} size limit`;
          } else {
            const zip = await JSZip.loadAsync(buffer);

            // Detect optional root directory inside the ZIP.
            const entries = Object.keys(zip.files);
            const topDirs = new Set(entries.map((e) => e.split('/')[0]));
            let root = '';
            if (topDirs.size === 1) {
              const dir = [...topDirs][0];
              if (zip.files[dir + '/'] || entries.some((e) => e.startsWith(dir + '/'))) {
                root = dir + '/';
              }
            }

            const manifestFile = zip.file(root + 'manifest.json');
            if (!manifestFile) {
              bundleError = 'Bundle missing manifest.json';
            } else {
              try {
                manifest = JSON.parse(await manifestFile.async('string'));
              } catch {
                bundleError = 'Invalid manifest.json in bundle';
              }
            }

            if (manifest) {
              if (type === 'theme') {
                const cssFile = zip.file(root + 'theme.css');
                if (cssFile) {
                  const css = await cssFile.async('string');
                  sourcePreview = {
                    name: 'theme.css',
                    content: css.length > MAX_PREVIEW_SOURCE_LEN
                      ? css.slice(0, MAX_PREVIEW_SOURCE_LEN)
                      : css,
                    truncated: css.length > MAX_PREVIEW_SOURCE_LEN,
                  };
                }
              } else {
                const entrypoint = (manifest.entrypoint as string) || 'index.js';
                const jsFile = zip.file(root + entrypoint);
                if (jsFile) {
                  const code = await jsFile.async('string');
                  sourcePreview = {
                    name: entrypoint,
                    content: code.length > MAX_PREVIEW_SOURCE_LEN
                      ? code.slice(0, MAX_PREVIEW_SOURCE_LEN)
                      : code,
                    truncated: code.length > MAX_PREVIEW_SOURCE_LEN,
                  };
                }
              }
            }
          }
        }
      } catch (err) {
        bundleError = err instanceof Error ? err.message : 'Failed to read bundle';
      }
    } else {
      bundleError = 'Extension has no published version';
    }

    // 3. Install status (slug is used as the registry id at install time)
    const [pluginRegistry, themeRegistry] = await Promise.all([
      getPluginRegistry(),
      getThemeRegistry(),
    ]);
    const installedEntry = type === 'theme'
      ? themeRegistry.themes.find((t) => t.id === slug)
      : pluginRegistry.plugins.find((p) => p.id === slug);
    const installed = installedEntry !== undefined;
    const installedVersion = installedEntry?.version ?? null;

    // 4. Build screenshot URLs (proxy through the directory's public files endpoint).
    const screenshots = Array.isArray(extension.screenshots)
      ? (extension.screenshots as Array<{ path: string; altText?: string | null }>).map((s) => ({
          url: new URL(`/api/v1/files/${s.path}`, directoryUrl).toString(),
          altText: s.altText ?? null,
        }))
      : [];

    // Strip the heavy `manifest` blob from versions when echoing the directory data.
    const versions = Array.isArray(extension.versions)
      ? (extension.versions as Array<Record<string, unknown>>).map((v) => ({
          version: v.version,
          changelog: v.changelog,
          bundleSize: v.bundleSize,
          minAppVersion: v.minAppVersion,
          publishedAt: v.publishedAt,
          permissions: v.permissions,
        }))
      : [];

    const fileUrl = (path: unknown): string | null =>
      typeof path === 'string' && path
        ? new URL(`/api/v1/files/${path}`, directoryUrl).toString()
        : null;

    return NextResponse.json(
      {
        extension: {
          slug: extension.slug,
          name: extension.name,
          type: extension.type,
          pluginType: extension.pluginType ?? null,
          description: extension.description,
          longDescription: extension.longDescription ?? null,
          tags: extension.tags ?? [],
          permissions: extension.permissions ?? [],
          totalDownloads: extension.totalDownloads ?? 0,
          featured: extension.featured ?? false,
          githubRepo: extension.githubRepo ?? null,
          license: extension.license ?? null,
          minAppVersion: extension.minAppVersion ?? null,
          iconUrl: fileUrl(extension.iconPath),
          bannerUrl: fileUrl(extension.bannerPath),
          author: extension.author ?? null,
          latestVersion,
          versions,
          screenshots,
          themePreviews: extension.themePreviews ?? [],
          createdAt: extension.createdAt ?? null,
          updatedAt: extension.updatedAt ?? null,
        },
        bundle: {
          manifest,
          source: sourcePreview,
          size: bundleSize,
          error: bundleError,
        },
        installed,
        installedVersion,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    logger.error('Marketplace preview error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to load preview' },
      { status: 502 },
    );
  }
}
