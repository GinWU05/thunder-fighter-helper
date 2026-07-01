"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_STAMINA_STATE,
  STAMINA_STORAGE_KEY,
  createDefaultStaminaState,
  type StaminaState,
} from "@/lib/staminaDefaults";

const RECOVERY_INTERVAL_MINUTES = 5;
const DAILY_RECOVERY_MAX = Math.floor((24 * 60) / RECOVERY_INTERVAL_MINUTES);
const FRIEND_GIFT_TOTAL = 30 * 5;
const REMINDER_OWNER_STORAGE_KEY = "thunder-fighter-reminder-owner";
const REMINDER_SETTINGS_STORAGE_KEY = "thunder-fighter-reminder-settings";
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

type ReminderOwner = {
  username: string;
  ownerToken: string;
};

type PendingReminder = {
  id: string;
  title: string;
  message: string;
  dueAtIso: string;
  retryCount: number;
};

type ReminderSettings = {
  barkUrl: string;
  title: string;
};

const formatTime = (date: Date) => {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
};

const parseMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map((part) => Number(part));
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return 0;
  }
  const total = hours * 60 + minutes;
  return Math.min(24 * 60, Math.max(0, total));
};

const formatMinutesToTime = (totalMinutes: number) => {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

const toPositiveInt = (value: number) => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
};

const toInt = (value: number) => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.trunc(value);
};

const getDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const addDaysToDateKey = (dateKey: string, days: number) => {
  const [year, month, day] = dateKey.split("-").map((part) => Number(part));
  const date = new Date(year, month - 1, day + days);
  return getDateKey(date);
};

const formatTimeWithSeconds = (value: string) =>
  value.split(":").length === 2 ? `${value}:00` : value;

const parseLocalDateTime = (dateValue: string, timeValue: string) => {
  const [year, month, day] = dateValue.split("-").map((part) => Number(part));
  const [hours, minutes, seconds = 0] = timeValue
    .split(":")
    .map((part) => Number(part));

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    !Number.isFinite(seconds)
  ) {
    return null;
  }

  return new Date(year, month - 1, day, hours, minutes, seconds);
};

type StoredStaminaState = {
  dateKey: string;
  state: Partial<StaminaState>;
  lastTime?: string;
};

const buildStoredPayload = (
  dateKey: string,
  state: StaminaState,
): StoredStaminaState => ({
  dateKey,
  lastTime: state.currentTime,
  state: {
    currentStamina: state.currentStamina,
    maxStamina: state.maxStamina,
    activityReward: state.activityReward,
    miniProgramSignIn: state.miniProgramSignIn,
    friendGift: state.friendGift,
    buy100Times: state.buy100Times,
    buy50Times: state.buy50Times,
    otherStamina: state.otherStamina,
  },
});

const parseStoredState = (raw: string | null): StoredStaminaState | null => {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as StoredStaminaState;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.dateKey !== "string" ||
      !parsed.state ||
      typeof parsed.state !== "object"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const parseReminderOwner = (raw: string | null): ReminderOwner | null => {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as ReminderOwner;
    if (
      !parsed ||
      typeof parsed.username !== "string" ||
      typeof parsed.ownerToken !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const parseReminderSettings = (raw: string | null): ReminderSettings | null => {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as ReminderSettings;
    if (
      !parsed ||
      typeof parsed.barkUrl !== "string" ||
      typeof parsed.title !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const apiJson = async <T,>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> => {
  const requestInput =
    typeof input === "string" && input.startsWith("/")
      ? `${API_BASE_URL}${input}`
      : input;
  const response = await fetch(requestInput, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const payload = (await response.json().catch(() => ({}))) as
    | T
    | { error?: string };

  if (!response.ok) {
    const errorMessage =
      payload && typeof payload === "object" && "error" in payload
        ? payload.error
        : null;
    throw new Error(
      typeof errorMessage === "string" ? errorMessage : "request_failed",
    );
  }

  return payload as T;
};

const getStoredNumber = (value: unknown, fallback: number) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return fallback;
};

const estimateCurrentStamina = (
  stored: StoredStaminaState,
  now: Date,
) => {
  const lastTime =
    typeof stored.lastTime === "string"
      ? stored.lastTime
      : typeof stored.state.currentTime === "string"
        ? stored.state.currentTime
        : null;
  const baseCurrent = toPositiveInt(
    getStoredNumber(
      stored.state.currentStamina,
      DEFAULT_STAMINA_STATE.currentStamina,
    ),
  );
  const baseMax = toPositiveInt(
    getStoredNumber(
      stored.state.maxStamina,
      DEFAULT_STAMINA_STATE.maxStamina,
    ),
  );
  const cappedCurrent = Math.min(baseCurrent, baseMax);

  if (!lastTime) {
    return cappedCurrent;
  }

  const nowMinutes = parseMinutes(formatTime(now));
  const lastMinutes = parseMinutes(lastTime);
  const elapsedMinutes = Math.max(0, nowMinutes - lastMinutes);
  const recovered = Math.floor(
    elapsedMinutes / RECOVERY_INTERVAL_MINUTES,
  );

  return Math.min(baseMax, cappedCurrent + recovered);
};

const useReducedMotion = () => {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(mediaQuery.matches);

    update();
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", update);
    } else {
      mediaQuery.addListener(update);
    }

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener("change", update);
      } else {
        mediaQuery.removeListener(update);
      }
    };
  }, []);

  return prefersReducedMotion;
};

