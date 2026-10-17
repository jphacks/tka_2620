// Realtime for screens, over Api.subscribe (lib/contracts.ts). The mock API pushes rows within this tab today; the
// real client's Supabase channels plug in behind the same call, so screens don't change.
import { useEffect, useEffectEvent } from "react";
import type { Api, RealtimeRows } from "@/lib/contracts";

// Calls onRow for each row of the channel this session may see, while the component is mounted. A new onRow on a
// re-render doesn't resubscribe.
export function useRealtime<C extends keyof RealtimeRows>(
  api: Api,
  channel: C,
  onRow: (row: RealtimeRows[C]) => void,
) {
  const handleRow = useEffectEvent(onRow);
  useEffect(
    () => api.subscribe(channel, (row) => handleRow(row)),
    [api, channel],
  );
}
