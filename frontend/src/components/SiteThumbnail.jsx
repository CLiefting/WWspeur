import { useState, useEffect } from 'react';

/**
 * Toont een thumbnail van de homepage van een shop.
 * shopId: het ID van de shop (voor de API-call)
 * width/height: afmetingen van de tile
 */
export default function SiteThumbnail({ shopId, width = 120, height = 75 }) {
  const [src, setSrc] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!shopId) return;
    setSrc(null);
    setError(false);
    setSrc(`/api/v1/shops/${shopId}/thumbnail?t=${Date.now()}`);
  }, [shopId]);

  if (!shopId) return null;

  return (
    <div style={{
      width, height, borderRadius: 6, overflow: 'hidden',
      border: '1px solid var(--border)',
      background: 'var(--bg-input)',
      flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {!error && src ? (
        <img
          src={src}
          alt="preview"
          onError={() => setError(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }}
        />
      ) : (
        <span style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', padding: 4 }}>
          {error ? 'geen preview' : '…'}
        </span>
      )}
    </div>
  );
}
