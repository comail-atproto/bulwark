import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import React from 'react';
import { ComailWordmark } from '../comail-wordmark';

describe('canonical Comail wordmark', () => {
  it.each([
    ['light', 'comail-light.svg', 'comail-logo.svg'],
    ['dark', 'comail-dark.svg', 'comail-logo-dark.svg'],
    ['spooky', 'comail-spooky.svg', 'comail-logo-spooky.svg'],
  ] as const)('uses the pinned %s artwork', (theme, canonical, filename) => {
    const manifest = JSON.parse(readFileSync('public/branding/comail/wordmark-manifest.json', 'utf8'));
    const bytes = readFileSync(`public/branding/comail/${filename}`);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.sha256[canonical]);
    render(<ComailWordmark theme={theme} />);
    expect(screen.getByRole('img', { name: 'comail' })).toHaveAttribute('src', `/branding/comail/${filename}`);
  });
});
