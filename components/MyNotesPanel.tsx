"use client";
// /me/notes (自分のメモ): the signed-in holder's own notes with their scope and 「撤回する」. Withdrawing draws
// the double line, then the entry closes and leaves — and the engine drops the note out of every answer
// (POST /api/notes/[id]/withdraw). On mocks as last year's treasurer (a25); on real data as the account signed in on
// this device, or the login screen in place (components/SignInGate.tsx), so withdrawing works from a phone too. Filters narrow the list
// by status, scope ring and seat, and the order is newest or oldest first (GET /api/me/notes lists newest first).
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { MyNotes, type NoteSeats, seatsOf } from "@/components/MyNotes";
import {
  COLLAPSE_MS,
  LINE_MS,
  type WithdrawPhase,
} from "@/components/NoteEntry";
import { SignInGate } from "@/components/SignInGate";
import { type Api, type MyNote, Scope } from "@/lib/contracts";
import { createMockApi, USE_MOCKS } from "@/lib/mocks";
import { useRealtime } from "@/lib/realtime";

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const ALL = "all";
type Status = MyNote["status"] | typeof ALL;
type Order = "newest" | "oldest";

export function MyNotesPanel({ seat }: { seat?: string }) {
  const mock = useMemo(
    () => (USE_MOCKS ? createMockApi("a25") : undefined),
    [],
  );
  if (mock) return <MyNotesList api={mock} seat={seat} />;
  return (
    <SignInGate>
      {({ api }) => <MyNotesList api={api} seat={seat} />}
    </SignInGate>
  );
}

function MyNotesList({ api, seat }: { api: Api; seat?: string }) {
  const t = useTranslations();
  const [seats, setSeats] = useState<NoteSeats>();
  const [notes, setNotes] = useState<MyNote[]>();
  const [failed, setFailed] = useState(false);
  const [withdrawFailed, setWithdrawFailed] = useState(false);
  const [withdrawing, setWithdrawing] = useState<{
    id: string;
    phase: WithdrawPhase;
  }>();
  const [status, setStatus] = useState<Status>(ALL);
  const [scope, setScope] = useState<Scope | typeof ALL>(ALL);
  // The seat the page came from (?seat=) first; every seat of the author's notes is one choice away.
  const [atSeat, setAtSeat] = useState<string>(seat ?? ALL);
  const [order, setOrder] = useState<Order>("newest");

  useEffect(() => {
    let alive = true;
    api
      .myNotes()
      .then(async (mine) => {
        const bySlug = await seatsOf(api, mine.notes);
        if (!alive) return;
        setSeats(bySlug);
        setNotes(mine.notes);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [api]);

  // A status change from another pane (the console) marks the note withdrawn here too.
  useRealtime(api, "notes", (row) => {
    setNotes((previous) =>
      previous?.map((note) =>
        note.id === row.id ? { ...note, status: row.status } : note,
      ),
    );
  });

  async function withdraw(noteId: string) {
    if (withdrawing) return;
    const clicked = performance.now();
    setWithdrawFailed(false);
    setWithdrawing({ id: noteId, phase: "line" });
    try {
      await api.withdraw(noteId);
    } catch {
      setWithdrawing(undefined); // the note stays; the button is usable again
      setWithdrawFailed(true);
      return;
    }
    // The double line finishes drawing (it started at the click), then the entry closes and leaves.
    await sleep(Math.max(0, LINE_MS - (performance.now() - clicked)));
    setWithdrawing({ id: noteId, phase: "collapse" });
    await sleep(COLLAPSE_MS);
    setNotes((previous) => previous?.filter((note) => note.id !== noteId));
    setWithdrawing(undefined);
  }

  if (failed) {
    return (
      <p className="dd-cap" style={{ margin: 0 }}>
        {t("myNotes.failed")}
      </p>
    );
  }
  if (!seats || !notes) return null;

  const slugs = [...new Set(notes.map((note) => note.seat))];
  // A seat from ?seat= where the author wrote nothing yet still shows (an empty list says so), as long as it's known.
  const seatFilter =
    atSeat !== ALL && (slugs.includes(atSeat) || seats[atSeat]) ? atSeat : ALL;
  const shown = notes.filter(
    (note) =>
      (status === ALL || note.status === status) &&
      (scope === ALL || note.scope === scope) &&
      (seatFilter === ALL || note.seat === seatFilter),
  );
  const ordered = order === "newest" ? shown : shown.toReversed();
  // The scope ring's words come from the label pack of the seat shown (or the first seat): 「次の会計だけ」.
  const wordsSeat =
    seats[seatFilter === ALL ? slugs[0] : seatFilter] ??
    Object.values(seats)[0];
  const filtered =
    status !== ALL || scope !== ALL || (seatFilter !== ALL && slugs.length > 1);

  const tools = notes.length > 0 && (
    <fieldset className="dd-filter">
      <legend className="dd-h">{t("filter.title")}</legend>
      <label>
        <span className="dd-cap">{t("filter.status")}</span>
        <select
          className="dd-select"
          value={status}
          onChange={(event) => setStatus(event.target.value as Status)}
        >
          <option value={ALL}>{t("filter.allStatus")}</option>
          <option value="live">{t("filter.live")}</option>
          <option value="withdrawn">{t("myNotes.withdrawn")}</option>
        </select>
      </label>
      <label>
        <span className="dd-cap">{t("filter.scope")}</span>
        <select
          className="dd-select"
          value={scope}
          onChange={(event) =>
            setScope(event.target.value as Scope | typeof ALL)
          }
        >
          <option value={ALL}>{t("filter.allScopes")}</option>
          {Scope.options.map((ring) => (
            <option key={ring} value={ring}>
              {wordsSeat
                ? t(`seatTypes.${wordsSeat.seatType}.scope.${ring}`, {
                    seat: wordsSeat.name,
                    group: wordsSeat.group,
                    institution: wordsSeat.institution,
                  })
                : ring}
            </option>
          ))}
        </select>
      </label>
      {slugs.length > 1 && (
        <label>
          <span className="dd-cap">{t("filter.seat")}</span>
          <select
            className="dd-select"
            value={seatFilter}
            onChange={(event) => setAtSeat(event.target.value)}
          >
            <option value={ALL}>{t("filter.allSeats")}</option>
            {slugs.map((slug) => (
              <option key={slug} value={slug}>
                {seats[slug]
                  ? `${seats[slug].name}（${seats[slug].group}）`
                  : slug}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        <span className="dd-cap">{t("filter.sort")}</span>
        <select
          className="dd-select"
          value={order}
          onChange={(event) => setOrder(event.target.value as Order)}
        >
          <option value="newest">{t("filter.newest")}</option>
          <option value="oldest">{t("filter.oldest")}</option>
        </select>
      </label>
      <div className="dd-filter-count">
        <output aria-live="polite">
          {t.rich("filter.shown", {
            n: ordered.length,
            fig: (chunks) => <span className="dd-fig">{chunks}</span>,
          })}
        </output>
        {filtered && (
          <button
            type="button"
            className="dd-link dd-filter-reset"
            onClick={() => {
              setStatus(ALL);
              setScope(ALL);
              setAtSeat(ALL);
            }}
          >
            {t("filter.clear")}
          </button>
        )}
      </div>
    </fieldset>
  );

  return (
    <MyNotes
      notes={ordered}
      seats={seats}
      withdrawing={withdrawing}
      withdrawFailed={withdrawFailed}
      onWithdraw={withdraw}
      tools={tools || undefined}
      emptyText={notes.length > 0 ? t("filter.noneMatch") : undefined}
    />
  );
}
