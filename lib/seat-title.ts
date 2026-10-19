// A seat's name and group for a page's title and its link preview (generateMetadata), read on the server without anyone's
// session. Seats and groups are readable by everyone (0003): this is what any visitor of the seat link may see anyway,
// read with the anon key, never the service role. On mocks from the mock seats. An unknown seat, or no database: undefined,
// and the title falls back to the page's verb alone. cache(): the page and its metadata read it once per request.
import { createClient } from "@supabase/supabase-js";
import { cache } from "react";
import { z } from "zod";
import { SeatSlug } from "@/lib/contracts";
import { mockOtherSeatViews, mockSeatViews, USE_MOCKS } from "@/lib/mocks";

export type SeatNames = { seat: string; group: string };

const Row = z.object({
  name: z.string(),
  groups: z.object({ name: z.string() }),
});

export const seatNames = cache(
  async (slug: string): Promise<SeatNames | undefined> => {
    const valid = SeatSlug.safeParse(slug);
    if (!valid.success) return undefined;
    if (USE_MOCKS) {
      const view =
        mockSeatViews.a26.seat.slug === valid.data
          ? mockSeatViews.a26
          : mockOtherSeatViews[valid.data];
      return view
        ? { seat: view.seat.name, group: view.seat.group }
        : undefined;
    }
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return undefined;
    try {
      const db = createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data } = await db
        .from("seats")
        .select("name, groups(name)")
        .eq("slug", valid.data)
        .maybeSingle();
      const row = Row.safeParse(data);
      return row.success
        ? { seat: row.data.name, group: row.data.groups.name }
        : undefined;
    } catch {
      return undefined; // no title is worth a failed page
    }
  },
);
