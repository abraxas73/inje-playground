export function logAction(
  action: string,
  category: string,
  detail?: Record<string, unknown>
) {
  fetch("/api/action-history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, category, detail }),
  }).catch(() => {});
}
