"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ZoomIn, ZoomOut, Maximize } from "lucide-react";

interface ImageLightboxProps {
  /** URL shown inline on the page (page-resolution). */
  src: string;
  /** Highest-resolution URL loaded inside the lightbox for close-up viewing. */
  zoomSrc: string;
  alt: string;
  /** Classes applied to the inline <img> so it matches the page layout. */
  inlineClassName?: string;
}

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const DBLCLICK_SCALE = 2.5;
const WHEEL_STEP = 1.15;
const BUTTON_STEP = 1.4;

interface View {
  scale: number;
  tx: number;
  ty: number;
}

const RESET: View = { scale: MIN_SCALE, tx: 0, ty: 0 };

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Click-to-enlarge image with a full-viewport zoom/pan lightbox, emulating
 * the Met's whole-browser viewer. Lets visitors inspect a work closely
 * without downloading it. Wheel/buttons zoom toward the cursor, drag pans
 * when zoomed, double-click toggles zoom, Esc/backdrop/✕ close.
 */
export default function ImageLightbox({ src, zoomSrc, alt, inlineClassName }: ImageLightboxProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState<View>(RESET);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef({ active: false, startX: 0, startY: 0, baseX: 0, baseY: 0 });

  useEffect(() => setMounted(true), []);

  const close = useCallback(() => {
    setOpen(false);
    setView(RESET);
  }, []);

  // Zoom toward a client point, keeping the image pixel under the cursor fixed.
  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = clientX - rect.left - rect.width / 2;
    const py = clientY - rect.top - rect.height / 2;
    setView((v) => {
      const ns = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
      if (ns === MIN_SCALE) return RESET;
      const lx = (px - v.tx) / v.scale;
      const ly = (py - v.ty) / v.scale;
      return { scale: ns, tx: px - lx * ns, ty: py - ly * ns };
    });
  }, []);

  const zoomFromCenter = useCallback(
    (factor: number) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    },
    [zoomAt]
  );

  // Lock body scroll + wire Esc while the lightbox is open.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  // Native wheel listener so we can preventDefault (React's onWheel is passive).
  useEffect(() => {
    const el = containerRef.current;
    if (!open || !el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [open, zoomAt]);

  const onPointerDown = (e: React.PointerEvent<HTMLImageElement>) => {
    if (view.scale <= MIN_SCALE) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { active: true, startX: e.clientX, startY: e.clientY, baseX: view.tx, baseY: view.ty };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLImageElement>) => {
    if (!drag.current.active) return;
    const dx = e.clientX - drag.current.startX;
    const dy = e.clientY - drag.current.startY;
    setView((v) => ({ ...v, tx: drag.current.baseX + dx, ty: drag.current.baseY + dy }));
  };

  const onPointerUp = () => {
    drag.current.active = false;
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (view.scale > MIN_SCALE) setView(RESET);
    else zoomAt(e.clientX, e.clientY, DBLCLICK_SCALE);
  };

  const zoomed = view.scale > MIN_SCALE;
  const ctrlBtn =
    "flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-white";

  const overlay = (
    <div
      ref={containerRef}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-black/90"
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={zoomSrc}
        alt={alt}
        draggable={false}
        onDoubleClick={onDoubleClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
          transformOrigin: "center center",
          touchAction: "none",
          willChange: "transform",
          cursor: zoomed ? (drag.current.active ? "grabbing" : "grab") : "zoom-in",
        }}
        className="max-h-[95vh] max-w-[95vw] select-none object-contain"
      />

      <div className="absolute right-4 top-4 flex gap-2">
        <button type="button" className={ctrlBtn} onClick={() => zoomFromCenter(1 / BUTTON_STEP)} aria-label="Zoom out">
          <ZoomOut size={20} aria-hidden="true" />
        </button>
        <button type="button" className={ctrlBtn} onClick={() => zoomFromCenter(BUTTON_STEP)} aria-label="Zoom in">
          <ZoomIn size={20} aria-hidden="true" />
        </button>
        <button type="button" className={ctrlBtn} onClick={close} aria-label="Close image viewer">
          <X size={20} aria-hidden="true" />
        </button>
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative block cursor-zoom-in"
        aria-label="Enlarge image"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className={inlineClassName} />
        <span className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
          <Maximize size={14} aria-hidden="true" /> Click to enlarge
        </span>
      </button>
      {mounted && open && createPortal(overlay, document.body)}
    </>
  );
}
