import { getWithPrefix, setWithPrefix, delWithPrefix } from "../redis";
import log from "../log";
import { Gender, Language, QuizType } from "../shared/types";
import { IUserData, QuizMode } from "./types";

const REDIS_PREFIX = "inmankist";
const USER_DATA_TTL = 24 * 60 * 60;
const CACHE_TTL = 30 * 60 * 1000;
const userDataCache = new Map<number, { data: IUserData; timestamp: number }>();
const pendingWrites = new Map<number, Promise<void>>();

async function drainWrites(userId: number): Promise<void> {
  // A newer write may have been queued while the previous one was finishing.
  while (pendingWrites.has(userId)) await pendingWrites.get(userId);
}

function isUserData(value: unknown): value is IUserData {
  if (!value || typeof value !== "object") return false;
  const data = value as IUserData;
  return (
    Number.isFinite(data.date) &&
    Object.values(QuizType).includes(data.quiz) &&
    [QuizMode.SM, QuizMode.MD, QuizMode.LG].includes(data.mode) &&
    (data.language === undefined || Object.values(Language).includes(data.language)) &&
    (data.gender === undefined || Object.values(Gender).includes(data.gender)) &&
    Array.isArray(data.order) &&
    data.order.every((index) => Number.isSafeInteger(index) && index >= 0) &&
    !!data.answers &&
    typeof data.answers === "object" &&
    !Array.isArray(data.answers) &&
    Object.entries(data.answers).every(
      ([index, answer]) =>
        /^\d+$/.test(index) &&
        Number.isSafeInteger(Number(index)) &&
        Number.isInteger(answer) &&
        answer >= 0 &&
        answer <= 3,
    )
  );
}

export async function getUserData(userId: number): Promise<IUserData | null> {
  const cached = userDataCache.get(userId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.data;

  await drainWrites(userId);
  const data = await getWithPrefix(REDIS_PREFIX, `userdata:${userId}`);
  if (!data) {
    userDataCache.delete(userId);
    return null;
  }
  try {
    const userData: unknown = JSON.parse(data);
    if (!isUserData(userData)) throw new Error("Invalid quiz session");
    userDataCache.set(userId, { data: userData, timestamp: Date.now() });
    return userData;
  } catch (error) {
    userDataCache.delete(userId);
    log.error("Invalid persisted quiz session", { userId, error });
    await delWithPrefix(REDIS_PREFIX, `userdata:${userId}`).catch((error) =>
      log.error("Failed to remove invalid quiz session", { userId, error }),
    );
    return null;
  }
}

export async function setUserData(userId: number, data: IUserData): Promise<void> {
  userDataCache.set(userId, { data, timestamp: Date.now() });
  // Snapshot now: later edits to the cached object must not change an older write.
  const serialized = JSON.stringify(data);
  const previous = pendingWrites.get(userId);
  const persist = () => setWithPrefix(REDIS_PREFIX, `userdata:${userId}`, serialized, USER_DATA_TTL);
  const write = (previous ? previous.then(persist) : persist()).catch((error) => {
    log.error("Failed to persist user data to Redis", { userId, error });
  });
  pendingWrites.set(userId, write);
  void write.then(() => {
    if (pendingWrites.get(userId) === write) pendingWrites.delete(userId);
  });
}

export async function updateUserData(
  userId: number,
  updates: Partial<IUserData>,
  existingData?: IUserData,
): Promise<IUserData> {
  const existing = existingData || (await getUserData(userId));
  if (!existing) throw new Error("User data not found");
  const updated = { ...existing, ...updates };
  await setUserData(userId, updated);
  return updated;
}

export async function deleteUserData(userId: number): Promise<void> {
  await drainWrites(userId);
  await delWithPrefix(REDIS_PREFIX, `userdata:${userId}`);
  userDataCache.delete(userId);
}
