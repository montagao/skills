#!/usr/bin/env node
// @ts-check

const process = require("node:process");

/**
 * @typedef {{
 *   PLANE_BASE_URL?: string;
 *   PLANE_API_URL?: string;
 *   PLANE_API_KEY?: string;
 *   PLANE_WORKSPACE_SLUG?: string;
 *   PLANE_PROJECT_ID?: string;
 *   [key: string]: string | undefined;
 * }} PlaneEnv
 */

/**
 * @typedef {{
 *   baseUrl: string;
 *   apiKey: string;
 *   workspaceSlug: string;
 *   projectId: string;
 * }} PlaneConfig
 */

/**
 * @typedef {{
 *   write: (chunk: string) => void;
 * }} WritableLike
 */

/**
 * @typedef {{
 *   isTTY?: boolean;
 *   on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
 *   setEncoding?: (...args: unknown[]) => unknown;
 * }} ReadableLike
 */

/**
 * @typedef {{
 *   env?: PlaneEnv;
 *   fetchImpl?: typeof fetch;
 *   stdin?: ReadableLike;
 *   stdout?: WritableLike;
 *   stderr?: WritableLike;
 *   readStdin?: () => Promise<string>;
 * }} RuntimeDeps
 */

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const PRIORITIES = new Set(["urgent", "high", "medium", "low", "none"]);

class PlaneError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number | null; body?: string; cause?: unknown }} [options]
   */
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "PlaneError";
    /** @type {number | null} */
    this.status = options.status ?? null;
    /** @type {string} */
    this.body = options.body ?? "";
  }
}

class PlaneConfigError extends PlaneError {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = "PlaneConfigError";
  }
}

class PlaneApiError extends PlaneError {
  /**
   * @param {string} message
   * @param {{ status?: number | null; body?: string; cause?: unknown }} [options]
   */
  constructor(message, options = {}) {
    super(message, options);
    this.name = "PlaneApiError";
  }
}

/**
 * @param {PlaneEnv} [env]
 * @returns {string}
 */
function getBaseUrl(env = process.env) {
  return (env.PLANE_BASE_URL || env.PLANE_API_URL || "").replace(/\/+$/, "");
}

/**
 * @param {PlaneEnv} [env]
 * @returns {PlaneConfig}
 */
function getConfig(env = process.env) {
  const baseUrl = getBaseUrl(env);
  const apiKey = env.PLANE_API_KEY || "";

  if (!baseUrl) {
    throw new PlaneConfigError("PLANE_BASE_URL or PLANE_API_URL environment variable not set");
  }

  if (!apiKey) {
    throw new PlaneConfigError("PLANE_API_KEY environment variable not set");
  }

  return {
    baseUrl,
    apiKey,
    workspaceSlug: env.PLANE_WORKSPACE_SLUG || "",
    projectId: env.PLANE_PROJECT_ID || "",
  };
}

/**
 * @param {string | undefined} workspaceArg
 * @param {PlaneEnv} [env]
 * @returns {string}
 */
function getWorkspace(workspaceArg, env = process.env) {
  const workspace = workspaceArg || getConfig(env).workspaceSlug;
  if (!workspace) {
    throw new PlaneConfigError(
      "Workspace slug required. Set PLANE_WORKSPACE_SLUG or pass --workspace",
    );
  }
  return workspace;
}

/**
 * @param {string | undefined} projectIdArg
 * @param {PlaneEnv} [env]
 * @returns {string}
 */
