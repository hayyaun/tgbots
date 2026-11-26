import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Language } from "../src/shared/types";
import { banks, languages, question, sample, session, sizes, variants } from "./support/catalog";

describe.each(variants)("$quiz question bank / $gender", ({ quiz, gender }) => {
  it("translations retain category structure and question counts", () => {
    const expected = banks(quiz, Language.English, gender).map((group) => [group[0].category, group.length]);
    for (const language of languages) {
      const groups = banks(quiz, language, gender);
      expect(groups.map((group) => [group[0].category, group.length])).toEqual(expected);
      for (const group of groups) {
        expect(new Set(group.map((q) => q.text)).size).toBe(group.length);
        expect(group.every((q) => typeof q.text === "string" && q.text.trim().length > 0)).toBe(true);
      }
    }
  });
  for (const language of languages)
    for (const size of sizes) {
      it(language + " / size " + size + ": unique in-range indices, balanced categories, correct text", () => {
        const groups = banks(quiz, language, gender),
          all = groups.flat();
        const user = session(quiz, language, gender, size);
        for (let run = 0; run < 8; run++) {
          const order = sample(quiz, size, language, gender);
          expect(order).toHaveLength(groups.reduce((sum, group) => sum + Math.min(size, group.length), 0));
          expect(new Set(order).size).toBe(order.length);
          const counts: Record<string, number> = {};
          for (const index of order) {
            expect(Number.isInteger(index) && index >= 0 && index < all.length).toBe(true);
            const actual = question(user, index);
            expect(actual).toEqual({ text: all[index].text, belong: all[index].category });
            counts[all[index].category] = (counts[all[index].category] ?? 0) + 1;
          }
          for (const group of groups) expect(counts[group[0].category]).toBe(Math.min(size, group.length));
        }
      });
    }
  it("sampling remains valid for generated sizes including zero and larger-than-bank requests", () => {
    const groups = banks(quiz, Language.English, gender);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (size) => {
        const order = sample(quiz, size, Language.English, gender);
        expect(order).toHaveLength(groups.reduce((sum, group) => sum + Math.min(size, group.length), 0));
        expect(new Set(order).size).toBe(order.length);
      }),
      { seed: 20261126, numRuns: 40 },
    );
  });
});
