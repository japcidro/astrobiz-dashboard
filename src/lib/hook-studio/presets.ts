/**
 * Prompt for the UGC Generator: swap the person in a still and return a
 * pure photo, nothing else.
 *
 * Rule one is the clean frame: every caption, sticker, emoji, watermark,
 * logo, icon, button, progress bar and app-interface element in the source
 * is removed and the background behind it rebuilt. Rule two is the person:
 * same gender, clearly different (skin tone, hair style, hair colour, face),
 * attractive and fit. Pose, expression, clothing, framing and background
 * stay.
 */
export function ugcSwapPrompt(note: string): string {
  const extra = note.trim() ? ` Also: ${note.trim()}.` : "";
  return (
    `Edit this photo and return a pure photograph: no text, no captions, no subtitles, no ` +
    `stickers, no emojis, no watermarks, no logos, no icons, no buttons, no progress bars, no ` +
    `play controls, no app interface of any kind. Remove all of those wherever they appear and ` +
    `rebuild the background behind them so nothing looks erased or blurred. ` +
    `Then replace the person with a completely different person of the same gender (a woman ` +
    `stays a woman, a man stays a man): attractive, fit and toned, healthy glowing skin, well ` +
    `groomed, photogenic, with a clearly different skin tone, a different hair style, a ` +
    `different hair colour and a new face, so the change is obvious at a glance. ` +
    `Keep everything else exactly as it is: the same pose, hand positions and facial expression, ` +
    `the same clothing, the same framing and crop, the same background, furniture, equipment, ` +
    `props, lighting and time of day. Photoreal, candid phone-camera look with natural skin ` +
    `texture.${extra}`
  );
}