function getProjectId(projectIdArg, env = process.env) {
  const projectId = projectIdArg || getConfig(env).projectId;
  if (!projectId) {
    throw new PlaneConfigError("Project ID required. Set PLANE_PROJECT_ID or include projectId");
  }
  return projectId;
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function looksLikeUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeLookupValue(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * @param {Record<string, unknown>} workItem
 * @param {string | undefined} [projectRef]
 * @returns {string | null}
 */
function extractProjectIdentifier(workItem, projectRef) {
  const candidates = [
    projectRef,
    typeof workItem.project_identifier === "string" ? workItem.project_identifier : undefined,
    typeof workItem.project__identifier === "string" ? workItem.project__identifier : undefined,
  ];

  const projectDetail = workItem.project_detail;
  if (projectDetail && typeof projectDetail === "object" && !Array.isArray(projectDetail)) {
    const identifier = /** @type {{ identifier?: unknown }} */ (projectDetail).identifier;
    candidates.push(typeof identifier === "string" ? identifier : undefined);
  }

  const project = workItem.project;
  if (project && typeof project === "object" && !Array.isArray(project)) {
    const identifier = /** @type {{ identifier?: unknown }} */ (project).identifier;
    candidates.push(typeof identifier === "string" ? identifier : undefined);
  }

  for (const candidate of candidates) {
    if (candidate && !looksLikeUuid(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * @param {Record<string, unknown>} workItem
 * @returns {string | null}
 */
function extractSequenceId(workItem) {
  const sequenceId = workItem.sequence_id;
  if (sequenceId === undefined || sequenceId === null || sequenceId === "") {
    return null;
  }
  return String(sequenceId);
}

/**
 * @param {string | null} projectIdentifier
 * @param {string | null} sequenceId
 * @returns {string | null}
 */
function buildIssueKey(projectIdentifier, sequenceId) {
  if (!projectIdentifier || !sequenceId) {
    return null;
  }
  return `${projectIdentifier}-${sequenceId}`;
}

/**
 * @param {string} baseUrl
 * @param {string} workspaceSlug
 * @param {string | null} issueKey
 * @returns {string | null}
 */
function buildIssueUrl(baseUrl, workspaceSlug, issueKey) {
  if (!baseUrl || !workspaceSlug || !issueKey) {
    return null;
  }
  return `${baseUrl.replace(/\/+$/, "")}/${workspaceSlug}/browse/${issueKey}`;
}

/**
 * @param {Record<string, unknown>} workItem
 * @param {string} workspaceSlug
 * @param {string | undefined} [projectRef]
 * @param {string | undefined} [baseUrl]
 * @param {PlaneEnv} [env]
 * @returns {Record<string, unknown>}
 */
function enrichWorkItemLink(workItem, workspaceSlug, projectRef, baseUrl, env = process.env) {
  const enriched = { ...workItem };
  const projectIdentifier = extractProjectIdentifier(enriched, projectRef);
  const sequenceId = extractSequenceId(enriched);
  const issueKey = buildIssueKey(projectIdentifier, sequenceId);

  if (issueKey) {
    enriched.issue_key = issueKey;
    const issueUrl = buildIssueUrl(baseUrl || getBaseUrl(env), workspaceSlug, issueKey);
    if (issueUrl) {
      enriched.url = issueUrl;
    }
  }

  return enriched;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function toStringArray(value) {
  if (value === undefined || value === null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }
  return [String(value)];
}

/**
 * @param {string | undefined} dueFrom
 * @param {string | undefined} dueTo
 * @returns {string | undefined}
 */
function buildTargetDateFilter(dueFrom, dueTo) {
  const parts = [];
  if (dueFrom) {
    parts.push(`${dueFrom};after`);
  }
  if (dueTo) {
    parts.push(`${dueTo};before`);
  }
  return parts.length > 0 ? parts.join(",") : undefined;
}

/**
 * @param {string | undefined} description
 * @returns {string}
 */
function toDescriptionHtml(description) {
  return description ? `<p>${description}</p>` : "";
}

/**
 * @param {unknown} priority
 * @returns {string}
 */
function normalizePriority(priority) {
  const normalized = priority === undefined ? "none" : String(priority);
  if (!PRIORITIES.has(normalized)) {
    throw new PlaneConfigError(`Invalid priority: ${normalized}`);
  }
  return normalized;
}

/**
 * @param {string} endpoint
 * @param {Record<string, string | undefined>} [query]
 * @param {PlaneEnv} [env]
 * @returns {URL}
 */
function buildUrl(endpoint, query = {}, env = process.env) {
  const url = new URL(endpoint, `${getConfig(env).baseUrl}/`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} result
 * @returns {Record<string, unknown>[]}
 */
function getResultsArray(result) {
  if (Array.isArray(result)) {
    return result.filter(isRecord);
  }

  if (isRecord(result) && Array.isArray(result.results)) {
    return result.results.filter(isRecord);
  }

  return [];
}

/**
 * @param {string} method
 * @param {string} endpoint
 * @param {{ data?: Record<string, unknown>; query?: Record<string, string | undefined> } | undefined} options
 * @param {RuntimeDeps} [deps]
 * @returns {Promise<unknown>}
 */
async function apiRequest(method, endpoint, options = {}, deps = {}) {
  const env = deps.env || process.env;
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new PlaneConfigError("Fetch implementation not available");
  }

  const config = getConfig(env);
  const url = buildUrl(endpoint, options.query, env);
  const response = await fetchImpl(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": config.apiKey,
    },
    body: options.data ? JSON.stringify(options.data) : undefined,
  }).catch((error) => {
    throw new PlaneApiError(`Request failed for ${method} ${url.pathname}`, { cause: error });
  });

  if (response.status === 204) {
    return {};
  }

  const text = await response.text();

  if (!response.ok) {
    const message = text || `Plane API request failed with status ${response.status}`;
    throw new PlaneApiError(message, { body: text, status: response.status });
  }

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new PlaneApiError(`Plane API returned invalid JSON for ${method} ${url.pathname}`, {
      body: text,
      cause: error,
      status: response.status,
    });
  }
}

/**
 * @param {string} workspaceSlug
 * @param {RuntimeDeps} [deps]
 * @returns {Promise<unknown[]>}
 */
async function listProjects(workspaceSlug, deps = {}) {
  const result = await apiRequest(
    "GET",
    `/api/v1/workspaces/${workspaceSlug}/projects/`,
    undefined,
    deps,
  );
  return getResultsArray(result);
}

/**
 * @param {string} workspaceSlug
 * @param {string} projectId
 * @param {{ query?: Record<string, string | undefined> }} [options]
 * @param {RuntimeDeps} [deps]
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function listWorkItems(workspaceSlug, projectId, options = {}, deps = {}) {
  const result = await apiRequest(
    "GET",
    `/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/work-items/`,
    {
      query: options.query,
    },
    deps,
  );
  const items = getResultsArray(result);
  const baseUrl = getBaseUrl(deps.env || process.env);
  return items.map((item) => enrichWorkItemLink(item, workspaceSlug, projectId, baseUrl, deps.env));
}

/**
 * @param {string} workspaceSlug
 * @param {string} projectId
 * @param {RuntimeDeps} [deps]
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function listStates(workspaceSlug, projectId, deps = {}) {
  const result = await apiRequest(
    "GET",
    `/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/states/`,
    undefined,
    deps,
  );
  return getResultsArray(result);
}

/**
 * @param {string} workspaceSlug
 * @param {string} projectId
 * @param {RuntimeDeps} [deps]
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function listCycles(workspaceSlug, projectId, deps = {}) {
  const result = await apiRequest(
    "GET",
    `/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/cycles/`,
    undefined,
    deps,
  );
  return getResultsArray(result);
}

/**
 * @param {string} workspaceSlug
 * @param {string} projectId
 * @param {RuntimeDeps} [deps]
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function listModules(workspaceSlug, projectId, deps = {}) {
  const result = await apiRequest(
    "GET",
    `/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/modules/`,
    undefined,
    deps,
  );
  return getResultsArray(result);
}

/**
 * @param {string} workspaceSlug
 * @param {string} projectId
 * @param {RuntimeDeps} [deps]
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function listLabels(workspaceSlug, projectId, deps = {}) {
  const result = await apiRequest(
    "GET",
    `/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/labels/`,
    undefined,
    deps,
  );
  return getResultsArray(result);
}

/**
 * @param {string} workspaceSlug
 * @param {string} projectId
 * @param {string[]} references
 * @param {RuntimeDeps} [deps]
 * @returns {Promise<string[]>}
 */
async function resolveStateIds(workspaceSlug, projectId, references, deps = {}) {
  const directIds = references.filter(looksLikeUuid);
  const unresolved = references.filter((reference) => !looksLikeUuid(reference));
  if (unresolved.length === 0) {
    return directIds;
  }

  const states = await listStates(workspaceSlug, projectId, deps);
  const lookup = new Map();
  for (const state of states) {
    const stateId = typeof state.id === "string" ? state.id : undefined;
    const stateName = typeof state.name === "string" ? state.name : undefined;
    const stateGroup = typeof state.group === "string" ? state.group : undefined;

    if (stateId) {
      lookup.set(normalizeLookupValue(stateId), stateId);
    }
    if (stateName) {
      lookup.set(normalizeLookupValue(stateName), stateId);
    }
    if (stateGroup) {
      lookup.set(normalizeLookupValue(stateGroup), stateId);
    }
  }

  /** @type {string[]} */
  const resolvedIds = [...directIds];
  /** @type {string[]} */
  const missing = [];
  for (const reference of unresolved) {
    const resolvedId = lookup.get(normalizeLookupValue(reference));
    if (resolvedId) {
      resolvedIds.push(resolvedId);
    } else {
      missing.push(reference);
    }
  }

  if (missing.length > 0) {
    throw new PlaneConfigError(`Unable to resolve state reference(s): ${missing.join(", ")}`);
  }

  return resolvedIds;
}

/**
 * @param {string} workspaceSlug
 * @param {string} projectId
 * @param {string[]} references
 * @param {RuntimeDeps} [deps]
 * @returns {Promise<string[]>}
 */
async function resolveLabelIds(workspaceSlug, projectId, references, deps = {}) {
  const directIds = references.filter(looksLikeUuid);
  const unresolved = references.filter((reference) => !looksLikeUuid(reference));
  if (unresolved.length === 0) {
    return directIds;
  }

  const labels = await listLabels(workspaceSlug, projectId, deps);
  const lookup = new Map();
  for (const label of labels) {
    const labelId = typeof label.id === "string" ? label.id : undefined;
    const labelName = typeof label.name === "string" ? label.name : undefined;
    if (labelId) {
      lookup.set(normalizeLookupValue(labelId), labelId);
    }
    if (labelName) {
      lookup.set(normalizeLookupValue(labelName), labelId);
    }
  }

  /** @type {string[]} */
  const resolvedIds = [...directIds];
  /** @type {string[]} */
  const missing = [];
  for (const reference of unresolved) {
    const resolvedId = lookup.get(normalizeLookupValue(reference));
    if (resolvedId) {
      resolvedIds.push(resolvedId);
    } else {
      missing.push(reference);
    }
  }

  if (missing.length > 0) {
    throw new PlaneConfigError(`Unable to resolve label reference(s): ${missing.join(", ")}`);
  }

  return resolvedIds;
}

/**
 * @param {string} workspaceSlug
 * @param {string} projectId
 * @param {string} title
 * @param {{
 *   description?: string;
 *   due?: string;
 *   labelIds?: string[];
 *   priority?: string;
 *   stateId?: string;
 * }} [options]
 * @param {RuntimeDeps} [deps]
 * @returns {Promise<Record<string, unknown>>}
 */
async function createWorkItem(workspaceSlug, projectId, title, options = {}, deps = {}) {
  /** @type {Record<string, unknown>} */
  const data = {
    name: title,
    priority: normalizePriority(options.priority),
  };

  if (options.stateId) {
    data.state_id = options.stateId;
  }
  if (options.description) {
    data.description_html = toDescriptionHtml(options.description);
  }
  if (options.due) {
    data.target_date = options.due;
  }
  if (options.labelIds) {
    data.label_ids = options.labelIds;
  }

  const created = /** @type {Record<string, unknown>} */ (
    await apiRequest(
      "POST",
      `/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/work-items/`,
      { data },
      deps,
    )
  );
  return enrichWorkItemLink(
    created,
    workspaceSlug,
    projectId,
    getBaseUrl(deps.env || process.env),
    deps.env,
  );
}

/**
 * @param {string} workspaceSlug
 * @param {string} projectId
 * @param {string} workItemId
 * @param {{
 *   description?: string;
 *   due?: string;
 *   labelIds?: string[];
 *   priority?: string;
 *   stateId?: string;
 *   title?: string;
 * }} patch
 * @param {RuntimeDeps} [deps]
 * @returns {Promise<Record<string, unknown>>}
 */
async function updateWorkItem(workspaceSlug, projectId, workItemId, patch, deps = {}) {
  /** @type {Record<string, unknown>} */
  const data = {};

  if (Object.hasOwn(patch, "title")) {
    data.name = patch.title ?? "";
  }
  if (Object.hasOwn(patch, "description")) {
    data.description_html = patch.description ? toDescriptionHtml(patch.description) : "";
  }
  if (Object.hasOwn(patch, "due")) {
    data.target_date = patch.due ?? null;
  }
  if (Object.hasOwn(patch, "priority")) {
    data.priority = normalizePriority(patch.priority);
  }
  if (Object.hasOwn(patch, "stateId")) {
    data.state_id = patch.stateId ?? null;
  }
  if (Object.hasOwn(patch, "labelIds")) {
    data.label_ids = patch.labelIds ?? [];
  }

  const updated = /** @type {Record<string, unknown>} */ (
    await apiRequest(
      "PATCH",
      `/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/work-items/${workItemId}/`,
      { data },
      deps,
    )
  );
  return enrichWorkItemLink(
    updated,
    workspaceSlug,
    projectId,
    getBaseUrl(deps.env || process.env),
    deps.env,
  );
}

/**
 * @param {string} workspaceSlug
 * @param {string} projectId
 * @param {{
 *   dueFrom?: string;
 *   dueTo?: string;
 *   labels?: unknown;
 *   priority?: string;
 *   search?: string;
 *   state?: unknown;
 * }} filters
 * @param {number | undefined} limit
 * @param {RuntimeDeps} [deps]
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function listWorkItemsForAction(workspaceSlug, projectId, filters, limit, deps = {}) {
  /** @type {Record<string, string | undefined>} */
  const query = {};

  if (limit !== undefined) {
    query.limit = String(limit);
  }

  if (filters.search) {
    query.name = filters.search;
  }

  if (filters.priority) {
    query.priority = normalizePriority(filters.priority);
  }

  const stateRefs = toStringArray(filters.state);
  if (stateRefs.length > 0) {
    query.state = (await resolveStateIds(workspaceSlug, projectId, stateRefs, deps)).join(",");
  }

  const labelRefs = toStringArray(filters.labels);
  if (labelRefs.length > 0) {
    query.labels = (await resolveLabelIds(workspaceSlug, projectId, labelRefs, deps)).join(",");
  }

  const targetDate = buildTargetDateFilter(filters.dueFrom, filters.dueTo);
  if (targetDate) {
    query.target_date = targetDate;
  }

  return listWorkItems(workspaceSlug, projectId, { query }, deps);
}

/**
 * @param {unknown} input
 * @param {RuntimeDeps} [deps]
 * @returns {Promise<Record<string, unknown>>}
 */
async function handleAction(input, deps = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new PlaneConfigError("Plane action input must be a JSON object");
  }

  const payload = /** @type {Record<string, unknown>} */ (input);
  const action = typeof payload.action === "string" ? payload.action : "";
  const env = deps.env || process.env;

  if (action === "create") {
    const workspaceSlug = getWorkspace(
      typeof payload.workspace === "string" ? payload.workspace : undefined,
      env,
    );
    const projectId = getProjectId(
      typeof payload.projectId === "string" ? payload.projectId : undefined,
      env,
    );
    const title = typeof payload.title === "string" ? payload.title : "";
    if (!title) {
      throw new PlaneConfigError("Create action requires a title");
    }

    const stateIds = await resolveStateIds(
      workspaceSlug,
      projectId,
      toStringArray(payload.state),
      deps,
    );
    const labelIds = Object.hasOwn(payload, "labels")
      ? await resolveLabelIds(workspaceSlug, projectId, toStringArray(payload.labels), deps)
      : undefined;

    const created = await createWorkItem(
      workspaceSlug,
      projectId,
      title,
      {
        description: typeof payload.description === "string" ? payload.description : undefined,
        due: typeof payload.due === "string" ? payload.due : undefined,
        labelIds,
        priority: typeof payload.priority === "string" ? payload.priority : undefined,
        stateId: stateIds[0],
      },
      deps,
    );

    return {
      ok: true,
      action,
      id: created.id,
      issue_key: created.issue_key,
      title: created.name,
      url: created.url,
    };
  }

  if (action === "list") {
    const workspaceSlug = getWorkspace(
      typeof payload.workspace === "string" ? payload.workspace : undefined,
      env,
    );
    const projectId = getProjectId(
      typeof payload.projectId === "string" ? payload.projectId : undefined,
      env,
    );
    const filters =
      payload.filters && typeof payload.filters === "object" && !Array.isArray(payload.filters)
        ? /** @type {{ dueFrom?: string; dueTo?: string; labels?: unknown; priority?: string; search?: string; state?: unknown }} */ (
            payload.filters
          )
        : {};
    const items = await listWorkItemsForAction(
      workspaceSlug,
      projectId,
      filters,
      typeof payload.limit === "number" ? payload.limit : undefined,
      deps,
    );

    return {
      ok: true,
      action,
      count: items.length,
      items,
    };
  }

  if (action === "update") {
    const workspaceSlug = getWorkspace(
      typeof payload.workspace === "string" ? payload.workspace : undefined,
      env,
    );
    const projectId = getProjectId(
      typeof payload.projectId === "string" ? payload.projectId : undefined,
      env,
    );
    const workItemId = typeof payload.id === "string" ? payload.id : "";
    if (!workItemId) {
      throw new PlaneConfigError("Update action requires an id");
    }

    const patch =
      payload.patch && typeof payload.patch === "object" && !Array.isArray(payload.patch)
        ? /** @type {Record<string, unknown>} */ (payload.patch)
        : null;
    if (!patch) {
      throw new PlaneConfigError("Update action requires a patch object");
    }

    const stateIds = Object.hasOwn(patch, "state")
      ? await resolveStateIds(workspaceSlug, projectId, toStringArray(patch.state), deps)
      : undefined;
    const labelIds = Object.hasOwn(patch, "labels")
      ? await resolveLabelIds(workspaceSlug, projectId, toStringArray(patch.labels), deps)
      : undefined;

    const updated = await updateWorkItem(
      workspaceSlug,
      projectId,
      workItemId,
      {
        description: typeof patch.description === "string" ? patch.description : undefined,
        due:
          typeof patch.due === "string" ? patch.due : Object.hasOwn(patch, "due") ? "" : undefined,
        labelIds,
        priority: typeof patch.priority === "string" ? patch.priority : undefined,
        stateId: stateIds ? stateIds[0] : undefined,
        title: typeof patch.title === "string" ? patch.title : undefined,
      },
      deps,
    );

    return {
      ok: true,
      action,
      id: updated.id,
      issue_key: updated.issue_key,
      title: updated.name,
      url: updated.url,
    };
  }

  throw new PlaneConfigError(`Unsupported action: ${action || "<missing>"}`);
}

/**
 * @param {RuntimeDeps} [deps]
 * @returns {Promise<Record<string, unknown>>}
 */
async function checkVersion(deps = {}) {
  const env = deps.env || process.env;
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new PlaneConfigError("Fetch implementation not available");
  }

  const config = getConfig(env);
  const result = {
    base_url: config.baseUrl,
    v1_api_available: false,
    api_key_auth_working: false,
    message: "",
  };

  /** @type {Array<[string, number | null, string]>} */
  const probeErrors = [];
  const endpoints = config.workspaceSlug
    ? [`/api/v1/workspaces/${config.workspaceSlug}/projects/`, "/api/v1/workspaces/"]
    : ["/api/v1/workspaces/"];

  for (const endpoint of endpoints) {
    const responseOrError = await fetchImpl(buildUrl(endpoint, undefined, env), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": config.apiKey,
      },
    }).catch((error) => {
      probeErrors.push([endpoint, null, error instanceof Error ? error.message : String(error)]);
      return null;
    });

    if (!responseOrError) {
      continue;
    }

    if (responseOrError.ok) {
      return {
        ...result,
        api_key_auth_working: true,
        message: `v1 API is available and API key auth works (probe: ${endpoint})`,
        v1_api_available: true,
      };
    }

    if (responseOrError.status === 401) {
      return {
        ...result,
        message: `v1 API exists at ${endpoint} but API key auth failed - check your key`,
        v1_api_available: true,
      };
    }

    probeErrors.push([
      endpoint,
      responseOrError.status,
      responseOrError.statusText || "Unknown error",
    ]);
  }

  const httpErrors = probeErrors.filter(([, code]) => code !== null);
  if (httpErrors.length > 0 && httpErrors.every(([, code]) => code === 404)) {
    return {
      ...result,
      message:
        "v1 API not found on probed endpoints. Ensure PLANE_BASE_URL or PLANE_API_URL points to your server root and Plane is v0.20+ for API key authentication.",
    };
  }

  if (probeErrors.length > 0) {
    const [endpoint, code, reason] = probeErrors[probeErrors.length - 1];
    return {
      ...result,
      message:
        code === null
          ? `Connection error while probing ${endpoint}: ${reason}`
          : `Unexpected error while probing ${endpoint}: ${code} ${reason}`,
    };
  }

  return {
    ...result,
    message: "Unable to verify API availability",
  };
}

