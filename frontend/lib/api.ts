// Types mirror backend/app/models/{food,user}.py exactly. Keep in sync.

export type Nutrient = {
  energy_kcal: number;
  fat: number;
  saturated_fat: number;
  carbohydrates: number;
  sugars: number;
  fiber: number;
  proteins: number;
  sodium: number;
};

export type ProductSummary = {
  barcode: string;
  name: string;
  brand: string | null;
  image_url: string | null;
  nutri_score: string | null;
  nova_group: number | null;
  score: number;
};

export type ScoreFactor = {
  factor: string;
  impact: number;
  reason: string;
};

export type Alternative = {
  barcode: string;
  name: string;
  brand: string | null;
  score: number;
  image_url: string | null;
  amazon_url: string | null;
};

export type FoodResult = {
  barcode: string;
  name: string;
  brand: string | null;
  image_url: string | null;
  nutri_score: string | null;
  nova_group: number | null;
  nutrients: Nutrient;
  score: number;
  score_label: string;
  score_breakdown: ScoreFactor[];
  alternatives: Alternative[];
  body_impact: string | null;
  personalized: boolean;
};

export type SearchResponse = {
  products: ProductSummary[];
  total: number;
  page: number;
};

export type Category = {
  slug: string;
  label: string;
  icon: string;
};

export type ProfileResponse = {
  health_conditions: string[];
};

export type HistoryItem = {
  id: string;
  barcode: string | null;
  product_name: string;
  brand: string | null;
  image_url: string | null;
  score: number;
  scanned_at: string;
};

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type FetchOptions = {
  token?: string;
  signal?: AbortSignal;
};

async function request<T>(
  path: string,
  init: RequestInit & FetchOptions = {},
): Promise<T> {
  const { token, signal, headers, ...rest } = init;
  const res = await fetch(`${BASE_URL}${path}`, {
    ...rest,
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });
  if (!res.ok) {
    throw new Error(`API ${res.status} on ${path}`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export type SearchParams = {
  q?: string;
  category?: string;
  page?: number;
  min_score?: number;
  safe_for?: string[];
  nutri_score?: string[];
  nova_group?: number[];
};

function buildQuery(params: SearchParams): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.category) sp.set("category", params.category);
  if (params.page) sp.set("page", String(params.page));
  if (params.min_score !== undefined) sp.set("min_score", String(params.min_score));
  for (const v of params.safe_for ?? []) sp.append("safe_for", v);
  for (const v of params.nutri_score ?? []) sp.append("nutri_score", v);
  for (const v of params.nova_group ?? []) sp.append("nova_group", String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export function searchFoods(
  params: SearchParams,
  opts: FetchOptions = {},
): Promise<SearchResponse> {
  return request<SearchResponse>(`/api/food/search${buildQuery(params)}`, opts);
}

// TODO(auth): pass `token` from server component via supabase-server.ts session
//   to receive personalized scoring when the user is logged in.
export function getFoodByBarcode(
  barcode: string,
  opts: FetchOptions = {},
): Promise<FoodResult> {
  return request<FoodResult>(`/api/food/barcode/${encodeURIComponent(barcode)}`, opts);
}

export async function getCategories(opts: FetchOptions = {}): Promise<Category[]> {
  const res = await request<{ categories: Category[] }>("/api/food/categories", opts);
  return res.categories;
}

// TODO(auth): caller must supply `token` via opts (auth-required endpoint)
export function getProfile(opts: FetchOptions = {}): Promise<ProfileResponse> {
  return request<ProfileResponse>("/api/profile", opts);
}

// TODO(auth): caller must supply `token` via opts (auth-required endpoint)
export function updateProfile(
  health_conditions: string[],
  opts: FetchOptions = {},
): Promise<ProfileResponse> {
  return request<ProfileResponse>("/api/profile", {
    ...opts,
    method: "PUT",
    body: JSON.stringify({ health_conditions }),
  });
}

// TODO(auth): caller must supply `token` via opts (auth-required endpoint)
export async function getHistory(opts: FetchOptions = {}): Promise<HistoryItem[]> {
  const res = await request<{ items: HistoryItem[] }>("/api/history", opts);
  return res.items;
}

// TODO(auth): caller must supply `token` via opts (auth-required endpoint)
export function clearHistory(opts: FetchOptions = {}): Promise<void> {
  return request<void>("/api/history", { ...opts, method: "DELETE" });
}
