export const SESSION_COOKIE = "kofa_session";

/**
 * Roles still on the default PIN, written at admin login so admin pages can show the
 * blocking banner without re-running six bcrypt compares on every render.
 */
export const DEFAULT_PIN_ROLES_COOKIE = "kofa_default_pin_roles";
