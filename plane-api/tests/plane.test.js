// @ts-check

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const test = require("node:test");

const plane = require("../plane.js");

function createResponse({ status = 200, body = {}, statusText = "OK" } = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    async text() {
      return text;
    },
  };
}

function createFetchSequence(...responses) {
  /** @type {{ url: string; init: RequestInit | undefined }[]} */
  const calls = [];
  const fetchImpl = async (input, init) => {
    calls.push({ init, url: String(input) });
    const next = responses.shift();
    if (next instanceof Error) {
      throw next;
    }
    if (typeof next === "function") {
      return next(input, init);
    }
    return next;
  };

  return { calls, fetchImpl };
}

function createWriter() {
  let value = "";
  return {
    output: {
      write(chunk) {
        value += chunk;
      },
    },
    read() {
      return value;
    },
  };
}

function createReadable(chunks) {
  const emitter = new EventEmitter();
  return {
    isTTY: false,
    on(event, listener) {
      emitter.on(event, listener);
    },
    setEncoding() {},
    start() {
      for (const chunk of chunks) {
        emitter.emit("data", chunk);
      }
      emitter.emit("end");
    },
  };
}

test("getBaseUrl prefers PLANE_BASE_URL and strips trailing slash", () => {
  assert.equal(
    plane.getBaseUrl({
      PLANE_API_URL: "https://ignored.example/",
      PLANE_BASE_URL: "https://plane.example/",
    }),
    "https://plane.example",
  );
});

test("getConfig validates required environment variables", () => {
  assert.throws(() => plane.getConfig({ PLANE_API_KEY: "token" }), /PLANE_BASE_URL/);
  assert.throws(
    () => plane.getConfig({ PLANE_BASE_URL: "https://plane.example" }),
    /PLANE_API_KEY/,
  );
});

test("workspace and project helpers use args first and validate missing values", () => {
  const env = {
    PLANE_API_KEY: "token",
    PLANE_BASE_URL: "https://plane.example",
    PLANE_PROJECT_ID: "project-from-env",
    PLANE_WORKSPACE_SLUG: "workspace-from-env",
  };

  assert.equal(plane.getWorkspace(undefined, env), "workspace-from-env");
  assert.equal(plane.getWorkspace("workspace-from-arg", env), "workspace-from-arg");
  assert.equal(plane.getProjectId(undefined, env), "project-from-env");
  assert.equal(plane.getProjectId("project-from-arg", env), "project-from-arg");
  assert.throws(
    () =>
      plane.getWorkspace(undefined, {
        PLANE_API_KEY: "token",
        PLANE_BASE_URL: "https://plane.example",
      }),
    /Workspace slug required/,
  );
  assert.throws(
    () =>
      plane.getProjectId(undefined, {
        PLANE_API_KEY: "token",
        PLANE_BASE_URL: "https://plane.example",
      }),
    /Project ID required/,
  );
});

test("link helpers preserve canonical Plane browse URLs and avoid legacy guesses", () => {
  const workItem = { id: "issue", sequence_id: 42 };
  assert.equal(plane.looksLikeUuid("550e8400-e29b-41d4-a716-446655440000"), true);
  assert.equal(plane.looksLikeUuid("not-a-uuid"), false);
  assert.equal(plane.normalizeLookupValue("In Progress"), "in_progress");
  assert.equal(plane.extractSequenceId(workItem), "42");
  assert.equal(plane.buildIssueKey("TMOM", "42"), "TMOM-42");
  assert.equal(
    plane.buildIssueUrl("https://plane.example/", "workspace", "TMOM-42"),
    "https://plane.example/workspace/browse/TMOM-42",
  );

  assert.deepEqual(
    plane.enrichWorkItemLink(workItem, "workspace", "TMOM", "https://plane.example"),
    {
      id: "issue",
      issue_key: "TMOM-42",
      sequence_id: 42,
      url: "https://plane.example/workspace/browse/TMOM-42",
    },
  );

  assert.equal(
    plane.extractProjectIdentifier(
      { project_detail: { identifier: "OPS" }, sequence_id: 10 },
      "550e8400-e29b-41d4-a716-446655440000",
    ),
    "OPS",
  );
  assert.equal(plane.extractProjectIdentifier({ project_identifier: "CORE" }), "CORE");
  assert.equal(plane.extractProjectIdentifier({ project_detail: { identifier: 1 } }), null);
  assert.equal(plane.extractProjectIdentifier({ project: { identifier: 1 } }), null);
  assert.deepEqual(
    plane.enrichWorkItemLink(
      { id: "issue", project: { identifier: "APP" }, sequence_id: 5 },
      "workspace",
      undefined,
      "https://plane.example",
    ),
    {
      id: "issue",
      issue_key: "APP-5",
      project: { identifier: "APP" },
      sequence_id: 5,
      url: "https://plane.example/workspace/browse/APP-5",
    },
  );
  assert.equal(plane.extractSequenceId({ sequence_id: "" }), null);
  assert.equal(plane.buildIssueUrl("", "workspace", "APP-1"), null);
  assert.deepEqual(
    plane.enrichWorkItemLink(
      { id: "issue", project_identifier: "APP", sequence_id: 6 },
      "workspace",
      undefined,
      undefined,
      { PLANE_BASE_URL: "https://plane.example" },
    ),
    {
      id: "issue",
      issue_key: "APP-6",
      project_identifier: "APP",
      sequence_id: 6,
      url: "https://plane.example/workspace/browse/APP-6",
    },
  );
  assert.deepEqual(
    plane.enrichWorkItemLink(
      { id: "issue", sequence_id: 5 },
      "workspace",
      "550e8400-e29b-41d4-a716-446655440000",
      "https://plane.example",
    ),
    { id: "issue", sequence_id: 5 },
  );
});

