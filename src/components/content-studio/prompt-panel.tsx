"use client";

import { useState, useEffect } from "react";
import {
  Loader2,
  Wand2,
  Download,
  Trash2,
  ThumbsUp,
  ThumbsDown,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  saveGeneratedImage,
  deleteGeneratedImage,
  rateGeneratedImage,
  addMoodboardImage,
} from "@/lib/content-studio/actions";
import { toast } from "sonner";

interface MoodboardImage {
  id: string;
  image_url: string;
  label: string | null;
}
interface ProductPhoto {
  id: string;
  product_name: string;
  image_url: string;
}
interface GeneratedImage {
  id: string;
  image_url: string;
  prompt: string | null;
  output_type: string;
  created_at: string;
  rating?: number | null;
}

export function PromptPanel({
  moodboard,
  products,
  generated: initialGenerated,
  storeName,
  onGeneratedChange,
  onMoodboardChange,
}: {
  moodboard: MoodboardImage[];
  products: ProductPhoto[];
  generated: GeneratedImage[];
  storeName: string;
  onGeneratedChange?: (images: GeneratedImage[]) => void;
  onMoodboardChange?: (images: MoodboardImage[]) => void;
}) {
  const [generated, setGeneratedLocal] = useState(initialGenerated);
  const savedSettings =
    typeof window !== "undefined"
      ? (() => {
          try {
            return JSON.parse(
              localStorage.getItem("content-studio-settings") || "{}"
            );
          } catch {
            return {};
          }
        })()
      : {};
  const [mode, setMode] = useState<"vibe" | "product">(savedSettings.mode ?? "product");
  const [prompt, setPrompt] = useState("");
  const [customDirection, setCustomDirection] = useState<string>(
    savedSettings.customDirection ?? ""
  );
  const [productContext, setProductContext] = useState(savedSettings.productContext ?? "");
  const [signatureStyle, setSignatureStyle] = useState<string>(
    savedSettings.signatureStyle ?? ""
  );
  const [imageCount, setImageCount] = useState(savedSettings.imageCount ?? 2);
  const [aspectRatio, setAspectRatio] = useState(savedSettings.aspectRatio ?? "1:1");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewPrompt, setPreviewPrompt] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showKeywords, setShowKeywords] = useState(false);
  const [withModel, setWithModel] = useState(savedSettings.withModel ?? false);
  const [modelType, setModelType] = useState<string>(savedSettings.modelType ?? "");
  const [favoriteKeywords, setFavoriteKeywords] = useState<
    { label: string; tag: string; category: string }[]
  >(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(localStorage.getItem("content-studio-favorites") || "[]");
    } catch {
      return [];
    }
  });

  const toggleFavorite = (label: string, tag: string, category: string) => {
    setFavoriteKeywords((prev) => {
      const exists = prev.some((f) => f.tag === tag);
      const next = exists
        ? prev.filter((f) => f.tag !== tag)
        : [...prev, { label, tag, category }];
      localStorage.setItem("content-studio-favorites", JSON.stringify(next));
      return next;
    });
  };

  const isFavorite = (tag: string) => favoriteKeywords.some((f) => f.tag === tag);

  const [brandPicker, setBrandPicker] = useState<{ label: string; search: string } | null>(
    null
  );
  const [brandResults, setBrandResults] = useState<{ url: string; title: string }[]>([]);
  const [brandSelectedUrls, setBrandSelectedUrls] = useState<Set<string>>(new Set());
  const [brandLoading, setBrandLoading] = useState(false);
  const [brandAdding, setBrandAdding] = useState(false);

  const openBrandPicker = async (label: string, search: string) => {
    setBrandPicker({ label, search });
    setBrandResults([]);
    setBrandSelectedUrls(new Set());
    setBrandLoading(true);
    try {
      const brandName = search.split(" ")[0];
      const [productRes, igRes] = await Promise.all([
        fetch("/api/ai/search-brand-images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: search }),
        }),
        fetch("/api/ai/search-brand-images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: `${brandName} instagram perfume aesthetic campaign`,
          }),
        }),
      ]);
      const [productData, igData] = await Promise.all([
        productRes.json(),
        igRes.json(),
      ]);
      const allImages = [
        ...(productData.success ? productData.images : []),
        ...(igData.success ? igData.images : []),
      ];
      const seen = new Set<string>();
      const unique = allImages.filter((img: { url: string }) => {
        if (seen.has(img.url)) return false;
        seen.add(img.url);
        return true;
      });
      setBrandResults(unique);
    } catch {
      toast.error("Search failed");
    } finally {
      setBrandLoading(false);
    }
  };

  const addSelectedBrandRefs = async () => {
    if (!onMoodboardChange || brandSelectedUrls.size === 0) return;
    setBrandAdding(true);
    const added: MoodboardImage[] = [];
    for (const url of brandSelectedUrls) {
      try {
        const dlRes = await fetch("/api/ai/search-brand-images", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image_url: url,
            store_name: storeName,
            label: `${brandPicker?.label} ref`,
          }),
        });
        const dlData = await dlRes.json();
        if (dlData.success) {
          const dbId = await addMoodboardImage(
            storeName,
            dlData.url,
            `${brandPicker?.label} ref`
          );
          added.push({
            id: dbId,
            image_url: dlData.url,
            label: `${brandPicker?.label} ref`,
          });
        }
      } catch {}
    }
    if (added.length > 0) {
      onMoodboardChange([...moodboard, ...added]);
      toast.success(`Added ${added.length} references`);
    }
    setBrandAdding(false);
    setBrandPicker(null);
  };

  useEffect(() => {
    localStorage.setItem(
      "content-studio-settings",
      JSON.stringify({
        mode,
        customDirection,
        productContext,
        signatureStyle,
        imageCount,
        aspectRatio,
        withModel,
        modelType,
      })
    );
  }, [
    mode,
    customDirection,
    productContext,
    signatureStyle,
    imageCount,
    aspectRatio,
    withModel,
    modelType,
  ]);

  const setGenerated = (
    updater: GeneratedImage[] | ((prev: GeneratedImage[]) => GeneratedImage[])
  ) => {
    setGeneratedLocal((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      onGeneratedChange?.(next);
      return next;
    });
  };

  useEffect(() => {
    const refTags = moodboard.map((_, i) => `@img${i + 1}`).join(" ");
    const prodTags = products
      .map((p, i) => `@prod${i + 1}(${p.product_name})`)
      .join(" ");
    const ratioLabel =
      aspectRatio === "9:16"
        ? "Portrait 9:16"
        : aspectRatio === "3:4"
        ? "Portrait 3:4"
        : aspectRatio === "16:9"
        ? "Landscape 16:9"
        : "Square 1:1";

    let built = "";
    const stylePrefix = signatureStyle ? `STYLE: ${signatureStyle}.\n\n` : "";
    if (mode === "vibe") {
      if (customDirection && moodboard.length > 0) {
        built =
          stylePrefix +
          `A photorealistic editorial photograph matching the visual style of the reference images (${refTags}) — use their exact color palette, lighting quality, mood, and composition approach.\n\nScene: ${customDirection}.\n\nThe person must look completely natural and human — real skin texture with visible pores and natural sheen, natural hair with individual strands, authentic facial features with subtle asymmetry.\n\nShot with an 85mm portrait lens at f/1.8. Lighting must match the reference images. No product in frame. Ignore any text overlays, logos, or UI elements in the references — use only the visual style. ${ratioLabel} format.`;
      } else if (customDirection) {
        built =
          stylePrefix +
          `A photorealistic editorial photograph.\n\nScene: ${customDirection}.\n\nThe person must look completely natural — real skin texture, natural hair, authentic facial features. Shot with an 85mm lens at f/1.8. Editorial mood. No product in frame. ${ratioLabel} format.`;
      } else if (moodboard.length > 0) {
        built =
          stylePrefix +
          `Use the visual style, lighting, color palette, and mood from these reference images: ${refTags}\n\nGenerate a photorealistic editorial photograph of a real person in this exact aesthetic. Real skin texture, natural hair, authentic features. Shot on 85mm at f/1.8. Match the reference lighting exactly. No product in frame. Ignore text/logos/UI in references. ${ratioLabel} format.`;
      } else {
        built =
          stylePrefix +
          `Generate a photorealistic editorial photograph of a real person. 85mm lens, f/1.8, natural skin, editorial mood. ${ratioLabel} format.`;
      }
    } else {
      built = "";
      if (signatureStyle) {
        built += `STYLE: ${signatureStyle}.\n\n`;
      }
      if (moodboard.length > 0) {
        built += `Reference style images: ${refTags} — combine the color palette, lighting, textures, and mood from all reference images into one cohesive scene.\n\n`;
      }
      if (products.length > 0) {
        if (withModel && modelType) {
          built += `Photograph a ${modelType} naturally holding or interacting with this product (${prodTags}) in a new scene. The model should look like a real person in a luxury editorial campaign. Product must look exactly like the product photo — same bottle, same label, same cap. Do not alter the product.`;
        } else if (withModel) {
          built += `Photograph a model naturally holding or interacting with this product (${prodTags}) in a new scene. The model should look like a real person in a luxury editorial campaign. Product must look exactly like the product photo — same bottle, same label, same cap. Do not alter the product.`;
        } else {
          built += `Photograph this product (${prodTags}) in a new scene. Product must look exactly like the product photo — same bottle, same label, same cap. Do not alter the product.`;
        }
      } else {
        built += "Generate a product photograph.";
      }
      if (customDirection) built += `\n\n${customDirection}`;
      if (productContext) built += `\n\n${productContext}`;
      built += `\n\nNo text overlays. No logos. No watermarks. ${ratioLabel} format.`;
    }
    setPrompt(built);
  }, [
    moodboard,
    products,
    mode,
    customDirection,
    productContext,
    signatureStyle,
    aspectRatio,
    withModel,
    modelType,
  ]);

  const handleGenerate = () => {
    if (!prompt.trim()) {
      toast.error("Write a prompt first");
      return;
    }
    if (moodboard.length === 0 && products.length === 0) {
      toast.error("Add references or product photos");
      return;
    }

    const placeholderIds = Array.from(
      { length: imageCount },
      () => `loading-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    );
    const placeholders: GeneratedImage[] = placeholderIds.map((id) => ({
      id,
      image_url: "",
      prompt: prompt.trim(),
      output_type: mode,
      created_at: new Date().toISOString(),
    }));
    setGenerated((prev) => [...placeholders, ...prev]);

    const currentPrompt = prompt.trim();
    const currentMode = mode;
    fetch("/api/ai/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        store_name: storeName,
        moodboard_urls: moodboard.map((m) => m.image_url),
        product_urls: currentMode === "product" ? products.map((p) => p.image_url) : [],
        prompt: currentPrompt,
        output_type: currentMode === "vibe" ? "lifestyle" : "feed_post",
        count: imageCount,
        aspect_ratio: aspectRatio,
      }),
    })
      .then((r) => r.json())
      .then(async (data) => {
        if (data.success && data.images?.length > 0) {
          for (let i = 0; i < data.images.length && i < placeholderIds.length; i++) {
            const img = data.images[i];
            const dbId = await saveGeneratedImage(
              storeName,
              img.url,
              currentPrompt,
              currentMode === "vibe" ? "lifestyle" : "feed_post",
              moodboard.map((m) => m.id),
              products.map((p) => p.id)
            );
            setGenerated((prev) =>
              prev.map((g) =>
                g.id === placeholderIds[i] ? { ...g, id: dbId, image_url: img.url } : g
              )
            );
          }
          if (data.images.length < placeholderIds.length) {
            const unusedIds = placeholderIds.slice(data.images.length);
            setGenerated((prev) => prev.filter((g) => !unusedIds.includes(g.id)));
          }
          toast.success(
            `${data.images.length} image${data.images.length > 1 ? "s" : ""} generated!`
          );
        } else {
          setGenerated((prev) => prev.filter((g) => !placeholderIds.includes(g.id)));
          toast.error(data.error || "Generation failed");
        }
      })
      .catch(() => {
        setGenerated((prev) => prev.filter((g) => !placeholderIds.includes(g.id)));
        toast.error("Failed to generate");
      });
  };

  const handleRate = async (id: string, rating: number) => {
    try {
      await rateGeneratedImage(id, rating);
      setGenerated((prev) => prev.map((g) => (g.id === id ? { ...g, rating } : g)));
    } catch {
      toast.error("Failed");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteGeneratedImage(id);
      setGenerated((prev) => prev.filter((g) => g.id !== id));
    } catch {
      toast.error("Failed");
    }
  };

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl h-full flex flex-col min-w-0 overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-700/50 flex items-center justify-between">
        <span className="text-[10px] font-bold font-mono uppercase tracking-widest text-gray-500">
          Prompt
        </span>
        <div className="flex border border-gray-700/50">
          <button
            onClick={() => setMode("product")}
            className={`px-3 py-1 text-[10px] font-bold font-mono cursor-pointer ${
              mode === "product" ? "bg-purple-600 text-white" : "text-gray-500"
            }`}
          >
            Product
          </button>
          <button
            onClick={() => setMode("vibe")}
            className={`px-3 py-1 text-[10px] font-bold font-mono cursor-pointer ${
              mode === "vibe" ? "bg-purple-600 text-white" : "text-gray-500"
            }`}
          >
            Vibe
          </button>
        </div>
      </div>

      <div className="p-3 border-b border-gray-700/50 space-y-2">
        <button onClick={() => setShowPrompt(!showPrompt)} className="w-full text-left">
          {showPrompt ? (
            <Textarea
              value={prompt}
              onChange={(e) => {
                e.stopPropagation();
                setPrompt(e.target.value);
              }}
              onClick={(e) => e.stopPropagation()}
              rows={5}
              className="text-[11px] font-mono leading-relaxed"
            />
          ) : (
            <p className="text-[10px] font-mono text-gray-500 truncate">
              {prompt.slice(0, 120)}...{" "}
              <span className="text-gray-600 hover:text-gray-300">
                (click to edit)
              </span>
            </p>
          )}
        </button>
        <div className="flex items-center gap-2">
          <input
            value={customDirection}
            onChange={(e) => setCustomDirection(e.target.value)}
            placeholder="Add direction (e.g., woman in linen dress at sunset)"
            className="flex-1 h-7 bg-gray-800 border border-gray-700 rounded-lg px-2 text-[10px] font-mono text-white placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
          />
          <Button onClick={handleGenerate} size="sm">
            <Wand2 className="h-3.5 w-3.5 mr-1" />
            Generate
          </Button>
        </div>
        <input
          value={productContext}
          onChange={(e) => setProductContext(e.target.value)}
          placeholder="Product context (optional) e.g., use nature materials — leaves, wood, greenery"
          className="w-full h-7 bg-gray-800 border border-gray-700 rounded-lg px-2 text-[10px] font-mono text-gray-300 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => {
              setWithModel(!withModel);
              if (withModel) setModelType("");
            }}
            className={`px-2 py-0.5 text-[9px] font-mono font-bold border transition-colors cursor-pointer ${
              withModel
                ? "bg-purple-600 text-white border-purple-500"
                : "border-gray-700/50 text-gray-500 hover:border-gray-500"
            }`}
          >
            {withModel ? "✓ With Model" : "+ With Model"}
          </button>
          {withModel && (
            <>
              {[
                { label: "Mestiza", desc: "Filipino-Spanish mestiza woman, fair warm skin, soft features, natural beauty, aspirational Filipina" },
                { label: "Morena Glow", desc: "morena Filipina woman, warm brown skin, radiant glow, confident beautiful, natural sun-kissed" },
                { label: "Chinita", desc: "Filipino-Chinese chinita woman, soft monolid eyes, porcelain skin, delicate features, fresh minimal" },
                { label: "Fit Mommy", desc: "fit young Filipina mother, toned body, glowing healthy skin, effortless put-together look, warm confident smile" },
                { label: "Teen Filipina", desc: "Gen Z Filipina teen, fresh natural skin, bubbly youthful vibe, casual everyday style" },
                { label: "Titas", desc: "stylish Filipina tita in her 30s-40s, well-kept, confident, warm aspirational, mom-next-door feel" },
                { label: "UGC / Real Customer", desc: "regular Filipina customer, natural unposed, candid phone-photo feel, authentic real-person look, no makeup or minimal makeup" },
                { label: "Male Filipino", desc: "Filipino male, mestizo or morena features, clean grooming, confident warm, casual lifestyle" },
                { label: "Male Fit", desc: "fit Filipino male, toned healthy physique, athletic lifestyle, grounded confident" },
                { label: "Gym Lifestyle", desc: "athletic Filipino in gym or fitness setting, workout attire, active energetic, healthy lifestyle" },
              ].map((m) => (
                <button
                  key={m.label}
                  onClick={() => setModelType(modelType === m.desc ? "" : m.desc)}
                  className={`px-1.5 py-0.5 text-[8px] font-mono border transition-colors cursor-pointer ${
                    modelType === m.desc
                      ? "border-blue-400 bg-blue-900/30 text-blue-300"
                      : "border-gray-700/50 text-gray-400 hover:border-gray-500"
                  }`}
                >
                  {m.label}
                </button>
              ))}
              <input
                value={modelType}
                onChange={(e) => setModelType(e.target.value)}
                placeholder="Or type custom model description..."
                className="flex-1 min-w-[150px] h-6 bg-gray-800 border border-gray-700 rounded px-1.5 text-[9px] font-mono text-white placeholder:text-gray-500 outline-none focus:border-gray-500"
              />
            </>
          )}
        </div>
        {signatureStyle && (
          <div className="flex items-center gap-1">
            <span className="text-[8px] font-mono font-bold text-amber-400 uppercase tracking-widest shrink-0">
              Style:
            </span>
            <input
              value={signatureStyle}
              onChange={(e) => setSignatureStyle(e.target.value)}
              className="flex-1 h-6 border border-amber-700/50 bg-amber-900/20 px-2 text-[9px] font-mono text-amber-200"
            />
            <button
              onClick={() => setSignatureStyle("")}
              className="text-amber-400 hover:text-red-400 text-[10px] font-mono px-1 cursor-pointer"
            >
              x
            </button>
          </div>
        )}
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[8px] font-mono font-bold text-purple-400 uppercase tracking-widest mr-1">
            Auto Mix
          </span>
          {[
            { label: "Hero Shot", signature: "clean professional product photography, commercial catalog quality, sharp ecommerce look", direction: "bright even studio lighting, pure white or soft neutral background, centered composition, no distractions", pose: "product standing upright front and center, hero angle, catalog-ready" },
            { label: "Lifestyle", signature: "authentic lifestyle photography, real moment, warm natural feel", direction: "warm natural daylight, in-context real home or cafe setting, slightly candid, relatable everyday vibe", pose: "product placed naturally on a surface as part of a real scene, hand reaching or holding optional" },
            { label: "UGC Phone", signature: "iPhone-style UGC content, casual phone photography, real-person feel", direction: "slightly imperfect lighting, phone-camera look, low-to-mid resolution feel, authentic not staged, no professional polish", pose: "product held up naturally by a hand like a customer sharing on social media" },
            { label: "Flat Lay", signature: "overhead flat lay product photography, Instagram aesthetic", direction: "directly overhead flat lay perspective, birds eye view, soft diffused light, styled props around the product, neutral background", pose: "product centered with complementary props arranged around it" },
            { label: "Sale / Promo", signature: "bold ecommerce promo visual, vibrant high-energy ad style", direction: "bold saturated colors, dynamic composition, high contrast, eye-catching energy, sale-banner feel, clean space for overlay text", pose: "product angled slightly toward the camera, confident hero placement" },
            { label: "Bundle Shot", signature: "product bundle collection photography, ecommerce catalog", direction: "clean bright lighting, multiple products grouped, balanced composition, slightly elevated 3/4 angle", pose: "multiple products stacked or arranged together as a set" },
            { label: "Before & After", signature: "split-panel before and after comparison, clean commercial feel", direction: "symmetrical split composition, consistent lighting both sides, clear visual contrast, clean typography-ready layout", pose: "product shown alongside the transformation context" },
            { label: "Testimonial Vibe", signature: "happy customer testimonial style, warm real-person feel", direction: "natural warm light, genuine smile, authentic emotion, real home or everyday setting, relatable not staged", pose: "person holding or using product, looking happy and satisfied" },
            { label: "Minimal Clean", signature: "premium minimalist ecommerce, curated negative space", direction: "extreme minimalism, vast negative space, single subject, soft even light, clean neutral background, quiet luxury feel", pose: "product centered with plenty of breathing room around it" },
            { label: "Bold Graphic", signature: "bold graphic colorblock product shot, modern DTC ecommerce", direction: "solid bright color background, strong shadow, graphic modern composition, playful energetic vibe", pose: "product floating or casting strong colored shadow, dynamic placement" },
          ].map((combo) => (
            <button
              key={combo.label}
              onClick={() => {
                setSignatureStyle(combo.signature);
                setCustomDirection(combo.direction + ", " + combo.pose);
                toast.success(`Applied: ${combo.label}`);
              }}
              className="px-2 py-0.5 text-[8px] font-mono font-bold border border-purple-700/50 text-purple-400 hover:bg-purple-900/20 hover:border-purple-500/50 transition-colors cursor-pointer"
            >
              {combo.label}
            </button>
          ))}
          <button
            onClick={() => {
              const signatures = [
                "clean professional product photography, commercial catalog quality, sharp ecommerce look",
                "authentic lifestyle photography, real moment, warm natural feel",
                "iPhone-style UGC content, casual phone photography, real-person feel",
                "overhead flat lay product photography, Instagram aesthetic",
                "bold ecommerce promo visual, vibrant high-energy ad style",
                "product bundle collection photography, ecommerce catalog",
                "premium minimalist ecommerce, curated negative space",
                "bold graphic colorblock product shot, modern DTC ecommerce",
                "happy customer testimonial style, warm real-person feel",
                "bright pastel aspirational ecommerce, feminine-friendly, approachable luxury",
                "warm golden hour lifestyle shot, aspirational yet attainable",
                "clean studio white background, professional ecommerce catalog",
              ];
              const moods = [
                "dark moody atmosphere, deep shadows, dramatic contrast",
                "soft dreamy focus, ethereal glow",
                "slightly overexposed, blown-out highlights, airy feel",
                "motion blur, dynamic movement",
                "extreme minimalism, vast negative space, single subject",
                "water droplets, condensation, dewy moisture on surfaces",
                "wispy smoke, haze, atmospheric fog",
              ];
              const compositions = [
                "shallow depth of field, creamy circular bokeh",
                "extreme close-up macro shot, 100mm lens, shallow DOF",
                "low angle shot looking up, dramatic perspective",
                "cinematic wide shot, 35mm anamorphic lens, letterbox feel",
                "perfectly symmetrical composition, centered subject",
              ];
              const poses = [
                "product laying on its side, casual relaxed placement",
                "product slightly tilted at an angle, dynamic leaning",
                "product held naturally in a human hand, fingers visible",
                "product nestled among props, partially hidden, peeking out",
                "product on reflective surface showing mirror reflection below",
                "product mid-fall, frozen motion, objects scattering around it",
              ];
              const pick = (arr: string[]) =>
                arr[Math.floor(Math.random() * arr.length)];
              setSignatureStyle(pick(signatures));
              setCustomDirection(
                `${pick(moods)}, ${pick(compositions)}, ${pick(poses)}`
              );
              toast.success("Random mix applied!");
            }}
            className="px-2 py-0.5 text-[8px] font-mono font-bold border border-purple-500/50 bg-purple-900/20 text-purple-300 hover:bg-purple-900/40 transition-colors cursor-pointer"
          >
            Shuffle
          </button>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            {(["1:1", "3:4", "9:16", "16:9"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setAspectRatio(r)}
                className={`px-2 py-0.5 text-[9px] font-mono font-bold border transition-colors cursor-pointer ${
                  aspectRatio === r
                    ? "bg-purple-600 text-white border-purple-500"
                    : "border-gray-700/50 text-gray-500 hover:border-gray-500"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                onClick={() => setImageCount(n)}
                className={`h-5 w-5 text-[9px] font-mono font-bold border transition-colors cursor-pointer ${
                  imageCount === n
                    ? "bg-purple-600 text-white border-purple-500"
                    : "border-gray-700/50 text-gray-500 hover:border-gray-500"
                }`}
              >
                {n}
              </button>
            ))}
            <span className="text-[9px] font-mono text-gray-500 ml-0.5">images</span>
          </div>
        </div>
        <button
          onClick={() => setShowKeywords(!showKeywords)}
          className="text-[9px] font-mono font-bold text-gray-500 hover:text-white flex items-center gap-1 cursor-pointer"
        >
          {showKeywords ? "▾ Hide Keywords" : "▸ Show Keywords"}
        </button>
        {showKeywords && (
          <>
            {favoriteKeywords.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[8px] font-mono font-bold text-red-400 uppercase tracking-widest mr-1">
                  Favorites
                </span>
                {favoriteKeywords.map((f) => (
                  <button
                    key={f.tag}
                    onClick={() => {
                      if (f.category === "Signature") setSignatureStyle(f.tag);
                      else
                        setCustomDirection((prev) =>
                          prev ? `${prev}, ${f.tag}` : f.tag
                        );
                    }}
                    className={`px-1.5 py-0.5 text-[8px] font-mono border transition-colors cursor-pointer ${
                      f.category === "Signature"
                        ? "border-amber-600/50 bg-amber-900/20 text-amber-300"
                        : "border-red-700/50 bg-red-900/20 text-red-400 hover:bg-red-100"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}
            {[
              { category: "Lens & Focus", keywords: [
                { label: "Bokeh", tag: "shallow depth of field, creamy circular bokeh" },
                { label: "Soft Focus", tag: "soft dreamy focus, ethereal glow" },
                { label: "Tilt Shift", tag: "tilt-shift miniature effect, selective focus plane" },
                { label: "Sharp", tag: "tack sharp focus, high clarity, crisp details" },
              ]},
              { category: "Lighting", keywords: [
                { label: "Hard Light", tag: "harsh directional light, sharp crisp shadows" },
                { label: "Soft Light", tag: "soft diffused light, no harsh shadows, even illumination" },
                { label: "Golden Hour", tag: "warm golden hour sunlight, long shadows, amber tones" },
                { label: "Neon Glow", tag: "neon light reflections, vibrant colored lighting, nightlife" },
                { label: "Backlit", tag: "strong backlight, rim lighting, glowing edges" },
                { label: "Candlelight", tag: "warm candlelight, intimate flickering glow, soft orange tones" },
                { label: "Studio", tag: "professional studio lighting, clean white backdrop, controlled shadows" },
              ]},
              { category: "Mood & Texture", keywords: [
                { label: "Motion Blur", tag: "motion blur, dynamic movement" },
                { label: "Film Grain", tag: "fine film grain, Kodak Portra 400 texture" },
                { label: "Overexposed", tag: "slightly overexposed, blown-out highlights, airy feel" },
                { label: "Wet/Dewy", tag: "water droplets, condensation, dewy moisture on surfaces" },
                { label: "Smoky", tag: "wispy smoke, haze, atmospheric fog" },
                { label: "Moody", tag: "dark moody atmosphere, deep shadows, dramatic contrast" },
                { label: "Dreamy", tag: "ethereal dreamy atmosphere, soft pastels, light leaks" },
                { label: "Gritty", tag: "raw gritty texture, high contrast, urban feel" },
                { label: "Vintage", tag: "vintage film look, faded colors, warm nostalgic tone" },
                { label: "Minimal", tag: "extreme minimalism, vast negative space, single subject" },
              ]},
              { category: "Composition", keywords: [
                { label: "Macro", tag: "extreme close-up macro shot, 100mm lens, shallow DOF" },
                { label: "Close-up", tag: "close-up shot, tight crop, product filling frame" },
                { label: "Eye Level", tag: "eye-level perspective, intimate distance" },
                { label: "Low Angle", tag: "low angle shot looking up, dramatic perspective" },
                { label: "Overhead", tag: "directly overhead flat lay perspective, birds eye view" },
                { label: "Wide Shot", tag: "wide establishing shot, subject small in environment" },
                { label: "Silhouette", tag: "backlit silhouette, rim light outlining the subject" },
                { label: "Cinematic", tag: "cinematic wide shot, 35mm anamorphic lens, letterbox feel" },
                { label: "Symmetry", tag: "perfectly symmetrical composition, centered subject" },
              ]},
              { category: "Scene & Surface", keywords: [
                { label: "Marble", tag: "white marble surface, luxury, clean elegant" },
                { label: "Wood", tag: "natural wood surface, warm organic texture" },
                { label: "Fabric", tag: "draped silk or linen fabric, soft flowing textile" },
                { label: "Flowers", tag: "surrounded by fresh flowers, petals scattered" },
                { label: "Sand", tag: "fine sand texture, beach coastal scene" },
                { label: "Leaves", tag: "natural green leaves, botanical, garden setting" },
                { label: "Water", tag: "reflective water surface, ripples, liquid" },
                { label: "Mirror", tag: "reflective mirror surface, double reflection" },
                { label: "Ice", tag: "ice cubes, frost, frozen crystalline surface" },
              ]},
              { category: "Product Pose", keywords: [
                { label: "Laying Down", tag: "product laying on its side, casual relaxed placement" },
                { label: "Tilted", tag: "product slightly tilted at an angle, dynamic leaning" },
                { label: "Held in Hand", tag: "product held naturally in a human hand, fingers visible" },
                { label: "Half Submerged", tag: "product partially submerged in liquid or sand" },
                { label: "Hanging", tag: "product suspended, dangling, hanging from above" },
                { label: "Nestled", tag: "product nestled among props, partially hidden, peeking out" },
                { label: "Falling", tag: "product mid-fall, frozen motion, objects scattering around it" },
                { label: "Reflected", tag: "product on reflective surface showing mirror reflection below" },
                { label: "Wrapped", tag: "product partially wrapped in fabric or paper, gift-like reveal" },
                { label: "Stacked", tag: "multiple products stacked or grouped together, collection shot" },
              ]},
              { category: "Signature", keywords: [
                { label: "Hasselblad", tag: "shot on medium format Hasselblad, ultra sharp, creamy tones" },
                { label: "Portra 800", tag: "Kodak Portra 800 pushed 2 stops, heavy grain, warm skin tones" },
                { label: "Leibovitz", tag: "Annie Leibovitz editorial, dramatic intimate portrait lighting" },
                { label: "Helmut Newton", tag: "Helmut Newton high-contrast black and white, powerful provocative, dramatic shadow play" },
                { label: "Guy Bourdin", tag: "Guy Bourdin surreal saturated colors, bizarre fashion compositions, glossy editorial art" },
                { label: "Tim Walker", tag: "Tim Walker fantastical dreamscape, oversized whimsical props, fairy tale editorial" },
                { label: "Mario Testino", tag: "Mario Testino golden warmth, sensual sun-drenched glamour, luxury editorial" },
                { label: "Peter Lindbergh", tag: "Peter Lindbergh raw black and white, unretouched natural beauty, emotional authentic" },
                { label: "Juergen Teller", tag: "Juergen Teller raw flash snapshot, anti-glamour, intentionally imperfect, candid editorial" },
                { label: "Dutch Masters", tag: "still life Dutch masters painting, rich dark dramatic chiaroscuro" },
                { label: "Chiaroscuro", tag: "chiaroscuro Caravaggio lighting, extreme contrast, single light source" },
                { label: "Wes Anderson", tag: "Wes Anderson color palette, symmetrical, pastel, whimsical" },
                { label: "Kubrick", tag: "Stanley Kubrick obsessive symmetry, one-point perspective, eerie clinical perfection" },
                { label: "Wong Kar-wai", tag: "Wong Kar-wai neon-soaked, romantic motion blur, saturated reds and greens, melancholy" },
                { label: "Sofia Coppola", tag: "Sofia Coppola pastel feminine, dreamy luxe ennui, soft natural light, romantic boredom" },
                { label: "David Lynch", tag: "David Lynch surreal uncanny, retro Americana, unsettling beauty, velvet darkness" },
                { label: "Vogue Italia", tag: "fashion editorial Vogue Italia, bold avant-garde styling" },
                { label: "Deconstructed", tag: "deconstructed flat lay, scattered editorial arrangement" },
                { label: "Petra Collins", tag: "Petra Collins hazy pink soft focus, girlhood nostalgia, dreamy Instagram-era editorial" },
                { label: "Tyler Mitchell", tag: "Tyler Mitchell warm golden light, pastel dreamscape, optimistic joyful editorial" },
                { label: "Ellen von Unwerth", tag: "Ellen von Unwerth playful feminine, retro pin-up glamour, flirty fun editorial" },
                { label: "Erwin Olaf", tag: "Erwin Olaf theatrical staged scene, hyperreal colors, cinematic tableau vivant" },
                { label: "Paolo Roversi", tag: "Paolo Roversi ethereal soft focus, painterly light, romantic ghostly beauty, Polaroid-like" },
                { label: "David LaChapelle", tag: "David LaChapelle pop art maximalism, hyper-saturated surreal, candy-colored excess" },
                { label: "Viviane Sassen", tag: "Viviane Sassen bold color blocking, abstract graphic shapes, high-contrast editorial art" },
                { label: "Harley Weir", tag: "Harley Weir intimate raw feminine, natural light, sensual soft tactile editorial" },
                { label: "Greta Gerwig", tag: "Greta Gerwig Barbie-pink nostalgia, warm feminist aesthetic, aspirational vintage pastel" },
                { label: "Miyazaki", tag: "Hayao Miyazaki Studio Ghibli dreamscape, lush botanical fantasy, whimsical magical nature" },
                { label: "Terrence Malick", tag: "Terrence Malick golden hour magic, nature as cathedral, backlit ethereal, poetic cinema" },
                { label: "Art Deco", tag: "Art Deco gold geometric patterns, 1920s luxury, ornate symmetry, gatsby elegance" },
                { label: "Bauhaus", tag: "Bauhaus geometric primary colors, functional minimalism, clean modernist" },
                { label: "Japandi", tag: "Japandi wabi-sabi, Japanese-Scandinavian organic minimal, imperfect natural beauty" },
              ]},
            ].map((cat) => (
              <div key={cat.category} className="flex flex-wrap items-center gap-1">
                <span className="text-[8px] font-mono font-bold text-gray-500 uppercase tracking-widest mr-1">
                  {cat.category}
                </span>
                {cat.keywords.map((k) => (
                  <span key={k.label} className="inline-flex items-center group/kw">
                    <button
                      onClick={() => {
                        if (cat.category === "Signature") setSignatureStyle(k.tag);
                        else
                          setCustomDirection((prev) =>
                            prev ? `${prev}, ${k.tag}` : k.tag
                          );
                      }}
                      className={`px-1.5 py-0.5 text-[8px] font-mono border-y border-l transition-colors cursor-pointer ${
                        cat.category === "Signature"
                          ? signatureStyle === k.tag
                            ? "border-amber-400 bg-amber-900/40 text-amber-200"
                            : "border-amber-700/50 text-amber-300 hover:bg-amber-900/20 hover:border-amber-400"
                          : "border-gray-700/50 hover:bg-gray-800 hover:border-gray-500"
                      } ${isFavorite(k.tag) ? "border-red-600/50" : ""}`}
                    >
                      {k.label}
                    </button>
                    <button
                      onClick={() => toggleFavorite(k.label, k.tag, cat.category)}
                      className={`px-0.5 py-0.5 text-[8px] border-y border-r transition-colors cursor-pointer ${
                        isFavorite(k.tag)
                          ? "text-red-400 border-red-600/50 bg-red-900/20"
                          : "text-gray-700 border-gray-700/50 hover:text-red-400 opacity-0 group-hover/kw:opacity-100"
                      }`}
                    >
                      {isFavorite(k.tag) ? "★" : "☆"}
                    </button>
                  </span>
                ))}
              </div>
            ))}
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {generated.length === 0 ? (
          <div className="flex items-center justify-center h-full text-center">
            <div>
              <Wand2 className="h-8 w-8 text-gray-700 mx-auto mb-2" />
              <p className="text-xs font-bold text-gray-500">No images yet</p>
              <p className="text-[10px] text-gray-600">
                Add refs + product, then generate
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {generated.map((img) => (
              <div key={img.id} className="border border-gray-700/50">
                {!img.image_url ? (
                  <div className="w-full aspect-square bg-gray-800 flex flex-col items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-600 mb-1" />
                    <span className="text-[9px] font-mono text-gray-500">
                      Generating...
                    </span>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setPreviewUrl(img.image_url);
                      setPreviewPrompt(img.prompt || null);
                    }}
                    className="relative overflow-hidden w-full cursor-pointer"
                  >
                    <img
                      src={img.image_url}
                      alt=""
                      className="w-full aspect-square object-cover block"
                    />
                  </button>
                )}
                {img.prompt && img.prompt.startsWith("STYLE:") && (
                  <div className="px-2 py-0.5 border-t border-gray-800 bg-amber-900/20">
                    <p className="text-[7px] font-mono text-amber-400 truncate">
                      {img.prompt.split("\n")[0].replace("STYLE: ", "").replace(".", "")}
                    </p>
                  </div>
                )}
                <div className="flex items-center justify-between px-2 py-1 border-t border-gray-800 bg-gray-900/50">
                  <div className="flex gap-0.5">
                    <button
                      onClick={() => handleRate(img.id, 5)}
                      className={`p-1 cursor-pointer ${
                        img.rating === 5
                          ? "text-emerald-400"
                          : "text-gray-600 hover:text-emerald-400"
                      }`}
                    >
                      <ThumbsUp className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => handleRate(img.id, 1)}
                      className={`p-1 cursor-pointer ${
                        img.rating === 1
                          ? "text-red-400"
                          : "text-gray-600 hover:text-red-400"
                      }`}
                    >
                      <ThumbsDown className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex gap-0.5">
                    {img.prompt && img.image_url && (
                      <button
                        onClick={() => {
                          const placeholderId = `loading-${Date.now()}-${Math.random()
                            .toString(36)
                            .slice(2, 6)}`;
                          setGenerated((prev) => [
                            {
                              id: placeholderId,
                              image_url: "",
                              prompt: img.prompt,
                              output_type: img.output_type,
                              created_at: new Date().toISOString(),
                            },
                            ...prev,
                          ]);
                          fetch("/api/ai/generate-image", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              store_name: storeName,
                              moodboard_urls: moodboard.map((m) => m.image_url),
                              product_urls:
                                mode === "product"
                                  ? products.map((p) => p.image_url)
                                  : [],
                              prompt: img.prompt,
                              output_type:
                                img.output_type === "vibe" ? "lifestyle" : "feed_post",
                              count: 1,
                              aspect_ratio: aspectRatio,
                            }),
                          })
                            .then((r) => r.json())
                            .then(async (data) => {
                              if (data.success && data.images?.[0]) {
                                const dbId = await saveGeneratedImage(
                                  storeName,
                                  data.images[0].url,
                                  img.prompt!,
                                  img.output_type,
                                  moodboard.map((m) => m.id),
                                  products.map((p) => p.id)
                                );
                                setGenerated((prev) =>
                                  prev.map((g) =>
                                    g.id === placeholderId
                                      ? { ...g, id: dbId, image_url: data.images[0].url }
                                      : g
                                  )
                                );
                                toast.success("More like this ready!");
                              } else {
                                setGenerated((prev) =>
                                  prev.filter((g) => g.id !== placeholderId)
                                );
                                toast.error(data.error || "Failed");
                              }
                            })
                            .catch(() => {
                              setGenerated((prev) =>
                                prev.filter((g) => g.id !== placeholderId)
                              );
                            });
                        }}
                        className="p-1 text-gray-500 hover:text-purple-400 cursor-pointer"
                        title="More like this"
                      >
                        <Wand2 className="h-3 w-3" />
                      </button>
                    )}
                    <button
                      onClick={async () => {
                        const supabase = (await import("@/lib/supabase/client")).createClient();
                        await supabase.from("saved_images").insert({
                          store_name: storeName,
                          image_url: img.image_url,
                          label: "Generated",
                          album: "Generated",
                        });
                        toast.success("Saved to library!");
                      }}
                      className="p-1 text-gray-500 hover:text-amber-400 cursor-pointer"
                      title="Save as Reference"
                    >
                      <BookOpen className="h-3 w-3" />
                    </button>
                    <a
                      href={img.image_url}
                      download
                      className="p-1 text-gray-500 hover:text-white"
                    >
                      <Download className="h-3 w-3" />
                    </a>
                    <button
                      onClick={() => handleDelete(img.id)}
                      className="p-1 text-gray-500 hover:text-red-400 cursor-pointer"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {brandPicker && (
        <div
          className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center"
          onClick={() => !brandAdding && setBrandPicker(null)}
        >
          <div
            className="bg-gray-900 border border-gray-700/50 rounded-xl w-[600px] max-h-[80vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-gray-700/50 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-sm font-bold font-mono">
                  {brandPicker.label} References
                </h3>
                <p className="text-[10px] font-mono text-gray-500">
                  Select images to add as references
                </p>
              </div>
              <div className="flex items-center gap-2">
                {brandSelectedUrls.size > 0 && (
                  <span className="text-[10px] font-mono font-bold text-purple-400">
                    {brandSelectedUrls.size} selected
                  </span>
                )}
                <button
                  onClick={addSelectedBrandRefs}
                  disabled={brandSelectedUrls.size === 0 || brandAdding}
                  className="px-3 py-1.5 bg-purple-600 text-white text-[10px] font-mono font-bold disabled:opacity-30 hover:bg-purple-900/200 cursor-pointer"
                >
                  {brandAdding ? "Adding..." : `Add Selected (${brandSelectedUrls.size})`}
                </button>
                <button
                  onClick={() => setBrandPicker(null)}
                  className="text-gray-500 hover:text-white text-lg px-1 cursor-pointer"
                >
                  x
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {brandLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-600" />
                  <span className="ml-2 text-xs font-mono text-gray-500">
                    Searching {brandPicker.label}...
                  </span>
                </div>
              ) : brandResults.length > 0 ? (
                <div className="grid grid-cols-4 gap-2">
                  {brandResults.map((img, i) => {
                    const isSelected = brandSelectedUrls.has(img.url);
                    return (
                      <button
                        key={i}
                        onClick={() =>
                          setBrandSelectedUrls((prev) => {
                            const next = new Set(prev);
                            if (next.has(img.url)) next.delete(img.url);
                            else next.add(img.url);
                            return next;
                          })
                        }
                        className={`relative border-2 transition-colors ${
                          isSelected
                            ? "border-purple-500"
                            : "border-gray-700/50 hover:border-gray-500"
                        }`}
                      >
                        <img
                          src={img.url}
                          alt=""
                          className="w-full aspect-square object-cover"
                          onError={(e) => {
                            const parent = e.currentTarget.closest("button");
                            if (parent) parent.style.display = "none";
                          }}
                        />
                        {isSelected && (
                          <div className="absolute top-1 right-1 bg-purple-900/200 text-white p-0.5 rounded-sm">
                            <span className="text-[8px] font-bold">✓</span>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-center text-xs font-mono text-gray-500 py-12">
                  No results found
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {previewUrl && (
        <div
          className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center"
          onClick={() => setPreviewUrl(null)}
        >
          <div
            className="bg-gray-900 border border-gray-700/50 rounded-xl p-2 shadow-2xl max-w-[600px]"
            onClick={(e) => e.stopPropagation()}
          >
            <img src={previewUrl} alt="" className="w-full h-auto object-contain" />
            {previewPrompt && (
              <div className="px-2 py-2 space-y-1 border-t border-gray-800 mt-1">
                {previewPrompt.startsWith("STYLE:") && (
                  <p className="text-[9px] font-mono text-amber-400 font-bold">
                    {previewPrompt
                      .split("\n")[0]
                      .replace("STYLE: ", "")
                      .replace(".", "")}
                  </p>
                )}
                {(() => {
                  const lines = previewPrompt.split("\n").filter((l) => l.trim());
                  const directionLine = lines.find(
                    (l) =>
                      !l.startsWith("STYLE:") &&
                      !l.startsWith("Reference") &&
                      !l.startsWith("Photograph") &&
                      !l.startsWith("No text") &&
                      l.length > 10 &&
                      !l.includes("product photo")
                  );
                  return directionLine ? (
                    <p className="text-[8px] font-mono text-gray-500 truncate">
                      {directionLine}
                    </p>
                  ) : null;
                })()}
              </div>
            )}
            <div className="flex items-center justify-end gap-2 pt-1">
              <a
                href={previewUrl}
                download
                className="px-3 py-1 text-[10px] font-mono text-gray-400 hover:text-white flex items-center gap-1"
              >
                <Download className="h-3 w-3" /> Download
              </a>
              <button
                onClick={() => setPreviewUrl(null)}
                className="px-3 py-1 text-[10px] font-mono text-gray-500 hover:text-white cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
