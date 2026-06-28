/**
 * E2E auth helpers.
 *
 * The app uses Google OAuth — there is no email/password login form.
 * Admin sessions are supplied via a Playwright storageState JSON file
 * whose path is set in the environment variable E2E_ADMIN_STORAGE_STATE.
 *
 * Usage:
 *   export E2E_ADMIN_STORAGE_STATE=/path/to/admin-storage.json
 *
 * To record a storageState file:
 *   npx playwright codegen --save-storage=/path/to/admin-storage.json http://localhost:3003
 *   (Log in as admin via Google OAuth, then Ctrl+C to save.)
 */

import fs from "node:fs";

/** Path to admin storageState JSON (undefined when env var is unset). */
export const ADMIN_STORAGE_STATE = process.env.E2E_ADMIN_STORAGE_STATE;

/** True when the admin storageState file exists and is readable. */
export const hasAdminSession: boolean =
  !!ADMIN_STORAGE_STATE && fs.existsSync(ADMIN_STORAGE_STATE);
