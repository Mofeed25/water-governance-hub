// Arabic Tafqit — convert integer amount to Arabic words (feminine ريال يمني)
// Handles up to 999,999,999,999.

const ONES = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة"];
const TEENS = ["عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
const TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const HUNDREDS = ["", "مئة", "مئتان", "ثلاثمئة", "أربعمئة", "خمسمئة", "ستمئة", "سبعمئة", "ثمانمئة", "تسعمئة"];

function under1000(n: number): string {
  if (n === 0) return "";
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(HUNDREDS[h]);
  if (r) {
    if (r < 10) parts.push(ONES[r]);
    else if (r < 20) parts.push(TEENS[r - 10]);
    else {
      const t = Math.floor(r / 10);
      const o = r % 10;
      if (o) parts.push(`${ONES[o]} و${TENS[t]}`);
      else parts.push(TENS[t]);
    }
  }
  return parts.join(" و");
}

function group(n: number, singular: string, dual: string, plural: string): string {
  if (n === 0) return "";
  if (n === 1) return singular;
  if (n === 2) return dual;
  if (n >= 3 && n <= 10) return `${under1000(n)} ${plural}`;
  return `${under1000(n)} ${singular}`;
}

export function tafqitYER(amount: number): string {
  const n = Math.floor(Math.abs(amount));
  if (n === 0) return "صفر ريال يمني فقط لا غير";

  const billions = Math.floor(n / 1_000_000_000);
  const millions = Math.floor((n % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;

  const parts: string[] = [];
  if (billions) parts.push(group(billions, "مليار", "ملياران", "مليارات"));
  if (millions) parts.push(group(millions, "مليون", "مليونان", "ملايين"));
  if (thousands) parts.push(group(thousands, "ألف", "ألفان", "آلاف"));
  if (rest) parts.push(under1000(rest));

  return `${parts.join(" و")} ريال يمني فقط لا غير`;
}
