import { readFileSync } from "node:fs";
import { loadImage } from "canvas";
import { expect, it, vi } from "vitest";
import { Language } from "../src/shared/types";
import { femaleDeities, maleDeities } from "./support/catalog";

it.each([...maleDeities, ...femaleDeities])(
  "native archetype renderer produces a changed, decodable JPEG for %s",
  async (deity) => {
    const { addTextBoxToImage } = await vi.importActual<typeof import("../src/inmankist/archetype/canvas")>(
      "../src/inmankist/archetype/canvas",
    );
    const input = readFileSync("assets/deities/" + deity + ".jpg");
    const output = await addTextBoxToImage(input, ["First", "Second", "Third"], ["60%", "30%", "10%"]);
    expect(output.subarray(0, 2).toString("hex")).toBe("ffd8");
    expect(output.equals(input)).toBe(false); // Detect the renderer's silent original-image fallback.
    const original = await loadImage(input),
      rendered = await loadImage(output);
    expect([rendered.width, rendered.height]).toEqual([original.width, original.height]);
  },
);
it.each([
  "intj",
  "intp",
  "entj",
  "entp",
  "infj",
  "infp",
  "enfj",
  "enfp",
  "istj",
  "isfj",
  "estj",
  "esfj",
  "istp",
  "isfp",
  "estp",
  "esfp",
])("MBTI %s result image is present and decodable", async (type) => {
  const image = await loadImage(readFileSync("assets/mbti/" + type + ".jpg"));
  expect(image.width).toBeGreaterThan(0);
  expect(image.height).toBeGreaterThan(0);
});
for (const language of Object.values(Language)) {
  it.each([
    [-100, -100],
    [100, -100],
    [-100, 100],
    [100, 100],
    [0, 0],
  ])(
    "native political compass " + language + " chart at (%i, %i) produces an 800x800 PNG",
    async (economic, social) => {
      const { generateCompassChart } = await vi.importActual<typeof import("../src/inmankist/politicalcompass/canvas")>(
        "../src/inmankist/politicalcompass/canvas",
      );
      const output = generateCompassChart(economic, social, language);
      expect(output.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      const image = await loadImage(output);
      expect([image.width, image.height]).toEqual([800, 800]);
    },
  );
}
