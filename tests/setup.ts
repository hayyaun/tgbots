import { beforeEach, vi } from "vitest";
import { resetBoundaries } from "./support/state";
// Only external I/O boundaries are replaced. Quiz handlers and scoring remain real.
vi.mock("../src/redis", async () => {
  const { redis } = await import("./support/state");
  return { ...redis, default: {}, connectRedis: vi.fn() };
});
vi.mock("../src/db", async () => {
  const { prisma } = await import("./support/state");
  return { prisma, default: prisma, connectDB: vi.fn(), closeDB: vi.fn() };
});
vi.mock("../src/log", async () => ({ default: (await import("./support/state")).log }));
vi.mock("../src/inmankist/archetype/canvas", async () => {
  const { drawings } = await import("./support/state");
  return {
    addTextBoxToImage: vi.fn(async (_image: Buffer, right: string[], left: string[]) => {
      drawings.push({ left, right });
      return Buffer.from("test image boundary");
    }),
  };
});
vi.mock("../src/inmankist/politicalcompass/canvas", () => ({
  generateCompassChart: vi.fn(() => Buffer.from("test chart boundary")),
}));
beforeEach(resetBoundaries);
