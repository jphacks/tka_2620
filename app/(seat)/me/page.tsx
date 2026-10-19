import { redirect } from "next/navigation";
import { SeatSlug } from "@/lib/contracts";

// /me was who you are at the seat; 自分のメモ opens with that now (components/YouCard.tsx). Old links land there, the
// seat (?seat=) brought along.
export default async function ProfilePage({ searchParams }: PageProps<"/me">) {
  const seat = SeatSlug.safeParse((await searchParams).seat).data;
  redirect(seat ? `/me/notes?seat=${encodeURIComponent(seat)}` : "/me/notes");
}
