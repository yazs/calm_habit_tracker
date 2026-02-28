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
