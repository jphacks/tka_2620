"use client";
// docs/DESIGN.md → SeatBar: 「あなた」 is the account on this device. A tap opens a small menu under the bar: which demo
// account is signed in here, in the seat's words and never by name (「2026年度 会計でログインしています」), and
// 「アカウントを切り替える」. Switching is the page's SignInGate's own: the account's data leaves the screen first, this
// device signs out (the other devices stay signed in), and the login screen shows in place. The gate hands its account
// and its switch up while it shows an account's data (useAccountSlot), so the bar, which sits above every seat page in
// app/(seat)/layout.tsx, never holds an account no page shows. On mocks nothing signs in, and the menu says so.
import { useTranslations } from "next-intl";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { accountLabel } from "@/components/sign-in";
import type { DemoAccount } from "@/lib/contracts";
import { USE_MOCKS } from "@/lib/mocks";

type Slot = { account: DemoAccount; switchAccount: () => void };

const AccountContext = createContext<{
  slot?: Slot;
  setSlot: (slot?: Slot) => void;
}>({ setSlot: () => undefined });

export function AccountProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<Slot>();
  const value = useMemo(() => ({ slot, setSlot }), [slot]);
  return (
    <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
  );
}

/** SignInGate, while it shows an account's data: the bar's menu names that account and switches through the gate. */
export function useAccountSlot(
  account: DemoAccount | undefined,
  switchAccount: () => void,
) {
  const { setSlot } = useContext(AccountContext);
  const latest = useRef(switchAccount);
  useEffect(() => {
    latest.current = switchAccount;
  });
  useEffect(() => {
    if (!account) return;
    setSlot({ account, switchAccount: () => latest.current() });
    return () => setSlot(undefined);
  }, [account, setSlot]);
}

export function AccountMenu() {
  const t = useTranslations();
  const { slot } = useContext(AccountContext);
  const menu = useId();
  const panel = useRef<HTMLDivElement>(null);
  const label = slot ? accountLabel(slot.account) : undefined;
  return (
    <>
      <button type="button" className="dd-you" popoverTarget={menu}>
        {t("bar.you")}
      </button>
      {/* The Popover API: in the top layer, closed by Esc or a tap outside, focus back on 「あなた」 */}
      <div
        id={menu}
        ref={panel}
        popover="auto"
        role="dialog"
        className="dd-slip dd-account"
        aria-label={t("bar.you")}
      >
        {slot && label ? (
          <>
            <p className="dd-phrase">
              {t("signIn.signedInAs", {
                account: t(label.key, label.values),
              })}
            </p>
            <button
              type="button"
              className="dd-btn dd-btn-wide"
              onClick={() => {
                panel.current?.hidePopover();
                slot.switchAccount();
              }}
            >
              {t("signIn.switch")}
            </button>
          </>
        ) : (
          <p className="dd-phrase">
            {t(USE_MOCKS ? "bar.mock" : "bar.signedOut")}
          </p>
        )}
      </div>
    </>
  );
}
