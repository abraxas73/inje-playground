const NLM_SERVICE_URL = process.env.NLM_SERVICE_URL || "http://localhost:8090";

export async function nlmFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${NLM_SERVICE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `NLM service error: ${res.status}`);
  }
  return res.json();
}
