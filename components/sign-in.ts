// F7.5 (issue #87): the pure side of the login screen (components/SignIn.tsx). The switcher names each demo account by
// what it holds, never by name: a holder by the seat's byline from its label pack (「2026年度 会計」), the other two by
// their group or their school (「軽音サークルの部員」, 「やまて大学の学生」). The seat, group and school names are seed
// data, not copy (docs/SPEC.md → Personas); tests/sign-in-screen.test.ts checks them against scripts/seed.ts.
import { ApiError, type DemoAccount, type SeatType } from "@/lib/contracts";

type Holds = { seatType: SeatType; seat: string; term: string };
type Who = Holds | { group: string } | { institution: string };

export const ACCOUNT_LABELS: Record<DemoAccount, Who> = {
  a26: { seatType: "club_role", seat: "会計", term: "2026" },
  a25: { seatType: "club_role", seat: "会計", term: "2025" },
  a24: { seatType: "club_role", seat: "会計", term: "2024" },
  b: { group: "軽音サークル" },
  x: { institution: "やまて大学" },
};

// The message that names an account, with its values: t(label.key, label.values).
export type AccountLabel =
  | {
      key: `seatTypes.${SeatType}.byline`;
      values: { term: string; seat: string };
    }
  | { key: "signIn.member"; values: { group: string } }
  | { key: "signIn.student"; values: { institution: string } };

export function accountLabel(account: DemoAccount): AccountLabel {
  const who = ACCOUNT_LABELS[account];
  if ("seatType" in who) {
    return {
      key: `seatTypes.${who.seatType}.byline`,
      values: { term: who.term, seat: who.seat },
    };
  }
  if ("group" in who) {
    return { key: "signIn.member", values: { group: who.group } };
  }
  return { key: "signIn.student", values: { institution: who.institution } };
}

// What a failed sign-in tells the person: a password Auth turned down, or no answer at all (offline, a rate limit).
export function signInFailure(error: unknown): "wrongPassword" | "unavailable" {
  return ApiError.safeParse(error).data?.error === "unauthorized"
    ? "wrongPassword"
    : "unavailable";
}