const useCountUp = (
  value: number,
  durationMs: number,
  enabled: boolean,
) => {
  const [displayValue, setDisplayValue] = useState(value);
  const previousValue = useRef(value);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    previousValue.current = displayValue;
  }, [displayValue]);

  useEffect(() => {
    if (!enabled) {
      setDisplayValue(value);
      previousValue.current = value;
      return undefined;
    }

    const startValue = previousValue.current;
    if (startValue === value) {
      setDisplayValue(value);
      return undefined;
    }

    let startTime = 0;
    const step = (timestamp: number) => {
      if (!startTime) {
        startTime = timestamp;
      }
      const progress = Math.min(1, (timestamp - startTime) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      const nextValue = startValue + (value - startValue) * eased;
      setDisplayValue(Math.round(nextValue));

      if (progress < 1) {
        frameRef.current = window.requestAnimationFrame(step);
      } else {
        previousValue.current = value;
      }
    };

    if (frameRef.current) {
      window.cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = window.requestAnimationFrame(step);

    return () => {
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, [value, durationMs, enabled]);

  return displayValue;
};

export default function Home() {
  const [currentTime, setCurrentTime] = useState(
    DEFAULT_STAMINA_STATE.currentTime,
  );
  const [currentStamina, setCurrentStamina] = useState(
    DEFAULT_STAMINA_STATE.currentStamina,
  );
  const [maxStamina, setMaxStamina] = useState(
    DEFAULT_STAMINA_STATE.maxStamina,
  );
  const [activityReward, setActivityReward] = useState(
    DEFAULT_STAMINA_STATE.activityReward,
  );
  const [miniProgramSignIn, setMiniProgramSignIn] = useState(
    DEFAULT_STAMINA_STATE.miniProgramSignIn,
  );
  const [friendGift, setFriendGift] = useState(
    DEFAULT_STAMINA_STATE.friendGift,
  );
  const [buy100Times, setBuy100Times] = useState(
    DEFAULT_STAMINA_STATE.buy100Times,
  );
  const [buy50Times, setBuy50Times] = useState(
    DEFAULT_STAMINA_STATE.buy50Times,
  );
  const [otherStamina, setOtherStamina] = useState(
    DEFAULT_STAMINA_STATE.otherStamina,
  );
  const [reminderOwner, setReminderOwner] = useState<ReminderOwner | null>(
    null,
  );
  const [registerUsername, setRegisterUsername] = useState("");
  const [reminderBarkUrl, setReminderBarkUrl] = useState("");
  const [reminderTitle, setReminderTitle] = useState("雷霆战机提醒");
  const [reminderMessage, setReminderMessage] = useState("体力快满了");
  const [reminderDueDate, setReminderDueDate] = useState("");
  const [reminderDueTime, setReminderDueTime] = useState("");
  const [pendingReminders, setPendingReminders] = useState<PendingReminder[]>(
    [],
  );
  const [reminderStatus, setReminderStatus] = useState("");
  const [reminderBusy, setReminderBusy] = useState(false);
  const [reminderListLoading, setReminderListLoading] = useState(false);
  const [reminderSettingsReady, setReminderSettingsReady] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const [storageDateKey, setStorageDateKey] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(false);

  const applyState = (state: StaminaState) => {
    setCurrentTime(state.currentTime);
    setCurrentStamina(state.currentStamina);
    setMaxStamina(state.maxStamina);
    setActivityReward(state.activityReward);
    setMiniProgramSignIn(state.miniProgramSignIn);
    setFriendGift(state.friendGift);
    setBuy100Times(state.buy100Times);
    setBuy50Times(state.buy50Times);
    setOtherStamina(state.otherStamina);
  };

  useEffect(() => {
    const now = new Date();
    const nowTime = formatTime(now);
    const todayKey = getDateKey(now);
    const stored = parseStoredState(
      localStorage.getItem(STAMINA_STORAGE_KEY),
    );

    if (stored && stored.dateKey === todayKey) {
      const estimatedCurrentStamina = estimateCurrentStamina(stored, now);
      const mergedState = {
        ...DEFAULT_STAMINA_STATE,
        ...stored.state,
        currentTime: nowTime,
        currentStamina: estimatedCurrentStamina,
      };
      applyState(mergedState);
      setStorageDateKey(stored.dateKey);
    } else {
      const defaults = createDefaultStaminaState(nowTime);
      applyState(defaults);
      setStorageDateKey(todayKey);
      localStorage.setItem(
        STAMINA_STORAGE_KEY,
        JSON.stringify(buildStoredPayload(todayKey, defaults)),
      );
    }
    setStorageReady(true);
  }, []);

  useEffect(() => {
    if (!storageReady) {
      return undefined;
    }

    let resetTimer: number;
    const scheduleReset = () => {
      const now = new Date();
      const nextReset = new Date(now);
      nextReset.setHours(24, 0, 0, 0);
      const delay = nextReset.getTime() - now.getTime();

      resetTimer = window.setTimeout(() => {
        const resetNow = new Date();
        const nextKey = getDateKey(resetNow);
        const defaults = createDefaultStaminaState(
          formatTime(resetNow),
        );
        applyState(defaults);
        setStorageDateKey(nextKey);
        localStorage.setItem(
          STAMINA_STORAGE_KEY,
          JSON.stringify(buildStoredPayload(nextKey, defaults)),
        );
        scheduleReset();
      }, Math.max(0, delay));
    };

    scheduleReset();
    return () => {
      window.clearTimeout(resetTimer);
    };
  }, [storageReady]);

  useEffect(() => {
    if (!storageReady || !storageDateKey) {
      return;
    }

    const state: StaminaState = {
      currentTime,
      currentStamina,
      maxStamina,
      activityReward,
      miniProgramSignIn,
      friendGift,
      buy100Times,
      buy50Times,
      otherStamina,
    };

    localStorage.setItem(
      STAMINA_STORAGE_KEY,
      JSON.stringify(buildStoredPayload(storageDateKey, state)),
    );
  }, [
    activityReward,
    buy100Times,
    buy50Times,
    currentStamina,
    currentTime,
    friendGift,
    maxStamina,
    miniProgramSignIn,
    otherStamina,
    storageDateKey,
    storageReady,
  ]);

  const loadPendingReminders = useCallback(async (owner: ReminderOwner) => {
    const params = new URLSearchParams({
      username: owner.username,
      ownerToken: owner.ownerToken,
    });
    const payload = await apiJson<{ reminders: PendingReminder[] }>(
      `/api/reminders?${params.toString()}`,
    );
    setPendingReminders(payload.reminders);
  }, []);

  useEffect(() => {
    const owner = parseReminderOwner(
      localStorage.getItem(REMINDER_OWNER_STORAGE_KEY),
    );
    const settings = parseReminderSettings(
      localStorage.getItem(REMINDER_SETTINGS_STORAGE_KEY),
    );
    if (settings) {
      setReminderBarkUrl(settings.barkUrl);
      setReminderTitle(settings.title);
    }
    setReminderSettingsReady(true);

    if (!owner) {
      return;
    }

    setReminderOwner(owner);
    setRegisterUsername(owner.username);
    loadPendingReminders(owner).catch((error) => {
      setReminderStatus(
        error instanceof Error ? error.message : "加载提醒失败",
      );
    });
  }, [loadPendingReminders]);

  useEffect(() => {
    if (!reminderSettingsReady) {
      return;
    }

    localStorage.setItem(
      REMINDER_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        barkUrl: reminderBarkUrl,
        title: reminderTitle,
      }),
    );
  }, [reminderBarkUrl, reminderSettingsReady, reminderTitle]);

  const handleRegisterReminderUser = async () => {
    setReminderBusy(true);
    setReminderStatus("");
    try {
      const payload = await apiJson<ReminderOwner>("/api/reminders/register", {
        method: "POST",
        body: JSON.stringify({ username: registerUsername }),
      });
      localStorage.setItem(
        REMINDER_OWNER_STORAGE_KEY,
        JSON.stringify(payload),
      );
      setReminderOwner(payload);
      setRegisterUsername(payload.username);
      setReminderStatus("注册成功");
      await loadPendingReminders(payload);
    } catch (error) {
      setReminderStatus(
        error instanceof Error ? error.message : "注册失败",
      );
    } finally {
      setReminderBusy(false);
    }
  };

  const handleUnregisterReminderUser = async () => {
    if (!reminderOwner) {
      setReminderStatus("缺少 ownerToken");
      return;
    }

    setReminderBusy(true);
    setReminderStatus("");
    try {
      await apiJson("/api/reminders/user", {
        method: "DELETE",
        body: JSON.stringify(reminderOwner),
      });
      localStorage.removeItem(REMINDER_OWNER_STORAGE_KEY);
      setReminderOwner(null);
      setPendingReminders([]);
      setReminderStatus("已解绑");
    } catch (error) {
      setReminderStatus(
        error instanceof Error ? error.message : "解绑失败",
      );
    } finally {
      setReminderBusy(false);
    }
  };

  const handleTestBark = async () => {
    if (!reminderOwner) {
      setReminderStatus("缺少 ownerToken");
      return;
    }

    setReminderBusy(true);
    setReminderStatus("");
    try {
      await apiJson("/api/reminders/test-bark", {
        method: "POST",
        body: JSON.stringify({
          ...reminderOwner,
          barkUrl: reminderBarkUrl,
          title: reminderTitle,
        }),
      });
      setReminderStatus("测试通知已发送");
    } catch (error) {
      setReminderStatus(
        error instanceof Error ? error.message : "测试通知失败",
      );
    } finally {
      setReminderBusy(false);
    }
  };

  const handleCreateReminder = async () => {
    if (!reminderOwner) {
      setReminderStatus("缺少 ownerToken");
      return;
    }

    const dueAt = parseLocalDateTime(reminderDueDate, reminderDueTime);
    if (!dueAt) {
      setReminderStatus("提醒时间无效");
      return;
    }

    setReminderBusy(true);
    setReminderStatus("");
    try {
      const payload = await apiJson<{ reminder: PendingReminder }>(
        "/api/reminders",
        {
          method: "POST",
          body: JSON.stringify({
            ...reminderOwner,
            barkUrl: reminderBarkUrl,
            title: reminderTitle,
            message: reminderMessage,
            dueAtIso: dueAt.toISOString(),
          }),
        },
      );
      setReminderStatus("提醒已创建");
      setPendingReminders((current) =>
        [
          ...current.filter((item) => item.id !== payload.reminder.id),
          payload.reminder,
        ].sort((a, b) => a.dueAtIso.localeCompare(b.dueAtIso)),
      );
    } catch (error) {
      setReminderStatus(
        error instanceof Error ? error.message : "创建提醒失败",
      );
    } finally {
      setReminderBusy(false);
    }
  };

  const handleCancelReminder = async (reminderId: string) => {
    if (!reminderOwner) {
      setReminderStatus("缺少 ownerToken");
      return;
    }

    setReminderBusy(true);
    setReminderStatus("");
    try {
      await apiJson("/api/reminders/cancel", {
        method: "DELETE",
        body: JSON.stringify({ ...reminderOwner, reminderId }),
      });
      setReminderStatus("提醒已取消");
      await loadPendingReminders(reminderOwner);
    } catch (error) {
      setReminderStatus(
        error instanceof Error ? error.message : "取消提醒失败",
      );
    } finally {
      setReminderBusy(false);
    }
  };

  const handleRefreshReminders = async () => {
    if (!reminderOwner) {
      setReminderStatus("缺少 ownerToken");
      return;
    }

    setReminderListLoading(true);
    setReminderStatus("");
    try {
      await loadPendingReminders(reminderOwner);
      setReminderStatus("列表已刷新");
    } catch (error) {
      setReminderStatus(
        error instanceof Error ? error.message : "刷新列表失败",
      );
    } finally {
      setReminderListLoading(false);
    }
  };

  const minutesSinceMidnight = useMemo(
    () => parseMinutes(currentTime),
    [currentTime],
  );
  const minutesUntilMidnight = Math.max(0, 24 * 60 - minutesSinceMidnight);
  const naturalRecovery = Math.floor(
    minutesUntilMidnight / RECOVERY_INTERVAL_MINUTES,
  );
  const safeCurrent = toPositiveInt(currentStamina);
  const safeMax = toPositiveInt(maxStamina);
  const expectedAtMidnight = safeCurrent + naturalRecovery;
  const overflow = Math.max(0, expectedAtMidnight - safeMax);
  const fullRecoveryMinutes = safeMax * RECOVERY_INTERVAL_MINUTES;
  const latestEmptyStartMinutes = Math.max(
    0,
    24 * 60 - fullRecoveryMinutes,
  );
  const latestEmptyStartTime = formatMinutesToTime(latestEmptyStartMinutes);
  const maxStaminaToKeepNow = Math.max(0, safeMax - naturalRecovery);
  const activityTotal = activityReward ? 100 : 0;
  const miniProgramTotal = miniProgramSignIn ? 30 : 0;
  const friendGiftTotal = friendGift ? FRIEND_GIFT_TOTAL : 0;
  const buy100Total = toPositiveInt(buy100Times) * 100;
  const buy50Total = toPositiveInt(buy50Times) * 50;
  const otherTotal = toInt(otherStamina);
  const extraTotal =
    activityTotal +
    miniProgramTotal +
    friendGiftTotal +
    buy100Total +
    buy50Total +
    otherTotal;
  const dailyTotal = safeCurrent + naturalRecovery + extraTotal;
  const hoursLeft = Math.floor(minutesUntilMidnight / 60);
  const minutesLeft = minutesUntilMidnight % 60;
  const overflowActive = overflow > 0;
  const missingStamina = Math.max(0, safeMax - safeCurrent);
  const minutesToFull = missingStamina * RECOVERY_INTERVAL_MINUTES;
  const remainingRecovery = Math.min(naturalRecovery, missingStamina);
  const fullTimeTotalMinutes = minutesSinceMidnight + minutesToFull;
  const fullTimeDayOffset = Math.floor(fullTimeTotalMinutes / (24 * 60));
  const fullTimeMinutes = fullTimeTotalMinutes % (24 * 60);
  const fullTimeTime = formatMinutesToTime(fullTimeMinutes);
  const fullTimeValue =
    missingStamina === 0
      ? "已满"
      : fullTimeTime;
  const showNewDayBadge =
    missingStamina !== 0 && fullTimeDayOffset > 0;
  const showOverflowCard = overflowActive && missingStamina === 0;
  const fullTimeSummaryLabel = `${fullTimeTime}${fullTimeDayOffset > 0 ? "（新游戏日）" : ""}`;
  const alertActive = showOverflowCard;

  useEffect(() => {
    const baseDateKey = storageDateKey ?? getDateKey(new Date());
    setReminderDueDate(addDaysToDateKey(baseDateKey, fullTimeDayOffset));
    setReminderDueTime(formatTimeWithSeconds(fullTimeTime));
  }, [fullTimeDayOffset, fullTimeTime, storageDateKey]);

  const overflowSummary = alertActive
    ? `已满，将溢出 ${overflow} 点。`
    : overflowActive
      ? `${fullTimeSummaryLabel} 满，溢出 ${overflow} 点。`
      : "今日不溢出。";
  const summaryTone = alertActive
    ? "border-accent-red/50 bg-[rgba(255,59,59,0.12)]"
    : "border-accent-green/40 bg-[rgba(61,255,204,0.12)]";
  const summaryTextTone = alertActive
    ? "shimmer-overlay shimmer-red"
    : "shimmer-overlay shimmer-green";
  const statusPulseTone = alertActive
    ? "status-pulse-alert"
    : "status-pulse-safe";

  const [statusPulse, setStatusPulse] = useState(false);
  const [statusShake, setStatusShake] = useState(false);
  const previousAlert = useRef(alertActive);

  useEffect(() => {
    if (previousAlert.current !== alertActive) {
      setStatusPulse(true);
      const pulseTimeout = window.setTimeout(() => {
        setStatusPulse(false);
      }, 600);

      let shakeTimeout: number | undefined;
      if (alertActive) {
        setStatusShake(true);
        shakeTimeout = window.setTimeout(() => {
          setStatusShake(false);
        }, 650);
      } else {
        setStatusShake(false);
      }

      previousAlert.current = alertActive;

      return () => {
        window.clearTimeout(pulseTimeout);
        if (shakeTimeout) {
          window.clearTimeout(shakeTimeout);
        }
      };
    }

    previousAlert.current = alertActive;
    return undefined;
  }, [alertActive]);

  const cardBase =
    "panel p-6 motion-safe:animate-[fade-up_0.7s_ease-out]";
  const inputBase =
    "input-field mt-2 w-full text-base sm:text-sm font-medium text-foreground";
  const reminderButtonGroupBase = "flex flex-wrap items-center gap-3";
  const breakdownRowBase = "flex items-center justify-between";
  const breakdownLabelEven = "text-[rgba(47,210,255,0.82)]";

  const animatedHours = useCountUp(
    hoursLeft,
    700,
    !prefersReducedMotion,
  );
  const animatedMinutes = useCountUp(
    minutesLeft,
    700,
    !prefersReducedMotion,
  );
  const animatedRecovery = useCountUp(
    naturalRecovery,
    700,
    !prefersReducedMotion,
  );
  const animatedRemainingRecovery = useCountUp(
    remainingRecovery,
    700,
    !prefersReducedMotion,
  );
  const animatedExpected = useCountUp(
    expectedAtMidnight,
    700,
    !prefersReducedMotion,
  );
  const animatedMax = useCountUp(
    safeMax,
    700,
    !prefersReducedMotion,
  );
  const animatedOverflow = useCountUp(
    overflow,
    700,
    !prefersReducedMotion,
  );
  const animatedMaxStaminaToKeep = useCountUp(
    maxStaminaToKeepNow,
    700,
    !prefersReducedMotion,
  );
  const animatedDailyTotal = useCountUp(
    dailyTotal,
    800,
    !prefersReducedMotion,
  );
  const animatedCurrent = useCountUp(
    safeCurrent,
    700,
    !prefersReducedMotion,
  );
  const animatedActivity = useCountUp(
    activityTotal,
    700,
    !prefersReducedMotion,
  );
  const animatedMiniProgram = useCountUp(
    miniProgramTotal,
    700,
    !prefersReducedMotion,
  );
  const animatedFriendGift = useCountUp(
    friendGiftTotal,
    700,
    !prefersReducedMotion,
  );
  const animatedBuy100 = useCountUp(
    buy100Total,
    700,
    !prefersReducedMotion,
  );
  const animatedBuy50 = useCountUp(
    buy50Total,
    700,
    !prefersReducedMotion,
  );
  const animatedOther = useCountUp(
    otherTotal,
    700,
    !prefersReducedMotion,
  );

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="space-layer" aria-hidden="true">
        <div className="nebula-layer" />
        <div className="starfield starfield-far" />
        <div className="starfield starfield-mid" />
        <div className="starfield starfield-near" />
        <div className="starfield starfield-cluster" />
        <div className="space-vignette" />
      </div>

      <main className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col gap-10 px-6 py-12 lg:py-16">
        <header className="max-w-2xl space-y-4">
          <div className="inline-flex items-center gap-3 rounded-full border border-accent-blue/40 bg-surface/70 px-4 py-2 text-xs text-muted shadow-[0_0_12px_rgba(47,210,255,0.25)]">
            <span className="indicator-dot" />
            雷霆战机助手
          </div>
          <h1 className="font-[var(--font-display)] text-5xl leading-none text-foreground sm:text-6xl">
            体力助手
          </h1>
          <p className="text-base text-muted sm:text-lg">
            算体力、看溢出、回满倒推、估算今日上限。
          </p>
        </header>

        <section className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-6">
            <div className={cardBase} style={{ animationDelay: "0ms" }}>
              <div className="panel-header panel-header-glow">
                <div className="flex items-center gap-3">
                  <span className="indicator-dot" />
                  <h2 className="text-base font-semibold text-foreground">
                    自然恢复
                  </h2>
                </div>
                <span className="panel-chip">5分钟+1</span>
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <label className="text-sm font-medium text-foreground">
                  当前时间
                  <input
                    className={inputBase}
                    type="time"
                    value={currentTime}
                    onChange={(event) => setCurrentTime(event.target.value)}
                  />
                </label>
                <label className="text-sm font-medium text-foreground">
                  当前体力
                  <input
                    className={inputBase}
                    type="number"
                    min={0}
                    step={1}
                    value={currentStamina}
                    onChange={(event) =>
                      setCurrentStamina(Number(event.target.value))
                    }
                  />
                </label>
                <label className="text-sm font-medium text-foreground">
                  体力上限
                  <input
                    className={inputBase}
                    type="number"
                    min={0}
                    step={1}
                    value={maxStamina}
                    onChange={(event) =>
                      setMaxStamina(Number(event.target.value))
                    }
                  />
                </label>
              </div>
              <div className="mt-5 rounded-2xl border border-accent-blue/20 bg-surface-strong/70 px-4 py-3 text-xs text-muted shadow-[inset_0_0_0_1px_rgba(7,18,37,0.85)]">
                每日重置；满体力后不再自然恢复。上限：{DAILY_RECOVERY_MAX}/日。
              </div>
            </div>

            <div className={cardBase} style={{ animationDelay: "120ms" }}>
              <div className="panel-header panel-header-glow">
                <div className="flex items-center gap-3">
                  <span className="indicator-dot" />
                  <h2 className="text-base font-semibold text-foreground">
                    额外来源
                  </h2>
                </div>
                <span className="panel-chip">可选</span>
              </div>
              <div className="mt-6 grid gap-4">
                <label className="flex items-center justify-between gap-3 rounded-2xl border border-accent-blue/20 bg-surface-strong/70 px-4 py-3 text-sm font-medium text-foreground shadow-[inset_0_0_0_1px_rgba(7,18,37,0.8)]">
                  活跃度奖励（+100）
                  <input
                    className="h-4 w-4 accent-accent-blue"
                    type="checkbox"
                    checked={activityReward}
                    onChange={(event) => setActivityReward(event.target.checked)}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-2xl border border-accent-blue/20 bg-surface-strong/70 px-4 py-3 text-sm font-medium text-foreground shadow-[inset_0_0_0_1px_rgba(7,18,37,0.8)]">
                  小程序签到（+30）
                  <input
                    className="h-4 w-4 accent-accent-blue"
                    type="checkbox"
                    checked={miniProgramSignIn}
                    onChange={(event) =>
                      setMiniProgramSignIn(event.target.checked)
                    }
                  />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-2xl border border-accent-blue/20 bg-surface-strong/70 px-4 py-3 text-sm font-medium text-foreground shadow-[inset_0_0_0_1px_rgba(7,18,37,0.8)]">
                  好友赠送（30次 / +150）
                  <input
                    className="h-4 w-4 accent-accent-blue"
                    type="checkbox"
                    checked={friendGift}
                    onChange={(event) => setFriendGift(event.target.checked)}
                  />
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-medium text-foreground">
                    购买 +100
                    <input
                      className={inputBase}
                      type="number"
                      min={0}
                      step={1}
                      value={buy100Times}
                      onChange={(event) =>
                        setBuy100Times(Number(event.target.value))
                      }
                    />
                  </label>
                  <label className="text-sm font-medium text-foreground">
                    购买 +50
                    <input
                      className={inputBase}
                      type="number"
                      min={0}
                      step={1}
                      value={buy50Times}
                      onChange={(event) =>
                        setBuy50Times(Number(event.target.value))
                      }
                    />
                  </label>
                </div>
                <label className="text-sm font-medium text-foreground">
                  其他调整
                  <input
                    className={inputBase}
                    type="number"
                    step={1}
                    value={otherStamina}
                    onChange={(event) =>
                      setOtherStamina(Number(event.target.value))
                    }
                  />
                </label>
              </div>
            </div>

            <section className={cardBase} style={{ animationDelay: "420ms" }}>
              <div className="panel-header panel-header-glow">
                <div className="flex items-center gap-3">
                  <span className="indicator-dot" />
                  <h2 className="text-base font-semibold text-foreground">
                    设置提醒
                  </h2>
                </div>
                <span className="panel-chip">
                  {reminderOwner ? reminderOwner.username : "未绑定"}
                </span>
              </div>

              <div className="mt-6 grid gap-6">
                <div className="space-y-4">
                  <div>
                    <label
                      className="text-sm font-medium text-foreground"
                      htmlFor="reminder-username"
                    >
                      用户名
                    </label>
                    <input
                      id="reminder-username"
                      className={inputBase}
                      type="text"
                      value={registerUsername}
                      disabled={Boolean(reminderOwner) || reminderBusy}
                      placeholder="3-32位字母数字_-"
                      onChange={(event) =>
                        setRegisterUsername(event.target.value)
                      }
                    />
                  </div>
                  <div>
                    <label
                      className="text-sm font-medium text-foreground"
                      htmlFor="reminder-bark-url"
                    >
                      Bark URL
                    </label>
                    <input
                      id="reminder-bark-url"
                      className={inputBase}
                      type="url"
                      value={reminderBarkUrl}
                      placeholder="https://api.day.app/YOUR_KEY/"
                      disabled={reminderBusy}
                      onChange={(event) =>
                        setReminderBarkUrl(event.target.value)
                      }
                    />
                  </div>
                  <div>
                    <label
                      className="text-sm font-medium text-foreground"
                      htmlFor="reminder-title"
                    >
                      提醒标题
                    </label>
                    <input
                      id="reminder-title"
                      className={inputBase}
                      type="text"
                      value={reminderTitle}
                      disabled={reminderBusy}
                      onChange={(event) =>
                        setReminderTitle(event.target.value)
                      }
                    />
                  </div>
                  <div className={reminderButtonGroupBase}>
                    <button
                      className="rounded-2xl border border-accent-blue/35 bg-accent-blue/15 px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-accent-blue/25 disabled:cursor-not-allowed disabled:opacity-50"
                      type="button"
                      disabled={Boolean(reminderOwner) || reminderBusy}
                      onClick={handleRegisterReminderUser}
                    >
                      注册
                    </button>
                    <button
                      className="rounded-2xl border border-accent-green/35 bg-accent-green/10 px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-accent-green/20 disabled:cursor-not-allowed disabled:opacity-50"
                      type="button"
                      disabled={!reminderOwner || reminderBusy}
                      onClick={handleTestBark}
                    >
                      测试 Bark
                    </button>
                    <button
                      className="rounded-2xl border border-accent-red/40 bg-accent-red/10 px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-accent-red/20 disabled:cursor-not-allowed disabled:opacity-50"
                      type="button"
                      disabled={!reminderOwner || reminderBusy}
                      onClick={handleUnregisterReminderUser}
                    >
                      解绑
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-[1fr_360px]">
                    <label className="text-sm font-medium text-foreground">
                      提醒内容
                      <input
                        className={inputBase}
                        type="text"
                        value={reminderMessage}
                        disabled={!reminderOwner || reminderBusy}
                        onChange={(event) =>
                          setReminderMessage(event.target.value)
                        }
                      />
                    </label>
                    <div className="text-sm font-medium text-foreground">
                      提醒时间
                      <div className="datetime-combo">
                        <input
                          className={inputBase}
                          type="date"
                          value={reminderDueDate}
                          disabled={!reminderOwner || reminderBusy}
                          onChange={(event) =>
                            setReminderDueDate(event.target.value)
                          }
                        />
                        <input
                          className={inputBase}
                          type="time"
                          step={1}
                          value={reminderDueTime}
                          disabled={!reminderOwner || reminderBusy}
                          onChange={(event) =>
                            setReminderDueTime(
                              formatTimeWithSeconds(event.target.value),
                            )
                          }
                        />
                      </div>
                    </div>
                  </div>
                  <div className={reminderButtonGroupBase}>
                    <button
                      className="rounded-2xl border border-accent-gold/45 bg-accent-gold/15 px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-accent-gold/25 disabled:cursor-not-allowed disabled:opacity-50"
                      type="button"
                      disabled={!reminderOwner || reminderBusy}
                      onClick={handleCreateReminder}
                    >
                      创建提醒
                    </button>
                    <button
                      className="inline-flex items-center gap-2 rounded-2xl border border-accent-blue/30 bg-surface-strong/75 px-4 py-2 text-sm font-semibold text-foreground transition hover:bg-accent-blue/15 disabled:cursor-not-allowed disabled:opacity-50"
                      type="button"
                      aria-busy={reminderListLoading}
                      disabled={
                        !reminderOwner || reminderBusy || reminderListLoading
                      }
                      onClick={handleRefreshReminders}
                    >
                      {reminderListLoading ? (
                        <span
                          className="h-3 w-3 rounded-full border border-current border-r-transparent motion-safe:animate-spin"
                          aria-hidden="true"
                        />
                      ) : null}
                      {reminderListLoading ? "刷新中..." : "刷新列表"}
                    </button>
                    {reminderStatus ? (
                      <span className="text-sm text-muted">{reminderStatus}</span>
                    ) : null}
                  </div>

                  <div className="space-y-3">
                    {reminderListLoading && pendingReminders.length === 0 ? (
                      <div className="rounded-2xl border border-accent-blue/20 bg-surface-strong/70 px-4 py-4 text-sm text-muted">
                        加载提醒中...
                      </div>
                    ) : pendingReminders.length === 0 ? (
                      <div className="rounded-2xl border border-accent-blue/20 bg-surface-strong/70 px-4 py-4 text-sm text-muted">
                        暂无提醒
                      </div>
                    ) : (
                      pendingReminders.map((reminder) => (
                        <div
                          className="flex flex-col gap-3 rounded-2xl border border-accent-blue/20 bg-surface-strong/70 px-4 py-3 text-sm shadow-[inset_0_0_0_1px_rgba(7,18,37,0.85)] sm:flex-row sm:items-center sm:justify-between"
                          key={reminder.id}
                        >
                          <div>
                            <p className="font-semibold text-foreground">
                              {reminder.message}
                            </p>
                            <p className="mt-1 text-xs text-muted">
                              {new Date(reminder.dueAtIso).toLocaleString()} · retry{" "}
                              {reminder.retryCount}
                            </p>
                          </div>
                          <button
                            className="rounded-xl border border-accent-red/35 bg-accent-red/10 px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-accent-red/20 disabled:cursor-not-allowed disabled:opacity-50"
                            type="button"
                            disabled={reminderBusy}
                            onClick={() => handleCancelReminder(reminder.id)}
                          >
                            取消
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <div className={cardBase} style={{ animationDelay: "200ms" }}>
              <div className="panel-header panel-header-glow">
                <div className="flex items-center gap-3">
                  <span className="indicator-dot" />
                  <h2 className="text-base font-semibold text-foreground">
                    溢出预警
                  </h2>
                </div>
                <span className="panel-chip">实时</span>
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="stat-card">
                  <p className="text-xs text-muted">
                    距离新游戏日
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-foreground font-[var(--font-display)]">
                    {String(animatedHours).padStart(2, "0")}h{" "}
                    {String(animatedMinutes).padStart(2, "0")}m
                  </p>
                </div>
                <div className="stat-card">
                  <p className="text-xs text-muted">
                    剩余恢复
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-foreground font-[var(--font-display)]">
                    +{animatedRemainingRecovery}
                  </p>
                </div>
                <div className="stat-card">
                  <p className="text-xs text-muted">
                    新游戏日前
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-foreground font-[var(--font-display)]">
                    {animatedExpected} / {animatedMax}
                  </p>
                </div>
                <div
                  className={`stat-card status-card ${showOverflowCard ? "status-card-alert" : "status-card-safe"} ${showOverflowCard ? "status-card-show-overflow" : "status-card-show-full"}`}
                >
                  <div className="status-card-pane status-pane-full">
                    <p className="text-xs text-muted status-label">
                      满体力时间
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-foreground font-[var(--font-display)] status-value">
                      <span className="status-value-main">
                        {fullTimeValue}
                      </span>
                      {showNewDayBadge ? (
                        <span className="status-badge">
                          新游戏日
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <div className="status-card-pane status-pane-overflow">
                    <p className="text-xs text-muted status-label">
                      溢出体力
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-foreground font-[var(--font-display)] status-value">
                      <span className="status-value-main">
                        +{animatedOverflow}
                      </span>
                    </p>
                  </div>
                </div>
              </div>
              <div
                className={`status-panel mt-6 rounded-2xl border px-4 py-4 text-center text-sm font-medium ${summaryTone} ${statusPulse ? `status-pulse ${statusPulseTone}` : ""} ${statusShake ? "status-shake" : ""}`}
              >
                <span className={summaryTextTone} data-text={overflowSummary}>
                  {overflowSummary}
                </span>
              </div>
              <div className="mt-4 rounded-2xl border border-accent-blue/25 bg-surface-strong/75 px-4 py-4 shadow-[inset_0_0_0_1px_rgba(7,18,37,0.8)]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs text-muted">回满倒推</p>
                    <p className="mt-1 text-sm font-medium text-foreground">
                      最晚清空时间
                    </p>
                  </div>
                  <p className="text-3xl font-semibold text-accent-blue font-[var(--font-display)]">
                    {latestEmptyStartTime}
                  </p>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-accent-blue/20 bg-surface/70 px-3 py-2">
                    <p className="text-[11px] text-muted">回满耗时</p>
                    <p className="mt-1 text-base font-semibold text-accent-blue font-[var(--font-display)]">
                      {fullRecoveryMinutes} 分钟
                    </p>
                  </div>
                  <div className="rounded-xl border border-accent-blue/20 bg-surface/70 px-3 py-2">
                    <p className="text-[11px] text-muted">当前保留</p>
                    <p className="mt-1 text-base font-semibold text-accent-blue font-[var(--font-display)]">
                      ≤ {animatedMaxStaminaToKeep}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className={cardBase} style={{ animationDelay: "320ms" }}>
              <div className="panel-header panel-header-glow">
                <div className="flex items-center gap-3">
                  <span className="indicator-dot" />
                  <h2 className="text-base font-semibold text-foreground">
                    今日理论 MAX
                  </h2>
                </div>
                <span className="panel-chip">含额外来源</span>
              </div>
              <div className="gold-card mt-6 rounded-2xl p-5">
                <p className="text-4xl font-semibold font-[var(--font-display)]">
                  {animatedDailyTotal}
                </p>
                <p className="mt-1 text-sm text-[#1c1200]/70">
                  当前体力 + 自然恢复 + 额外来源，未扣溢出。
                </p>
              </div>
              <div className="mt-6 space-y-3 text-sm text-foreground">
                <div className={breakdownRowBase}>
                  <span className="text-muted">当前体力</span>
                  <span className="font-semibold">{animatedCurrent}</span>
                </div>
                <div className={breakdownRowBase}>
                  <span className={breakdownLabelEven}>自然恢复体力</span>
                  <span className="font-semibold">{animatedRecovery}</span>
                </div>
                <div className={breakdownRowBase}>
                  <span className="text-muted">活跃度奖励</span>
                  <span className="font-semibold">{animatedActivity}</span>
                </div>
                <div className={breakdownRowBase}>
                  <span className={breakdownLabelEven}>小程序签到</span>
                  <span className="font-semibold">{animatedMiniProgram}</span>
                </div>
                <div className={breakdownRowBase}>
                  <span className="text-muted">好友赠送</span>
                  <span className="font-semibold">{animatedFriendGift}</span>
                </div>
                <div className={breakdownRowBase}>
                  <span className={breakdownLabelEven}>购买100</span>
                  <span className="font-semibold">{animatedBuy100}</span>
                </div>
                <div className={breakdownRowBase}>
                  <span className="text-muted">购买50</span>
                  <span className="font-semibold">{animatedBuy50}</span>
                </div>
                <div className={breakdownRowBase}>
                  <span className={breakdownLabelEven}>其他体力</span>
                  <span className="font-semibold">{animatedOther}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

      </main>
    </div>
  );
}
