import { createWorker, type Worker } from "tesseract.js";
import { canonicalizeMeterSerial, normalizeOcrDigits, parseCurrentReading } from "@/lib/meter-reading-evidence";

const OCR_LANG_PATH = "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int";
const OCR_CACHE_PATH = "mizan-meter-ocr-eng-v1";
const MAX_OCR_DIMENSION = 1800;
const MIN_CONFIDENCE = 0.9;

let workerPromise: Promise<Worker> | null = null;

export interface MeterOcrResult {
  meterSerialExtracted: string | null;
  currentReading: number | null;
  readingOcrConfidence: number;
  meterIdentityConfidence: number;
  ocrProcessingMs: number;
  rawText: string;
}

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker("eng", 1, {
      langPath: OCR_LANG_PATH,
      cachePath: OCR_CACHE_PATH,
      cacheMethod: "write",
      gzip: true,
    }).then(async (worker) => {
      await worker.setParameters({
        tessedit_pageseg_mode: "11",
        tessedit_char_whitelist: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.-٠١٢٣٤٥٦٧٨٩",
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
      });
      return worker;
    }).catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

async function preprocessImage(source: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  const scale = Math.min(1, MAX_OCR_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    throw new Error("تعذر تجهيز صورة العداد للقراءة");
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const image = context.getImageData(0, 0, width, height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const contrast = Math.max(0, Math.min(255, (luminance - 128) * 1.25 + 128));
    data[i] = contrast;
    data[i + 1] = contrast;
    data[i + 2] = contrast;
  }
  context.putImageData(image, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("تعذر تحويل صورة العداد"))), "image/jpeg", 0.92);
  });
}

function tsvWords(tsv: string): Array<{ text: string; confidence: number }> {
  return tsv.split(/\r?\n/).slice(1).flatMap((line) => {
    const columns = line.split("\t");
    if (columns.length < 12) return [];
    const text = columns[11]?.trim();
    const confidence = Number(columns[10]);
    if (!text || !Number.isFinite(confidence) || confidence < 0) return [];
    return [{ text, confidence: confidence / 100 }];
  });
}

function findExactSerial(words: Array<{ text: string; confidence: number }>, registeredSerial: string) {
  const registered = canonicalizeMeterSerial(registeredSerial);
  const exact = words.find((word) => canonicalizeMeterSerial(word.text) === registered);
  if (exact) return { value: exact.text, confidence: exact.confidence };
  return null;
}

function findStrictReading(words: Array<{ text: string; confidence: number }>, registeredSerial: string): { value: number; confidence: number } | null {
  const serial = canonicalizeMeterSerial(registeredSerial);
  const candidates = words
    .filter((word) => word.confidence >= MIN_CONFIDENCE)
    .map((word) => ({ ...word, normalized: normalizeOcrDigits(word.text).replace(",", ".") }))
    .filter((word) => /^\d+(?:\.\d+)?$/.test(word.normalized))
    .filter((word) => canonicalizeMeterSerial(word.text) !== serial)
    .map((word) => ({ value: parseCurrentReading(word.normalized), confidence: word.confidence }))
    .filter((word): word is { value: number; confidence: number } => word.value !== null);

  if (candidates.length !== 1) return null;
  return candidates[0];
}

export async function recognizeMeterImage(photo: Blob, registeredSerial: string): Promise<MeterOcrResult> {
  const started = performance.now();
  const processed = await preprocessImage(photo);
  const worker = await getWorker();
  const result = await worker.recognize(processed, {}, { text: true, tsv: true });
  const words = tsvWords(result.data.tsv ?? "");
  const serial = findExactSerial(words, registeredSerial);
  const reading = findStrictReading(words, registeredSerial);
  const elapsed = Math.round(performance.now() - started);

  return {
    meterSerialExtracted: serial?.value ? canonicalizeMeterSerial(serial.value) : null,
    currentReading: reading?.value ?? null,
    readingOcrConfidence: reading?.confidence ?? 0,
    meterIdentityConfidence: serial?.confidence ?? 0,
    ocrProcessingMs: elapsed,
    rawText: result.data.text ?? "",
  };
}

export async function warmMeterOcr(): Promise<void> {
  await getWorker();
}
