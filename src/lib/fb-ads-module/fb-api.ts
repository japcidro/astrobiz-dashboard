// ============================================
// Facebook Ads Module — Core API Functions
// No framework dependencies — works with any Next.js/Node.js project
// Just needs: a Facebook access token and ad account ID
// ============================================

const FB_API_VERSION = "v21.0";
const FB_API_BASE = `https://graph.facebook.com/${FB_API_VERSION}`;

/**
 * POST to Facebook Graph API with form-urlencoded body.
 * Throws on error with detailed FB error message.
 */
export async function fbPost(
  endpoint: string,
  token: string,
  params: Record<string, string>
): Promise<Record<string, unknown>> {
  const res = await fetch(`${FB_API_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ access_token: token, ...params }).toString(),
  });

  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Invalid FB response: ${text.slice(0, 300)}`);
  }

  if (!res.ok) {
    const fbErr = json.error as Record<string, unknown> | undefined;
    const msg =
      (fbErr?.error_user_msg as string) ||
      (fbErr?.message as string) ||
      `FB API error: ${res.status}`;
    const detail = fbErr?.error_user_title
      ? `${fbErr.error_user_title}: ${msg}`
      : msg;
    throw new Error(
      `${detail} [endpoint: ${endpoint}, code: ${fbErr?.code}, subcode: ${fbErr?.error_subcode}]`
    );
  }
  return json;
}

/**
 * GET from Facebook Graph API.
 */
export async function fbGet(
  endpoint: string,
  token: string,
  params?: Record<string, string>
): Promise<Record<string, unknown>> {
  const urlParams = new URLSearchParams({ access_token: token, ...params });
  const res = await fetch(`${FB_API_BASE}${endpoint}?${urlParams}`, {
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok) {
    const fbErr = json.error as Record<string, unknown> | undefined;
    throw new Error(
      (fbErr?.message as string) || `FB API error: ${res.status}`
    );
  }
  return json;
}

/**
 * Upload an image to Facebook from the server side.
 * Returns the image hash.
 */
export async function uploadImageServer(
  adAccountId: string,
  token: string,
  imageUrl: string
): Promise<string> {
  const result = await fbPost(`/${adAccountId}/adimages`, token, {
    url: imageUrl,
  });
  const images = result.images as Record<string, { hash: string }>;
  const firstKey = Object.keys(images)[0];
  return images[firstKey].hash;
}

/**
 * Upload an image to Facebook from the browser (client-side).
 * File goes directly to FB, bypasses your server.
 */
export async function uploadImageClient(
  file: File,
  adAccountId: string,
  token: string
): Promise<{ image_hash: string; url: string }> {
  const form = new FormData();
  form.append("access_token", token);
  form.append("filename", file);
  const res = await fetch(`${FB_API_BASE}/${adAccountId}/adimages`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(
      err?.error?.message || `Image upload failed: ${res.status}`
    );
  }
  const json = await res.json();
  const images = json.images as Record<string, { hash: string; url: string }>;
  const firstKey = Object.keys(images)[0];
  return { image_hash: images[firstKey].hash, url: images[firstKey].url };
}

/**
 * Upload a video to Facebook from the browser (client-side).
 * File goes directly to FB, bypasses your server.
 */
export async function uploadVideoClient(
  file: File,
  adAccountId: string,
  token: string
): Promise<{ video_id: string }> {
  const form = new FormData();
  form.append("access_token", token);
  form.append("source", file);
  form.append("title", file.name);
  const res = await fetch(`${FB_API_BASE}/${adAccountId}/advideos`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(
      err?.error?.message || `Video upload failed: ${res.status}`
    );
  }
  const json = await res.json();
  return { video_id: json.id as string };
}

/**
 * Auto-detect file type and upload to Facebook.
 */
export async function uploadFileClient(
  file: File,
  adAccountId: string,
  token: string
): Promise<{ image_hash?: string; video_id?: string }> {
  if (file.type.startsWith("video/")) {
    return uploadVideoClient(file, adAccountId, token);
  }
  const result = await uploadImageClient(file, adAccountId, token);
  return { image_hash: result.image_hash };
}
