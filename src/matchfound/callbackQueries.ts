/**
 * Centralized callback query strings for keyboards
 * All callback query patterns used in inline keyboards should be defined here
 */

// User action callbacks
export const callbacks = {
  // Like/Dislike actions
  like: (telegramId: number) => `like:${telegramId}`,
  dislike: (telegramId: number) => `dislike:${telegramId}`,
  deleteLiked: (telegramId: number) => `delete_liked:${telegramId}`,
  nextMatch: (telegramId: number) => `next_match:${telegramId}`,
  prevMatch: (telegramId: number) => `prev_match:${telegramId}`,
  
  // Report action
  report: (telegramId: number) => `report:${telegramId}`,
  
  // Ban actions
  ban: (telegramId: number) => `ban:${telegramId}`,
  banDuration: (telegramId: number, duration: string) => `ban_duration:${telegramId}:${duration}`,
  banCancel: (telegramId: number) => `ban_cancel:${telegramId}`,
  
  // Profile actions
  profile: "profile",
  findStart: "find:start",
  
  // Settings actions
  settingsWipeData: "settings:wipe_data",
  wipeDataConfirm: "wipe_data:confirm",
  wipeDataCancel: "wipe_data:cancel",
  
  // Admin actions
  adminReports: "admin:reports",
  adminUsers: (page: number) => `admin:users:${page}`,
  resolveReport: (reportId: number) => `resolve_report:${reportId}`,
  
  // Profile editing (used in shared/profileCallbacks)
  profileSetGender: (gender: string) => `profile:set:gender:${gender}`,
  profileSetLookingFor: (gender: string) => `profile:set:looking_for:${gender}`,
  profileInterestsNoop: "profile:interests:noop",
  profileInterestsPage: (page: number) => `profile:interests:page:${page}`,
  profileEditUsername: "profile:edit:username",
};

