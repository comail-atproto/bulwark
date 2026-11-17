"use client";

import { useEffect, useRef } from "react";
import { withBasePath } from "@/lib/browser-navigation";

interface Particle {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  vr: number;
  vx: number;
  vy: number;
  sway: number;
  swayA: number;
  swaySp: number;
  alpha: number;
  quiet: number;
  sp: HTMLCanvasElement;
}

interface QuietRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const comailLoginArtwork = {
  default: { sprites: ["mail1.gif", "mail2.gif", "mail3.gif"], native: false, scale: 1,
    tint: "#3fa1c0", mascot: "cammie-wiggle.gif", staticMascot: "cammie-mark.png" },
  spooky: { sprites: ["leaf1.webp", "leaf2.webp", "leaf3.webp"], native: true, scale: 1.6,
    tint: "#ffad3b", mascot: "spooky.webp", staticMascot: "spooky.webp" },
};
export type ComailLoginTheme = "light" | "dark" | "spooky";
type Artwork = typeof comailLoginArtwork.default;

function hexToRgb(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return [63, 161, 192];
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

// Preserve native artwork's alpha. Only key out white paper for opaque
// drawings, or the leaf strokes become translucent and keep pale halos.
function toSprite(img: HTMLImageElement, artwork: Artwork): HTMLCanvasElement {
  const [TINT_R, TINT_G, TINT_B] = hexToRgb(artwork.tint);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d");
  if (!x) return c;
  x.drawImage(img, 0, 0);
  const id = x.getImageData(0, 0, w, h);
  const d = id.data;
  let hasAlpha = false;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] < 250) {
      hasAlpha = true;
      break;
    }
  }
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let any = false;
  for (let i = 0; i < d.length; i += 4) {
    const darkest = Math.min(d[i], d[i + 1], d[i + 2]);
    const a = hasAlpha ? d[i + 3] : Math.min(255, (255 - darkest) * 2);
    if (a > 8) {
      if (!artwork.native) {
        d[i] = TINT_R;
        d[i + 1] = TINT_G;
        d[i + 2] = TINT_B;
      } else if (!hasAlpha) {
        const k = 255 / (255 - darkest);
        d[i] = 255 - (255 - d[i]) * k;
        d[i + 1] = 255 - (255 - d[i + 1]) * k;
        d[i + 2] = 255 - (255 - d[i + 2]) * k;
      }
      d[i + 3] = a;
      const p = i / 4;
      const px = p % w;
      const py = (p / w) | 0;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      any = true;
    } else {
      d[i + 3] = 0;
    }
  }
  x.putImageData(id, 0, 0);
  if (!any) return c;
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const crop = document.createElement("canvas");
  crop.width = cw;
  crop.height = ch;
  const cx = crop.getContext("2d");
  if (!cx) return c;
  cx.drawImage(c, minX, minY, cw, ch, 0, 0, cw, ch);
  return crop;
}

function loadSprites(artwork: Artwork): Promise<HTMLCanvasElement[]> {
  return Promise.all(
    artwork.sprites.map(
      (src) =>
        new Promise<HTMLCanvasElement | null>((resolve) => {
          const img = new Image();
          img.onload = () => resolve(toSprite(img, artwork));
          img.onerror = () => resolve(null);
          img.src = withBasePath(`/branding/comail/${src}`);
        }),
    ),
  ).then((list) => list.filter((s): s is HTMLCanvasElement => s !== null));
}

