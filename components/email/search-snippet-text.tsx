import React, { useMemo } from 'react';
import { parseSearchSnippet } from '@/lib/search-snippet';

interface SearchSnippetTextProps {
  /** Server snippet with `<mark>` around the matched terms (RFC 8621 §5). */
  snippet: string;
}

/**
 * Renders a SearchSnippet/get excerpt with the matched terms highlighted.
 * The snippet is parsed into segments and rendered as text nodes, never as
 * HTML.
 */
export function SearchSnippetText({ snippet }: SearchSnippetTextProps) {
  const segments = useMemo(() => parseSearchSnippet(snippet), [snippet]);
  return (
    <>
      {segments.map((segment, i) =>
        segment.marked ? (
          <mark
            key={i}
            className="rounded-sm bg-yellow-200 px-0.5 text-inherit dark:bg-yellow-500/40"
          >
            {segment.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{segment.text}</React.Fragment>
        ),
      )}
    </>
  );
}
