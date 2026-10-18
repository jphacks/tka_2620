"use client";

import { useRef } from "react";

// FileDrop (docs/DESIGN.md → AddPanel): the dashed area a file is dropped on, with a button for the file picker. While
// the 「＋ 追加」 slip is open it catches a file dropped anywhere in the window (components/AddSlip.tsx), so this
// area only shows where to drop, and turns blue while a file is dragged over the page. The file is read on the device.
export function FileDrop({
  hint,
  pickLabel,
  accept,
  over,
  onFile,
}: {
  hint: string;
  pickLabel: string;
  /** Extensions and media types: iOS greys out a file whose type isn't listed. */
  accept: string;
  over: boolean;
  onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className={over ? "dd-drop is-over" : "dd-drop"}>
      <p className="dd-phrase" style={{ margin: 0 }}>
        {hint}
      </p>
      <button
        type="button"
        className="dd-btn"
        onClick={() => input.current?.click()}
      >
        {pickLabel}
      </button>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = ""; // picking the same file again reads it again
          if (file) onFile(file);
        }}
      />
    </div>
  );
}
