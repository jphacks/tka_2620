"use client";
// docs/DESIGN.md → SeatBar: 「あなた」 is the account on this device. A tap opens a small menu under the bar: which demo
// account is signed in here, in the seat's words and never by name (「2026年度 会計でログインしています」), and
// 「アカウントを切り替える」. Switching is the page's SignInGate's own: the account's data leaves the screen first, this
// device signs out (the other devices stay signed in), and the login screen shows in place. The gate hands up where it
// is (checking, signed in, signed out…) and, only while it shows an account's data, that account and its switch
// (useAccountSlot), so the bar, which sits above every seat page in app/(seat)/layout.tsx, never names an account no
// page shows. On mocks nothing signs in, and the menu says so.
import { useTranslations } from "next-intl";
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { accountLabel } from "@/components/sign-in";
import type { DemoAccount } from "@/lib/contracts";
import { USE_MOCKS } from "@/lib/mocks";

/** Where the page's sign-in gate is: SignInGate's own states. */
export type GateState =
  | "checking"
  | "offline"
  | "signedOut"
  | "signingOut"
  | "signedIn";

type Slot = {
  state: GateState;
  account?: DemoAccount;
  switchAccount?: () => void;
};

const AccountContext = createContext<{
  slot?: Slot;
  setSlot: Dispatch<SetStateAction<Slot | undefined>>;
}>({ setSlot: () => undefined });

export function AccountProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<Slot>();
  const value = useMemo(() => ({ slot, setSlot }), [slot]);
  return (
    <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
  );
}

/** SignInGate: where it is, and while it shows an account's data, that account and the gate's switch. */
export function useAccountSlot(
  state: GateState,
  account: DemoAccount | undefined,
  switchAccount: () => void,
) {
  const { setSlot } = useContext(AccountContext);
  const latest = useRef(switchAccount);
  useEffect(() => {
    latest.current = switchAccount;
  });
  useEffect(() => {
    const shown = state === "signedIn" ? account : undefined;
    const mine: Slot = shown
      ? { state, account: shown, switchAccount: () => latest.current() }
      : { state };
    setSlot(mine);
    // Only this gate's own slot leaves with it
    return () => setSlot((slot) => (slot === mine ? undefined : slot));
  }, [state, account, setSlot]);
}

// Hydrated or not: false on the server and while React hydrates, true after.
const noSubscription = () => () => undefined;
const useHydrated = () =>
  useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );

export function AccountMenu() {
  const t = useTranslations();
  const { slot } = useContext(AccountContext);
  // The bar hydrates in its own Suspense boundary, after the page, whose gate may have handed up its state by then:
  // the slip (closed, unseen until a tap) fills only once hydrated, so the server's HTML and the first client render
  // match.
  const hydrated = useHydrated();
  const menu = useId();
  const panel = useRef<HTMLDivElement>(null);
  // The slip's open state, for the tag's aria-expanded and its turned chevron (the popover's own toggle event)
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    const toggled = (event: Event) =>
      setOpen((event as ToggleEvent).newState === "open");
    element.addEventListener("toggle", toggled);
    return () => element.removeEventListener("toggle", toggled);
  }, []);
  const label = slot?.account ? accountLabel(slot.account) : undefined;
  // What the slip says when no account is shown: the gate's state, or on mocks that nothing signs in.
  const status = !slot
    ? t(USE_MOCKS ? "bar.mock" : "bar.signedOut")
    : slot.state === "checking"
      ? t("signIn.checking")
      : slot.state === "signingOut"
        ? t("signIn.signingOut")
        : slot.state === "offline"
          ? t("signIn.offline")
          : t("bar.signedOut");
  return (
    <>
      <button
        type="button"
        className="dd-you"
        popoverTarget={menu}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {t("bar.you")}
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
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
        {!hydrated ? null : slot?.account && slot.switchAccount && label ? (
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
                slot.switchAccount?.();
              }}
            >
              {t("signIn.switch")}
            </button>
          </>
        ) : (
          <p className="dd-phrase">{status}</p>
        )}
      </div>
    </>
  );
}
