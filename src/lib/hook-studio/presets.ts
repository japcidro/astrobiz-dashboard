/**
 * Prompt for the UGC Generator: swap the person in a still, keep everything
 * else. The difference must be obvious (skin tone, body type, hair style,
 * hair colour, face); gender, pose, clothing, framing and background stay.
 */
export function ugcSwapPrompt(note: string): string {
  const extra = note.trim() ? ` Also: ${note.trim()}.` : "";
  return (
    `Replace the person in this photo with a completely different person of the same gender ` +
    `(a woman stays a woman, a man stays a man). Make the difference obvious at a glance: ` +
    `a clearly different skin tone, a different body type, a different hair style and a different ` +
    `hair colour, and a new face. Keep everything else exactly as it is: the same pose and hand ` +
    `positions, the same clothing, the same framing and crop, the same background, furniture, ` +
    `props, phone, earphones, lighting and time of day. Photoreal, candid phone-camera look with ` +
    `natural skin texture. No text, no logo, no watermark.${extra}`
  );
}
