import { notFound } from 'next/navigation';

// Catch-all that anchors unmatched URLs into the (main) route group so
// Next renders app/(main)/not-found.tsx (wrapped by (main)/layout.tsx)
// instead of the built-in __next_builtin__not-found page. Without this,
// route groups can't pick a root layout for URLs that match nothing, so
// 404s render bare.
export default function CatchAll() {
  notFound();
}
