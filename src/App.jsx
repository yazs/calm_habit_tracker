import { useEffect, useMemo, useRef, useState } from "react";
import { isCloudConfigured, supabase } from "./lib/supabase";
import {
  buildPayload,
  getPayloadSignature,
  getValidUpdatedAt,
  readLocalPayload,
  resolveNewest,
  writeLocalPayload,
} from "./lib/snapshot";

const STORAGE_KEY = "calm-habit-tracker-v1";
const BACKUP_KEY = "calm-habit-tracker-backups-v1";
const BACKUP_LIMIT = 14;
const CLOUD_SYNC_DEBOUNCE_MS = 650;
const CLOUD_TABLE = "user_snapshots";
const MIN_HABITS = 3;
const MAX_HABITS = 7;
const MAX_HABIT_NAME_LENGTH = 26;
const HABIT_COLORS = [
  "#e27d60",
  "#85a872",
  "#5f9ea0",
  "#d4a259",
  "#c06c84",
  "#7b8fb2",
  "#9b7e6a",
];

const DEFAULT_HABITS = [
  { id: "hydrate", name: "Hydrate", color: HABIT_COLORS[0] },
  { id: "stretch", name: "Stretch", color: HABIT_COLORS[1] },
  { id: "walk", name: "Walk", color: HABIT_COLORS[2] },
  { id: "read", name: "Read", color: HABIT_COLORS[3] },
  { id: "reflect", name: "Reflect", color: HABIT_COLORS[4] },
];

const STAR_POINTS = [
  { x: 16, y: 60 },
  { x: 28, y: 32 },
  { x: 45, y: 66 },
  { x: 59, y: 26 },
  { x: 74, y: 58 },
  { x: 84, y: 34 },
  { x: 92, y: 52 },
];

function getDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getMonthDays(viewDate) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const days = [];
  const leading = firstDay.getDay();

  for (let i = 0; i < leading; i += 1) {
    days.push(null);
  }
  for (let d = 1; d <= lastDay.getDate(); d += 1) {
    days.push(new Date(year, month, d));
  }
  return days;
}

function getTimePhase(hour) {
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 17) return "day";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

const PALETTES = {
  light: {
    morning: {
      bgStart: "#f8f0e8",
      bgEnd: "#e8efea",
      surface: "rgba(255,255,255,0.72)",
      text: "#2f3231",
      muted: "#6a706d",
      accent: "#7d9e85",
      line: "rgba(69,82,73,0.16)",
    },
    day: {
      bgStart: "#f2f1ec",
      bgEnd: "#e2ebe6",
      surface: "rgba(255,255,255,0.74)",
      text: "#2a2f2c",
      muted: "#65706a",
      accent: "#6f9482",
      line: "rgba(65,76,71,0.14)",
    },
    evening: {
      bgStart: "#f4ebe3",
      bgEnd: "#dde6ef",
      surface: "rgba(255,255,255,0.72)",
      text: "#2b3037",
      muted: "#656d78",
      accent: "#6f8fb4",
      line: "rgba(67,76,93,0.16)",
    },
    night: {
      bgStart: "#ecebf0",
      bgEnd: "#dfe6ee",
      surface: "rgba(255,255,255,0.74)",
      text: "#29313d",
      muted: "#687486",
      accent: "#7390ad",
      line: "rgba(63,75,94,0.18)",
    },
  },
  dark: {
    morning: {
      bgStart: "#222625",
      bgEnd: "#1e2d28",
      surface: "rgba(25,29,28,0.74)",
      text: "#edf0ec",
      muted: "#b5beb8",
      accent: "#8fb49a",
      line: "rgba(218,232,223,0.14)",
    },
    day: {
      bgStart: "#202524",
      bgEnd: "#1b2a25",
      surface: "rgba(21,26,24,0.75)",
      text: "#ecf0ee",
      muted: "#b2bcba",
      accent: "#90b6a3",
      line: "rgba(217,229,223,0.14)",
    },
    evening: {
      bgStart: "#211f28",
      bgEnd: "#1a2732",
      surface: "rgba(24,24,30,0.75)",
      text: "#eef0f5",
      muted: "#b7bdcb",
      accent: "#8fa7ca",
      line: "rgba(221,228,243,0.15)",
    },
    night: {
      bgStart: "#1b1d25",
      bgEnd: "#16212b",
      surface: "rgba(19,22,29,0.77)",
      text: "#eef2f8",
      muted: "#afbccd",
      accent: "#86a5c6",
      line: "rgba(223,231,246,0.16)",
    },
  },
};

