import type { Attachment, ImageFormat, OutputMode, PersonMode, ProductMode, TextStyle } from "./types";

/** Nano Banana Pro's aspect ratio for a social format; a pair is one wide image split in two. */
export function aspectFor(format: ImageFormat, output: OutputMode): string {
  if (output === "pair") return "16:9";
  return format === "1.91:1" ? "16:9" : format;
}

export interface PromptInput {
  instruction: string;
  attachments: Attachment[];
  product_mode: ProductMode;
  person_mode: PersonMode;
  output: OutputMode;
  format: ImageFormat;
  text_on_image: string;
  text_style: TextStyle;
  brandRules: string;
  store: string | null;
}

/**
 * The prompt the studio sends: the user's words first, then what every
 * attached image is for, then the brand, person, product, text and output
 * rules that always apply. Images are numbered in the order they are sent.
 */
export function studioPrompt(i: PromptInput): string {
  const parts: string[] = [];
  const instruction = i.instruction.trim();
  parts.push(instruction ? instruction : "Create a scroll-stopping social media image for our brand.");

  if (i.attachments.length) {
    const lines = i.attachments.map((a, n) => {
      const k = n + 1;
      switch (a.role) {
        case "reference":
          return `Image ${k} is a REFERENCE: copy its layout, composition, framing, pose and text placement; do not copy its people, products or brand names.`;
        case "model":
          return `Image ${k} is our MODEL: the person in the output is this exact individual, with the same face, facial features, skin tone, hair and body. Do not use anyone else's face and do not blend faces.`;
        case "product":
          return `Image ${k} is our PRODUCT: reproduce it exactly, same shape, colors and label, with every word of the label copied letter for letter, sharp and legible, nothing invented.`;
        default:
          return `Image ${k} is a LOOK reference: use only its style, lighting, colors or subject matter; do not copy its people, products or text.`;
      }
    });
    parts.push(lines.join(" "));
  }

  const hasModel = i.attachments.some((a) => a.role === "model");
  const hasProduct = i.attachments.some((a) => a.role === "product");

  if (i.person_mode === "none") parts.push("No person appears in the image: no face, no body, no hands, unless the instruction explicitly asks for hands.");
  else if (i.person_mode === "new") parts.push("The person is a new, attractive Filipino adult who looks nothing like anyone in the reference images.");
  else if (hasModel) parts.push("The person is our model from the attached image, recognisably the same individual.");
  else parts.push("If a person appears, they are a natural-looking Filipino adult; do not copy the face of anyone in the reference images.");

  if (i.product_mode === "none") parts.push("No product, bottle, box or packaging appears; if the reference shows one, leave it out and rebuild the scene naturally.");
  else if (hasProduct) parts.push("Our product from the attached product image appears at its true real-world size relative to hands and faces: a supplement bottle is palm-sized, fingers wrap most of the way around it; never enlarged to fill the frame.");
  else parts.push("Any product shown is unbranded and generic; no readable brand names.");

  const text = i.text_on_image.trim().replace(/"/g, "'");
  if (text) parts.push(`Render exactly this text on the image, letter for letter, nothing added: "${text}". ${i.text_style === "reference" ? "Match the reference's typography, size, colors and placement." : "Clean, modern, highly legible typography that suits the image."}`);
  else if (i.text_style === "clean") parts.push("No text, captions, logos or watermarks anywhere in the image.");
  else parts.push("Add no text unless the instruction asks for it; never copy the reference's words.");

  if (i.output === "pair") {
    parts.push("Produce ONE wide image made of two equal panels side by side, split exactly down the middle with a thin clean divider: LEFT panel = BEFORE, RIGHT panel = AFTER. Same subject, same camera angle, framing, lighting and background in both panels; only the change described differs. No labels or text in either panel.");
  } else if (i.output === "set3") {
    parts.push("This is one image of a set of three that share the same style; keep it consistent with the instruction.");
  }

  parts.push("Photoreal, phone-camera realism with natural skin and surfaces, no watermarks, no competitor brand names or logos anywhere, nothing that looks pasted on.");
  if (i.brandRules.trim()) parts.push(`Brand rules${i.store ? ` for ${i.store}` : ""}: ${i.brandRules.trim()}.`);
  parts.push(`Output aspect ratio ${aspectFor(i.format, i.output)}.`);
  return parts.join(" ");
}
