import type { PackSummary } from '@dubparty/shared';
import { useEffect, useState } from 'react';
import { fetchPacks } from '../net/api';

/** Список паков для лобби. Перезапрашивается при каждом открытии — паки могли добавить. */
export function usePacks(): { packs: PackSummary[]; loading: boolean; reload(): void } {
  const [packs, setPacks] = useState<PackSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchPacks()
      .then((list) => !cancelled && setPacks(list))
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return { packs, loading, reload: () => setNonce((n) => n + 1) };
}
