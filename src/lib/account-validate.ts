/**
 * What a sign-up is allowed to contain.
 *
 * Validation lives here rather than in the route so the rules are stated once and can be tested
 * without standing up a request. Every message names the field it is about — a form that says
 * "invalid input" and leaves you guessing is a worse form than one with no validation at all.
 */

export interface FieldError {
  field: "username" | "email" | "password" | "confirm" | "identifier";
  error: string;
}

/**
 * Deliberately permissive: this is a check for obvious typos, not an attempt to decide what a valid
 * address is. The only address that can be proven to exist is one that has received mail, and this
 * app sends none, so a stricter pattern would only reject real addresses for no gain.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Letters, digits, and the few separators a display name reasonably needs. */
const USERNAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{1,31}$/;

/**
 * Ten characters, and that is the whole rule.
 *
 * No mandatory symbol or digit: those rules push people towards `Password1!` and a sticky note,
 * which is weaker than a long thing they can remember. Length is the property that actually costs
 * an attacker anything, and it is the one thing worth insisting on.
 */
const MIN_PASSWORD = 10;
const MAX_PASSWORD = 200;

export function validateSignup(input: {
  username?: unknown;
  email?: unknown;
  password?: unknown;
  confirm?: unknown;
}): FieldError | null {
  const username = typeof input.username === "string" ? input.username.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  const confirm = typeof input.confirm === "string" ? input.confirm : "";

  if (!username) return { field: "username", error: "A display name is required." };
  if (!USERNAME.test(username)) {
    return {
      field: "username",
      error: "2–32 characters: letters, digits, spaces, dots, hyphens or underscores.",
    };
  }

  if (!email) return { field: "email", error: "An email address is required." };
  if (email.length > 254 || !EMAIL.test(email)) return { field: "email", error: "That does not look like an email address." };

  if (!password) return { field: "password", error: "A password is required." };
  if (password.length < MIN_PASSWORD) {
    return { field: "password", error: `At least ${MIN_PASSWORD} characters.` };
  }
  // An upper bound because scrypt hashes whatever it is given, and a megabyte-long password is a
  // way to make the server do a megabyte of work per request.
  if (password.length > MAX_PASSWORD) return { field: "password", error: "That password is too long." };

  if (confirm !== password) return { field: "confirm", error: "The two passwords do not match." };

  return null;
}

export function validateLogin(input: { identifier?: unknown; password?: unknown }): FieldError | null {
  const identifier = typeof input.identifier === "string" ? input.identifier.trim() : "";
  const password = typeof input.password === "string" ? input.password : "";
  if (!identifier) return { field: "identifier", error: "Enter your email or display name." };
  if (!password) return { field: "password", error: "Enter your password." };
  if (password.length > MAX_PASSWORD) return { field: "password", error: "That password is too long." };
  return null;
}