test("description, due date, and priority helpers handle supported shapes", () => {
  assert.equal(plane.toDescriptionHtml("Ship it"), "<p>Ship it</p>");
  assert.equal(plane.toDescriptionHtml(undefined), "");
  assert.equal(
    plane.buildTargetDateFilter("2026-04-01", "2026-04-30"),
    "2026-04-01;after,2026-04-30;before",
  );
  assert.equal(plane.buildTargetDateFilter(undefined, undefined), undefined);
  assert.equal(plane.normalizePriority(undefined), "none");
  assert.equal(plane.normalizePriority("high"), "high");
  assert.throws(() => plane.normalizePriority("critical"), /Invalid priority/);
});

test("apiRequest handles success, empty responses, invalid JSON, API errors, and network failures", async () => {
  const env = {
    PLANE_API_KEY: "token",
    PLANE_BASE_URL: "https://plane.example",
  };

  const success = createFetchSequence(createResponse({ body: { ok: true } }));
  await assert.doesNotReject(async () => {
    assert.deepEqual(
      await plane.apiRequest("GET", "/api/v1/workspaces/", undefined, {
        env,
        fetchImpl: success.fetchImpl,
      }),
      {
        ok: true,
      },
    );
  });
  assert.equal(success.calls[0].url, "https://plane.example/api/v1/workspaces/");

  const empty = createFetchSequence({
    ok: true,
    status: 204,
    statusText: "No Content",
    async text() {
      return "";
    },
  });
  assert.deepEqual(
    await plane.apiRequest("DELETE", "/api/v1/workspaces/", undefined, {
      env,
      fetchImpl: empty.fetchImpl,
    }),
    {},
  );

  const emptyBody = createFetchSequence(createResponse({ body: "" }));
  assert.deepEqual(
    await plane.apiRequest("GET", "/api/v1/workspaces/", undefined, {
      env,
      fetchImpl: emptyBody.fetchImpl,
    }),
    {},
  );

  const invalidJson = createFetchSequence(createResponse({ body: "not-json" }));
  await assert.rejects(
    () =>
      plane.apiRequest("GET", "/api/v1/workspaces/", undefined, {
        env,
        fetchImpl: invalidJson.fetchImpl,
      }),
    /invalid JSON/,
  );

  const apiFailure = createFetchSequence(
    createResponse({ body: { detail: "nope" }, status: 401, statusText: "Unauthorized" }),
  );
  await assert.rejects(
    () =>
      plane.apiRequest("GET", "/api/v1/workspaces/", undefined, {
        env,
        fetchImpl: apiFailure.fetchImpl,
      }),
    /nope/,
  );

  const defaultErrorMessage = createFetchSequence(
    createResponse({ body: "", status: 500, statusText: "Server Error" }),
  );
  await assert.rejects(
    () =>
      plane.apiRequest("GET", "/api/v1/workspaces/", undefined, {
        env,
        fetchImpl: defaultErrorMessage.fetchImpl,
      }),
    /status 500/,
  );

  const networkFailure = createFetchSequence(new Error("socket closed"));
  await assert.rejects(
    () =>
      plane.apiRequest("GET", "/api/v1/workspaces/", undefined, {
        env,
        fetchImpl: networkFailure.fetchImpl,
      }),
    /Request failed/,
  );
});

