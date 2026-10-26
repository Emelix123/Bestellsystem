import type { Catalog } from '@bestellsystem/shared';
import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from './api';
import { useLive } from './live';
import { storage } from './storage';

const CACHE_KEY = 'catalog-cache';

/**
 * Produkte, Tische und Einstellungen der aktiven Veranstaltung. Wird lokal
 * zwischengespeichert, damit die App auch bei kurzem Netzausfall sofort startet,
 * und bei Änderungen im Admin-Bereich live aktualisiert.
 */
export function useCatalog() {
  const [catalog, setCatalog] = useState<Catalog | null>(() => storage.get<Catalog | null>(CACHE_KEY, null));
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await api.get<Catalog>('/api/catalog');
      setCatalog(data);
      storage.set(CACHE_KEY, data);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useLive(
    (msg) => {
      if (msg.type === 'catalog') void reload();
      if (msg.type === 'product') {
        setCatalog((c) => {
          if (!c) return c;
          const next = {
            ...c,
            products: c.products.map((p) => (p.id === msg.productId ? { ...p, soldOut: msg.soldOut } : p)),
          };
          storage.set(CACHE_KEY, next);
          return next;
        });
      }
    },
    () => void reload(),
  );

  return { catalog, error, reload };
}