/**
 * @param {WritableLike | undefined} output
 * @param {unknown} value
 */
function writeJson(output, value) {
  output?.write(`${JSON.stringify(value, null, 2)}\n`);
}

/**
 * @param {WritableLike | undefined} output
 * @param {unknown} error
 */
function writeError(output, error) {
  if (error instanceof PlaneError) {
    output?.write(`${error.message}\n`);
    if (error.body) {
      output?.write(`${error.body}\n`);
    }
    return;
  }

  if (error instanceof Error) {
    output?.write(`${error.message}\n`);
    return;
  }

  output?.write(`${String(error)}\n`);
}

/**
 * @param {string | undefined} action
 * @param {unknown} error
 * @returns {Record<string, unknown>}
 */
function toActionError(action, error) {
  if (error instanceof PlaneError) {
    return {
      ok: false,
      action,
      error: error.message,
      status: error.status ?? undefined,
    };
  }

  if (error instanceof Error) {
    return {
      ok: false,
      action,
      error: error.message,
    };
  }

  return {
    ok: false,
    action,
    error: String(error),
  };
}

/**
 * @returns {string}
 */
function helpText() {
  return [
    "Plane API Client",
    "",
    "Usage:",
    "  ./plane.js check-version",
    "  ./plane.js projects [--workspace slug]",
    "  ./plane.js work-items <project_id> [--workspace slug]",
    "  ./plane.js create-work-item <project_id> <title> [--workspace slug] [--priority <value>] [--state-id <id>] [--description <text>]",
    "  ./plane.js states <project_id> [--workspace slug]",
    "  ./plane.js cycles <project_id> [--workspace slug]",
    "  ./plane.js modules <project_id> [--workspace slug]",
    '  ./plane.js action \'{"action":"list"}\'',
    "",
    "The file is directly executable with Node and can also be run with Bun.",
    "If no subcommand is provided and stdin is piped, the script reads a JSON action object from stdin.",
  ].join("\n");
}

