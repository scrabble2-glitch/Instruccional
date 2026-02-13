import JSZip from "jszip";

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#xA;/gi, "\n")
    .replace(/&#xD;/gi, "\n");
}

function extractAText(xml: string): string[] {
  const out: string[] = [];
  const matches = xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g);
  for (const match of matches) {
    const raw = match[1] ?? "";
    const decoded = decodeXmlEntities(raw).trim();
    if (decoded) out.push(decoded);
  }
  return out;
}

function extractWText(xml: string): string[] {
  const out: string[] = [];
  const paragraphs = xml.split(/<\/w:p>/g);
  for (const paragraph of paragraphs) {
    const matches = paragraph.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g);
    const tokens: string[] = [];
    for (const match of matches) {
      const raw = match[1] ?? "";
      const decoded = decodeXmlEntities(raw).trim();
      if (decoded) tokens.push(decoded);
    }
    const line = tokens.join(" ").trim();
    if (line) out.push(line);
  }
  return out;
}

function sortByNumericSuffix(pattern: RegExp) {
  return (a: string, b: string) => {
    const getIndex = (value: string) => {
      const match = value.match(pattern);
      return match ? Number(match[1]) : 0;
    };
    return getIndex(a) - getIndex(b);
  };
}

export async function extractPptxTextFromArrayBuffer(arrayBuffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const slideNames = Object.keys(zip.files)
    .filter((name) => name.startsWith("ppt/slides/slide") && name.endsWith(".xml"))
    .sort(sortByNumericSuffix(/slide(\d+)\.xml$/));

  const notesNames = Object.keys(zip.files)
    .filter((name) => name.startsWith("ppt/notesSlides/notesSlide") && name.endsWith(".xml"))
    .sort(sortByNumericSuffix(/notesSlide(\d+)\.xml$/));

  const parts: string[] = [];
  for (const slideName of slideNames) {
    const file = zip.file(slideName);
    if (!file) continue;
    const xml = await file.async("text");
    parts.push(...extractAText(xml));
  }

  for (const notesName of notesNames) {
    const file = zip.file(notesName);
    if (!file) continue;
    const xml = await file.async("text");
    parts.push(...extractAText(xml));
  }

  return parts.join("\n");
}

export async function extractDocxTextFromArrayBuffer(arrayBuffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const doc = zip.file("word/document.xml");
  if (!doc) return "";
  const xml = await doc.async("text");
  return extractWText(xml).join("\n");
}

