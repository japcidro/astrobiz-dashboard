import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getEmployee } from "@/lib/supabase/get-employee";

export const dynamic = "force-dynamic";

async function assertMarketing() {
  const employee = await getEmployee();
  if (!employee) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!["admin", "marketing"].includes(employee.role)) {
    return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const authError = await assertMarketing();
    if (authError) return authError;

    const { query } = await request.json();
    if (!query) {
      return NextResponse.json(
        { success: false, error: "Missing query" },
        { status: 400 }
      );
    }

    const db = createServiceClient();
    const { data: keyRow } = await db
      .from("app_settings")
      .select("value")
      .eq("key", "serper_api_key")
      .single();
    const serperKey = (keyRow?.value as string | undefined) || process.env.SERPER_API_KEY;

    if (!serperKey) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Serper API key not configured. Go to Settings → API Keys and add your Serper key (get one free at serper.dev).",
        },
        { status: 400 }
      );
    }

    let searchQuery = String(query).trim();
    const igMatch = searchQuery.match(/instagram\.com\/([^/?]+)/);
    if (igMatch) searchQuery = igMatch[1].replace(/[._]/g, " ");

    const res = await fetch("https://google.serper.dev/images", {
      method: "POST",
      headers: {
        "X-API-KEY": serperKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: `${searchQuery} brand aesthetic campaign editorial photography`,
        num: 50,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json(
        { success: false, error: `Serper API error: ${err.slice(0, 200)}` },
        { status: 500 }
      );
    }

    const data = await res.json();
    const images = (data.images || [])
      .filter((img: Record<string, string>) => {
        const url = img.imageUrl || "";
        return (
          url.startsWith("http") &&
          !url.includes("icon") &&
          !url.includes("logo") &&
          !url.includes("favicon")
        );
      })
      .slice(0, 40)
      .map((img: Record<string, string>) => ({
        url: img.imageUrl,
        title: img.title || "",
        source: img.source || "",
      }));

    return NextResponse.json({ success: true, images, query: searchQuery });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown" },
      { status: 500 }
    );
  }
}

// Save an external image to Supabase storage (avoids CORS)
export async function PUT(request: NextRequest) {
  try {
    const authError = await assertMarketing();
    if (authError) return authError;

    const { image_url, store_name, label } = await request.json();
    if (!image_url) {
      return NextResponse.json(
        { success: false, error: "Missing image_url" },
        { status: 400 }
      );
    }
    if (!store_name) {
      return NextResponse.json(
        { success: false, error: "Missing store_name" },
        { status: 400 }
      );
    }

    const db = createServiceClient();

    const imgRes = await fetch(image_url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!imgRes.ok) {
      return NextResponse.json(
        { success: false, error: "Failed to download image" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    const ext = contentType.includes("png") ? "png" : "jpg";
    const path = `moodboard/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error: uploadError } = await db.storage
      .from("content-studio")
      .upload(path, buffer, { contentType, upsert: true });

    if (uploadError) {
      return NextResponse.json(
        { success: false, error: uploadError.message },
        { status: 500 }
      );
    }

    const {
      data: { publicUrl },
    } = db.storage.from("content-studio").getPublicUrl(path);

    return NextResponse.json({ success: true, url: publicUrl });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown" },
      { status: 500 }
    );
  }
}