test("apiRequest supports global fetch fallback and missing fetch validation", {
  concurrency: false,
}, async () => {
  const originalFetch = globalThis.fetch;
  process.env.PLANE_API_KEY = "token";
  process.env.PLANE_BASE_URL = "https://plane.example";

  try {
    globalThis.fetch = async () => createResponse({ body: { ok: true } });
    assert.deepEqual(await plane.apiRequest("GET", "/api/v1/workspaces/"), { ok: true });

    globalThis.fetch = undefined;
    await assert.rejects(
      () => plane.apiRequest("GET", "/api/v1/workspaces/"),
      /Fetch implementation not available/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.PLANE_API_KEY;
    delete process.env.PLANE_BASE_URL;
  }
});

test("listWorkItems enriches every returned item", async () => {
  const fetchMock = createFetchSequence(
    createResponse({
      body: {
        results: [
          { id: "one", sequence_id: 1 },
          { id: "two", project__identifier: "OPS", sequence_id: 2 },
        ],
      },
    }),
  );

  const items = await plane.listWorkItems("workspace", "APP", undefined, {
    env: {
      PLANE_API_KEY: "token",
      PLANE_BASE_URL: "https://plane.example",
    },
    fetchImpl: fetchMock.fetchImpl,
  });

  assert.deepEqual(items, [
    {
      id: "one",
      issue_key: "APP-1",
      sequence_id: 1,
      url: "https://plane.example/workspace/browse/APP-1",
    },
    {
      id: "two",
      issue_key: "APP-2",
      project__identifier: "OPS",
      sequence_id: 2,
      url: "https://plane.example/workspace/browse/APP-2",
    },
  ]);
});

test("state and label resolvers accept IDs, names, and state groups", async () => {
  const stateId = "550e8400-e29b-41d4-a716-446655440000";
  const labelId = "660e8400-e29b-41d4-a716-446655440000";
  const fetchMock = createFetchSequence(
    createResponse({
      body: {
        results: [
          { group: "started", id: stateId, name: "In Progress" },
          { group: "unstarted", id: "770e8400-e29b-41d4-a716-446655440000", name: "Todo" },
        ],
      },
    }),
    createResponse({
      body: {
        results: [{ id: labelId, name: "claw_inbox" }],
      },
    }),
  );

  const deps = {
    env: {
      PLANE_API_KEY: "token",
      PLANE_BASE_URL: "https://plane.example",
    },
    fetchImpl: fetchMock.fetchImpl,
  };

  assert.deepEqual(
    await plane.resolveStateIds("workspace", "project", [stateId, "In Progress", "started"], deps),
    [stateId, stateId, stateId],
  );
  assert.deepEqual(
    await plane.resolveLabelIds("workspace", "project", [labelId, "claw_inbox"], deps),
    [labelId, labelId],
  );
});

test("state and label resolvers short-circuit when every reference is already an ID", async () => {
  const stateId = "550e8400-e29b-41d4-a716-446655440000";
  const labelId = "660e8400-e29b-41d4-a716-446655440000";
  assert.deepEqual(await plane.resolveStateIds("workspace", "project", [stateId]), [stateId]);
  assert.deepEqual(await plane.resolveLabelIds("workspace", "project", [labelId]), [labelId]);
});

test("state and label resolvers ignore non-string metadata when building lookups", async () => {
  await assert.rejects(
    () =>
      plane.resolveStateIds("workspace", "project", ["todo"], {
        env: {
          PLANE_API_KEY: "token",
          PLANE_BASE_URL: "https://plane.example",
        },
        fetchImpl: createFetchSequence(
          createResponse({ body: { results: [{ group: 1, id: 2, name: 3 }] } }),
        ).fetchImpl,
      }),
    /Unable to resolve state reference/,
  );
  await assert.rejects(
    () =>
      plane.resolveLabelIds("workspace", "project", ["todo"], {
        env: {
          PLANE_API_KEY: "token",
          PLANE_BASE_URL: "https://plane.example",
        },
        fetchImpl: createFetchSequence(createResponse({ body: { results: [{ id: 2, name: 3 }] } }))
          .fetchImpl,
      }),
    /Unable to resolve label reference/,
  );
});

test("state and label resolvers fail when references are unknown", async () => {
  const deps = {
    env: {
      PLANE_API_KEY: "token",
      PLANE_BASE_URL: "https://plane.example",
    },
    fetchImpl: createFetchSequence(createResponse({ body: { results: [] } })).fetchImpl,
  };

  await assert.rejects(
    () => plane.resolveStateIds("workspace", "project", ["missing"], deps),
    /Unable to resolve state reference/,
  );
  await assert.rejects(
    () =>
      plane.resolveLabelIds("workspace", "project", ["missing"], {
        ...deps,
        fetchImpl: createFetchSequence(createResponse({ body: { results: [] } })).fetchImpl,
      }),
    /Unable to resolve label reference/,
  );
});

test("createWorkItem and updateWorkItem map payload fields to Plane's API", async () => {
  const createFetch = createFetchSequence((_input, init) => {
    const body = JSON.parse(init.body);
    assert.deepEqual(body, {
      description_html: "<p>Fix copy</p>",
      label_ids: ["label-1"],
      name: "Improve landing page",
      priority: "medium",
      state_id: "state-1",
      target_date: "2026-04-10",
    });
    return createResponse({
      body: { id: "issue-1", sequence_id: 9 },
    });
  });

  const env = {
    PLANE_API_KEY: "token",
    PLANE_BASE_URL: "https://plane.example",
  };

  const created = await plane.createWorkItem(
    "workspace",
    "APP",
    "Improve landing page",
    {
      description: "Fix copy",
      due: "2026-04-10",
      labelIds: ["label-1"],
      priority: "medium",
      stateId: "state-1",
    },
    { env, fetchImpl: createFetch.fetchImpl },
  );
  assert.equal(created.issue_key, "APP-9");

  const updateFetch = createFetchSequence((input, init) => {
    assert.match(String(input), /work-items\/issue-1\/$/);
    const body = JSON.parse(init.body);
    assert.deepEqual(body, {
      description_html: "",
      label_ids: [],
      name: "New title",
      priority: "low",
      state_id: null,
      target_date: null,
    });
    return createResponse({
      body: { id: "issue-1", project__identifier: "APP", sequence_id: 9 },
    });
  });

  const updated = await plane.updateWorkItem(
    "workspace",
    "APP",
    "issue-1",
    {
      description: "",
      due: null,
      labelIds: [],
      priority: "low",
      stateId: null,
      title: "New title",
    },
    { env, fetchImpl: updateFetch.fetchImpl },
  );
  assert.equal(updated.url, "https://plane.example/workspace/browse/APP-9");
});

test("createWorkItem and updateWorkItem can fall back to process env and sparse patches", {
  concurrency: false,
}, async () => {
  process.env.PLANE_API_KEY = "token";
  process.env.PLANE_BASE_URL = "https://plane.example";

  try {
    const created = await plane.createWorkItem("workspace", "APP", "Env create", undefined, {
      fetchImpl: createFetchSequence(createResponse({ body: { id: "issue-2", sequence_id: 12 } }))
        .fetchImpl,
    });
    assert.equal(created.url, "https://plane.example/workspace/browse/APP-12");

    const updated = await plane.updateWorkItem(
      "workspace",
      "APP",
      "issue-2",
      {
        description: "Fresh copy",
        labelIds: null,
        title: null,
      },
      {
        fetchImpl: createFetchSequence((_input, init) => {
          const body = JSON.parse(init.body);
          assert.deepEqual(body, {
            description_html: "<p>Fresh copy</p>",
            label_ids: [],
            name: "",
          });
          return createResponse({ body: { id: "issue-2", sequence_id: 12 } });
        }).fetchImpl,
      },
    );
    assert.equal(updated.issue_key, "APP-12");
  } finally {
    delete process.env.PLANE_API_KEY;
    delete process.env.PLANE_BASE_URL;
  }
});

test("listWorkItemsForAction translates skill filters into Plane query parameters", async () => {
  const stateId = "550e8400-e29b-41d4-a716-446655440000";
  const labelId = "660e8400-e29b-41d4-a716-446655440000";
  const fetchMock = createFetchSequence(
    createResponse({ body: { results: [{ group: "started", id: stateId, name: "In Progress" }] } }),
    createResponse({ body: { results: [{ id: labelId, name: "claw_inbox" }] } }),
    createResponse({ body: { results: [] } }),
  );

  await plane.listWorkItemsForAction(
    "workspace",
    "project",
    {
      dueFrom: "2026-04-01",
      dueTo: "2026-04-30",
      labels: ["claw_inbox"],
      priority: "high",
      search: "refactor",
      state: "In Progress",
    },
    25,
    {
      env: {
        PLANE_API_KEY: "token",
        PLANE_BASE_URL: "https://plane.example",
      },
      fetchImpl: fetchMock.fetchImpl,
    },
  );

  const url = new URL(fetchMock.calls[2].url);
  assert.equal(url.searchParams.get("labels"), labelId);
  assert.equal(url.searchParams.get("limit"), "25");
  assert.equal(url.searchParams.get("name"), "refactor");
  assert.equal(url.searchParams.get("priority"), "high");
  assert.equal(url.searchParams.get("state"), stateId);
  assert.equal(url.searchParams.get("target_date"), "2026-04-01;after,2026-04-30;before");
});

test("handleAction implements create, list, and update using the documented JSON contract", async () => {
  const env = {
    PLANE_API_KEY: "token",
    PLANE_BASE_URL: "https://plane.example",
    PLANE_PROJECT_ID: "APP",
    PLANE_WORKSPACE_SLUG: "workspace",
  };

  const createDeps = {
    env,
    fetchImpl: createFetchSequence(
      createResponse({
        body: { results: [{ group: "started", id: "state-1", name: "In Progress" }] },
      }),
      createResponse({ body: { results: [{ id: "label-1", name: "claw_inbox" }] } }),
      createResponse({ body: { id: "issue-1", sequence_id: 7, name: "Create title" } }),
    ).fetchImpl,
  };
  assert.deepEqual(
    await plane.handleAction(
      {
        action: "create",
        description: "Short brief",
        labels: ["claw_inbox"],
        priority: "high",
        state: "In Progress",
        title: "Create title",
      },
      createDeps,
    ),
    {
      action: "create",
      id: "issue-1",
      issue_key: "APP-7",
      ok: true,
      title: "Create title",
      url: "https://plane.example/workspace/browse/APP-7",
    },
  );

  const listDeps = {
    env,
    fetchImpl: createFetchSequence(
      createResponse({
        body: { results: [{ group: "started", id: "state-1", name: "In Progress" }] },
      }),
      createResponse({ body: { results: [{ id: "label-1", name: "claw_inbox" }] } }),
      createResponse({ body: { results: [{ id: "issue-1", sequence_id: 8 }] } }),
    ).fetchImpl,
  };
  const listResult = await plane.handleAction(
    {
      action: "list",
      filters: {
        labels: ["claw_inbox"],
        state: "In Progress",
      },
      limit: 1,
    },
    listDeps,
  );
  assert.equal(listResult.ok, true);
  assert.equal(listResult.count, 1);
  assert.equal(listResult.items[0].url, "https://plane.example/workspace/browse/APP-8");

  const updateDeps = {
    env,
    fetchImpl: createFetchSequence(
      createResponse({ body: { results: [{ group: "completed", id: "state-2", name: "Done" }] } }),
      createResponse({ body: { results: [{ id: "label-2", name: "done" }] } }),
      createResponse({
        body: { id: "issue-1", project__identifier: "APP", sequence_id: 9, name: "Updated" },
      }),
    ).fetchImpl,
  };
  assert.deepEqual(
    await plane.handleAction(
      {
        action: "update",
        id: "issue-1",
        patch: {
          labels: ["done"],
          state: "Done",
          title: "Updated",
        },
      },
      updateDeps,
    ),
    {
      action: "update",
      id: "issue-1",
      issue_key: "APP-9",
      ok: true,
      title: "Updated",
      url: "https://plane.example/workspace/browse/APP-9",
    },
  );
});

test("handleAction validates malformed or unsupported action input", async () => {
  await assert.rejects(() => plane.handleAction([]), /must be a JSON object/);
  await assert.rejects(
    () =>
      plane.handleAction(
        { action: "create" },
        {
          env: {
            PLANE_API_KEY: "token",
            PLANE_BASE_URL: "https://plane.example",
            PLANE_PROJECT_ID: "APP",
            PLANE_WORKSPACE_SLUG: "workspace",
          },
        },
      ),
    /requires a title/,
  );
  await assert.rejects(
    () =>
      plane.handleAction(
        { action: "update", id: "issue-1" },
        {
          env: {
            PLANE_API_KEY: "token",
            PLANE_BASE_URL: "https://plane.example",
            PLANE_PROJECT_ID: "APP",
            PLANE_WORKSPACE_SLUG: "workspace",
          },
        },
      ),
    /requires a patch object/,
  );
  await assert.rejects(
    () =>
      plane.handleAction(
        { action: "update", patch: {} },
        {
          env: {
            PLANE_API_KEY: "token",
            PLANE_BASE_URL: "https://plane.example",
            PLANE_PROJECT_ID: "APP",
            PLANE_WORKSPACE_SLUG: "workspace",
          },
        },
      ),
    /requires an id/,
  );
  await assert.rejects(() => plane.handleAction({ action: "archive" }), /Unsupported action/);
  await assert.rejects(() => plane.handleAction({}), /Unsupported action/);
});

test("resource list helpers return plain arrays", async () => {
  const env = {
    PLANE_API_KEY: "token",
    PLANE_BASE_URL: "https://plane.example",
  };
  const fetchImpl = createFetchSequence(
    createResponse({ body: { results: [{ id: "project-1" }] } }),
    createResponse({ body: [{ id: "state-1" }] }),
    createResponse({ body: { results: [{ id: "cycle-1" }] } }),
    createResponse({ body: { results: [{ id: "module-1" }] } }),
    createResponse({ body: { results: [{ id: "label-1", name: "claw_inbox" }] } }),
  ).fetchImpl;

  assert.deepEqual(await plane.listProjects("workspace", { env, fetchImpl }), [
    { id: "project-1" },
  ]);
  assert.deepEqual(await plane.listStates("workspace", "project", { env, fetchImpl }), [
    { id: "state-1" },
  ]);
  assert.deepEqual(await plane.listCycles("workspace", "project", { env, fetchImpl }), [
    { id: "cycle-1" },
  ]);
  assert.deepEqual(await plane.listModules("workspace", "project", { env, fetchImpl }), [
    { id: "module-1" },
  ]);
  assert.deepEqual(await plane.listLabels("workspace", "project", { env, fetchImpl }), [
    { id: "label-1", name: "claw_inbox" },
  ]);
});

test("resource list helpers also accept direct array payloads", async () => {
  const env = {
    PLANE_API_KEY: "token",
    PLANE_BASE_URL: "https://plane.example",
  };
  const fetchImpl = createFetchSequence(
    createResponse({ body: [{ id: "project-1" }] }),
    createResponse({ body: [{ id: "issue-1", sequence_id: 1 }] }),
    createResponse({ body: [{ id: "state-1" }] }),
    createResponse({ body: [{ id: "cycle-1" }] }),
    createResponse({ body: [{ id: "module-1" }] }),
    createResponse({ body: [{ id: "label-1" }] }),
  ).fetchImpl;

  assert.deepEqual(await plane.listProjects("workspace", { env, fetchImpl }), [
    { id: "project-1" },
  ]);
  assert.deepEqual(await plane.listWorkItems("workspace", "APP", undefined, { env, fetchImpl }), [
    {
      id: "issue-1",
      issue_key: "APP-1",
      sequence_id: 1,
      url: "https://plane.example/workspace/browse/APP-1",
    },
  ]);
  assert.deepEqual(await plane.listStates("workspace", "project", { env, fetchImpl }), [
    { id: "state-1" },
  ]);
  assert.deepEqual(await plane.listCycles("workspace", "project", { env, fetchImpl }), [
    { id: "cycle-1" },
  ]);
  assert.deepEqual(await plane.listModules("workspace", "project", { env, fetchImpl }), [
    { id: "module-1" },
  ]);
  assert.deepEqual(await plane.listLabels("workspace", "project", { env, fetchImpl }), [
    { id: "label-1" },
  ]);
});

test("resource list helpers fall back to empty arrays for non-list payloads", async () => {
  const env = {
    PLANE_API_KEY: "token",
    PLANE_BASE_URL: "https://plane.example",
  };
  const fetchImpl = createFetchSequence(
    createResponse({ body: {} }),
    createResponse({ body: {} }),
    createResponse({ body: {} }),
    createResponse({ body: {} }),
    createResponse({ body: {} }),
    createResponse({ body: {} }),
  ).fetchImpl;

  assert.deepEqual(await plane.listProjects("workspace", { env, fetchImpl }), []);
  assert.deepEqual(
    await plane.listWorkItems("workspace", "APP", undefined, { env, fetchImpl }),
    [],
  );
  assert.deepEqual(await plane.listStates("workspace", "project", { env, fetchImpl }), []);
  assert.deepEqual(await plane.listCycles("workspace", "project", { env, fetchImpl }), []);
  assert.deepEqual(await plane.listModules("workspace", "project", { env, fetchImpl }), []);
  assert.deepEqual(await plane.listLabels("workspace", "project", { env, fetchImpl }), []);
});

test("checkVersion reports success, auth failure, missing API, network failure, and fallback", async () => {
  const env = {
    PLANE_API_KEY: "token",
    PLANE_BASE_URL: "https://plane.example",
    PLANE_WORKSPACE_SLUG: "workspace",
  };

  const success = await plane.checkVersion({
    env,
    fetchImpl: createFetchSequence(createResponse()).fetchImpl,
  });
  assert.equal(success.v1_api_available, true);
  assert.equal(success.api_key_auth_working, true);

  const authFailure = await plane.checkVersion({
    env,
    fetchImpl: createFetchSequence(createResponse({ status: 401, statusText: "Unauthorized" }))
      .fetchImpl,
  });
  assert.equal(authFailure.v1_api_available, true);
  assert.match(authFailure.message, /auth failed/);

  const notFound = await plane.checkVersion({
    env,
    fetchImpl: createFetchSequence(
      createResponse({ status: 404, statusText: "Not Found" }),
      createResponse({ status: 404, statusText: "Not Found" }),
    ).fetchImpl,
  });
  assert.match(notFound.message, /v1 API not found/);

  const networkFailure = await plane.checkVersion({
    env,
    fetchImpl: createFetchSequence(new Error("dial tcp failed"), new Error("dial tcp failed"))
      .fetchImpl,
  });
  assert.match(networkFailure.message, /Connection error/);

  const unexpectedFailure = await plane.checkVersion({
    env,
    fetchImpl: createFetchSequence(createResponse({ status: 500, statusText: "" })).fetchImpl,
  });
  assert.match(unexpectedFailure.message, /Unexpected error while probing/);

  const stringFailure = await plane.checkVersion({
    env,
    fetchImpl: async () => {
      throw "socket closed";
    },
  });
  assert.match(stringFailure.message, /socket closed/);

  const unableToVerify = await plane.checkVersion({
    env: { PLANE_API_KEY: "token", PLANE_BASE_URL: "https://plane.example" },
    fetchImpl: async () => null,
  });
  assert.equal(unableToVerify.message, "Unable to verify API availability");
});

test("checkVersion validates missing fetch implementations", async () => {
  await assert.rejects(
    () =>
      plane.checkVersion({
        env: {
          PLANE_API_KEY: "token",
          PLANE_BASE_URL: "https://plane.example",
        },
        fetchImpl: {},
      }),
    /Fetch implementation not available/,
  );
});

test("checkVersion can use process env and global fetch fallbacks", {
  concurrency: false,
}, async () => {
  const originalFetch = globalThis.fetch;
  process.env.PLANE_API_KEY = "token";
  process.env.PLANE_BASE_URL = "https://plane.example";

  try {
    globalThis.fetch = async () => createResponse();
    const result = await plane.checkVersion();
    assert.equal(result.api_key_auth_working, true);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.PLANE_API_KEY;
    delete process.env.PLANE_BASE_URL;
  }
});

test("parseOptions, parseJsonInput, stdin detection, and stream reads handle edge cases", async () => {
  assert.deepEqual(
    plane.parseOptions(["value", "--workspace", "workspace"], { "--workspace": "workspace" }),
    {
      options: { workspace: "workspace" },
      positionals: ["value"],
    },
  );
  assert.throws(() => plane.parseOptions(["--missing"], {}), /Unknown option/);
  assert.throws(
    () => plane.parseOptions(["--workspace"], { "--workspace": "workspace" }),
    /Missing value/,
  );

  assert.deepEqual(plane.parseJsonInput('{"action":"list"}'), { action: "list" });
  assert.throws(() => plane.parseJsonInput(""), /No JSON input/);
  assert.throws(() => plane.parseJsonInput("{"), /Invalid JSON/);
  assert.throws(() => plane.parseJsonInput("[]"), /must be a JSON object/);

  assert.equal(plane.shouldReadStdin(undefined), false);
  assert.equal(plane.shouldReadStdin({ isTTY: false }), true);
  assert.equal(await plane.readStreamText(undefined), "");

  const readable = createReadable(["hello", " world"]);
  const readPromise = plane.readStreamText(readable);
  readable.start();
  assert.equal(await readPromise, "hello world");

  const bufferReadable = createReadable([Buffer.from("buffered")]);
  const bufferPromise = plane.readStreamText(bufferReadable);
  bufferReadable.start();
  assert.equal(await bufferPromise, "buffered");

  const emptyChunkReadable = createReadable([undefined]);
  const emptyChunkPromise = plane.readStreamText(emptyChunkReadable);
  emptyChunkReadable.start();
  assert.equal(await emptyChunkPromise, "");
});

test("toActionError and helpText expose user-facing output", () => {
  assert.deepEqual(plane.toActionError("list", new Error("boom")), {
    action: "list",
    error: "boom",
    ok: false,
  });
  assert.deepEqual(plane.toActionError("list", "boom"), {
    action: "list",
    error: "boom",
    ok: false,
  });
  assert.match(plane.helpText(), /directly executable with Node and can also be run with Bun/);
});

test("run supports help text, JSON action mode, stdin action mode, subcommands, and CLI errors", async () => {
  const noArgsStdout = createWriter();
  assert.equal(await plane.run([], { stdout: noArgsStdout.output }), 1);
  assert.match(noArgsStdout.read(), /Usage:/);

  const helpStdout = createWriter();
  assert.equal(await plane.run(["--help"], { stdout: helpStdout.output }), 0);

  const actionStdout = createWriter();
  assert.equal(
    await plane.run(["action", '{"action":"list"}'], {
      env: {
        PLANE_API_KEY: "token",
        PLANE_BASE_URL: "https://plane.example",
        PLANE_PROJECT_ID: "APP",
        PLANE_WORKSPACE_SLUG: "workspace",
      },
      fetchImpl: createFetchSequence(createResponse({ body: { results: [] } })).fetchImpl,
      stdout: actionStdout.output,
    }),
    0,
  );
  assert.match(actionStdout.read(), /"ok": true/);

  const actionFailureStdout = createWriter();
  assert.equal(
    await plane.run(["action", '{"action":"create"}'], { stdout: actionFailureStdout.output }),
    1,
  );
  assert.match(actionFailureStdout.read(), /"action": "create"/);

  const invalidJsonStdout = createWriter();
  assert.equal(await plane.run(["action", "{"], { stdout: invalidJsonStdout.output }), 1);
  assert.match(invalidJsonStdout.read(), /"ok": false/);

  const stdinStdout = createWriter();
  assert.equal(
    await plane.run([], {
      env: {
        PLANE_API_KEY: "token",
        PLANE_BASE_URL: "https://plane.example",
        PLANE_PROJECT_ID: "APP",
        PLANE_WORKSPACE_SLUG: "workspace",
      },
      fetchImpl: createFetchSequence(createResponse({ body: { results: [] } })).fetchImpl,
      readStdin: async () => '{"action":"list"}',
      stdin: { isTTY: false },
      stdout: stdinStdout.output,
    }),
    0,
  );
  assert.match(stdinStdout.read(), /"count": 0/);

  const createStdout = createWriter();
  assert.equal(
    await plane.run(
      ["create-work-item", "APP", "Ship", "--priority", "medium", "--description", "Fast"],
      {
        env: {
          PLANE_API_KEY: "token",
          PLANE_BASE_URL: "https://plane.example",
          PLANE_WORKSPACE_SLUG: "workspace",
        },
        fetchImpl: createFetchSequence(createResponse({ body: { id: "issue-1", sequence_id: 11 } }))
          .fetchImpl,
        stdout: createStdout.output,
      },
    ),
    0,
  );
  assert.match(createStdout.read(), /"issue_key": "APP-11"/);

  const checkVersionStdout = createWriter();
  assert.equal(
    await plane.run(["check-version"], {
      env: {
        PLANE_API_KEY: "token",
        PLANE_BASE_URL: "https://plane.example",
      },
      fetchImpl: createFetchSequence(createResponse()).fetchImpl,
      stdout: checkVersionStdout.output,
    }),
    0,
  );
  assert.match(checkVersionStdout.read(), /"v1_api_available": true/);

  const projectsStdout = createWriter();
  assert.equal(
    await plane.run(["projects"], {
      env: {
        PLANE_API_KEY: "token",
        PLANE_BASE_URL: "https://plane.example",
        PLANE_WORKSPACE_SLUG: "workspace",
      },
      fetchImpl: createFetchSequence(createResponse({ body: { results: [{ id: "project-1" }] } }))
        .fetchImpl,
      stdout: projectsStdout.output,
    }),
    0,
  );
  assert.match(projectsStdout.read(), /project-1/);

  const workItemsStdout = createWriter();
  assert.equal(
    await plane.run(["work-items", "APP"], {
      env: {
        PLANE_API_KEY: "token",
        PLANE_BASE_URL: "https://plane.example",
        PLANE_WORKSPACE_SLUG: "workspace",
      },
      fetchImpl: createFetchSequence(createResponse({ body: { results: [] } })).fetchImpl,
      stdout: workItemsStdout.output,
    }),
    0,
  );
  assert.match(workItemsStdout.read(), /\[\]/);

  const statesStdout = createWriter();
  assert.equal(
    await plane.run(["states", "APP"], {
      env: {
        PLANE_API_KEY: "token",
        PLANE_BASE_URL: "https://plane.example",
        PLANE_WORKSPACE_SLUG: "workspace",
      },
      fetchImpl: createFetchSequence(createResponse({ body: [{ id: "state-1" }] })).fetchImpl,
      stdout: statesStdout.output,
    }),
    0,
  );
  assert.match(statesStdout.read(), /state-1/);

  const cyclesStdout = createWriter();
  assert.equal(
    await plane.run(["cycles", "APP"], {
      env: {
        PLANE_API_KEY: "token",
        PLANE_BASE_URL: "https://plane.example",
        PLANE_WORKSPACE_SLUG: "workspace",
      },
      fetchImpl: createFetchSequence(createResponse({ body: { results: [{ id: "cycle-1" }] } }))
        .fetchImpl,
      stdout: cyclesStdout.output,
    }),
    0,
  );
  assert.match(cyclesStdout.read(), /cycle-1/);

  const modulesStdout = createWriter();
  assert.equal(
    await plane.run(["modules", "APP"], {
      env: {
        PLANE_API_KEY: "token",
        PLANE_BASE_URL: "https://plane.example",
        PLANE_WORKSPACE_SLUG: "workspace",
      },
      fetchImpl: createFetchSequence(createResponse({ body: { results: [{ id: "module-1" }] } }))
        .fetchImpl,
      stdout: modulesStdout.output,
    }),
    0,
  );
  assert.match(modulesStdout.read(), /module-1/);

  const createArgError = createWriter();
  assert.equal(await plane.run(["create-work-item", "APP"], { stderr: createArgError.output }), 1);
  assert.match(createArgError.read(), /requires <project_id> <title>/);

  const workItemsArgError = createWriter();
  assert.equal(await plane.run(["work-items"], { stderr: workItemsArgError.output }), 1);
  assert.match(workItemsArgError.read(), /work-items requires <project_id>/);

  const statesArgError = createWriter();
  assert.equal(await plane.run(["states"], { stderr: statesArgError.output }), 1);
  assert.match(statesArgError.read(), /states requires <project_id>/);

  const stderr = createWriter();
  assert.equal(await plane.run(["bogus"], { stderr: stderr.output }), 1);
  assert.match(stderr.read(), /Unknown command/);
});

test("handleAction also supports explicit workspace and project overrides with sparse patches", async () => {
  const createDeps = {
    env: {
      PLANE_API_KEY: "token",
      PLANE_BASE_URL: "https://plane.example",
    },
    fetchImpl: createFetchSequence(
      createResponse({ body: { id: "issue-1", sequence_id: 21, name: "Create override" } }),
    ).fetchImpl,
  };
  assert.deepEqual(
    await plane.handleAction(
      {
        action: "create",
        due: "2026-04-20",
        projectId: "APP",
        title: "Create override",
        workspace: "workspace",
      },
      createDeps,
    ),
    {
      action: "create",
      id: "issue-1",
      issue_key: "APP-21",
      ok: true,
      title: "Create override",
      url: "https://plane.example/workspace/browse/APP-21",
    },
  );

  const listDeps = {
    env: {
      PLANE_API_KEY: "token",
      PLANE_BASE_URL: "https://plane.example",
    },
    fetchImpl: createFetchSequence(createResponse({ body: { results: [] } })).fetchImpl,
  };
  assert.deepEqual(
    await plane.handleAction(
      {
        action: "list",
        projectId: "APP",
        workspace: "workspace",
      },
      listDeps,
    ),
    {
      action: "list",
      count: 0,
      items: [],
      ok: true,
    },
  );

  const updateDeps = {
    env: {
      PLANE_API_KEY: "token",
      PLANE_BASE_URL: "https://plane.example",
    },
    fetchImpl: createFetchSequence(
      createResponse({ body: { id: "issue-2", sequence_id: 22, name: "Updated override" } }),
    ).fetchImpl,
  };
  assert.deepEqual(
    await plane.handleAction(
      {
        action: "update",
        id: "issue-2",
        patch: {
          description: "Some details",
          due: "2026-04-22",
          priority: "medium",
        },
        projectId: "APP",
        workspace: "workspace",
      },
      updateDeps,
    ),
    {
      action: "update",
      id: "issue-2",
      issue_key: "APP-22",
      ok: true,
      title: "Updated override",
      url: "https://plane.example/workspace/browse/APP-22",
    },
  );

  const updateNullDueDeps = {
    env: {
      PLANE_API_KEY: "token",
      PLANE_BASE_URL: "https://plane.example",
    },
    fetchImpl: createFetchSequence((_input, init) => {
      const body = JSON.parse(init.body);
      assert.deepEqual(body, {
        description_html: "",
        label_ids: [],
        name: "",
        priority: "none",
        state_id: null,
        target_date: "",
      });
      return createResponse({ body: { id: "issue-3", sequence_id: 23, name: "Updated override" } });
    }).fetchImpl,
  };
  assert.deepEqual(
    await plane.handleAction(
      {
        action: "update",
        id: "issue-3",
        patch: {
          due: null,
        },
        projectId: "APP",
        workspace: "workspace",
      },
      updateNullDueDeps,
    ),
    {
      action: "update",
      id: "issue-3",
      issue_key: "APP-23",
      ok: true,
      title: "Updated override",
      url: "https://plane.example/workspace/browse/APP-23",
    },
  );
});

test("plane.js is directly executable on Ubuntu-style hosts with Node on PATH", () => {
  const output = execFileSync("./plane.js", ["--help"], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PATH: path.dirname(process.execPath),
    },
    encoding: "utf8",
  });

  assert.match(output, /directly executable with Node and can also be run with Bun/);
});

