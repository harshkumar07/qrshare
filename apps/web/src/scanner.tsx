import { useEffect } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

export function Scanner({ onScan, onError }: { onScan: (text: string) => void; onError?: (message: string) => void }) {
  useEffect(() => {
    const elementId = 'qrshare-reader';
    const scanner = new Html5Qrcode(elementId);
    let stopped = false;
    void scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      (decoded) => {
        if (!stopped) {
          stopped = true;
          void scanner.stop().catch(() => undefined).finally(() => onScan(decoded));
        }
      },
      () => undefined,
    ).catch(() => { if (!stopped) onError?.('Camera could not start. Check camera permission and HTTPS.'); });
    return () => { stopped = true; void scanner.stop().catch(() => undefined); };
  }, [onScan, onError]);
  return <div id="qrshare-reader" className="scanner" />;
}
