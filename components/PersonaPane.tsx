"use client";
// docs/DESIGN.md → PersonaPane: a plain 390×844 rounded rectangle in --sheet with a 1px --rule border, the
// persona above it in UI text. No device chrome. The console runs three of these side by side at 1920px.
export function PersonaPane({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="dd-col"
      style={{ gap: "var(--s-2)", flex: "none" }}
      aria-label={label}
    >
      <p className="dd-label" style={{ margin: 0, fontWeight: 700 }}>
        {label}
      </p>
      <div className="dd-pane">{children}</div>
    </section>
  );
}
