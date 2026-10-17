// Realtime for screens, over Api.subscribe (lib/contracts.ts). The mock API pushes rows within this tab today; the
// real client's Supabase channels plug in behind the same call, so screens don't change.
import { useEffect, useEffectEvent, useState } from "react";
import type {
  AnswersRow,
  Api,
  LiveAnswer,
  RealtimeRows,
} from "@/lib/contracts";

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

export type Subscriber = Pick<Api, "subscribe">;

// Every answers row about this question that carries a live, signed answer. The abstain never
// pushes a row: the asker has already seen the blank line and the 「去年の会計に届けました」 status.
export function subscribeToLiveAnswer(
  api: Subscriber,
  questionId: string,
  onLive: (answer: LiveAnswer) => void,
): () => void {
  return api.subscribe("answers", (row: AnswersRow) => {
    if (row.question_id !== questionId) return;
    const result = row.payload;
    if (result.status !== "answered" || !result.live) return;
    onLive({ ...result, live: result.live });
  });
}

// React binding: the last live answer wins (for example, withdrawing the cited note re-answers the
// question, so the entry must shrink). Unsubscribe on change; re-subscribing replays nothing.
export function useLiveAnswer(
  api: Subscriber,
  questionId: string | null,
): LiveAnswer | null {
  const [answer, setAnswer] = useState<LiveAnswer | null>(null);
  useEffect(() => {
    // No question asked (for example after the mock reset) means no answer on screen either.
    if (!questionId) {
      setAnswer(null);
      return;
    }
    return subscribeToLiveAnswer(api, questionId, setAnswer);
  }, [api, questionId]);
  return answer;
}