function start(canvas: HTMLCanvasElement, sprites: HTMLCanvasElement[], scale: number): () => void {
  const parent = canvas.parentElement;
  if (!parent) return () => {};
  const root = parent;
  const ctx = canvas.getContext("2d")!;
  if (!ctx) return () => {};
  if (sprites.length === 0) return () => {};

  let W = 0;
  let H = 0;
  let dpr = 1;
  let particles: Particle[] = [];
  let quietRects: QuietRect[] = [];
  let raf = 0;
  let layoutTimer = 0;
  let disposed = false;
  const pointer = { x: -9999, y: -9999, active: false };
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  function isReduced(): boolean {
    const preference = document.documentElement.dataset.reducedMotion;
    return document.hidden || (preference === undefined ? motionQuery.matches : preference === "true");
  }
  let reduced = isReduced();

  function sizeCanvas(): boolean {
    const nextW = root.clientWidth;
    const nextH = root.clientHeight;
    const deviceDpr = Math.min(window.devicePixelRatio || 1, 2);
    const area = Math.max(1, nextW * nextH);
    const nextDpr = Math.max(1, Math.min(deviceDpr, Math.sqrt(8_000_000 / area)));
    const changed = nextW !== W || nextH !== H || Math.abs(nextDpr - dpr) > 0.01;
    if (!changed) return false;
    W = nextW;
    H = nextH;
    dpr = nextDpr;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  function mkPart(): Particle {
    const sp = sprites[(Math.random() * sprites.length) | 0];
    const w = (24 + Math.random() * 42) * scale; // 24..66px × theme scale
    const aspect = sp.height / sp.width;
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      w,
      h: w * aspect,
      rot: Math.random() * 6.28,
      vr: (Math.random() - 0.5) * 0.8,
      vx: (Math.random() - 0.5) * 0.28,
      vy: -(0.07 + Math.random() * 0.27), // upward
      sway: Math.random() * 6.28,
      swayA: 0.2 + Math.random() * 0.7,
      swaySp: 0.008 + Math.random() * 0.012,
      alpha: 0.3 + Math.random() * 0.42, // 0.30..0.72
      quiet: 1,
      sp,
    };
  }

  function rebuild(): void {
    const mobile = window.innerWidth < 700;
    const area = Math.max(1, W * H);
    const n = Math.min(
      mobile ? 86 : 150,
      Math.max(mobile ? 28 : 60, Math.round(area / (mobile ? 15500 : 24000))),
    );
    particles = [];
    for (let i = 0; i < n; i++) particles.push(mkPart());
  }

  // Capture the actual rendered line boxes. Particle opacity is eased
  // against these regions in step(), which avoids a full-page mask
  // composite on every frame while retaining a soft transition.
  function rebuildQuietRegions(): void {
    const rootBounds = root.getBoundingClientRect();
    const lineRects: DOMRect[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || !node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
        if (parent.closest("canvas, script, style, [hidden], [aria-hidden='true']")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const range = document.createRange();
    let textNode = walker.nextNode();
    while (textNode) {
      range.selectNodeContents(textNode);
      for (const rect of range.getClientRects()) {
        if (rect.width > 0 && rect.height > 0) lineRects.push(rect);
      }
      textNode = walker.nextNode();
    }
    for (const control of root.querySelectorAll<HTMLElement>(
      "input:not([type='hidden']), textarea, select",
    )) {
      if (!control.closest("[hidden]")) lineRects.push(control.getBoundingClientRect());
    }
    root.dataset.textFadeLines = String(lineRects.length);
    quietRects = lineRects.map((rect) => ({
      left: rect.left - rootBounds.left,
      top: rect.top - rootBounds.top,
      right: rect.right - rootBounds.left,
      bottom: rect.bottom - rootBounds.top,
    }));
  }

  function quietFactor(p: Particle): number {
    const halfW = p.w / 2 + 8;
    const halfH = p.h / 2 + 8;
    let factor = 1;
    for (const rect of quietRects) {
      const left = rect.left - halfW;
      const right = rect.right + halfW;
      const top = rect.top - halfH;
      const bottom = rect.bottom + halfH;
      const dx = Math.max(left - p.x, 0, p.x - right);
      const dy = Math.max(top - p.y, 0, p.y - bottom);
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance >= 28) continue;
      factor = Math.min(factor, 0.08 + (distance / 28) * 0.92);
      if (factor <= 0.08) return 0.08;
    }
    return factor;
  }

  function syncQuietFactors(): void {
    for (const p of particles) p.quiet = quietFactor(p);
  }

  function drawParticle(p: Particle): void {
    ctx.globalAlpha = p.alpha * p.quiet;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.drawImage(p.sp, -p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }

  function drawStatic(): void {
    ctx.clearRect(0, 0, W, H);
    syncQuietFactors();
    for (const p of particles) drawParticle(p);
    ctx.globalAlpha = 1;
  }

  function step(): void {
    ctx.clearRect(0, 0, W, H);
    for (const p of particles) {
      p.sway += p.swaySp;
      p.rot += p.vr * 0.01;
      p.x += p.vx + Math.sin(p.sway) * p.swayA * 0.15;
      p.y += p.vy;

      // Subtle cursor repel within ~110px.
      if (pointer.active) {
        const dx = p.x - pointer.x;
        const dy = p.y - pointer.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 110 && dist > 0.001) {
          const f = ((110 - dist) / 110) * 1.2;
          p.x += (dx / dist) * f;
          p.y += (dy / dist) * f;
        }
      }

      // Wrap/respawn when leaving the top or sides.
      if (p.y < -80) {
        p.y = H + 40;
        p.x = Math.random() * W;
      }
      if (p.x < -80) p.x = W + 40;
      else if (p.x > W + 80) p.x = -40;

      const quietTarget = quietFactor(p);
      p.quiet += (quietTarget - p.quiet) * 0.12;
      drawParticle(p);
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(step);
  }

  function onMove(e: MouseEvent): void {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (x < 0 || x > W || y < 0 || y > H) {
      pointer.active = false;
      return;
    }
    pointer.x = x;
    pointer.y = y;
    pointer.active = true;
  }

  function refreshLayout(): void {
    if (disposed) return;
    const resized = sizeCanvas();
    rebuildQuietRegions();
    if (resized) {
      rebuild();
      syncQuietFactors();
    }
    if (reduced) drawStatic();
    layoutTimer = 0;
  }

  function scheduleLayout(): void {
    if (disposed) return;
    if (layoutTimer) window.clearTimeout(layoutTimer);
    layoutTimer = window.setTimeout(refreshLayout, 120);
  }

  const resizeObserver = new ResizeObserver(scheduleLayout);
  const contentObserver = new MutationObserver(scheduleLayout);
  function syncMotion(): void {
    const next = isReduced();
    if (next === reduced || disposed) return;
    reduced = next;
    if (reduced) {
      cancelAnimationFrame(raf);
      raf = 0;
      drawStatic();
    } else {
      raf = requestAnimationFrame(step);
    }
  }
  const motionObserver = new MutationObserver(syncMotion);

  function cleanup(): void {
    disposed = true;
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    if (layoutTimer) window.clearTimeout(layoutTimer);
    resizeObserver.disconnect();
    contentObserver.disconnect();
    motionObserver.disconnect();
    motionQuery.removeEventListener("change", syncMotion);
    document.removeEventListener("visibilitychange", syncMotion);
    window.removeEventListener("resize", scheduleLayout);
    window.removeEventListener("mousemove", onMove);
  }

  sizeCanvas();
  rebuildQuietRegions();
  rebuild();
  syncQuietFactors();
  resizeObserver.observe(root);
  motionObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-reduced-motion"],
  });
  motionQuery.addEventListener("change", syncMotion);
  document.addEventListener("visibilitychange", syncMotion);
  contentObserver.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["hidden"],
  });
  window.addEventListener("resize", scheduleLayout, { passive: true });
  window.addEventListener("mousemove", onMove, { passive: true });
  void document.fonts?.ready.then(scheduleLayout);
  if (reduced) {
    drawStatic();
  } else {
    raf = requestAnimationFrame(step);
  }

  return cleanup;
}

export function ComailLoginEnvelopes({ theme = "spooky" }: { theme?: ComailLoginTheme }) {
  const artwork = comailLoginArtwork[theme === "spooky" ? "spooky" : "default"];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void loadSprites(artwork).then(sprites => {
      if (!disposed) stop = start(canvas, sprites, artwork.scale);
    });
    return () => {
      disposed = true;
      stop?.();
    };
  }, [artwork]);
  return <canvas ref={canvasRef} className="comail-login-envelopes" aria-hidden="true" />;
}
