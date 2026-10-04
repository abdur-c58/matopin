const SIGN_IN_ERRORS: Record<string, string> = {
  AccessDenied: "That Google account was not allowed to sign in.",
  Configuration: "Google sign-in is not set up correctly on the server.",
};

/** The message for the `?error=` code Auth.js sends back after a failed Google sign-in, or "" when there is none. */
export function signInError(code: string | string[] | null | undefined): string {
  const value = Array.isArray(code) ? code[0] : code;
  return value ? SIGN_IN_ERRORS[value] ?? "Google sign-in did not finish. Try again." : "";
}
