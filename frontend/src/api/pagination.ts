export interface PageParams {
  limit?: number;
  cursor?: string;
}
export function queryString(params: object) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== null && value !== "")
      query.set(key, String(value));
  return query.size ? `?${query}` : "";
}