/**
 * @param {string[]} argv
 * @param {Record<string, string>} optionMap
 * @returns {{ options: Record<string, string>; positionals: string[] }}
 */
function parseOptions(argv, optionMap) {
  /** @type {Record<string, string>} */
  const options = {};
  /** @type {string[]} */
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("-")) {
      positionals.push(token);
      continue;
    }

    const mappedKey = optionMap[token];
    if (!mappedKey) {
      throw new PlaneConfigError(`Unknown option: ${token}`);
    }

    const value = argv[index + 1];
    if (value === undefined) {
      throw new PlaneConfigError(`Missing value for ${token}`);
    }

    options[mappedKey] = value;
    index += 1;
  }

  return { options, positionals };
}

/**
 * @param {ReadableLike | undefined} readable
 * @returns {boolean}
 */
function shouldReadStdin(readable) {
  return Boolean(readable && readable.isTTY === false);
}

/**
 * @param {ReadableLike | undefined} readable
 * @returns {Promise<string>}
 */
function readStreamText(readable) {
  if (!readable || typeof readable.on !== "function") {
    return Promise.resolve("");
  }

  readable.setEncoding?.("utf8");
  return new Promise((resolve, reject) => {
    const on = /** @type {NonNullable<ReadableLike["on"]>} */ (readable.on);
    let text = "";
    on.call(readable, "data", (chunk) => {
      text += typeof chunk === "string" ? chunk : String(chunk ?? "");
    });
    on.call(readable, "end", () => resolve(text));
    on.call(readable, "error", (error) => reject(error));
  });
}

