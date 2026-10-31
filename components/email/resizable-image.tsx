"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";

function ResizableImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [resizing, setResizing] = useState(false);
  const startState = useRef<{ x: number; y: number; width: number; height: number; handle: string }>({
    x: 0, y: 0, width: 0, height: 0, handle: "",
  });

  const onMouseDown = useCallback((e: React.MouseEvent, handle: string) => {
    e.preventDefault();
    e.stopPropagation();
    const img = imgRef.current;
    if (!img) return;
    startState.current = {
      x: e.clientX,
      y: e.clientY,
      width: img.offsetWidth,
      height: img.offsetHeight,
      handle,
    };
    setResizing(true);
  }, []);

  useEffect(() => {
    if (!resizing) return;

    const onMouseMove = (e: MouseEvent) => {
      const { x, width, handle } = startState.current;
      const dx = e.clientX - x;
      let newWidth: number;

      if (handle === "right" || handle === "bottom-right" || handle === "top-right") {
        newWidth = Math.max(50, width + dx);
      } else {
        newWidth = Math.max(50, width - dx);
      }

      updateAttributes({ width: Math.round(newWidth) });
    };

    const onMouseUp = () => {
      setResizing(false);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [resizing, updateAttributes]);

  const width = node.attrs.width;
  const style: React.CSSProperties = {
    ...(width ? { width: `${width}px` } : {}),
    maxWidth: "100%",
  };

  return (
    <NodeViewWrapper as="span" className="inline-block relative" draggable data-drag-handle>
      <span
        className={`relative inline-block group ${selected ? "ring-2 ring-primary rounded" : ""}`}
        style={style}
      >
        <img
          ref={imgRef}
          src={node.attrs.src}
          alt={node.attrs.alt || ""}
          title={node.attrs.title || undefined}
          style={{ width: "100%", height: "auto", display: "block" }}
          draggable={false}
        />
        {selected && (
          <>
            {/* Resize handle: right */}
            <span
              onMouseDown={(e) => onMouseDown(e, "right")}
              className="absolute top-1/2 -right-1.5 -translate-y-1/2 w-3 h-8 bg-primary rounded cursor-ew-resize"
            />
            {/* Resize handle: left */}
            <span
              onMouseDown={(e) => onMouseDown(e, "left")}
              className="absolute top-1/2 -left-1.5 -translate-y-1/2 w-3 h-8 bg-primary rounded cursor-ew-resize"
            />
            {/* Resize handle: bottom-right corner */}
            <span
              onMouseDown={(e) => onMouseDown(e, "bottom-right")}
              className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-primary rounded cursor-nwse-resize"
            />
          </>
        )}
      </span>
    </NodeViewWrapper>
  );
}

export const ResizableImage = Node.create({
  name: "image",
  group: "inline",
  inline: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      width: { default: null },
      cid: {
        default: null,
        parseHTML: (el) => {
          const dataCid = el.getAttribute("data-cid");
          if (dataCid) return dataCid;
          // Fall back to deriving the cid from `src="cid:xxx"` so inline
          // image refs survive editor round-trips even when data-cid was
          // never set (defensive — the composer normally pre-rewrites
          // quoted-body cid: refs into data-cid).
          const src = el.getAttribute("src") || "";
          if (/^cid:/i.test(src)) return src.slice(4) || null;
          return null;
        },
        renderHTML: (attrs) => (attrs.cid ? { "data-cid": attrs.cid } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "img[src]" }];
  },

  renderHTML({ HTMLAttributes }) {
    const attrs: Record<string, string> = { ...HTMLAttributes };
    if (attrs.width) {
      attrs.style = `width: ${attrs.width}px; max-width: 100%;`;
      delete attrs.width;
    }
    return ["img", mergeAttributes(attrs)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});
