"use client";

import { useEffect, useRef, useState } from "react";

// Animates a number counting up from its previous value whenever `value` changes —
// used for the ingested file/chunk counts so the ingest-complete moment feels earned
// rather than just appearing.
export default function CountUp({ value, durationMs = 700 }: { value: number; durationMs?: number }) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    const start = performance.now();

    let raf: number;
    function tick(now: number) {
      const progress = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <>{display}</>;
}
