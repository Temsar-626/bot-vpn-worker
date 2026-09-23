// BPB Cloudflare REST client (Workers + KV).
// Pure REST with Bearer token — no dependency on the BPB panel cookie login.
// `fetchFn` is injectable for tests (defaults to globalThis.fetch).
// Never log the raw token; errors carry short codes only.

const CF_BASE = "https://api.cloudflare.com/client/v4";

function err(code, extra = {}) {
  const e = new Error(code);
  e.status = extra.status || 502;
  e.remoteStatus = extra.remoteStatus || 0;
  e.uncertain = !!extra.uncertain;
  return e;
}

async function cfFetch(fetchFn, token, path, { method = "GET", body, json, form } = {}) {
  const headers = { authorization: "Bearer " + token };
  let payload;
  if (form) {
    payload = form;
  } else if (json !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(json);
  } else if (body !== undefined) {
    payload = body;
  }
  let res;
  try {
    res = await fetchFn(CF_BASE + path, {
      method,
      headers,
      ...(payload === undefined ? {} : { body: payload }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw err("provider_network_error", { uncertain: method !== "GET" });
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    throw err("provider_response_incomplete", { uncertain: method !== "GET" });
  }
  if (!res.ok || data?.success === false) {
    const status = res.status || 502;
    if (status === 401 || status === 403) throw err("provider_auth_failed", { status: 502, remoteStatus: status });
    throw err(`provider_http_${status}`, { status: 502, remoteStatus: status, uncertain: status >= 500 });
  }
  return data?.result ?? data;
}

export async function verifyToken(token, fetchFn = globalThis.fetch) {
  if (!token || typeof token !== "string" || token.length < 10) throw err("invalid_cf_token", { status: 400 });
  const [verify, accounts, user] = await Promise.all([
    cfFetch(fetchFn, token, "/user/tokens/verify"),
    cfFetch(fetchFn, token, "/accounts"),
    cfFetch(fetchFn, token, "/user"),
  ]);
  if (verify?.status && verify.status !== "active") throw err("cf_token_not_active", { status: 400 });
  const list = Array.isArray(accounts) ? accounts : accounts?.result || [];
  const accountId = list[0]?.id || accounts?.[0]?.id;
  if (!accountId) throw err("cf_account_not_found", { status: 400 });
  const email = String(user?.email || "").toLowerCase();
  return { accountId, email };
}

export async function createKvNamespace(token, accountId, title, fetchFn = globalThis.fetch) {
  const result = await cfFetch(fetchFn, token, `/accounts/${accountId}/storage/kv/namespaces`, {
    method: "POST",
    json: { title: String(title).slice(0, 128) },
  });
  if (!result?.id) throw err("cf_kv_create_failed");
  return result.id;
}

export async function getWorkersDevSubdomain(token, accountId, fetchFn = globalThis.fetch) {
  const result = await cfFetch(fetchFn, token, `/accounts/${accountId}/workers/subdomain`);
  const sub = result?.subdomain;
  if (!sub) throw err("cf_subdomain_missing");
  return `${sub}.workers.dev`;
}

export async function createWorkersDevSubdomain(token, accountId, subdomain, fetchFn = globalThis.fetch) {
  const result = await cfFetch(
    fetchFn,
    token,
    `/accounts/${accountId}/workers/subdomain`,
    { method: "PUT", json: { subdomain } },
  );
  if (!result?.subdomain) throw err("cf_subdomain_create_failed");
  return result.subdomain;
}

export async function ensureWorkersDevSubdomain(token, accountId, randSubdomain, fetchFn = globalThis.fetch) {
  try {
    return await getWorkersDevSubdomain(token, accountId, fetchFn);
  } catch {
    // Fresh account without subdomain — try a few random names.
    let lastError;
    for (let i = 0; i < 3; i++) {
      try {
        const created = await createWorkersDevSubdomain(token, accountId, randSubdomain(), fetchFn);
        return `${created}.workers.dev`;
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError || err("cf_subdomain_create_failed");
  }
}

export async function workerNameTaken(token, accountId, name, fetchFn = globalThis.fetch) {
  try {
    await cfFetch(fetchFn, token, `/accounts/${accountId}/workers/scripts/${encodeURIComponent(name)}`);
    return true;
  } catch (e) {
    if (e.message === "provider_auth_failed") throw e;
    return false;
  }
}

export async function deployWorker(token, accountId, workerName, scriptText, namespaceId, fetchFn = globalThis.fetch) {
  const date = new Date().toISOString().slice(0, 10);
  const metadata = {
    main_module: "worker.js",
    compatibility_date: date,
    compatibility_flags: ["nodejs_compat"],
    bindings: [{ type: "kv_namespace", name: "kv", namespace_id: namespaceId }],
  };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("worker.js", new Blob([scriptText], { type: "application/javascript+module" }), "worker.js");
  // Multipart upload must go through raw fetch (not cfFetch JSON helper).
  let res;
  try {
    res = await fetchFn(
      `${CF_BASE}/accounts/${accountId}/workers/scripts/${encodeURIComponent(workerName)}`,
      {
        method: "PUT",
        headers: { authorization: "Bearer " + token },
        body: form,
        signal: AbortSignal.timeout(30000),
      },
    );
  } catch {
    throw err("provider_network_error", { uncertain: true });
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    throw err("provider_response_incomplete", { uncertain: true });
  }
  if (!res.ok || data?.success === false) {
    const status = res.status || 502;
    if (status === 401 || status === 403) throw err("provider_auth_failed", { remoteStatus: status });
    throw err(`provider_http_${status}`, { remoteStatus: status, uncertain: status >= 500 });
  }
  return true;
}

export async function enableWorkerSubdomain(token, accountId, workerName, fetchFn = globalThis.fetch) {
  await cfFetch(fetchFn, token, `/accounts/${accountId}/workers/scripts/${encodeURIComponent(workerName)}/subdomain`, {
    method: "POST",
    json: { enabled: true, previews_enabled: true },
  });
  return true;
}

export async function deleteWorker(token, accountId, workerName, fetchFn = globalThis.fetch) {
  try {
    await cfFetch(fetchFn, token, `/accounts/${accountId}/workers/scripts/${encodeURIComponent(workerName)}`, {
      method: "DELETE",
    });
  } catch (e) {
    // Already gone is fine.
    if (!String(e.message).includes("provider_http_404")) throw e;
  }
  return true;
}

export async function kvWrite(token, accountId, namespaceId, key, value, fetchFn = globalThis.fetch) {
  await cfFetch(
    fetchFn,
    token,
    `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
    { method: "PUT", body: String(value) },
  );
  return true;
}

export async function kvRead(token, accountId, namespaceId, key, fetchFn = globalThis.fetch) {
  // KV value reads return raw text, not JSON — use raw fetch here.
  let res;
  try {
    res = await fetchFn(
      `${CF_BASE}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
      { headers: { authorization: "Bearer " + token }, signal: AbortSignal.timeout(15000) },
    );
  } catch {
    throw err("provider_network_error");
  }
  if (res.status === 404) return null;
  if (!res.ok) throw err(`provider_http_${res.status}`, { remoteStatus: res.status });
  return res.text();
}

export const CF_BASE_URL = CF_BASE;
