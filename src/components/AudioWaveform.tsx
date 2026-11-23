import React, { useEffect, useRef } from 'react';

interface AudioWaveformProps {
  active: boolean;
  level?: number; // 0..1 live amplitude
  accent?: 'pink' | 'blue' | 'blend';
  height?: number;
  bars?: number;
}

export const AudioWaveform: React.FC<AudioWaveformProps> = ({
  active,
  level = 0.25,
  accent = 'blend',
  height = 56,
  bars = 36,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const levelRef = useRef(level);
  const activeRef = useRef(active);

  useEffect(() => {
    levelRef.current = level;
  }, [level]);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let rafId = 0;
    let phase = 0;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth || 320;
      const h = height;
      if (canvas.width !== width * dpr || canvas.height !== h * dpr) {
        canvas.width = width * dpr;
        canvas.height = h * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, h);

      const grad = ctx.createLinearGradient(0, 0, width, 0);
      if (accent === 'pink') {
        grad.addColorStop(0, '#EC4899');
        grad.addColorStop(1, '#A855F7');
      } else if (accent === 'blue') {
        grad.addColorStop(0, '#3B82F6');
        grad.addColorStop(1, '#8B5CF6');
      } else {
        grad.addColorStop(0, '#EC4899');
        grad.addColorStop(0.5, '#A855F7');
        grad.addColorStop(1, '#3B82F6');
      }

      const barGap = width / bars;
      const barWidth = Math.max(2, Math.min(4, barGap * 0.48));
      const amp = activeRef.current ? Math.max(0.28, Math.min(1, levelRef.current)) : 0.14;

      for (let i = 0; i < bars; i++) {
        const norm = i / (bars - 1);
        const envelope = Math.sin(norm * Math.PI);
        const wave =
          Math.sin(phase + i * 0.42) * 0.5 +
          Math.cos(phase * 1.4 - i * 0.27) * 0.5;
        const barH = Math.max(4, (h - 8) * amp * envelope * (0.45 + 0.55 * Math.abs(wave)));
        const x = i * barGap + (barGap - barWidth) / 2;
        const y = (h - barH) / 2;

        ctx.fillStyle = grad;
        ctx.globalAlpha = activeRef.current ? 0.92 : 0.42;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barH, barWidth / 2);
        ctx.fill();
      }

      ctx.restore();
      if (!prefersReducedMotion) {
        phase += activeRef.current ? 0.12 : 0.035;
        rafId = requestAnimationFrame(draw);
      }
    };

    draw();
    return () => cancelAnimationFrame(rafId);
  }, [accent, bars, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{ height: `${height}px` }}
      className="w-full block"
      aria-hidden="true"
    />
  );
};
