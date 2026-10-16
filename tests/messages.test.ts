import { expect, it } from "vitest";
import en from "@/messages/en.json";
import ja from "@/messages/ja.json";

function keys(messages: object, prefix = ""): string[] {
  return Object.entries(messages).flatMap(([key, value]) =>
    typeof value === "object" && value !== null
      ? keys(value, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

// AGENTS.md: every UI string is added to both messages/ja.json and messages/en.json.
it("ja.json and en.json have the same keys", () => {
  expect(keys(en).sort()).toEqual(keys(ja).sort());
});
