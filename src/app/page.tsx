"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_STAMINA_STATE,
  STAMINA_STORAGE_KEY,
  createDefaultStaminaState,
  type StaminaState,
} from "@/lib/staminaDefaults";

const RECOVERY_INTERVAL_MINUTES = 5;
const DAILY_RECOVERY_MAX = Math.floor((24 * 60) / RECOVERY_INTERVAL_MINUTES);
const FRIEND_GIFT_TOTAL = 30 * 5;

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

  const overflowSummary = alertActive
    ? `已满体力，继续自然恢复将冗余 ${overflow} 点体力。`
    : overflowActive
      ? `预计在 ${fullTimeSummaryLabel} 满体力，新游戏日前将冗余 ${overflow} 点自然恢复体力。`
      : "新游戏日前不会溢出。";
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
            新游戏日体力情况，当日体力总值上限。
          </p>
        </header>

        <section className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-6">
            <div className={cardBase} style={{ animationDelay: "0ms" }}>
              <div className="panel-header panel-header-glow">
                <div className="flex items-center gap-3">
                  <span className="indicator-dot" />
                  <h2 className="text-base font-semibold text-foreground">
                    自然时间恢复体力
                  </h2>
                </div>
                <span className="panel-chip">每5分钟恢复1点体力</span>
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
                每日新游戏日重置，体力满时停止自然恢复；自然恢复上限：{DAILY_RECOVERY_MAX}/日。
              </div>
            </div>

            <div className={cardBase} style={{ animationDelay: "120ms" }}>
              <div className="panel-header panel-header-glow">
                <div className="flex items-center gap-3">
                  <span className="indicator-dot" />
                  <h2 className="text-base font-semibold text-foreground">
                    每日体力来源
                  </h2>
                </div>
                <span className="panel-chip">自主计算</span>
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
                    体力购买（每次+100）
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
                    体力购买（每次+50）
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
                  其他体力（可为负值，用于无尽/活动损耗）
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
          </div>

          <div className="space-y-6">
            <div className={cardBase} style={{ animationDelay: "200ms" }}>
              <div className="panel-header panel-header-glow">
                <div className="flex items-center gap-3">
                  <span className="indicator-dot" />
                  <h2 className="text-base font-semibold text-foreground">
                    新游戏日溢出情况
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
                    剩余自然恢复体力
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-foreground font-[var(--font-display)]">
                    +{animatedRemainingRecovery}
                  </p>
                </div>
                <div className="stat-card">
                  <p className="text-xs text-muted">
                    预计新游戏日体力
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
            </div>

            <div className={cardBase} style={{ animationDelay: "320ms" }}>
              <div className="panel-header panel-header-glow">
                <div className="flex items-center gap-3">
                  <span className="indicator-dot" />
                  <h2 className="text-base font-semibold text-foreground">
                    当日体力理论MAX值
                  </h2>
                </div>
                <span className="panel-chip">从现在到新游戏日</span>
              </div>
              <div className="gold-card mt-6 rounded-2xl p-5">
                <p className="text-4xl font-semibold font-[var(--font-display)]">
                  {animatedDailyTotal}
                </p>
                <p className="mt-1 text-sm text-[#1c1200]/70">
                  总值：当前体力+自然恢复体力（无视溢出情况）+ 每日体力来源，合计为理论MAX值。
                </p>
              </div>
              <div className="mt-6 space-y-3 text-sm text-foreground">
                <div className="flex items-center justify-between">
                  <span className="text-muted">当前体力</span>
                  <span className="font-semibold">{animatedCurrent}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">自然恢复体力</span>
                  <span className="font-semibold">{animatedRecovery}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">活跃度奖励</span>
                  <span className="font-semibold">{animatedActivity}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">小程序签到</span>
                  <span className="font-semibold">{animatedMiniProgram}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">好友赠送</span>
                  <span className="font-semibold">{animatedFriendGift}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">购买100</span>
                  <span className="font-semibold">{animatedBuy100}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">购买50</span>
                  <span className="font-semibold">{animatedBuy50}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">其他体力</span>
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
