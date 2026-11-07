/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as accounts from "../accounts.js";
import type * as activity from "../activity.js";
import type * as adminUsers from "../adminUsers.js";
import type * as alarms from "../alarms.js";
import type * as automation from "../automation.js";
import type * as availability from "../availability.js";
import type * as borrowing from "../borrowing.js";
import type * as business from "../business.js";
import type * as catalog from "../catalog.js";
import type * as categories from "../categories.js";
import type * as categoryMigration from "../categoryMigration.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as integrationAuth from "../integrationAuth.js";
import type * as logging from "../logging.js";
import type * as maintenance from "../maintenance.js";
import type * as operators from "../operators.js";
import type * as overdue from "../overdue.js";
import type * as seed from "../seed.js";
import type * as textValidation from "../textValidation.js";
import type * as toolSearch from "../toolSearch.js";
import type * as tools from "../tools.js";
import type * as workspace from "../workspace.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  accounts: typeof accounts;
  activity: typeof activity;
  adminUsers: typeof adminUsers;
  alarms: typeof alarms;
  automation: typeof automation;
  availability: typeof availability;
  borrowing: typeof borrowing;
  business: typeof business;
  catalog: typeof catalog;
  categories: typeof categories;
  categoryMigration: typeof categoryMigration;
  crons: typeof crons;
  http: typeof http;
  integrationAuth: typeof integrationAuth;
  logging: typeof logging;
  maintenance: typeof maintenance;
  operators: typeof operators;
  overdue: typeof overdue;
  seed: typeof seed;
  textValidation: typeof textValidation;
  toolSearch: typeof toolSearch;
  tools: typeof tools;
  workspace: typeof workspace;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
