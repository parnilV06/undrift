import { useEffect, type RefObject } from "react";

interface Ripple {
  x: number;
  y: number;
  start: number;
}

const RIPPLE_DURATION = 1800;
const RIPPLE_SPEED = 0.42;
const RIPPLE_WIDTH = 28;
const RIPPLE_PUSH = 10;
const WARP_RADIUS = 170;
const WARP_PULL = 0.22;
const TAU = Math.PI * 2;

export function useKineticGrid(
  containerRef: RefObject<HTMLElement>,
  canvasRef: RefObject<HTMLCanvasElement>,
) {
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!container || !canvas || !ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const interactive = finePointer.matches && !reduceMotion.matches;

    let width = 0;
    let height = 0;
    let cols = 0;
    let rows = 0;
    let baseX = new Float32Array(0);
    let baseY = new Float32Array(0);
    let x = new Float32Array(0);
    let y = new Float32Array(0);
    let influence = new Float32Array(0);

    const pointer = {
      x: 0,
      y: 0,
      targetX: 0,
      targetY: 0,
      strength: 0,
      targetStrength: 0,
    };
    const ripples: Ripple[] = [];
    let frame = 0;
    let visible = true;

    const build = () => {
      const rect = container.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const spacing = width < 768 ? 40 : 56;
      cols = Math.ceil(width / spacing) + 1;
      rows = Math.ceil(height / spacing) + 1;
      const count = cols * rows;
      baseX = new Float32Array(count);
      baseY = new Float32Array(count);
      x = new Float32Array(count);
      y = new Float32Array(count);
      influence = new Float32Array(count);

      const left = (width - (cols - 1) * spacing) / 2;
      const top = (height - (rows - 1) * spacing) / 2;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const i = row * cols + col;
          baseX[i] = left + col * spacing;
          baseY[i] = top + row * spacing;
        }
      }
    };

    const draw = (now: number) => {
      ctx.clearRect(0, 0, width, height);
      const { x: px, y: py, strength } = pointer;
      const count = cols * rows;

      for (let i = 0; i < count; i++) {
        const bx = baseX[i];
        const by = baseY[i];
        const dx = px - bx;
        const dy = py - by;
        const near =
          strength *
          Math.exp(-(dx * dx + dy * dy) / (2 * WARP_RADIUS * WARP_RADIUS));
        influence[i] = near;

        let nx = bx + dx * near * WARP_PULL;
        let ny = by + dy * near * WARP_PULL;

        for (const ripple of ripples) {
          const rx = bx - ripple.x;
          const ry = by - ripple.y;
          const dist = Math.hypot(rx, ry);
          if (dist === 0) continue;
          const age = Math.max(0, now - ripple.start);
          const band = Math.exp(
            -((dist - age * RIPPLE_SPEED) ** 2) /
              (2 * RIPPLE_WIDTH * RIPPLE_WIDTH),
          );
          const push = band * (1 - age / RIPPLE_DURATION) * RIPPLE_PUSH;
          nx += (rx / dist) * push;
          ny += (ry / dist) * push;
        }

        x[i] = nx;
        y[i] = ny;
      }

      if (strength > 0.01) {
        const glow = ctx.createRadialGradient(
          px,
          py,
          0,
          px,
          py,
          WARP_RADIUS * 1.4,
        );
        glow.addColorStop(0, `rgba(255, 255, 255, ${0.08 * strength})`);
        glow.addColorStop(1, "rgba(255, 255, 255, 0)");
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, width, height);
      }

      ctx.beginPath();
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const i = row * cols + col;
          if (col === 0) ctx.moveTo(x[i], y[i]);
          else ctx.lineTo(x[i], y[i]);
        }
      }
      for (let col = 0; col < cols; col++) {
        for (let row = 0; row < rows; row++) {
          const i = row * cols + col;
          if (row === 0) ctx.moveTo(x[i], y[i]);
          else ctx.lineTo(x[i], y[i]);
        }
      }
      ctx.strokeStyle = "rgba(255, 255, 255, 0.07)";
      ctx.lineWidth = 1;
      ctx.stroke();

      for (let i = 0; i < count; i++) {
        ctx.fillStyle = `rgba(255, 255, 255, ${0.2 + influence[i] * 0.6})`;
        ctx.beginPath();
        ctx.arc(x[i], y[i], 1.2, 0, TAU);
        ctx.fill();
      }

      for (const ripple of ripples) {
        const age = Math.max(0, now - ripple.start);
        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, age * RIPPLE_SPEED, 0, TAU);
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.12 * (1 - age / RIPPLE_DURATION)})`;
        ctx.stroke();
      }
    };

    const request = () => {
      if (!frame && visible && interactive) frame = requestAnimationFrame(tick);
    };

    const tick = (now: number) => {
      frame = 0;
      pointer.x += (pointer.targetX - pointer.x) * 0.16;
      pointer.y += (pointer.targetY - pointer.y) * 0.16;
      pointer.strength += (pointer.targetStrength - pointer.strength) * 0.12;

      while (ripples.length && now - ripples[0].start > RIPPLE_DURATION) {
        ripples.shift();
      }

      draw(now);

      const settled =
        Math.abs(pointer.targetX - pointer.x) < 0.1 &&
        Math.abs(pointer.targetY - pointer.y) < 0.1 &&
        Math.abs(pointer.targetStrength - pointer.strength) < 0.005;
      if (!settled || ripples.length) request();
    };

    const localPoint = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const onPointerMove = (event: PointerEvent) => {
      const point = localPoint(event);
      if (pointer.targetStrength === 0) {
        pointer.x = point.x;
        pointer.y = point.y;
      }
      pointer.targetX = point.x;
      pointer.targetY = point.y;
      pointer.targetStrength = 1;
      request();
    };

    const onPointerLeave = () => {
      pointer.targetStrength = 0;
      request();
    };

    const onPointerDown = (event: PointerEvent) => {
      const point = localPoint(event);
      ripples.push({ x: point.x, y: point.y, start: performance.now() });
      if (ripples.length > 5) ripples.shift();
      request();
    };

    const resizeObserver = new ResizeObserver(() => {
      build();
      if (interactive) request();
      else draw(0);
    });
    resizeObserver.observe(container);

    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) request();
    });
    intersectionObserver.observe(container);

    if (interactive) {
      container.addEventListener("pointermove", onPointerMove);
      container.addEventListener("pointerleave", onPointerLeave);
      container.addEventListener("pointerdown", onPointerDown);
    }

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      if (interactive) {
        container.removeEventListener("pointermove", onPointerMove);
        container.removeEventListener("pointerleave", onPointerLeave);
        container.removeEventListener("pointerdown", onPointerDown);
      }
    };
  }, [containerRef, canvasRef]);
}
