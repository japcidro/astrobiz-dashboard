const FB_API_BASE = "https://graph.facebook.com/v21.0";

export interface AdVideoRef {
  ad_id: string;
  creative_id: string | null;
  video_id: string | null;
  video_url: string | null;
  thumbnail_url: string | null;
  source_note: string;
  // Debug breadcrumbs — which lookup path did we try + what did FB say.
  attempts: string[];
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

// Walks through every place Meta can put a video ID on an ad creative.
// Ads built via different tools nest the video differently, so we check
// them all in descending-likelihood order. Returns video_url=null only
// if none of the paths yield a playable video.
export async function resolveAdVideo(
  adId: string,
  token: string
): Promise<AdVideoRef> {
  const attempts: string[] = [];

  type StorySpecVideoData = {
    video_id?: string | null;
    image_url?: string | null;
    image_hash?: string | null;
  };
  type ChildAttachment = {
    video_data?: StorySpecVideoData;
    link_data?: { video_id?: string | null };
  };
  type ObjectStorySpec = {
    video_data?: StorySpecVideoData;
    link_data?: {
      video_id?: string | null;
      child_attachments?: ChildAttachment[];
    };
  };
  type AssetFeedSpec = {
    videos?: Array<{
      video_id?: string;
      thumbnail_url?: string;
      thumbnail_hash?: string;
    }>;
  };
  type CreativeResp = {
    creative?: {
      id?: string;
      video_id?: string | null;
      thumbnail_url?: string | null;
      effective_object_story_id?: string | null;
      object_type?: string | null;
      asset_feed_spec?: AssetFeedSpec | null;
      object_story_spec?: ObjectStorySpec | null;
    };
  };

  let creative: CreativeResp["creative"] | undefined;
  try {
    const res = await fbGet<CreativeResp>(
      `/${adId}?fields=creative{id,video_id,thumbnail_url,effective_object_story_id,object_type,asset_feed_spec,object_story_spec}`,
      token
    );
    creative = res.creative;
  } catch (err) {
    return {
      ad_id: adId,
      creative_id: null,
      video_id: null,
      video_url: null,
      thumbnail_url: null,
      attempts: [`creative fetch failed: ${(err as Error).message}`],
      source_note: `Could not read ad creative from Facebook: ${(err as Error).message}`,
    };
  }

  const cr = creative ?? {};
  const creative_id = cr.id ?? null;
  let video_id: string | null = null;
  let thumbnail_url = cr.thumbnail_url ?? null;

  // 1. Direct video_id on the creative (legacy direct-video ads).
  if (cr.video_id) {
    video_id = cr.video_id;
    attempts.push("creative.video_id");
  }

  // 2. object_story_spec.video_data.video_id — THE most common path for
  //    ads created in Ads Manager with a video creative.
  if (!video_id && cr.object_story_spec?.video_data?.video_id) {
    video_id = cr.object_story_spec.video_data.video_id;
    attempts.push("object_story_spec.video_data.video_id");
  }

  // 3. object_story_spec.link_data.video_id — link ads that carry a video.
  if (!video_id && cr.object_story_spec?.link_data?.video_id) {
    video_id = cr.object_story_spec.link_data.video_id;
    attempts.push("object_story_spec.link_data.video_id");
  }

  // 4. object_story_spec.link_data.child_attachments — carousel ads.
  //    Pick the first attachment that carries a video.
  if (!video_id) {
    const children = cr.object_story_spec?.link_data?.child_attachments ?? [];
    for (const child of children) {
      const vId =
        child?.video_data?.video_id ?? child?.link_data?.video_id ?? null;
      if (vId) {
        video_id = vId;
        attempts.push("object_story_spec.link_data.child_attachments[*]");
        break;
      }
    }
  }

  // 5. asset_feed_spec.videos[0] — DCO / Advantage+ multi-asset ads.
  if (!video_id && cr.asset_feed_spec?.videos?.length) {
    const first = cr.asset_feed_spec.videos[0];
    if (first.video_id) {
      video_id = first.video_id;
      attempts.push("asset_feed_spec.videos[0]");
    }
    thumbnail_url = thumbnail_url ?? first.thumbnail_url ?? null;
  }

  // 6. Last resort — walk the attached post's attachments to find a video.
  if (!video_id && cr.effective_object_story_id) {
    attempts.push(
      `walk effective_object_story_id=${cr.effective_object_story_id}`
    );
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
    } catch (err) {
      attempts.push(`object_story walk failed: ${(err as Error).message}`);
    }
  }

  if (!video_id) {
    const tried = attempts.join(" → ") || "no paths found";
    return {
      ad_id: adId,
      creative_id,
      video_id: null,
      video_url: null,
      thumbnail_url,
      attempts,
      source_note: `No video_id on this ad's creative. Checked: ${tried}. Likely an image-only ad, or the creative was built outside Ads Manager.`,
    };
  }

  // Resolve the actual playable source URL for the video.
  try {
    type VideoResp = {
      source?: string | null;
      permalink_url?: string | null;
    };
    const video = await fbGet<VideoResp>(
      `/${video_id}?fields=source,permalink_url`,
      token
    );
    attempts.push(`video lookup ${video_id}`);
    return {
      ad_id: adId,
      creative_id,
      video_id,
      video_url: video.source ?? null,
      thumbnail_url,
      attempts,
      source_note: video.source
        ? "ok"
        : `Video ${video_id} exists but Facebook returned no source URL (dark post or region-restricted).`,
    };
  } catch (err) {
    return {
      ad_id: adId,
      creative_id,
      video_id,
      video_url: null,
      thumbnail_url,
      attempts,
      source_note: `Video metadata fetch failed for video ${video_id}: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}
