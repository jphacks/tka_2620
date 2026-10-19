import { Suspense } from "react";
import { AccountProvider } from "@/components/AccountMenu";
import { PageTurn } from "@/components/PageTurn";
import { SeatBar } from "@/components/SeatBar";

// Every seat page (/s/<seat>, its 残す and guide, and 自分のメモ) opens with the same quiet bar: language, theme and
// 「あなた」, the account on this device. AccountProvider lets the page's sign-in gate hand its account up to the bar's
// menu; it lives here, above both, so it outlasts a page change. PageTurn fades each new page in.
export default function SeatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AccountProvider>
      <Suspense fallback={null}>
        <SeatBar />
      </Suspense>
      <PageTurn />
      {children}
    </AccountProvider>
  );
}
