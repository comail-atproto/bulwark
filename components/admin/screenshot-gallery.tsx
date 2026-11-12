'use client';

import { useState, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight } from '@/components/icons';
import { Dialog } from '@/components/ui/dialog';
import { IconButton } from '@/components/ui/icon-button';

export interface GalleryImage {
  url: string;
  altText?: string | null;
}

/**
 * A grid of screenshots. A click opens one large in a dialog, with previous
 * and next buttons and the arrow keys to step through the rest.
 */
export function ScreenshotGallery({ images, name }: { images: GalleryImage[]; name: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const count = images.length;
  const alt = (i: number) => images[i].altText || `${name} screenshot ${i + 1}`;
  const step = (by: number) => setOpen((i) => (i === null ? i : (i + by + count) % count));

  const onKeyDown = (e: KeyboardEvent) => {
    if (count < 2) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  };

  return (
    <>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {images.map((s, i) => (
          <li key={s.url}>
            <button
              type="button"
              onClick={() => setOpen(i)}
              className="block w-full overflow-hidden rounded-md border border-border bg-muted transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring cursor-zoom-in"
              aria-label={`Open ${alt(i)} larger`}
            >
              <img src={s.url} alt={alt(i)} className="block w-full" loading="lazy" />
            </button>
          </li>
        ))}
      </ul>

      <Dialog
        isOpen={open !== null}
        onClose={() => setOpen(null)}
        title={count > 1 ? `Screenshot ${(open ?? 0) + 1} of ${count}` : 'Screenshot'}
        description={open !== null && images[open].altText ? images[open].altText : undefined}
        size="lg"
        className="max-w-[min(96vw,1400px)]"
        testId="screenshot-gallery-dialog"
      >
        {open !== null && (
          <div className="mt-4 flex items-center gap-2" onKeyDown={onKeyDown}>
            {count > 1 && (
              <IconButton label="Previous screenshot" onClick={() => step(-1)} className="shrink-0">
                <ChevronLeft className="h-5 w-5" />
              </IconButton>
            )}
            <img
              src={images[open].url}
              alt={alt(open)}
              className="block min-w-0 flex-1 max-h-[75vh] object-contain rounded-md border border-border bg-muted"
            />
            {count > 1 && (
              <IconButton label="Next screenshot" onClick={() => step(1)} className="shrink-0">
                <ChevronRight className="h-5 w-5" />
              </IconButton>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