function getStreak(log) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  let streak = 0;

  while (true) {
    const key = getDateKey(date);
    const count = Object.keys(log[key] || {}).length;
    if (count < 1) break;
    streak += 1;
    date.setDate(date.getDate() - 1);
  }
  return streak;
}

function formatMonth(date) {
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function formatDayLabel(date) {
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatBackupMoment(timestamp) {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function normalizeColorMode(mode) {
  return mode === "dark" ? "dark" : "light";
}

function getColorIndexFromSeed(seed) {
  const str = String(seed || "");
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash % HABIT_COLORS.length;
}

function pickColorFromAvailability(usedColors, seed) {
  const available = HABIT_COLORS.find((color) => !usedColors.has(color));
  if (available) return available;
  return HABIT_COLORS[getColorIndexFromSeed(seed)];
}

function pickHabitColor(habits, seed) {
  const usedColors = new Set(
    habits
      .map((habit) => habit.color)
      .filter((color) => HABIT_COLORS.includes(color)),
  );
  return pickColorFromAvailability(usedColors, seed);
}

function normalizeHabits(rawHabits) {
  if (!Array.isArray(rawHabits)) return null;
  const normalized = [];
  const usedColors = new Set();
  const seenIds = new Set();

  rawHabits.forEach((rawHabit) => {
    if (!rawHabit || typeof rawHabit !== "object") return;
    if (normalized.length >= MAX_HABITS) return;

    const id = typeof rawHabit.id === "string" ? rawHabit.id.trim() : "";
    const nameRaw = typeof rawHabit.name === "string" ? rawHabit.name.trim() : "";
    if (!id || !nameRaw || seenIds.has(id)) return;

    const name = nameRaw.slice(0, MAX_HABIT_NAME_LENGTH);
    if (!name) return;

    const hasKnownColor =
      typeof rawHabit.color === "string" &&
      HABIT_COLORS.includes(rawHabit.color) &&
      !usedColors.has(rawHabit.color);

    const color = hasKnownColor ? rawHabit.color : pickColorFromAvailability(usedColors, id);
    usedColors.add(color);
    seenIds.add(id);
    normalized.push({ id, name, color });
  });

  return normalized.length >= MIN_HABITS ? normalized : null;
}

function createBackupEntry(payload, kind = "auto") {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    kind,
    payload,
  };
}

function normalizeBackupList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry) => entry && entry.payload && typeof entry.payload === "object")
    .map((entry) => ({
      id: typeof entry.id === "string" ? entry.id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: Number.isFinite(entry.ts) ? entry.ts : Date.now(),
      kind: typeof entry.kind === "string" ? entry.kind : "auto",
      payload: entry.payload,
    }))
    .slice(0, BACKUP_LIMIT);
}

function normalizePayload(rawPayload, updatedAtFallback = 0) {
  if (!rawPayload || typeof rawPayload !== "object") return null;

  const habits = normalizeHabits(rawPayload.habits);
  if (!habits) return null;

  return buildPayload({
    habits,
    log: rawPayload.log && typeof rawPayload.log === "object" ? rawPayload.log : {},
    colorMode: normalizeColorMode(rawPayload.colorMode),
    updatedAt: getValidUpdatedAt(rawPayload.updatedAt, updatedAtFallback),
  });
}