/**
 * @param {string} raw
 * @returns {Record<string, unknown>}
 */
function parseJsonInput(raw) {
  if (!raw.trim()) {
    throw new PlaneConfigError("No JSON input provided");
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new PlaneConfigError("Plane action input must be a JSON object");
    }
    return parsed;
  } catch (error) {
    if (error instanceof PlaneConfigError) {
      throw error;
    }
    throw new PlaneConfigError("Invalid JSON input");
  }
}

/**
 * @param {string[]} argv
 * @param {RuntimeDeps} [deps]
 * @returns {Promise<number>}
 */
async function run(argv, deps = {}) {
  const stdin = /** @type {ReadableLike} */ (deps.stdin || process.stdin);
  const stdout = deps.stdout || process.stdout;
  const stderr = deps.stderr || process.stderr;

  const actionMode = argv[0] === "action" || (argv.length === 0 && shouldReadStdin(stdin));
  try {
    if (actionMode) {
      const raw =
        argv[0] === "action"
          ? argv.slice(1).join(" ")
          : deps.readStdin
            ? await deps.readStdin()
            : await readStreamText(stdin);
      const input = parseJsonInput(raw);
      const result = await handleAction(input, deps);
      writeJson(stdout, result);
      return 0;
    }

    if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
      stdout.write(`${helpText()}\n`);
      return argv.length === 0 ? 1 : 0;
    }

    const [command, ...rest] = argv;

    if (command === "check-version") {
      writeJson(stdout, await checkVersion(deps));
      return 0;
    }

    if (command === "projects") {
      const parsed = parseOptions(rest, { "--workspace": "workspace", "-w": "workspace" });
      writeJson(
        stdout,
        await listProjects(getWorkspace(parsed.options.workspace, deps.env || process.env), deps),
      );
      return 0;
    }

    if (command === "work-items") {
      const parsed = parseOptions(rest, { "--workspace": "workspace", "-w": "workspace" });
      if (parsed.positionals.length !== 1) {
        throw new PlaneConfigError("work-items requires <project_id>");
      }

      writeJson(
        stdout,
        await listWorkItems(
          getWorkspace(parsed.options.workspace, deps.env || process.env),
          parsed.positionals[0],
          undefined,
          deps,
        ),
      );
      return 0;
    }

    if (command === "create-work-item") {
      const parsed = parseOptions(rest, {
        "--description": "description",
        "--priority": "priority",
        "--state-id": "stateId",
        "--workspace": "workspace",
        "-w": "workspace",
      });
      if (parsed.positionals.length !== 2) {
        throw new PlaneConfigError("create-work-item requires <project_id> <title>");
      }

      writeJson(
        stdout,
        await createWorkItem(
          getWorkspace(parsed.options.workspace, deps.env || process.env),
          parsed.positionals[0],
          parsed.positionals[1],
          {
            description: parsed.options.description,
            priority: parsed.options.priority,
            stateId: parsed.options.stateId,
          },
          deps,
        ),
      );
      return 0;
    }

    if (command === "states" || command === "cycles" || command === "modules") {
      const parsed = parseOptions(rest, { "--workspace": "workspace", "-w": "workspace" });
      if (parsed.positionals.length !== 1) {
        throw new PlaneConfigError(`${command} requires <project_id>`);
      }

      const workspace = getWorkspace(parsed.options.workspace, deps.env || process.env);
      const projectId = parsed.positionals[0];
      const loader =
        command === "states" ? listStates : command === "cycles" ? listCycles : listModules;
      writeJson(stdout, await loader(workspace, projectId, deps));
      return 0;
    }

    throw new PlaneConfigError(`Unknown command: ${command}`);
  } catch (error) {
    if (actionMode) {
      const rawAction =
        argv[0] === "action" && argv[1]
          ? (() => {
              try {
                const parsed = JSON.parse(argv.slice(1).join(" "));
                return parsed && typeof parsed === "object" && !Array.isArray(parsed)
                  ? String(parsed.action || "")
                  : "";
              } catch {
                return "";
              }
            })()
          : "";
      writeJson(stdout, toActionError(rawAction || undefined, error));
      return 1;
    }

    writeError(stderr, error);
    return 1;
  }
}

module.exports = {
  PlaneApiError,
  PlaneConfigError,
  PlaneError,
  apiRequest,
  buildIssueKey,
  buildIssueUrl,
  buildTargetDateFilter,
  checkVersion,
  createWorkItem,
  enrichWorkItemLink,
  extractProjectIdentifier,
  extractSequenceId,
  getBaseUrl,
  getConfig,
  getProjectId,
  getWorkspace,
  handleAction,
  helpText,
  listCycles,
  listLabels,
  listModules,
  listProjects,
  listStates,
  listWorkItems,
  listWorkItemsForAction,
  looksLikeUuid,
  normalizeLookupValue,
  normalizePriority,
  parseJsonInput,
  parseOptions,
  readStreamText,
  resolveLabelIds,
  resolveStateIds,
  run,
  shouldReadStdin,
  toActionError,
  toDescriptionHtml,
  updateWorkItem,
};

if (require.main === module) {
  run(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
