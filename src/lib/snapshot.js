export function getValidUpdatedAt(rawValue, fallback = 0) {
  return Number.isFinite(rawValue) && rawValue > 0 ? rawValue : fallback;
}

export function buildPayload({ habits, log, colorMode, updatedAt }) {
  return {
    habits,
    log,
    colorMode,
    updatedAt: getValidUpdatedAt(updatedAt, Date.now()),
  };
}

export function getPayloadSignature(payload) {
  return JSON.stringify({
    habits: payload?.habits || [],
    log: payload?.log || {},
    colorMode: payload?.colorMode || "light",
  });
}

export function readLocalPayload(storageKey) {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeLocalPayload(storageKey, payload) {
  localStorage.setItem(storageKey, JSON.stringify(payload));
}

export function resolveNewest(localPayload, cloudPayload) {
  if (!localPayload && !cloudPayload) {
    return { source: "none", payload: null };
  }

  if (!cloudPayload) {
    return { source: "local", payload: localPayload };
  }

  if (!localPayload) {
    return { source: "cloud", payload: cloudPayload };
  }

  const localUpdatedAt = getValidUpdatedAt(localPayload.updatedAt, 0);
  const cloudUpdatedAt = getValidUpdatedAt(cloudPayload.updatedAt, 0);

  if (cloudUpdatedAt > localUpdatedAt) {
    return { source: "cloud", payload: cloudPayload };
  }

  return { source: "local", payload: localPayload };
}

function mergeHabits(localHabits, cloudHabits, newerSource, maxHabits) {
  const safeLocal = Array.isArray(localHabits) ? localHabits : [];
  const safeCloud = Array.isArray(cloudHabits) ? cloudHabits : [];

  const localMap = new Map(safeLocal.map((habit) => [habit.id, habit]));
  const cloudMap = new Map(safeCloud.map((habit) => [habit.id, habit]));

  const newer = newerSource === "local" ? safeLocal : safeCloud;
  const older = newerSource === "local" ? safeCloud : safeLocal;
  const newerMap = newerSource === "local" ? localMap : cloudMap;
  const olderMap = newerSource === "local" ? cloudMap : localMap;

  const orderedIds = [];
  const seenIds = new Set();

  newer.forEach((habit) => {
    if (!habit?.id || seenIds.has(habit.id)) return;
    seenIds.add(habit.id);
    orderedIds.push(habit.id);
  });

  older.forEach((habit) => {
    if (!habit?.id || seenIds.has(habit.id)) return;
    seenIds.add(habit.id);
    orderedIds.push(habit.id);
  });

  const merged = orderedIds.map((id) => {
    const preferred = newerMap.get(id) || olderMap.get(id);
    const fallback = olderMap.get(id);
    return {
      id,
      name: preferred?.name || fallback?.name || "",
      color: preferred?.color || fallback?.color || "",
    };
  });

  return merged.slice(0, Math.max(0, maxHabits));
}

function mergeLog(localLog, cloudLog) {
  const safeLocal = localLog && typeof localLog === "object" ? localLog : {};
  const safeCloud = cloudLog && typeof cloudLog === "object" ? cloudLog : {};
  const merged = {};

  const dayKeys = new Set([...Object.keys(safeLocal), ...Object.keys(safeCloud)]);
  dayKeys.forEach((dayKey) => {
    const localDay = safeLocal[dayKey] && typeof safeLocal[dayKey] === "object" ? safeLocal[dayKey] : {};
    const cloudDay = safeCloud[dayKey] && typeof safeCloud[dayKey] === "object" ? safeCloud[dayKey] : {};
    const mergedDay = {};

    Object.entries(localDay).forEach(([habitId, completed]) => {
      if (completed) mergedDay[habitId] = true;
    });
    Object.entries(cloudDay).forEach(([habitId, completed]) => {
      if (completed) mergedDay[habitId] = true;
    });

    if (Object.keys(mergedDay).length > 0) {
      merged[dayKey] = mergedDay;
    }
  });

  return merged;
}

export function resolveMerged(localPayload, cloudPayload, options = {}) {
  const maxHabits = Number.isFinite(options.maxHabits) ? options.maxHabits : 7;

  if (!localPayload && !cloudPayload) {
    return { source: "none", reason: "empty", payload: null };
  }

  if (!cloudPayload) {
    return { source: "local", reason: "no-cloud", payload: localPayload };
  }

  if (!localPayload) {
    return { source: "cloud", reason: "no-local", payload: cloudPayload };
  }

  const localUpdatedAt = getValidUpdatedAt(localPayload.updatedAt, 0);
  const cloudUpdatedAt = getValidUpdatedAt(cloudPayload.updatedAt, 0);
  const newerSource = localUpdatedAt >= cloudUpdatedAt ? "local" : "cloud";
  const newerPayload = newerSource === "local" ? localPayload : cloudPayload;

  const payload = {
    habits: mergeHabits(localPayload.habits, cloudPayload.habits, newerSource, maxHabits),
    log: mergeLog(localPayload.log, cloudPayload.log),
    colorMode: newerPayload?.colorMode || "light",
    updatedAt: Math.max(localUpdatedAt, cloudUpdatedAt),
  };

  return {
    source: "merged",
    reason: "union",
    payload,
  };
}
