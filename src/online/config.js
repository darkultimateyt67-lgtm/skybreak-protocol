/**
 * Firebase project settings for the online features (player limit, play
 * statistics, staff powers, creator-placed models).
 *
 * While this is null the game runs fully offline: no limit, nothing recorded,
 * no staff panel. Paste the web-app config from the Firebase console here
 * (Project settings → Your apps → SDK setup and configuration → Config).
 * These values are public by design — access is controlled by the database
 * rules in database.rules.json, not by keeping this secret.
 */
export const FIREBASE_CONFIG = null;

/** Used until a creator sets a different limit in the admin panel. */
export const DEFAULT_MAX_PLAYERS = 50;
