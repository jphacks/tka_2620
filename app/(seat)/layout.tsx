import { Suspense } from "react";
import { PageTurn } from "@/components/PageTurn";
import { SeatBar } from "@/components/SeatBar";

// Every seat page (/s/<seat>, its 残す and guide, and the /me pages) opens with the same quiet bar: language, theme
// and 「あなた」. The bar reads ?seat= on the /me pages, so it renders inside Suspense. PageTurn fades each new page in.
export default function SeatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Suspense fallback={null}>
        <SeatBar />
      </Suspense>
      <PageTurn />
      {children}
    </>
  );
}
