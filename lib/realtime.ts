"use client";
// lib/realtime.ts — the screens' Realtime layer. The API (mocks now, the real client later) exposes
// subscribe(channel, onRow); this file adds only what a screen needs: the asker's live answer for one
// question (docs/SPEC.md → Realtime `answers`), delivered via next-intl-safe state.
import { useEffect, useState } from "react";
import type { AnswersRow, Api, LiveAnswer } from "@/lib/contracts";

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
