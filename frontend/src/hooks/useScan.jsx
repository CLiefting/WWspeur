import { createContext, useContext, useRef, useState } from 'react';
import { scans, shops } from '../services/api';

const ScanContext = createContext(null);

export function ScanProvider({ children }) {
  const [isScanning, setIsScanning] = useState(null);
  const [scanStatus, setScanStatus] = useState('');
  const [scanProgress, setScanProgress] = useState(null);
  const [scanningUrl, setScanningUrl] = useState('');
  const [currentScanId, setCurrentScanId] = useState(null);
  const [currentShopId, setCurrentShopId] = useState(null);
  const [scanStartedAt, setScanStartedAt] = useState(null);

  const [batchScanning, setBatchScanning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0, currentDomain: '', shopProgress: null, completedShops: [] });

  // Queue: array of { id, domain, url }
  const [scanQueue, setScanQueue] = useState([]);

  const abortRef = useRef(false);
  const lastScanRef = useRef({ shopId: null, shopUrl: '', maxPages: 50 });
  const batchStartRef = useRef(null);
  const shopStartRef = useRef(null);

  const _runScanWithPolling = async (shopId, shopUrl, maxPages) => {
    setIsScanning(shopId);
    setCurrentShopId(shopId);
    setScanningUrl(shopUrl);
    setScanStatus('Scan gestart...');
    setScanProgress(null);
    setScanStartedAt(Date.now());
    abortRef.current = false;
    lastScanRef.current = { shopId, shopUrl, maxPages };

    const scan = await scans.create(
      shopId,
      ['whois', 'ssl', 'dns_http', 'tech', 'trustmark', 'ad_tracker', 'scrape', 'kvk', 'scam_check'],
      maxPages,
    );
    setCurrentScanId(scan.id);

    await scans.pollUntilDone(
      scan.id,
      (s) => {
        if (s.status === 'completed') setScanStatus('Scan voltooid!');
        else if (s.status === 'failed') setScanStatus('Scan mislukt');
      },
      (progressData) => {
        if (progressData.progress && Object.keys(progressData.progress).length > 0) {
          setScanProgress(progressData.progress);
          const p = progressData.progress;
          setScanStatus(
            `Pagina ${p.pages_crawled || 0}/${p.max_pages || '?'} — ` +
            `${p.emails_found || 0} emails, ${p.phones_found || 0} tel, ` +
            `${p.kvk_found || 0} KvK`,
          );
        }
      },
      1500,
      () => abortRef.current,
    );

    return shopId;
  };

  const startScan = async (shopId, shopUrl, maxPages, onComplete) => {
    await _runScanWithPolling(shopId, shopUrl, maxPages);
    if (onComplete) onComplete(shopId);
  };

  const stopScan = () => {
    abortRef.current = true;
    setIsScanning(null);
    setScanStatus('');
    setScanProgress(null);
    setScanningUrl('');
    setCurrentScanId(null);
    setCurrentShopId(null);
    setScanStartedAt(null);
  };

  const restartScan = () => {
    const { shopId, shopUrl, maxPages } = lastScanRef.current;
    stopScan();
    if (shopId) setTimeout(() => startScan(shopId, shopUrl, maxPages), 100);
  };

  // Queue a list of shops and process them one by one
  const queueScans = async (shopList, maxPages = 50, onShopComplete) => {
    if (batchScanning) return;
    setBatchScanning(true);
    abortRef.current = false;

    // Set full queue upfront so the UI can show it immediately
    setScanQueue(shopList.map(s => ({ id: s.id, domain: s.domain, url: s.url })));

    const scannedShopIds = [];
    setBatchProgress({ current: 0, total: shopList.length, currentDomain: '', shopProgress: null, completedShops: [] });

    try {
      for (let i = 0; i < shopList.length; i++) {
        if (abortRef.current) break;

        const shop = shopList[i];

        // Remove this shop from the queue (it's now active)
        setScanQueue(prev => prev.filter(s => s.id !== shop.id));
        setBatchProgress(p => ({ ...p, current: i + 1, currentDomain: shop.domain, shopProgress: null }));
        setIsScanning(shop.id);
        setCurrentShopId(shop.id);
        setScanningUrl(shop.url || shop.domain);

        try {
          const scan = await scans.create(
            shop.id,
            ['whois', 'ssl', 'dns_http', 'tech', 'trustmark', 'ad_tracker', 'scrape', 'kvk', 'scam_check'],
            maxPages,
          );
          setCurrentScanId(scan.id);

          await scans.pollUntilDone(
            scan.id,
            () => {},
            (progressData) => {
              if (progressData.progress && Object.keys(progressData.progress).length > 0) {
                setScanProgress(progressData.progress);
                setBatchProgress(p => ({ ...p, shopProgress: progressData.progress }));
              }
            },
            1500,
            () => abortRef.current,
          );

          if (!abortRef.current) {
            scannedShopIds.push(shop.id);
            setBatchProgress(p => ({
              ...p,
              completedShops: [...(p.completedShops || []), { domain: shop.domain, status: 'ok' }],
              shopProgress: null,
            }));
            if (onShopComplete) onShopComplete(shop.id);
          }
        } catch (err) {
          console.error('Scan failed for', shop.domain, err);
          setBatchProgress(p => ({
            ...p,
            completedShops: [...(p.completedShops || []), { domain: shop.domain, status: 'error' }],
          }));
        }
      }
    } finally {
      setScanQueue([]);
      setIsScanning(null);
      setCurrentShopId(null);
      setScanStatus('');
      setScanProgress(null);
      setScanningUrl('');
      setBatchScanning(false);
      setBatchProgress({ current: 0, total: 0, currentDomain: '', shopProgress: null, completedShops: [] });
    }
  };

  const startBatchScan = async (maxPages, withReports, onShopComplete) => {
    if (batchScanning) return;
    setBatchScanning(true);
    abortRef.current = false;

    try {
      let allShops = [];
      let pg = 1;
      while (true) {
        const data = await shops.list(pg, 100, '');
        allShops = [...allShops, ...data.shops];
        if (allShops.length >= data.total) break;
        pg++;
      }

      batchStartRef.current = Date.now();
      setBatchProgress({ current: 0, total: allShops.length, currentDomain: '', shopProgress: null, completedShops: [], batchStartedAt: Date.now() });
      const scannedShopIds = [];

      for (let i = 0; i < allShops.length; i++) {
        if (abortRef.current) break;

        const shop = allShops[i];
        shopStartRef.current = Date.now();
        setBatchProgress(p => ({ ...p, current: i + 1, currentDomain: shop.domain, shopProgress: null, shopStartedAt: Date.now() }));

        try {
          const scan = await scans.create(
            shop.id,
            ['whois', 'ssl', 'dns_http', 'tech', 'trustmark', 'ad_tracker', 'scrape', 'kvk', 'scam_check'],
            maxPages,
          );

          await scans.pollUntilDone(
            scan.id,
            () => {},
            (progressData) => {
              if (progressData.progress && Object.keys(progressData.progress).length > 0) {
                setBatchProgress(p => ({ ...p, shopProgress: progressData.progress }));
              }
            },
            1500,
            () => abortRef.current,
          );

          if (!abortRef.current) {
            scannedShopIds.push(shop.id);
            setBatchProgress(p => ({
              ...p,
              completedShops: [...(p.completedShops || []), { domain: shop.domain, status: 'ok' }],
              shopProgress: null,
            }));
            if (onShopComplete) onShopComplete();
          }
        } catch (err) {
          console.error('Scan failed for', shop.domain, err);
          setBatchProgress(p => ({
            ...p,
            completedShops: [...(p.completedShops || []), { domain: shop.domain, status: 'error' }],
          }));
        }
      }

      if (withReports && scannedShopIds.length > 0 && !abortRef.current) {
        setBatchProgress(p => ({ ...p, currentDomain: 'Rapporten genereren...' }));
        try {
          const token = localStorage.getItem('wwspeur_token');
          const response = await fetch('/api/v1/shops/batch-reports', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(scannedShopIds),
          });
          if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const match = response.headers.get('content-disposition')?.match(/filename="?([^"]+)"?/);
            a.download = match ? match[1] : 'wwspeur_rapporten.zip';
            a.click();
            window.URL.revokeObjectURL(url);
          }
        } catch (err) { console.error('Batch reports failed', err); }
      }

      if (onShopComplete) onShopComplete();
    } finally {
      setBatchScanning(false);
      setBatchProgress({ current: 0, total: 0, currentDomain: '', shopProgress: null, completedShops: [] });
    }
  };

  const stopBatchScan = () => {
    abortRef.current = true;
    setScanQueue([]);
    setIsScanning(null);
    setCurrentShopId(null);
    setBatchScanning(false);
    setBatchProgress({ current: 0, total: 0, currentDomain: '', shopProgress: null, completedShops: [] });
  };

  return (
    <ScanContext.Provider value={{
      isScanning, scanStatus, scanProgress, scanningUrl, currentScanId, currentShopId,
      scanStartedAt,
      batchScanning, batchProgress, scanQueue,
      startScan, stopScan, restartScan,
      startBatchScan, stopBatchScan, queueScans,
    }}>
      {children}
    </ScanContext.Provider>
  );
}

export function useScan() {
  return useContext(ScanContext);
}
