/**
 * Builds a PDF from photos, one page per photo, for the scan button. Each
 * photo is re-encoded as a JPEG (at most 2000px on the long side) and
 * embedded with DCTDecode, so no PDF library is needed.
 */

const MAX_SIDE = 2000;
/** Pixels per inch assumed when sizing pages: a 2000px photo becomes an 11 x 13.3 in page. */
const DPI = 150;

interface Jpeg {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
}

const loadImage = (blob: Blob): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => (URL.revokeObjectURL(url), resolve(img));
    img.onerror = () => (URL.revokeObjectURL(url), reject(new Error("That photo couldn't be read.")));
    img.src = url;
  });

/** Re-encodes an image as a JPEG no larger than MAX_SIDE. */
export const toJpeg = async (blob: Blob): Promise<Jpeg> => {
  const img = await loadImage(blob);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.round(img.naturalWidth * scale);
  const height = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const jpeg = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't encode the photo."))), "image/jpeg", 0.82)
  );
  return { bytes: new Uint8Array(await jpeg.arrayBuffer()), width, height };
};

export const imagesToPdf = async (photos: readonly Blob[]): Promise<Blob> => {
  const pages = [];
  for (const p of photos) pages.push(await toJpeg(p));

  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: string | Uint8Array) => {
    const bytes = typeof chunk === "string" ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, ...body: (string | Uint8Array)[]) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    body.forEach(push);
    push("\nendobj\n");
  };

  // Objects: 1 catalog, 2 page tree, then per page: page, content stream, image.
  const pageId = (i: number) => 3 + i * 3;
  push("%PDF-1.4\n%âãÏÓ\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  pages.forEach((p, i) => {
    const w = ((p.width * 72) / DPI).toFixed(2);
    const h = ((p.height * 72) / DPI).toFixed(2);
    const id = pageId(i);
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`);
    object(id + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    object(
      id + 2,
      `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.bytes.length} >>\nstream\n`,
      p.bytes,
      "\nendstream"
    );
  });

  const count = 2 + pages.length * 3;
  const xref = length;
  push(`xref\n0 ${count + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= count; id++) push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts as BlobPart[], { type: "application/pdf" });
};
