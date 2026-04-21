import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getEmployee } from "@/lib/supabase/get-employee";
import { injectBrandDNA } from "@/lib/content-studio/brand-dna";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/nano-banana-pro-preview:generateContent";

async function downloadAsBase64(url: string) {
  try {
    const res = await fetch(url);
    const buffer = await res.arrayBuffer();
    let mimeType = res.headers.get("content-type") || "image/jpeg";
    if (!mimeType.startsWith("image/")) {
      const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
      mimeType =
        ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    }
    return { mimeType, data: Buffer.from(buffer).toString("base64") };
  } catch {
    return null;
  }
}

async function extractProductDescription(
  productImages: { mimeType: string; data: string }[],
  storeName: string,
  anthropicKey: string
): Promise<string> {
  const imageContent = productImages.map((img) => ({
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: img.mimeType as "image/jpeg",
      data: img.data,
    },
  }));

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [
            ...imageContent,
            {
              type: "text",
              text: `Describe ONLY the product object in this image. IGNORE the background completely.

Include:
- Exact packaging type (tube, bottle, box, jar, etc.)
- Shape, size proportions
- Colors of the packaging and liquid inside (if visible)
- Label/branding text visible (brand name, product name)
- Material appearance (matte, glossy, frosted, clear glass, etc.)
- Cap/lid description
- Any distinctive design elements

IMPORTANT: Do NOT describe the background, surface, or environment. Only describe the product itself. Brand: ${storeName}.
Output ONLY the description, no preamble.`,
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) throw new Error("Claude API failed");
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

export async function POST(request: NextRequest) {
  try {
    const employee = await getEmployee();
    if (!employee) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    if (!["admin", "marketing"].includes(employee.role)) {
      return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const {
      store_name,
      moodboard_urls,
      product_urls,
      prompt,
      output_type,
      aspect_ratio,
      count,
    } = await request.json();
    const aspectRatio = aspect_ratio || "1:1";

    if (!store_name) {
      return NextResponse.json(
        { success: false, error: "Missing store_name" },
        { status: 400 }
      );
    }

    const adminDb = createServiceClient();
    const [{ data: geminiRow }, { data: anthropicRow }] = await Promise.all([
      adminDb.from("app_settings").select("value").eq("key", "gemini_api_key").single(),
      adminDb.from("app_settings").select("value").eq("key", "anthropic_api_key").single(),
    ]);
    const apiKey = (geminiRow?.value as string | undefined) || process.env.GEMINI_API_KEY;
    const anthropicKey =
      (anthropicRow?.value as string | undefined) || process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          error: "Gemini API key not configured. Go to Settings → API Keys.",
        },
        { status: 400 }
      );
    }
    if (!anthropicKey) {
      return NextResponse.json(
        { success: false, error: "Anthropic API key not configured." },
        { status: 400 }
      );
    }

    const moodboardImages = (
      await Promise.all((moodboard_urls || []).slice(0, 5).map(downloadAsBase64))
    ).filter(Boolean) as { mimeType: string; data: string }[];
    const productImages = (
      await Promise.all((product_urls || []).slice(0, 2).map(downloadAsBase64))
    ).filter(Boolean) as { mimeType: string; data: string }[];

    if (moodboardImages.length === 0 && productImages.length === 0) {
      return NextResponse.json(
        { success: false, error: "Failed to load reference images" },
        { status: 400 }
      );
    }

    let productDescription = "";
    if (productImages.length > 0) {
      try {
        productDescription = await extractProductDescription(
          productImages,
          store_name,
          anthropicKey
        );
      } catch (e) {
        console.error("Product extraction failed:", e);
      }
    }

    const refParts = moodboardImages.map((img) => ({ inlineData: img }));
    const productParts = productImages.map((img) => ({ inlineData: img }));

    const basePrompt = prompt || "A photorealistic editorial photograph";
    const finalPrompt = await injectBrandDNA(store_name, basePrompt);

    const numImages = Math.min(count || 4, 4);
    const generatedImages: { url: string }[] = [];
    const db = createServiceClient();

    for (let i = 0; i < numImages; i++) {
      if (i > 0) await new Promise((r) => setTimeout(r, 1500));
      try {
        const labeledPrompt =
          finalPrompt + (output_type === "lifestyle" ? "\n\nNo product in frame." : "");

        const geminiRes = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [...refParts, ...productParts, { text: labeledPrompt }],
              },
            ],
            generationConfig: {
              responseModalities: ["TEXT", "IMAGE"],
              temperature: 0.5,
            },
          }),
        });

        if (!geminiRes.ok) {
          const err = await geminiRes.text();
          console.error(`Gemini error (${geminiRes.status}): ${err}`);
          if (geminiRes.status === 429) {
            await new Promise((r) => setTimeout(r, 5000));
          }
          if (i === 0 && generatedImages.length === 0) {
            return NextResponse.json(
              {
                success: false,
                error: `Gemini API error (${geminiRes.status}): ${err.slice(0, 200)}`,
              },
              { status: 500 }
            );
          }
          continue;
        }

        const data = await geminiRes.json();
        const parts = data.candidates?.[0]?.content?.parts || [];

        for (const part of parts) {
          if (part.inlineData?.mimeType?.startsWith("image/")) {
            const imageBuffer = Buffer.from(part.inlineData.data, "base64");
            const ext = part.inlineData.mimeType === "image/png" ? "png" : "jpg";
            const path = `generated/${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 8)}.${ext}`;

            const { error: uploadError } = await db.storage
              .from("content-studio")
              .upload(path, imageBuffer, {
                contentType: part.inlineData.mimeType,
                upsert: true,
              });

            if (!uploadError) {
              const {
                data: { publicUrl },
              } = db.storage.from("content-studio").getPublicUrl(path);
              generatedImages.push({ url: publicUrl });
            }
          }
        }
      } catch (e) {
        console.error(`Generation ${i + 1} failed:`, e);
      }
    }

    if (generatedImages.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "No images generated. Check API key and try again.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      images: generatedImages,
      productDescription,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown" },
      { status: 500 }
    );
  }
}
