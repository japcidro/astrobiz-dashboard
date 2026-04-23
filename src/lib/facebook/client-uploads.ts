// Client-side Facebook creative upload helpers.
// Previously lived inside ad-rows-table.tsx. Extracted so the Approved Library
// (and any other launch-adjacent UI) can upload creatives the same way.

const FB_API_BASE = "https://graph.facebook.com/v21.0";

export async function fetchFbToken(): Promise<string> {
  const res = await fetch("/api/facebook/token");
  if (!res.ok) throw new Error("Failed to fetch token");
  const { token } = await res.json();
  return token;
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt === retries) throw e;
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
  throw new Error("Max retries reached");
}

export async function uploadImageToFb(
  file: File,
  adAccountId: string,
  token: string
): Promise<{ image_hash: string }> {
  return withRetry(async () => {
    const form = new FormData();
    form.append("access_token", token);
    form.append("filename", file);
    const res = await fetch(`${FB_API_BASE}/${adAccountId}/adimages`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        (err as Record<string, Record<string, string>>)?.error?.message ||
          `Image upload failed (${res.status})`
      );
    }
    const json = await res.json();
    const firstKey = Object.keys(json.images)[0];
    return { image_hash: json.images[firstKey].hash };
  });
}

export async function uploadVideoToFb(
  file: File,
  adAccountId: string,
  token: string
): Promise<{ video_id: string }> {
  const fileSizeMB = file.size / (1024 * 1024);

  if (fileSizeMB > 10) {
    return uploadVideoChunked(file, adAccountId, token);
  }

  return withRetry(async () => {
    const form = new FormData();
    form.append("access_token", token);
    form.append("source", file);
    form.append("title", file.name);
    const res = await fetch(`${FB_API_BASE}/${adAccountId}/advideos`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        (err as Record<string, Record<string, string>>)?.error?.message ||
          `Video upload failed (${res.status})`
      );
    }
    const json = await res.json();
    return { video_id: json.id };
  });
}

async function uploadVideoChunked(
  file: File,
  adAccountId: string,
  token: string
): Promise<{ video_id: string }> {
  const startForm = new FormData();
  startForm.append("access_token", token);
  startForm.append("upload_phase", "start");
  startForm.append("file_size", file.size.toString());

  const startRes = await fetch(`${FB_API_BASE}/${adAccountId}/advideos`, {
    method: "POST",
    body: startForm,
  });
  if (!startRes.ok)
    throw new Error(`Chunked upload start failed (${startRes.status})`);
  const startJson = await startRes.json();
  const uploadSessionId = startJson.upload_session_id;
  const videoId = startJson.video_id;

  const CHUNK_SIZE = 4 * 1024 * 1024;
  let offset = 0;

  while (offset < file.size) {
    const chunk = file.slice(offset, offset + CHUNK_SIZE);
    const chunkForm = new FormData();
    chunkForm.append("access_token", token);
    chunkForm.append("upload_phase", "transfer");
    chunkForm.append("upload_session_id", uploadSessionId);
    chunkForm.append("start_offset", offset.toString());
    chunkForm.append("video_file_chunk", chunk);

    const chunkRes = await withRetry(async () => {
      const res = await fetch(`${FB_API_BASE}/${adAccountId}/advideos`, {
        method: "POST",
        body: chunkForm,
      });
      if (!res.ok) throw new Error(`Chunk upload failed at offset ${offset}`);
      return res;
    });

    const chunkJson = await chunkRes.json();
    offset = parseInt(chunkJson.start_offset || offset + CHUNK_SIZE);
  }

  const finishForm = new FormData();
  finishForm.append("access_token", token);
  finishForm.append("upload_phase", "finish");
  finishForm.append("upload_session_id", uploadSessionId);
  finishForm.append("title", file.name);

  const finishRes = await fetch(`${FB_API_BASE}/${adAccountId}/advideos`, {
    method: "POST",
    body: finishForm,
  });
  if (!finishRes.ok) throw new Error("Chunked upload finish failed");

  return { video_id: videoId };
}