test("run uses raw stdin streams for action mode when no readStdin helper is supplied", async () => {
  const readable = createReadable(['{"action":"list"}']);
  const stdout = createWriter();
  const promise = plane.run([], {
    env: {
      PLANE_API_KEY: "token",
      PLANE_BASE_URL: "https://plane.example",
      PLANE_PROJECT_ID: "APP",
      PLANE_WORKSPACE_SLUG: "workspace",
    },
    fetchImpl: createFetchSequence(createResponse({ body: { results: [] } })).fetchImpl,
    stdin: readable,
    stdout: stdout.output,
  });

  readable.start();
  assert.equal(await promise, 0);
  assert.match(stdout.read(), /"count": 0/);
});

test("run reports stdin and action parsing failures with the correct action context", async () => {
  const missingActionStdout = createWriter();
  assert.equal(await plane.run(["action", "{}"], { stdout: missingActionStdout.output }), 1);
  assert.match(missingActionStdout.read(), /"error": "Unsupported action: <missing>"/);

  const arrayActionStdout = createWriter();
  assert.equal(await plane.run(["action", "[]"], { stdout: arrayActionStdout.output }), 1);
  assert.match(arrayActionStdout.read(), /"ok": false/);

  const readable = createReadable(["{"]);
  const stdout = createWriter();
  const promise = plane.run([], {
    stdin: readable,
    stdout: stdout.output,
  });
  readable.start();
  assert.equal(await promise, 1);
  assert.match(stdout.read(), /"ok": false/);
});

