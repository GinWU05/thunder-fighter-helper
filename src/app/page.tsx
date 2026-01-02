"use client";

import { useEffect, useMemo, useState } from "react";

const RECOVERY_INTERVAL_MINUTES = 5;
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

const toPositiveInt = (value: number) => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
};

export default function Home() {
  const [currentTime, setCurrentTime] = useState("12:00");
  const [currentStamina, setCurrentStamina] = useState(0);
  const [maxStamina, setMaxStamina] = useState(120);
  const [activityReward, setActivityReward] = useState(false);
  const [miniProgramSignIn, setMiniProgramSignIn] = useState(false);
  const [friendGift, setFriendGift] = useState(false);
  const [buy100Times, setBuy100Times] = useState(0);
  const [buy50Times, setBuy50Times] = useState(0);
  const [otherStamina, setOtherStamina] = useState(0);

  useEffect(() => {
    setCurrentTime(formatTime(new Date()));
  }, []);

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
  const buy100Total = toPositiveInt(buy100Times) * 100;
  const buy50Total = toPositiveInt(buy50Times) * 50;
  const otherTotal = toPositiveInt(otherStamina);
  const extraTotal =
    (activityReward ? 100 : 0) +
    (miniProgramSignIn ? 30 : 0) +
    (friendGift ? FRIEND_GIFT_TOTAL : 0) +
    buy100Total +
    buy50Total +
    otherTotal;
  const dailyTotal = naturalRecovery + extraTotal;
  const hoursLeft = Math.floor(minutesUntilMidnight / 60);
  const minutesLeft = minutesUntilMidnight % 60;

  const overflowSummary =
    overflow > 0
      ? `将溢出 +${overflow}。建议在00:00前消耗 ${overflow} 体力。`
      : "00:00前不会溢出。";

  const cardBase =
    "rounded-3xl border border-black/10 bg-surface/80 p-6 shadow-[0_20px_50px_rgba(31,27,22,0.12)] backdrop-blur";
  const inputBase =
    "mt-2 w-full rounded-2xl border border-black/10 bg-surface/90 px-4 py-2 text-sm font-medium text-foreground shadow-sm outline-none transition focus:border-transparent focus:ring-2 focus:ring-ring";

  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(255,107,45,0.18),_transparent_55%),_radial-gradient(circle_at_20%_55%,_rgba(31,156,144,0.18),_transparent_60%),_linear-gradient(135deg,#f9f2e8,#efe3d4)] text-foreground">
      <div className="pointer-events-none absolute -left-16 top-8 h-72 w-72 rounded-full bg-accent/20 blur-3xl animate-[float_14s_ease-in-out_infinite]" />
      <div className="pointer-events-none absolute right-[-120px] top-40 h-96 w-96 rounded-full bg-accent-2/20 blur-3xl animate-[float_16s_ease-in-out_infinite]" />
      <div className="pointer-events-none absolute bottom-[-140px] left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-black/10 blur-3xl animate-[pulse-soft_6s_ease-in-out_infinite]" />

      <main className="relative mx-auto flex min-h-screen max-w-6xl flex-col gap-10 px-6 py-12 lg:py-16">
        <header className="max-w-2xl space-y-4">
          <div className="inline-flex items-center gap-3 rounded-full border border-black/10 bg-surface/70 px-4 py-2 text-xs uppercase tracking-[0.35em] text-muted">
            雷霆战机助手
          </div>
          <h1 className="font-[var(--font-display)] text-5xl leading-none text-foreground sm:text-6xl">
            体力计算
          </h1>
          <p className="text-base text-muted sm:text-lg">
            根据当前体力和时间判断00:00是否溢出，并估算今日可获取的体力上限。
          </p>
        </header>

        <section className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-6">
            <div
              className={`${cardBase} animate-[fade-up_0.7s_ease-out]`}
              style={{ animationDelay: "0ms" }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-foreground">
                  当前状态
                </h2>
                <span className="rounded-full border border-black/10 bg-surface-alt/70 px-3 py-1 text-xs uppercase tracking-[0.2em] text-muted">
                  每5分钟+1
                </span>
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
              <div className="mt-5 rounded-2xl border border-black/10 bg-surface-alt/70 px-4 py-3 text-xs uppercase tracking-[0.2em] text-muted">
                每日00:00重置，体力满时停止自然恢复。
              </div>
            </div>

            <div
              className={`${cardBase} animate-[fade-up_0.7s_ease-out]`}
              style={{ animationDelay: "120ms" }}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">
                  每日体力来源
                </h2>
                <span className="text-xs uppercase tracking-[0.2em] text-muted">
                  可选
                </span>
              </div>
              <div className="mt-6 grid gap-4">
                <label className="flex items-center justify-between gap-3 rounded-2xl border border-black/10 bg-surface-alt/60 px-4 py-3 text-sm font-medium text-foreground">
                  活跃度奖励（+100）
                  <input
                    className="h-4 w-4 accent-accent"
                    type="checkbox"
                    checked={activityReward}
                    onChange={(event) => setActivityReward(event.target.checked)}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-2xl border border-black/10 bg-surface-alt/60 px-4 py-3 text-sm font-medium text-foreground">
                  小程序签到（+30）
                  <input
                    className="h-4 w-4 accent-accent"
                    type="checkbox"
                    checked={miniProgramSignIn}
                    onChange={(event) =>
                      setMiniProgramSignIn(event.target.checked)
                    }
                  />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-2xl border border-black/10 bg-surface-alt/60 px-4 py-3 text-sm font-medium text-foreground">
                  好友赠送（+150）
                  <input
                    className="h-4 w-4 accent-accent"
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
                  其他体力（总计）
                  <input
                    className={inputBase}
                    type="number"
                    min={0}
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
            <div
              className={`${cardBase} animate-[fade-up_0.7s_ease-out]`}
              style={{ animationDelay: "200ms" }}
            >
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-lg font-semibold text-foreground">
                  00:00溢出检查
                </h2>
                <span className="rounded-full border border-black/10 bg-surface-alt/70 px-3 py-1 text-xs uppercase tracking-[0.2em] text-muted">
                  实时
                </span>
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-black/10 bg-surface-alt/60 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted">
                    距离00:00
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">
                    {String(hoursLeft).padStart(2, "0")}h{" "}
                    {String(minutesLeft).padStart(2, "0")}m
                  </p>
                </div>
                <div className="rounded-2xl border border-black/10 bg-surface-alt/60 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted">
                    自然恢复
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">
                    +{naturalRecovery}
                  </p>
                </div>
                <div className="rounded-2xl border border-black/10 bg-surface-alt/60 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted">
                    预计00:00体力
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">
                    {expectedAtMidnight} / {safeMax}
                  </p>
                </div>
                <div className="rounded-2xl border border-black/10 bg-surface-alt/60 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted">
                    溢出体力
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">
                    {overflow > 0 ? `+${overflow}` : "0"}
                  </p>
                </div>
              </div>
              <div className="mt-6 rounded-2xl border border-black/10 bg-surface/90 px-4 py-4 text-sm font-medium text-foreground">
                <span
                  className={
                    overflow > 0 ? "text-accent" : "text-accent-2"
                  }
                >
                  {overflowSummary}
                </span>
              </div>
            </div>

            <div
              className={`${cardBase} animate-[fade-up_0.7s_ease-out]`}
              style={{ animationDelay: "320ms" }}
            >
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-lg font-semibold text-foreground">
                  今日可获得体力上限
                </h2>
                <span className="text-xs uppercase tracking-[0.2em] text-muted">
                  从现在到00:00
                </span>
              </div>
              <div className="mt-6 rounded-2xl bg-[linear-gradient(120deg,#ff6b2d,#f6b449)] p-5 text-white">
                <p className="text-xs uppercase tracking-[0.3em] text-white/70">
                  合计
                </p>
                <p className="mt-2 text-4xl font-semibold">{dailyTotal}</p>
                <p className="mt-1 text-sm text-white/80">
                  包含自然恢复与勾选来源，默认不溢出。
                </p>
              </div>
              <div className="mt-6 space-y-3 text-sm text-foreground">
                <div className="flex items-center justify-between">
                  <span className="text-muted">自然恢复</span>
                  <span className="font-semibold">{naturalRecovery}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">活跃度奖励</span>
                  <span className="font-semibold">
                    {activityReward ? 100 : 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">小程序签到</span>
                  <span className="font-semibold">
                    {miniProgramSignIn ? 30 : 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">好友赠送</span>
                  <span className="font-semibold">
                    {friendGift ? FRIEND_GIFT_TOTAL : 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">购买100</span>
                  <span className="font-semibold">{buy100Total}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">购买50</span>
                  <span className="font-semibold">{buy50Total}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted">其他来源</span>
                  <span className="font-semibold">{otherTotal}</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
