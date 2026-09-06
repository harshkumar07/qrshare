import { useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

export function Scanner({ onScan }: { onScan: (text: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const elementId = 'qrshare-reader';
    const scanner = new Html5Qrcode(elementId);
    let stopped = false;
    scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      (decoded) => {
        if (!stopped) {
          stopped = true;
          void scanner.stop().catch(() => undefined).finally(() => onScan(decoded));
        }
      },
      () => undefined,
    ).catch(() => undefined);

    return () => {
      stopped = true;
      void scanner.stop().catch(() => undefined);
    };
  }, [onScan]);

  return <div id="qrshare-reader" ref={ref} className="scanner" />;
}
