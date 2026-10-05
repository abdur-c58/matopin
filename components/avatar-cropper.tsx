"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Dialog } from "radix-ui";
import { LoaderCircle, Minus, Move, Plus, X } from "lucide-react";
import type { AvatarCrop, AvatarSource } from "@/lib/avatar";
import { Button } from "./ui";

const VIEW = 288;
const MAX_ZOOM = 4;

type Point = { x: number; y: number };

/** Pick the square of a picture to use as the avatar: drag to move, zoom with the slider, wheel, or + and −. */
export function AvatarCropper({ source, busy, onCancel, onApply }: { source: AvatarSource; busy: boolean; onCancel: () => void; onApply: (crop: AvatarCrop) => void }) {
  const base = VIEW / Math.min(source.width, source.height);
  const sizeAt = (z: number) => ({ w: source.width * base * z, h: source.height * base * z });
  const clamp = (p: Point, z: number): Point => {
    const { w, h } = sizeAt(z);
    return { x: Math.min(0, Math.max(VIEW - w, p.x)), y: Math.min(0, Math.max(VIEW - h, p.y)) };
  };
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState<Point>(() => ({ x: (VIEW - source.width * base) / 2, y: (VIEW - source.height * base) / 2 }));
  const drag = useRef<{ pointer: number; start: Point; from: Point } | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const { w, h } = sizeAt(zoom);

  const zoomTo = (next: number, anchor: Point = { x: VIEW / 2, y: VIEW / 2 }) => {
    const z = Math.min(MAX_ZOOM, Math.max(1, next));
    const ratio = z / zoom;
    setPos(clamp({ x: anchor.x - (anchor.x - pos.x) * ratio, y: anchor.y - (anchor.y - pos.y) * ratio }, z));
    setZoom(z);
  };
  const wheelZoom = (delta: number, anchor: Point) => zoomTo(zoom * Math.exp(-delta * 0.0015), anchor);
  const wheelRef = useRef(wheelZoom);
  useEffect(() => { wheelRef.current = wheelZoom; });

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    // React's wheel handler is passive, so the page would scroll along with the zoom.
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      wheelRef.current(e.deltaY, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);

  const crop: AvatarCrop = { x: -pos.x / w, y: -pos.y / h, w: Math.min(1, VIEW / w), h: Math.min(1, VIEW / h) };

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="popup fixed top-1/2 left-1/2 w-[min(22rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 p-5">
          <Dialog.Close className="icon-btn absolute top-4 right-4" aria-label="Close" disabled={busy}><X className="size-4" /></Dialog.Close>
          <Dialog.Title className="pr-10 text-lg font-semibold">Crop your photo</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted">Drag to move it and zoom to fit. The square is saved; the circle is how it shows.</Dialog.Description>

          <div
            ref={frame} tabIndex={0} role="application" aria-label="Crop area. Arrow keys move the photo, plus and minus zoom."
            className="relative mx-auto mt-4 cursor-grab touch-none overflow-hidden rounded-2xl bg-porcelain outline-none select-none focus-visible:ring-2 focus-visible:ring-volt-500 active:cursor-grabbing"
            style={{ width: VIEW, height: VIEW }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { pointer: e.pointerId, start: { x: e.clientX, y: e.clientY }, from: pos };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d || d.pointer !== e.pointerId) return;
              setPos(clamp({ x: d.from.x + e.clientX - d.start.x, y: d.from.y + e.clientY - d.start.y }, zoom));
            }}
            onPointerUp={() => { drag.current = null; }}
            onPointerCancel={() => { drag.current = null; }}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 40 : 10;
              const moves: Record<string, Point> = { ArrowLeft: { x: step, y: 0 }, ArrowRight: { x: -step, y: 0 }, ArrowUp: { x: 0, y: step }, ArrowDown: { x: 0, y: -step } };
              if (moves[e.key]) { e.preventDefault(); setPos(clamp({ x: pos.x + moves[e.key].x, y: pos.y + moves[e.key].y }, zoom)); }
              if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomTo(zoom + 0.25); }
              if (e.key === "-") { e.preventDefault(); zoomTo(zoom - 0.25); }
            }}
          >
            <Image
              src={source.url} alt="" width={source.width} height={source.height} unoptimized draggable={false}
              className="pointer-events-none absolute top-0 left-0 max-w-none"
              style={{ width: w, height: h, transform: `translate(${pos.x}px, ${pos.y}px)` }}
            />
            <span aria-hidden className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_999px_rgb(0_0_0/0.55)] ring-2 ring-white/80" />
            <span aria-hidden className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-white/30 ring-inset" />
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button type="button" className="icon-btn" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => zoomTo(zoom - 0.25)}><Minus className="size-4" /></button>
            <input
              type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} aria-label="Zoom"
              className="h-1.5 flex-1 cursor-pointer accent-volt-500"
              onChange={(e) => zoomTo(Number(e.target.value))}
            />
            <button type="button" className="icon-btn" aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => zoomTo(zoom + 0.25)}><Plus className="size-4" /></button>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted"><Move className="size-3.5" />{source.gif ? "GIFs stay animated." : "Saved as a small square image."}</p>

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
            <Button variant="primary" disabled={busy} onClick={() => onApply(crop)}>
              {busy && <LoaderCircle className="size-4 animate-spin" />}Use photo
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
