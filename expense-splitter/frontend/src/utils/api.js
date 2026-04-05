const BASE = "http://localhost:8000";

export async function api(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "API error");
  }
  return res.json();
}

export const get = (p) => api(p);
export const post = (p, body) => api(p, { method: "POST", body: JSON.stringify(body) });
export const patch = (p, body) => api(p, { method: "PATCH", body: JSON.stringify(body) });
export const del = (p) => api(p, { method: "DELETE" });