test("run can use process env fallbacks for subcommands", { concurrency: false }, async () => {
  process.env.PLANE_API_KEY = "token";
  process.env.PLANE_BASE_URL = "https://plane.example";
  process.env.PLANE_WORKSPACE_SLUG = "workspace";

  try {
    const projectsStdout = createWriter();
    assert.equal(
      await plane.run(["projects"], {
        fetchImpl: createFetchSequence(createResponse({ body: [{ id: "project-1" }] })).fetchImpl,
        stdout: projectsStdout.output,
      }),
      0,
    );
    assert.match(projectsStdout.read(), /project-1/);

    const workItemsStdout = createWriter();
    assert.equal(
      await plane.run(["work-items", "APP"], {
        fetchImpl: createFetchSequence(
          createResponse({ body: [{ id: "issue-1", sequence_id: 1 }] }),
        ).fetchImpl,
        stdout: workItemsStdout.output,
      }),
      0,
    );
    assert.match(workItemsStdout.read(), /APP-1/);

    const createStdout = createWriter();
    assert.equal(
      await plane.run(["create-work-item", "APP", "Env title"], {
        fetchImpl: createFetchSequence(createResponse({ body: { id: "issue-1", sequence_id: 3 } }))
          .fetchImpl,
        stdout: createStdout.output,
      }),
      0,
    );
    assert.match(createStdout.read(), /APP-3/);

    const statesStdout = createWriter();
    assert.equal(
      await plane.run(["states", "APP"], {
        fetchImpl: createFetchSequence(createResponse({ body: [{ id: "state-1" }] })).fetchImpl,
        stdout: statesStdout.output,
      }),
      0,
    );
    assert.match(statesStdout.read(), /state-1/);
  } finally {
    delete process.env.PLANE_API_KEY;
    delete process.env.PLANE_BASE_URL;
    delete process.env.PLANE_WORKSPACE_SLUG;
  }
});

