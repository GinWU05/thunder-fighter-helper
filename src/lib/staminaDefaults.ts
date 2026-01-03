export type StaminaState = {
  currentTime: string;
  currentStamina: number;
  maxStamina: number;
  activityReward: boolean;
  miniProgramSignIn: boolean;
  friendGift: boolean;
  buy100Times: number;
  buy50Times: number;
  otherStamina: number;
};

export const DEFAULT_STAMINA_STATE: StaminaState = {
  currentTime: "12:00",
  currentStamina: 0,
  maxStamina: 120,
  activityReward: false,
  miniProgramSignIn: false,
  friendGift: false,
  buy100Times: 3,
  buy50Times: 4,
  otherStamina: 0,
};

export const STAMINA_STORAGE_KEY = "thunder-fighter-stamina";

export const createDefaultStaminaState = (
  currentTime: string,
): StaminaState => ({
  ...DEFAULT_STAMINA_STATE,
  currentTime,
});