function Constellation({ habits, completedIds, newlyCompletedId }) {
  const activeCount = completedIds.length;
  const fullPath = habits
    .map((_, idx) => STAR_POINTS[idx])
    .map((point, idx) => `${idx === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");

  const activeIndexes = habits
    .map((habit, idx) => (completedIds.includes(habit.id) ? idx : -1))
    .filter((idx) => idx >= 0);

  let path = "";
  activeIndexes.forEach((idx, i) => {
    const point = STAR_POINTS[idx];
    path += `${i === 0 ? "M" : "L"} ${point.x} ${point.y} `;
  });

  return (
    <div className="constellation" aria-label={`Progress constellation: ${activeCount} of ${habits.length}`}>
      <svg viewBox="0 0 100 80" role="img" aria-hidden="true">
        <defs>
          <linearGradient id="starLine" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--accent-soft)" />
            <stop offset="100%" stopColor="var(--accent)" />
          </linearGradient>
          <radialGradient id="starGlow">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.46" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="constellationAura">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle className="constellation-aura" cx="56" cy="44" r="24" />
        {fullPath && <path className="constellation-skeleton" d={fullPath} />}
        {path && <path key={path} className="constellation-line" d={path.trim()} />}
        {habits.map((habit, idx) => {
          const point = STAR_POINTS[idx];
          const active = completedIds.includes(habit.id);
          const fresh = newlyCompletedId === habit.id && active;
          return (
            <g
              key={habit.id}
              className={`star-group ${active ? "active" : ""} ${fresh ? "newly-active" : ""}`}
            >
              <circle className="star-glow" cx={point.x} cy={point.y} r="7" />
              <circle className="star-core" cx={point.x} cy={point.y} r="2.1" />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function App() {
  const [habits, setHabits] = useState(DEFAULT_HABITS);
  const [log, setLog] = useState({});
  const [colorMode, setColorMode] = useState("light");
  const [updatedAt, setUpdatedAt] = useState(Date.now());
  const [viewMonth, setViewMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(() => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  });
  const [isHydrated, setIsHydrated] = useState(false);
  const [backups, setBackups] = useState([]);
  const [showBackups, setShowBackups] = useState(false);
  const [backupNotice, setBackupNotice] = useState("");
  const [newHabit, setNewHabit] = useState("");
  const [pulseHabitId, setPulseHabitId] = useState(null);
  const [freshStarHabitId, setFreshStarHabitId] = useState(null);
  const [editingHabitId, setEditingHabitId] = useState(null);
  const [editHabitName, setEditHabitName] = useState("");
  const [session, setSession] = useState(null);
  const [syncNotice, setSyncNotice] = useState("");
  const importInputRef = useRef(null);
  const payloadRef = useRef(buildPayload({ habits: DEFAULT_HABITS, log: {}, colorMode: "light", updatedAt: Date.now() }));
  const signatureRef = useRef("");
  const skipTimestampSyncRef = useRef(false);
  const cloudPushTimerRef = useRef(null);
  const lastPushedUpdatedAtRef = useRef(0);
  const syncingUserIdRef = useRef(null);
  const cloudReadyUserIdRef = useRef(null);
  const cloudPullInFlightRef = useRef(false);

  useEffect(() => {
    let normalizedBackups = [];
    let latestBackupTs = 0;
    try {
      const backupRaw = localStorage.getItem(BACKUP_KEY);
      if (backupRaw) {
        normalizedBackups = normalizeBackupList(JSON.parse(backupRaw));
        latestBackupTs = normalizedBackups[0]?.ts || 0;
        setBackups(normalizedBackups);
      }

      const localRawPayload = readLocalPayload(STORAGE_KEY);
      const payload =
        normalizePayload(localRawPayload, latestBackupTs) ||
        buildPayload({
          habits: DEFAULT_HABITS,
          log: {},
          colorMode: "light",
          updatedAt: getValidUpdatedAt(latestBackupTs, Date.now()),
        });

      setHabits(payload.habits);
      setLog(payload.log);
      setColorMode(payload.colorMode);
      setUpdatedAt(payload.updatedAt);
      payloadRef.current = payload;
      signatureRef.current = getPayloadSignature(payload);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(BACKUP_KEY);
    } finally {
      setIsHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!backupNotice) return undefined;
    const timer = window.setTimeout(() => setBackupNotice(""), 1800);
    return () => window.clearTimeout(timer);
  }, [backupNotice]);

  useEffect(() => {
    if (!syncNotice) return undefined;
    const timer = window.setTimeout(() => setSyncNotice(""), 2400);
    return () => window.clearTimeout(timer);
  }, [syncNotice]);

  function withBackupPersistence(updater) {
    setBackups((prev) => {
      const next = updater(prev).slice(0, BACKUP_LIMIT);
      try {
        localStorage.setItem(BACKUP_KEY, JSON.stringify(next));
        return next;
      } catch {
        const trimmed = next.slice(0, Math.max(4, Math.floor(BACKUP_LIMIT / 2)));
        try {
          localStorage.setItem(BACKUP_KEY, JSON.stringify(trimmed));
        } catch {
          return prev;
        }
        return trimmed;
      }
    });
  }

  useEffect(() => {
    if (!isCloudConfigured || !supabase) return undefined;

    let active = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setSyncNotice("Cloud unavailable, using local mode");
        return;
      }
      setSession(data.session || null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession || null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => () => {
    if (cloudPushTimerRef.current) {
      window.clearTimeout(cloudPushTimerRef.current);
      cloudPushTimerRef.current = null;
    }
  }, []);

  function applyPayloadToState(rawPayload, updatedAtFallback = 0, fromCloud = false) {
    const normalized = normalizePayload(rawPayload, updatedAtFallback);
    if (!normalized) return false;

    skipTimestampSyncRef.current = true;
    payloadRef.current = normalized;
    signatureRef.current = getPayloadSignature(normalized);
    setHabits(normalized.habits);
    setLog(normalized.log);
    setColorMode(normalized.colorMode);
    setUpdatedAt(normalized.updatedAt);

    if (fromCloud) {
      lastPushedUpdatedAtRef.current = normalized.updatedAt;
    }

    return true;
  }

  async function fetchCloudPayload(userId) {
    if (!supabase || !userId) return { payload: null, error: null };
    const { data, error } = await supabase
      .from(CLOUD_TABLE)
      .select("payload")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return { payload: null, error };
    return { payload: data?.payload || null, error: null };
  }

  async function upsertCloudPayload(userId, payload) {
    if (!supabase || !userId) return null;
    const { error } = await supabase.from(CLOUD_TABLE).upsert(
      {
        user_id: userId,
        payload,
        version: 1,
      },
      { onConflict: "user_id" },
    );
    return error;
  }

  async function syncWithCloudUser(userId) {
    if (!isHydrated || !supabase || !userId) return;

    const localPayload = normalizePayload(payloadRef.current, 0);
    const { payload: cloudRawPayload, error } = await fetchCloudPayload(userId);
    if (error) {
      setSyncNotice("Sync failed, saved locally");
      return;
    }

    const cloudPayload = normalizePayload(cloudRawPayload, 0);
    const winner = resolveNewest(localPayload, cloudPayload);

    if (winner.source === "cloud" && winner.payload) {
      applyPayloadToState(winner.payload, 0, true);
      setSyncNotice("Cloud sync on");
      cloudReadyUserIdRef.current = userId;
      return;
    }

    if (winner.source === "local" && winner.payload) {
      const pushError = await upsertCloudPayload(userId, winner.payload);
      if (pushError) {
        setSyncNotice("Sync failed, saved locally");
        return;
      }
      lastPushedUpdatedAtRef.current = winner.payload.updatedAt;
      setSyncNotice("Cloud sync on");
      cloudReadyUserIdRef.current = userId;
    }
  }

  function queueCloudSync(payload) {
    const userId = session?.user?.id;
    if (!supabase || !userId) return;
    if (cloudReadyUserIdRef.current !== userId) return;
    if (payload.updatedAt <= lastPushedUpdatedAtRef.current) return;

    if (cloudPushTimerRef.current) {
      window.clearTimeout(cloudPushTimerRef.current);
    }

    cloudPushTimerRef.current = window.setTimeout(async () => {
      const pushError = await upsertCloudPayload(userId, payload);
      if (pushError) {
        setSyncNotice("Sync failed, saved locally");
        return;
      }
      lastPushedUpdatedAtRef.current = payload.updatedAt;
      setSyncNotice("Cloud sync on");
    }, CLOUD_SYNC_DEBOUNCE_MS);
  }

  useEffect(() => {
    if (!isHydrated || !supabase || !session?.user?.id) return;

    const userId = session.user.id;
    if (syncingUserIdRef.current !== userId) {
      syncingUserIdRef.current = userId;
      cloudReadyUserIdRef.current = null;
      syncWithCloudUser(userId);
    }
  }, [isHydrated, session?.user?.id]);

  useEffect(() => {
    if (session?.user?.id) return;
    syncingUserIdRef.current = null;
    cloudReadyUserIdRef.current = null;
    lastPushedUpdatedAtRef.current = 0;
    if (cloudPushTimerRef.current) {
      window.clearTimeout(cloudPushTimerRef.current);
      cloudPushTimerRef.current = null;
    }
  }, [session?.user?.id]);

  useEffect(() => {
    if (!isHydrated || !supabase || !session?.user?.id) return undefined;

    const userId = session.user.id;
    const onFocus = async () => {
      if (cloudPullInFlightRef.current) return;
      cloudPullInFlightRef.current = true;
      try {
        await syncWithCloudUser(userId);
      } finally {
        cloudPullInFlightRef.current = false;
      }
    };

    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [isHydrated, session?.user?.id]);

  function storeSnapshot(kind = "manual", payloadOverride = null) {
    const payload = payloadOverride || buildPayload({ habits, log, colorMode, updatedAt });
    withBackupPersistence((prev) => [createBackupEntry(payload, kind), ...prev]);
  }

  function restoreBackup(backupId) {
    const selected = backups.find((item) => item.id === backupId);
    if (!selected) return;
    if (!normalizePayload(selected.payload, selected.ts)) {
      setBackupNotice("Restore failed");
      return;
    }
    storeSnapshot("pre-restore");
    applyPayloadToState(selected.payload, selected.ts);
    setBackupNotice(`Restored ${formatBackupMoment(selected.ts)}`);
    setShowBackups(false);
  }

  useEffect(() => {
    if (!isHydrated) return;
    const payload = buildPayload({ habits, log, colorMode, updatedAt });
    payloadRef.current = payload;
    const signature = getPayloadSignature(payload);

    if (signature !== signatureRef.current) {
      if (skipTimestampSyncRef.current) {
        skipTimestampSyncRef.current = false;
      } else {
        setUpdatedAt(Date.now());
        return;
      }
    }

    signatureRef.current = signature;
    writeLocalPayload(STORAGE_KEY, payload);
    withBackupPersistence((prev) => {
      const latest = prev[0];
      if (latest && JSON.stringify(latest.payload) === JSON.stringify(payload)) {
        return prev;
      }
      return [createBackupEntry(payload, "auto"), ...prev];
    });
    queueCloudSync(payload);
  }, [habits, log, colorMode, updatedAt, isHydrated, session?.user?.id]);

  const now = new Date();
  const todayKey = getDateKey(now);
  const selectedDateKey = getDateKey(selectedDate);
  const selectedLog = log[selectedDateKey] || {};
  const completedSelected = habits.filter((habit) => selectedLog[habit.id]).map((habit) => habit.id);
  const streak = useMemo(() => getStreak(log), [log]);
  const monthDays = useMemo(() => getMonthDays(viewMonth), [viewMonth]);
  const completionRatio = habits.length > 0 ? completedSelected.length / habits.length : 0;
  const phase = getTimePhase(now.getHours());
  const palette = PALETTES[colorMode][phase];
  const streakCopy =
    streak > 0 ? `A gentle streak of ${streak} day${streak === 1 ? "" : "s"}` : "Begin softly today";
  const isSelectedToday = selectedDateKey === todayKey;
  const selectedDateCopy = isSelectedToday ? "Today" : formatDayLabel(selectedDate);

  const monthStats = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const countsByHabit = habits.reduce((acc, habit) => ({ ...acc, [habit.id]: 0 }), {});
    for (let day = 1; day <= daysInMonth; day += 1) {
      const key = getDateKey(new Date(year, month, day));
      const dayLog = log[key] || {};
      habits.forEach((habit) => {
        if (dayLog[habit.id]) countsByHabit[habit.id] += 1;
      });
    }
    return {
      daysInMonth,
      rows: habits.map((habit) => ({
        ...habit,
        count: countsByHabit[habit.id] || 0,
        ratio: daysInMonth > 0 ? (countsByHabit[habit.id] || 0) / daysInMonth : 0,
      })),
    };
  }, [viewMonth, habits, log]);

  useEffect(() => {
    document.documentElement.style.background = palette.bgStart;
  }, [palette.bgStart]);

  function setActiveDate(date, syncMonth = false) {
    const next = new Date(date);
    next.setHours(0, 0, 0, 0);
    setSelectedDate(next);
    if (syncMonth) {
      setViewMonth(new Date(next.getFullYear(), next.getMonth(), 1));
    }
  }

  function shiftActiveDate(deltaDays) {
    setSelectedDate((prev) => {
      const next = new Date(prev);
      next.setDate(next.getDate() + deltaDays);
      next.setHours(0, 0, 0, 0);
      setViewMonth(new Date(next.getFullYear(), next.getMonth(), 1));
      return next;
    });
  }

  function toggleHabit(id) {
    const isActive = Boolean(selectedLog[id]);
    setLog((prev) => {
      const nextDay = { ...(prev[selectedDateKey] || {}) };
      if (nextDay[id]) {
        delete nextDay[id];
      } else {
        nextDay[id] = true;
      }
      return {
        ...prev,
        [selectedDateKey]: nextDay,
      };
    });
    if (!isActive) {
      setPulseHabitId(id);
      setFreshStarHabitId(id);
      window.setTimeout(() => setPulseHabitId(null), 620);
      window.setTimeout(() => setFreshStarHabitId(null), 760);
    }
  }

  function addHabit(event) {
    event.preventDefault();
    const name = newHabit.trim().slice(0, MAX_HABIT_NAME_LENGTH);
    if (!name || habits.length >= MAX_HABITS) return;
    const id = `${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`;
    const color = pickHabitColor(habits, id);
    setHabits((prev) => [...prev, { id, name, color }]);
    setNewHabit("");
  }

  function beginEditHabit(habit) {
    setEditingHabitId(habit.id);
    setEditHabitName(habit.name);
  }

  function cancelEditHabit() {
    setEditingHabitId(null);
    setEditHabitName("");
  }

  function saveHabitName(id) {
    const trimmed = editHabitName.trim().slice(0, MAX_HABIT_NAME_LENGTH);
    if (!trimmed) {
      cancelEditHabit();
      return;
    }
    setHabits((prev) => prev.map((habit) => (habit.id === id ? { ...habit, name: trimmed } : habit)));
    cancelEditHabit();
  }

  function downloadBackupFile() {
    const currentPayload = buildPayload({ habits, log, colorMode, updatedAt });
    const bundle = {
      version: 1,
      exportedAt: new Date().toISOString(),
      current: currentPayload,
      backups,
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `calm-habits-backup-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setBackupNotice("Backup file exported");
  }

  async function importBackupFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      const importedCurrent = parsed.current && typeof parsed.current === "object" ? parsed.current : parsed;
      const latestLocalBackupTs = backups[0]?.ts || 0;
      const normalizedImport = normalizePayload(importedCurrent, latestLocalBackupTs);
      if (!normalizedImport) {
        throw new Error("Invalid backup");
      }

      storeSnapshot("pre-import");
      applyPayloadToState(normalizedImport, latestLocalBackupTs);

      const importedBackups = normalizeBackupList(parsed.backups || []);
      if (importedBackups.length) {
        withBackupPersistence((prev) => [...importedBackups, ...prev]);
      }
      setBackupNotice("Backup imported");
    } catch {
      setBackupNotice("Backup import failed");
    } finally {
      event.target.value = "";
    }
  }

  async function sendMagicLink() {
    if (!supabase) {
      setSyncNotice("Cloud not configured, using local mode");
      return;
    }

    const email = window.prompt("Enter your email for a sign-in magic link:");
    const trimmedEmail = email?.trim();
    if (!trimmedEmail) return;

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: { emailRedirectTo: window.location.origin },
    });

    if (error) {
      setSyncNotice("Sign-in failed");
      return;
    }

    setSyncNotice("Magic link sent");
  }

  async function signOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) {
      setSyncNotice("Sign-out failed");
      return;
    }
    syncingUserIdRef.current = null;
    setSession(null);
    setSyncNotice("Signed out, local mode");
  }

  const syncStatusLabel = !isCloudConfigured
    ? "Local mode"
    : session?.user
      ? "Cloud sync on"
      : "Local mode (sign in to sync)";
  const userShortLabel = session?.user?.email ? session.user.email.split("@")[0] : "Signed in";

  return (
    <main
      className={`app-shell mode-${colorMode} phase-${phase}`}
      style={{
        "--bg-start": palette.bgStart,
        "--bg-end": palette.bgEnd,
        "--surface": palette.surface,
        "--text": palette.text,
        "--muted": palette.muted,
        "--accent": palette.accent,
        "--accent-soft": `${palette.accent}80`,
        "--line": palette.line,
        "--ratio": completionRatio,
      }}
    >
      <section className="tracker-card">
        <header className="top-bar">
          <div>
            <p className="eyebrow">Daily rhythm</p>
            <h1>Calm Habit Flow</h1>
          </div>
          <div className="top-actions">
            <button
              type="button"
              className={`backup-toggle ${showBackups ? "active" : ""}`}
              onClick={() => setShowBackups((prev) => !prev)}
              aria-expanded={showBackups}
              aria-controls="backup-panel"
            >
              Backups
            </button>
            {isCloudConfigured && (
              session?.user ? (
                <>
                  <span className="auth-pill" title={session.user.email || ""}>
                    {userShortLabel}
                  </span>
                  <button type="button" className="backup-toggle" onClick={signOut}>
                    Sign out
                  </button>
                </>
              ) : (
                <button type="button" className="backup-toggle" onClick={sendMagicLink}>
                  Sign in
                </button>
              )
            )}
            <button
              type="button"
              className={`mode-toggle ${colorMode === "dark" ? "dark" : "light"}`}
              onClick={() => setColorMode((prev) => (prev === "light" ? "dark" : "light"))}
              aria-label={`Switch to ${colorMode === "light" ? "dark" : "light"} mode`}
            >
              <span className="mode-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <circle className="sun-core" cx="12" cy="12" r="4" />
                  <g className="sun-rays">
                    <line x1="12" y1="1.5" x2="12" y2="4" />
                    <line x1="12" y1="20" x2="12" y2="22.5" />
                    <line x1="1.5" y1="12" x2="4" y2="12" />
                    <line x1="20" y1="12" x2="22.5" y2="12" />
                    <line x1="4.5" y1="4.5" x2="6.2" y2="6.2" />
                    <line x1="17.8" y1="17.8" x2="19.5" y2="19.5" />
                    <line x1="17.8" y1="6.2" x2="19.5" y2="4.5" />
                    <line x1="4.5" y1="19.5" x2="6.2" y2="17.8" />
                  </g>
                  <path className="moon-core" d="M15.7 4.4a7.7 7.7 0 1 0 3.9 14.3 8.9 8.9 0 1 1-3.9-14.3Z" />
                </svg>
              </span>
              <span className="mode-label">{colorMode === "light" ? "Night" : "Day"}</span>
            </button>
          </div>
        </header>
        {showBackups && (
          <section id="backup-panel" className="backup-panel" aria-label="Backup controls">
            <div className="backup-toolbar">
              <button type="button" onClick={() => { storeSnapshot("manual"); setBackupNotice("Snapshot saved"); }}>
                Save now
              </button>
              <button type="button" onClick={downloadBackupFile}>
                Export
              </button>
              <button type="button" onClick={() => importInputRef.current?.click()}>
                Import
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json"
                onChange={importBackupFile}
                className="sr-only"
                aria-label="Import backup file"
              />
            </div>
            <div className="backup-list">
              {backups.length === 0 ? (
                <p className="backup-empty">No snapshots yet</p>
              ) : (
                backups.slice(0, 6).map((backup) => (
                  <div key={backup.id} className="backup-row">
                    <span>{formatBackupMoment(backup.ts)}</span>
                    <button type="button" onClick={() => restoreBackup(backup.id)}>
                      Restore
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        )}
        {backupNotice && <p className="backup-notice">{backupNotice}</p>}
        <p className="sync-status">{syncStatusLabel}</p>
        {syncNotice && <p className="sync-notice">{syncNotice}</p>}

        <section className="hero">
          <div className="hero-copy">
            <p className="phase-label">{phase}</p>
            <h2>{completedSelected.length} complete</h2>
            <p className="day-copy">{selectedDateCopy}</p>
            <p className="muted">{streakCopy}</p>
            <div className="day-nav" aria-label="Day navigation">
              <button type="button" onClick={() => shiftActiveDate(-1)} aria-label="Previous day">
                Prev day
              </button>
              <button type="button" onClick={() => setActiveDate(new Date(), true)} disabled={isSelectedToday}>
                Today
              </button>
              <button type="button" onClick={() => shiftActiveDate(1)} aria-label="Next day">
                Next day
              </button>
            </div>
          </div>
          <Constellation
            habits={habits}
            completedIds={completedSelected}
            newlyCompletedId={freshStarHabitId}
          />
        </section>

        <section className="habits" aria-label="Habit checklist">
          {habits.map((habit) => {
            const done = Boolean(selectedLog[habit.id]);
            const isEditing = editingHabitId === habit.id;
            return (
              <div key={habit.id} className={`habit-row ${isEditing ? "editing" : ""}`}>
                {isEditing ? (
                  <div className="habit-editor">
                    <input
                      type="text"
                      value={editHabitName}
                      onChange={(event) => setEditHabitName(event.target.value)}
                      maxLength={MAX_HABIT_NAME_LENGTH}
                      aria-label={`Rename ${habit.name}`}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          saveHabitName(habit.id);
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          cancelEditHabit();
                        }
                      }}
                      autoFocus
                    />
                    <button type="button" className="habit-action" onClick={() => saveHabitName(habit.id)}>
                      Save
                    </button>
                    <button type="button" className="habit-action" onClick={cancelEditHabit}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className={`habit-chip ${pulseHabitId === habit.id ? "pulse" : ""}`}
                    aria-pressed={done}
                    onClick={() => toggleHabit(habit.id)}
                  >
                    <span className="habit-name">{habit.name}</span>
                    <span className="habit-marker" style={{ "--habit-color": habit.color }} aria-hidden="true" />
                  </button>
                )}
                {!isEditing && (
                  <div className="habit-actions">
                    <button
                      type="button"
                      className="habit-action"
                      onClick={() => beginEditHabit(habit)}
                      aria-label={`Edit ${habit.name}`}
                    >
                      Edit
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </section>

        <form className="add-habit" onSubmit={addHabit}>
          <label htmlFor="new-habit" className="sr-only">
            Add a habit
          </label>
          <input
            id="new-habit"
            type="text"
            placeholder={habits.length >= MAX_HABITS ? "Habit limit reached" : "Add one small habit"}
            value={newHabit}
            onChange={(event) => setNewHabit(event.target.value)}
            maxLength={MAX_HABIT_NAME_LENGTH}
            disabled={habits.length >= MAX_HABITS}
          />
          <button type="submit" disabled={habits.length >= MAX_HABITS || !newHabit.trim()}>
            Add
          </button>
        </form>
      </section>

      <aside className="calendar-card" aria-label="Monthly completion view">
        <header className="calendar-head">
          <button
            type="button"
            onClick={() => setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
            aria-label="Previous month"
          >
            Prev
          </button>
          <h2>{formatMonth(viewMonth)}</h2>
          <button
            type="button"
            onClick={() => setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
            aria-label="Next month"
          >
            Next
          </button>
        </header>

        <div className="weekdays" aria-hidden="true">
          <span>S</span>
          <span>M</span>
          <span>T</span>
          <span>W</span>
          <span>T</span>
          <span>F</span>
          <span>S</span>
        </div>

        <div className="calendar-grid">
          {monthDays.map((day, idx) => {
            if (!day) return <div key={`empty-${idx}`} className="day-cell empty" />;
            const key = getDateKey(day);
            const dayLog = log[key] || {};
            const doneCount = habits.reduce((count, habit) => count + (dayLog[habit.id] ? 1 : 0), 0);
            const ratio = habits.length ? Math.min(doneCount / habits.length, 1) : 0;
            const isToday = key === todayKey;
            const isSelected = key === selectedDateKey;
            return (
              <button
                type="button"
                key={key}
                className={`day-cell ${isToday ? "today" : ""} ${isSelected ? "selected" : ""}`}
                style={{ "--day-fill": `${Math.round(ratio * 34)}%` }}
                onClick={() => setActiveDate(day)}
                aria-label={`${day.toLocaleDateString()}: ${doneCount} habits complete`}
              >
                <span className="day-number">{day.getDate()}</span>
                <span className="day-dots" aria-hidden="true">
                  {habits.map((habit) => (
                    <span
                      key={`${habit.id}-${key}`}
                      className={dayLog[habit.id] ? "dot active" : "dot"}
                      style={{ "--dot-color": habit.color }}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>

        <section className="month-quant" aria-label="Monthly habit quantification">
          <p className="quant-title">Monthly traces</p>
          <div className="quant-list">
            {monthStats.rows.map((row) => (
              <div key={`quant-${row.id}`} className="quant-row">
                <div className="quant-meta">
                  <span>{row.name}</span>
                  <span>
                    {row.count}/{monthStats.daysInMonth}
                  </span>
                </div>
                <div className="quant-track" aria-hidden="true">
                  <span className="quant-fill" style={{ "--quant-fill": `${Math.round(row.ratio * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </main>
  );
}
