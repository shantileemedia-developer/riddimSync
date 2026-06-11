import React, { useRef, useEffect } from 'react';

interface WaveformDisplayProps {
  peaks: number[];
  color: string;
  height?: number;
}

const WaveformDisplay: React.FC<WaveformDisplayProps> = ({ peaks, color, height = 44 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || peaks.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const barWidth = w / peaks.length;
    const midY = h / 2;

    ctx.fillStyle = color;
    peaks.forEach((peak, i) => {
      const barH = Math.max(1, peak * h * 0.88);
      ctx.fillRect(i * barWidth, midY - barH / 2, Math.max(1, barWidth - 0.5), barH);
    });
  }, [peaks, color]);

  return (
    <canvas
      ref={canvasRef}
      width={400}
      height={height}
      style={{ width: '100%', height: `${height}px`, display: 'block' }}
    />
  );
};

export default WaveformDisplay;