test("run writes Plane API bodies and generic thrown values to stderr", async () => {
  const planeErrorStderr = createWriter();
  assert.equal(
    await plane.run(["projects"], {
      env: {
        PLANE_API_KEY: "token",
        PLANE_BASE_URL: "https://plane.example",
        PLANE_WORKSPACE_SLUG: "workspace",
      },
      fetchImpl: createFetchSequence(
        createResponse({
          body: { detail: "unauthorized" },
          status: 401,
          statusText: "Unauthorized",
        }),
      ).fetchImpl,
      stderr: planeErrorStderr.output,
    }),
    1,
  );
  assert.match(planeErrorStderr.read(), /unauthorized/);

  const genericErrorStderr = createWriter();
  assert.equal(
    await plane.run(["--help"], {
      stderr: genericErrorStderr.output,
      stdout: {
        write() {
          throw new Error("stdout exploded");
        },
      },
    }),
    1,
  );
  assert.match(genericErrorStderr.read(), /stdout exploded/);

  const valueErrorStderr = createWriter();
  assert.equal(
    await plane.run(["--help"], {
      stderr: valueErrorStderr.output,
      stdout: {
        write() {
          throw "stdout value";
        },
      },
    }),
    1,
  );
  assert.match(valueErrorStderr.read(), /stdout value/);
});
