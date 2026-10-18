// Removing the questions a check asked, and the demand prompts they started, without touching anyone else's: shared
// by scripts/check-leak.ts and scripts/check-citations.ts. Uses the service-role key, which only scripts/ may hold.
// Since dedupe (F2.5, 0008) a question can join an open demand prompt instead of starting one, so:
//   - a prompt a check's question started, that a question the check didn't ask has joined since (a rehearsal's), is
//     kept, with its route: deleting it would take the rehearsal's slip out of a25's inbox. Deleting the check's own
//     question only clears the prompt's source_question_id.
//   - a prompt the check's question joined but didn't start keeps an ask_count one too high; it is reported.
// Their answers rows go with the questions, and their routes with the prompts; Realtime sends no deletes (0005).
// Answers what wasn't as it should be, ids only; an empty list when everything the questions made is gone.
import type { SupabaseClient } from "@supabase/supabase-js";

export async function removeQuestions(
  service: SupabaseClient,
  questionIds: string[],
): Promise<string[]> {
  const problems: string[] = [];
  const ours = new Set(questionIds);
  const ids = [...ours];
  for (let at = 0; at < ids.length; at += 50) {
    const chunk = ids.slice(at, at + 50);
    // Before the questions go: deleting one clears its prompt's source_question_id.
    const [started, asked] = await Promise.all([
      service.from("prompts").select("id").in("source_question_id", chunk),
      service.from("questions").select("id, prompt_id").in("id", chunk),
    ]);
    if (started.error || asked.error) {
      problems.push(
        `find the questions' prompts: ${started.error?.code ?? asked.error?.code}`,
      );
      continue;
    }
    const startedIds = new Set(
      (started.data as { id: string }[]).map((row) => row.id),
    );
    for (const row of asked.data as {
      id: string;
      prompt_id: string | null;
    }[]) {
      if (row.prompt_id && !startedIds.has(row.prompt_id)) {
        problems.push(
          `question ${row.id} joined prompt ${row.prompt_id}, which it didn't start: its ask count stays one higher`,
        );
      }
    }
    let removable = [...startedIds];
    if (removable.length > 0) {
      const joined = await service
        .from("questions")
        .select("id, prompt_id")
        .in("prompt_id", removable);
      if (joined.error) {
        problems.push(`find who joined the prompts: ${joined.error.code}`);
        continue;
      }
      const kept = new Set(
        (joined.data as { id: string; prompt_id: string }[])
          .filter((row) => !ours.has(row.id))
          .map((row) => row.prompt_id),
      );
      for (const promptId of kept) {
        problems.push(
          `kept prompt ${promptId}: a question this check didn't ask joined it`,
        );
      }
      removable = removable.filter((id) => !kept.has(id));
    }
    if (removable.length > 0) {
      const { error } = await service
        .from("prompts")
        .delete()
        .in("id", removable);
      if (error) problems.push(`delete prompts: ${error.code}`);
    }
    const { error } = await service.from("questions").delete().in("id", chunk);
    if (error) problems.push(`delete questions: ${error.code}`);
  }
  return problems;
}
