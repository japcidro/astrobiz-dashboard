const FB_API_BASE = "https://graph.facebook.com/v21.0";

export interface AdVideoRef {
  ad_id: string;
  creative_id: string | null;
  video_id: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  source_note: string;
}

async function fbGet<T>(path: string, token: string): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(
    `${FB_API_BASE}${path}${sep}access_token=${encodeURIComponent(token)}`,
    { cache: "no-store" }
  );
  const json = await res.json();
  if (!res.ok) {
    const msg =
      (json?.error?.message as string) || `FB API error ${res.status}`;
    throw new Error(msg);
  }
  return json as T;
}

// Walks through ad → creative → (video_id | object_story) to find a playable
// video. Returns { video_url: null } if the ad is an image-only ad or if FB
// refused to expose the video source (can happen with some dark posts).
export async function resolveAdVideo(
  adId: string,
  token: string
): Promise<AdVideoRef> {
  // 1. Get the creative attached to the ad
  type CreativeResp = {
    creative?: {
      id?: string;
      video_id?: string | null;
      thumbnail_url?: string | null;
      effective_object_story_id?: string | null;
      object_type?: string | null;
      asset_feed_spec?: {
        videos?: Array<{ video_id?: string; thumbnail_url?: string }>;
      } | null;
    };
  };

  const creative = await fbGet<CreativeResp>(
    `/${adId}?fields=creative{id,video_id,thumbnail_url,effective_object_story_id,object_type,asset_feed_spec}`,
    token
  );

  const cr = creative.creative ?? {};
  const creative_id = cr.id ?? null;
  let video_id: string | null = cr.video_id ?? null;
  let thumbnail_url = cr.thumbnail_url ?? null;

  // 2. If not on creative directly, try asset_feed_spec (used in DCO / multi-asset ads)
  if (!video_id && cr.asset_feed_spec?.videos?.length) {
    const first = cr.asset_feed_spec.videos[0];
    video_id = first.video_id ?? null;
    thumbnail_url = thumbnail_url ?? first.thumbnail_url ?? null;
  }

  // 3. If still nothing, walk the object story (post)
  if (!video_id && cr.effective_object_story_id) {
    try {
      type PostResp = {
        attachments?: {
          data?: Array<{
            media_type?: string;
            target?: { id?: string };
            subattachments?: {
              data?: Array<{
                media_type?: string;
                target?: { id?: string };
              }>;
            };
          }>;
        };
      };
      const post = await fbGet<PostResp>(
        `/${cr.effective_object_story_id}?fields=attachments{media_type,target,subattachments}`,
        token
      );
      const walk = (
        items?: Array<{ media_type?: string; target?: { id?: string } }>
      ): string | null => {
        for (const a of items ?? []) {
          if (a.media_type === "video" && a.target?.id) return a.target.id;
        }
        return null;
      };
      const top = post.attachments?.data ?? [];
      video_id = walk(top);
      if (!video_id) {
        for (const a of top) {
          const sub = a.subattachments?.data;
          const found = walk(sub);
          if (found) {
            video_id = found;
            break;
          }
        }
      }
    } catch {
      // Ignore — some posts are not accessible via Graph
    }
  }

  if (!video_id) {
    return {
      ad_id: adId,
      creative_id,
      video_id: null,
      video_url: null,
      thumbnail_url,
      source_note:
        "No video found on this ad — may be an image-only ad or the creative does not expose video assets.",
    };
  }

  // 4. Resolve video source URL
  try {
    type VideoResp = {
      source?: string | null;
      permalink_url?: string | null;
    };
    const video = await fbGet<VideoResp>(
      `/${video_id}?fields=source,permalink_url`,
      token
    );
    return {
      ad_id: adId,
      creative_id,
      video_id,
      video_url: video.source ?? null,
      thumbnail_url,
      source_note: video.source
        ? "ok"
        : "Facebook did not return a video source URL for this ad (dark post or restricted).",
    };
  } catch (err) {
    return {
      ad_id: adId,
      creative_id,
      video_id,
      video_url: null,
      thumbnail_url,
      source_note: `Video metadata fetch failed: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}
