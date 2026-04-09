"use client";

import { useState, useRef } from "react";
import { Upload, X, Image, Film, Loader2, CheckCircle } from "lucide-react";

const FB_API_BASE = "https://graph.facebook.com/v21.0";

interface CreativeUploaderProps {
  type: "image" | "video";
  adAccountId: string;
  fileName: string | null;
  previewUrl: string | null;
  imageHash: string | null;
  videoId: string | null;
  onUploaded: (result: {
    image_hash?: string | null;
    video_id?: string | null;
    file_name: string;
    file_preview_url: string | null;
  }) => void;
  onClear: () => void;
  onTypeChange: (type: "image" | "video") => void;
}

export function CreativeUploader({
  type,
  adAccountId,
  fileName,
  previewUrl,
  imageHash,
  videoId,
  onUploaded,
  onClear,
  onTypeChange,
}: CreativeUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasFile = !!(imageHash || videoId);

  const handleFile = async (file: File) => {
    // Validate
    if (type === "image" && !file.type.startsWith("image/")) {
      setError("Please upload an image file (JPG, PNG)");
      return;
    }
    if (type === "video" && !file.type.startsWith("video/")) {
      setError("Please upload a video file (MP4, MOV)");
      return;
    }
    if (type === "image" && file.size > 30 * 1024 * 1024) {
      setError("Image must be under 30MB");
      return;
    }
    if (type === "video" && file.size > 150 * 1024 * 1024) {
      setError("Video must be under 150MB");
      return;
    }

    setError(null);
    setUploading(true);

    try {
      // Get FB token from our API (small request, no size issues)
      const tokenRes = await fetch("/api/facebook/token");
      if (!tokenRes.ok) {
        const tokenErr = await tokenRes.json();
        throw new Error(tokenErr.error || "Failed to get token");
      }
      const { token } = await tokenRes.json();

      // Upload directly to Facebook from the browser (bypasses Vercel size limit)
      const fbForm = new FormData();
      fbForm.append("access_token", token);

      if (type === "image") {
        fbForm.append("filename", file);

        const res = await fetch(`${FB_API_BASE}/${adAccountId}/adimages`, {
          method: "POST",
          body: fbForm,
        });

        const json = await res.json();
        if (!res.ok) {
          const fbErr = json.error as Record<string, unknown> | undefined;
          throw new Error((fbErr?.message as string) || `FB API error: ${res.status}`);
        }

        const images = json.images as Record<string, { hash: string; url: string }>;
        const firstKey = Object.keys(images)[0];
        const imageData = images[firstKey];

        onUploaded({
          image_hash: imageData.hash,
          video_id: null,
          file_name: file.name,
          file_preview_url: URL.createObjectURL(file),
        });
      } else {
        fbForm.append("source", file);
        fbForm.append("title", file.name);

        const res = await fetch(`${FB_API_BASE}/${adAccountId}/advideos`, {
          method: "POST",
          body: fbForm,
        });

        const json = await res.json();
        if (!res.ok) {
          const fbErr = json.error as Record<string, unknown> | undefined;
          throw new Error((fbErr?.message as string) || `FB API error: ${res.status}`);
        }

        onUploaded({
          image_hash: null,
          video_id: json.id as string,
          file_name: file.name,
          file_preview_url: null,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div>
      <label className="block text-sm text-gray-400 mb-2">Creative</label>

      {/* Type toggle */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => onTypeChange("image")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
            type === "image"
              ? "bg-white text-gray-900"
              : "bg-gray-700 text-gray-400 hover:text-white"
          }`}
        >
          <Image size={14} />
          Image
        </button>
        <button
          onClick={() => onTypeChange("video")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
            type === "video"
              ? "bg-white text-gray-900"
              : "bg-gray-700 text-gray-400 hover:text-white"
          }`}
        >
          <Film size={14} />
          Video
        </button>
      </div>

      {/* Upload area or preview */}
      {hasFile ? (
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-4">
          <div className="flex items-center gap-3">
            {previewUrl && type === "image" ? (
              <img
                src={previewUrl}
                alt="Preview"
                className="w-16 h-16 rounded-lg object-cover"
              />
            ) : (
              <div className="w-16 h-16 rounded-lg bg-gray-700 flex items-center justify-center">
                {type === "image" ? (
                  <Image size={24} className="text-gray-500" />
                ) : (
                  <Film size={24} className="text-gray-500" />
                )}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate">{fileName}</p>
              <div className="flex items-center gap-1.5 mt-1">
                <CheckCircle size={12} className="text-green-400" />
                <span className="text-xs text-green-400">
                  Uploaded to Facebook
                </span>
              </div>
            </div>
            <button
              onClick={() => {
                onClear();
                if (inputRef.current) inputRef.current.value = "";
              }}
              className="text-gray-400 hover:text-red-400 cursor-pointer p-1"
              title="Remove"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
            dragOver
              ? "border-blue-500 bg-blue-500/5"
              : "border-gray-600 hover:border-gray-500"
          }`}
        >
          {uploading ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 size={32} className="text-white animate-spin" />
              <p className="text-sm text-gray-400">
                Uploading to Facebook...
              </p>
            </div>
          ) : (
            <>
              <Upload size={32} className="mx-auto text-gray-500 mb-3" />
              <p className="text-sm text-gray-300">
                Drag & drop or click to upload
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {type === "image"
                  ? "JPG, PNG — max 30MB"
                  : "MP4, MOV — max 150MB"}
              </p>
            </>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={type === "image" ? "image/*" : "video/*"}
        onChange={handleInputChange}
        className="hidden"
      />

      {error && (
        <p className="text-red-400 text-xs mt-2">{error}</p>
      )}
    </div>
  );
}
