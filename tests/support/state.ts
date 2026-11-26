import { vi } from "vitest";
type Row = Record<string, unknown> & { id: bigint; telegram_id: bigint };
type Where = { telegram_id?: bigint; id?: bigint };
type Mutation = {
  where: Where;
  create?: Record<string, unknown>;
  update?: Record<string, unknown>;
  data?: Record<string, unknown>;
};
export const redisEntries = new Map<string, { value: string; expiresAt: number }>();
export const users = new Map<string, Row>();
export const failures = { read: false, write: false, delete: false, dbRead: false, dbWrite: false };
export const log = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
export const drawings: { left: string[]; right: string[] }[] = [];
let sequence = 100_000;
export const newUserId = () => ++sequence;
const key = (prefix: string, name: string) => prefix + ":" + name;
export const redis = {
  getWithPrefix: vi.fn(async (prefix: string, name: string): Promise<string | null> => {
    if (failures.read) throw new Error("Injected Redis read failure");
    const entry = redisEntries.get(key(prefix, name));
    return entry && entry.expiresAt > Date.now() ? entry.value : null;
  }),
  setWithPrefix: vi.fn(async (prefix: string, name: string, value: string, ttl?: number): Promise<void> => {
    if (failures.write) throw new Error("Injected Redis write failure");
    redisEntries.set(key(prefix, name), { value, expiresAt: ttl ? Date.now() + ttl * 1000 : Infinity });
  }),
  delWithPrefix: vi.fn(async (prefix: string, name: string): Promise<void> => {
    if (failures.delete) throw new Error("Injected Redis delete failure");
    redisEntries.delete(key(prefix, name));
  }),
};
function find(where: Where): Row | null {
  if (failures.dbRead) throw new Error("Injected database read failure");
  return where.telegram_id !== undefined
    ? (users.get(String(where.telegram_id)) ?? null)
    : ([...users.values()].find((row) => row.id === where.id) ?? null);
}
function mutate(args: Mutation): Row {
  if (failures.dbWrite) throw new Error("Injected database write failure");
  const id = String(args.where.telegram_id ?? [...users.values()].find((row) => row.id === args.where.id)?.telegram_id);
  const current = users.get(id);
  const patch = current ? (args.update ?? args.data) : (args.create ?? args.data);
  const row = { id: BigInt(id), telegram_id: BigInt(id), ...current, ...patch } as Row;
  users.set(id, row);
  return structuredClone(row);
}
export const prisma = {
  user: {
    findUnique: vi.fn(async ({ where }: { where: Where }) => find(where)),
    upsert: vi.fn(async (args: Mutation) => mutate(args)),
    update: vi.fn(async (args: Mutation) => mutate(args)),
    updateMany: vi.fn(async (args: Mutation) => {
      if (failures.dbWrite) throw new Error("Injected database write failure");
      if (!find(args.where)) return { count: 0 };
      mutate(args);
      return { count: 1 };
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
      mutate({ where: { telegram_id: data.telegram_id as bigint }, create: data }),
    ),
  },
};
export function resetBoundaries() {
  redisEntries.clear();
  users.clear();
  drawings.length = 0;
  for (const name of Object.keys(failures) as (keyof typeof failures)[]) failures[name] = false;
  vi.clearAllMocks();
}
