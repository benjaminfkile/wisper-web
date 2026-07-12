import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserAttribute,
  CognitoUserPool,
  type CognitoUserSession,
} from "amazon-cognito-identity-js";

// Cognito configuration comes from public env vars (baked at build time). The
// app is designed to build and test without them — auth calls throw a friendly
// AuthError only when actually invoked without configuration.
const USER_POOL_ID = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
const CLIENT_ID = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;

/** True when the Cognito user pool + client id are configured. */
export function isAuthConfigured(): boolean {
  return Boolean(USER_POOL_ID && CLIENT_ID);
}

/** An auth-flow failure carrying the Cognito error code where available. */
export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

let pool: CognitoUserPool | null = null;

/** Lazily construct the user pool so an unconfigured build never throws. */
function getPool(): CognitoUserPool {
  if (!USER_POOL_ID || !CLIENT_ID) {
    throw new AuthError(
      "Authentication is not configured. Set NEXT_PUBLIC_COGNITO_USER_POOL_ID and NEXT_PUBLIC_COGNITO_CLIENT_ID.",
      "not_configured",
    );
  }
  if (!pool) {
    pool = new CognitoUserPool({ UserPoolId: USER_POOL_ID, ClientId: CLIENT_ID });
  }
  return pool;
}

function cognitoUser(email: string): CognitoUser {
  return new CognitoUser({ Username: email, Pool: getPool() });
}

/** Extract the JWT this app sends as the API bearer token (the Cognito ID token). */
function jwtFromSession(session: CognitoUserSession): string {
  return session.getIdToken().getJwtToken();
}

/**
 * Sign in with email + password. Resolves the ID-token JWT on success. Rejects
 * with an AuthError (code "new_password_required" when the account was created
 * by an admin and must set a password first).
 */
export function signIn(email: string, password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const user = cognitoUser(email);
    const details = new AuthenticationDetails({ Username: email, Password: password });
    user.authenticateUser(details, {
      onSuccess: (session) => resolve(jwtFromSession(session)),
      onFailure: (err) => reject(new AuthError(err.message || String(err), err.code)),
      newPasswordRequired: () =>
        reject(new AuthError("A new password is required for this account.", "new_password_required")),
    });
  });
}

/** Whether a just-registered account still needs email confirmation. */
export interface SignUpResult {
  userConfirmed: boolean;
}

/** Register a new account with email + password. */
export function signUp(email: string, password: string): Promise<SignUpResult> {
  return new Promise((resolve, reject) => {
    const attributes = [new CognitoUserAttribute({ Name: "email", Value: email })];
    getPool().signUp(email, password, attributes, [], (err, result) => {
      if (err) return reject(new AuthError(err.message || String(err), (err as { code?: string }).code));
      resolve({ userConfirmed: Boolean(result?.userConfirmed) });
    });
  });
}

/** Confirm a sign-up with the emailed verification code. */
export function confirmSignUp(email: string, code: string): Promise<void> {
  return new Promise((resolve, reject) => {
    cognitoUser(email).confirmRegistration(code, true, (err) => {
      if (err) return reject(new AuthError(err.message || String(err), (err as { code?: string }).code));
      resolve();
    });
  });
}

/** Re-send the confirmation code to the account's email. */
export function resendConfirmationCode(email: string): Promise<void> {
  return new Promise((resolve, reject) => {
    cognitoUser(email).resendConfirmationCode((err) => {
      if (err) return reject(new AuthError(err.message || String(err), (err as { code?: string }).code));
      resolve();
    });
  });
}

/**
 * Restore the current session's JWT if a valid one exists (Cognito refreshes it
 * transparently). Resolves `null` when there is no signed-in user, the session
 * is invalid/expired, or auth is not configured.
 */
export function currentSession(): Promise<string | null> {
  return new Promise((resolve) => {
    if (!isAuthConfigured()) return resolve(null);
    const user = getPool().getCurrentUser();
    if (!user) return resolve(null);
    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) return resolve(null);
      resolve(jwtFromSession(session));
    });
  });
}

/** Sign the current user out, clearing their tokens from local storage. */
export function signOut(): void {
  if (!isAuthConfigured()) return;
  getPool().getCurrentUser()?.signOut();
}
