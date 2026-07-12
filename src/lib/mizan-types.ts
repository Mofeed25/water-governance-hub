export type Role = 'super' | 'local';

export type RiskGrade = 'high' | 'med' | 'stable';

export type SyncStatus = 'synced' | 'pending' | 'retrying' | 'failed';

export interface UserAccount {
  username: string;
  password: string;
  role: Role;
  displayName: string;
  projectId?: string; // for local tenants
  directorateName?: string;
}

export interface Directorate {
  id: string;
  name: string;
}

export interface WaterProject {
  id: string;
  name: string;
  directorateId: string;
  directorateName: string;
  establishedYear: number;
  households: number;
  productionM3: number;
  meteredConsumptionM3: number;
  tariffPerM3: number;
  subscribersCount: number;
  verifiedReadingsPct: number;
  collectedPct: number;
  governanceGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  conflictGrade: RiskGrade;
  lossRatePct: number;
  lastSync: string;
}

export interface Subscriber {
  id: string;
  projectId: string;
  name: string;
  zone: string;
  meterSerial: string;
  householdSize: number;
  balanceYER: number;
  status: 'active' | 'arrears' | 'disconnected';
}

export interface Reading {
  id: string;
  subscriberId: string;
  subscriberName: string;
  projectId: string;
  readingM3: number;
  previousM3: number;
  capturedAt: string;
  gps: { lat: number; lng: number };
  hasPhoto: boolean;
  syncStatus: SyncStatus;
  retries: number;
}

export interface Directive {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  body: string;
  severity: 'info' | 'warning' | 'critical';
  createdAt: string;
  acknowledged: boolean;
}

export interface WorkOrder {
  id: string;
  projectId: string;
  projectName: string;
  type: 'leak' | 'illegal_connection' | 'meter_fault';
  description: string;
  lossPct: number;
  createdAt: string;
  status: 'open' | 'in_progress' | 'closed';
}

export interface BillingLog {
  id: string;
  subscriberId: string;
  subscriberName: string;
  projectId: string;
  period: string;
  consumptionM3: number;
  amountYER: number;
  paid: boolean;
  paidAt: string | null;
}

export const ACCOUNTS: UserAccount[] = [
  {
    username: 'admin_taiz',
    password: 'Taiz2026',
    role: 'super',
    displayName: 'المشرف المركزي - محافظة تعز',
  },
  {
    username: 'mawasit_water',
    password: 'Maw123',
    role: 'local',
    displayName: 'مدير مشروع يفرس - المواسط',
    projectId: 'p-yaf-1',
    directorateName: 'المواسط',
  },
  {
    username: 'shamaytain_water',
    password: 'Sha123',
    role: 'local',
    displayName: 'مدير مشروع التربة - الشمايتين',
    projectId: 'p-tur-1',
    directorateName: 'الشمايتين',
  },
  {
    username: 'jabal_water',
    password: 'Jab123',
    role: 'local',
    displayName: 'مدير مشروع بلاد الوافي - جبل حبشي',
    projectId: 'p-waf-1',
    directorateName: 'جبل حبشي',
  },
];

export const DIRECTORATES: Directorate[] = [
  { id: 'd-maw', name: 'المواسط' },
  { id: 'd-sha', name: 'الشمايتين' },
  { id: 'd-jab', name: 'جبل حبشي' },
  { id: 'd-sab', name: 'صبر الموادم' },
  { id: 'd-maq', name: 'مقبنة' },
];

const taizNames = [
  'أحمد محمد الأغبري',
  'عبدالله علي القاسمي',
  'صالح حسن الشرعبي',
  'محمد عبدالكريم الحبيشي',
  'يحيى إسماعيل المقاطي',
  'ناصر قاسم العزاني',
  'فهد سعيد الصبيحي',
  'عمر محسن المتوكل',
  'بدر أحمد الكدسي',
  'حسين علي الشمايتي',
  'كمال عبدالله المواسطي',
  'زيد منصور الحبيشي',
  'طارق ناصر المقبي',
  'رمزي يحيى الصبري',
  'سمير عبدالكريم الأكوع',
  'حمدان صالح الذبحاني',
  'جبر محمد العامري',
  'نجيب أحمد الشاوري',
  'وليد سعيد القباطي',
  'عادل قاسم المفلحي',
  'منصور علي الحاج',
  'سعيد عبدالله اليماني',
  'فارق محمد المخلافي',
  'عبده ناصر الوصابي',
  'إبراهيم سعيد العولقي',
];

const taizZones = [
  'حي الجامع',
  'حي السوق',
  'حي القلعة',
  'حي الجبل',
  'حي الوحدة',
  'حي النصر',
  'حي الصفاء',
  'حي الأمل',
];

function seeded(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function gradeFromLoss(loss: number): WaterProject['governanceGrade'] {
  if (loss <= 12) return 'A';
  if (loss <= 18) return 'B';
  if (loss <= 25) return 'C';
  if (loss <= 35) return 'D';
  return 'F';
}

function riskFromLoss(loss: number, tariff: number): RiskGrade {
  if (loss > 28 || tariff > 1800) return 'high';
  if (loss > 18 || tariff > 1200) return 'med';
  return 'stable';
}

export const SEED_PROJECTS: WaterProject[] = [
  {
    id: 'p-yaf-1',
    name: 'مشروع مياه يفرس',
    directorateId: 'd-maw',
    directorateName: 'المواسط',
    establishedYear: 2017,
    households: 860,
    productionM3: 5200,
    meteredConsumptionM3: 4108,
    tariffPerM3: 1200,
    subscribersCount: 540,
    verifiedReadingsPct: 89,
    collectedPct: 84,
    governanceGrade: 'B',
    conflictGrade: 'med',
    lossRatePct: 21,
    lastSync: '2026-07-09T08:20:00Z',
  },
  {
    id: 'p-tur-1',
    name: 'مشروع مياه التربة',
    directorateId: 'd-sha',
    directorateName: 'الشمايتين',
    establishedYear: 2019,
    households: 720,
    productionM3: 4100,
    meteredConsumptionM3: 3526,
    tariffPerM3: 1000,
    subscribersCount: 480,
    verifiedReadingsPct: 94,
    collectedPct: 92,
    governanceGrade: 'A',
    conflictGrade: 'stable',
    lossRatePct: 14,
    lastSync: '2026-07-09T07:45:00Z',
  },
  {
    id: 'p-waf-1',
    name: 'مشروع بلاد الوافي',
    directorateId: 'd-jab',
    directorateName: 'جبل حبشي',
    establishedYear: 2020,
    households: 640,
    productionM3: 3800,
    meteredConsumptionM3: 2622,
    tariffPerM3: 1500,
    subscribersCount: 410,
    verifiedReadingsPct: 71,
    collectedPct: 66,
    governanceGrade: 'D',
    conflictGrade: 'high',
    lossRatePct: 31,
    lastSync: '2026-07-08T22:10:00Z',
  },
  {
    id: 'p-sab-1',
    name: 'مشروع مياه صبر الموادم',
    directorateId: 'd-sab',
    directorateName: 'صبر الموادم',
    establishedYear: 2018,
    households: 980,
    productionM3: 6300,
    meteredConsumptionM3: 5166,
    tariffPerM3: 1300,
    subscribersCount: 620,
    verifiedReadingsPct: 86,
    collectedPct: 79,
    governanceGrade: 'C',
    conflictGrade: 'med',
    lossRatePct: 18,
    lastSync: '2026-07-09T06:30:00Z',
  },
  {
    id: 'p-maq-1',
    name: 'مشروع مياه مقبنة',
    directorateId: 'd-maq',
    directorateName: 'مقبنة',
    establishedYear: 2016,
    households: 1100,
    productionM3: 7100,
    meteredConsumptionM3: 4899,
    tariffPerM3: 1700,
    subscribersCount: 690,
    verifiedReadingsPct: 78,
    collectedPct: 72,
    governanceGrade: 'D',
    conflictGrade: 'high',
    lossRatePct: 31,
    lastSync: '2026-07-08T19:00:00Z',
  },
];

export function seedSubscribers(projects: WaterProject[]): Subscriber[] {
  const out: Subscriber[] = [];
  let n = 1;
  projects.forEach((p) => {
    const rnd = seeded(n * 7 + p.subscribersCount);
    const count = Math.min(14, Math.max(6, Math.round(p.subscribersCount / 90)));
    for (let i = 0; i < count; i++) {
      const name = taizNames[(n + i) % taizNames.length];
      const balance = Math.round((rnd() * 4) * p.tariffPerM3);
      const r = rnd();
      const status: Subscriber['status'] =
        r > 0.82 ? 'arrears' : r > 0.95 ? 'disconnected' : 'active';
      out.push({
        id: `s-${p.id}-${i}`,
        projectId: p.id,
        name,
        zone: taizZones[(n + i) % taizZones.length],
        meterSerial: `TA-${p.id.slice(-3).toUpperCase()}-${(1000 + n + i)}`,
        householdSize: 4 + Math.floor(rnd() * 7),
        balanceYER: status === 'active' ? 0 : balance,
        status,
      });
      n++;
    }
  });
  return out;
}

export function seedBilling(projects: WaterProject[], subs: Subscriber[]): BillingLog[] {
  const out: BillingLog[] = [];
  const periods = ['2026-06', '2026-05', '2026-04'];
  subs.forEach((s, idx) => {
    const p = projects.find((x) => x.id === s.projectId)!;
    const rnd = seeded(idx + s.id.length);
    periods.forEach((period) => {
      const consumption = Math.round(8 + rnd() * 22);
      const amount = consumption * p.tariffPerM3;
      const paid = rnd() > 0.3;
      out.push({
        id: `b-${s.id}-${period}`,
        subscriberId: s.id,
        subscriberName: s.name,
        projectId: p.id,
        period,
        consumptionM3: consumption,
        amountYER: amount,
        paid,
        paidAt: paid ? `${period}-15T10:00:00Z` : null,
      });
    });
  });
  return out;
}

export function seedReadings(subs: Subscriber[]): Reading[] {
  return subs.slice(0, 18).map((s, i) => {
    const rnd = seeded(i + 3);
    const prev = 100 + Math.floor(rnd() * 400);
    const cur = prev + Math.floor(4 + rnd() * 24);
    const statuses: SyncStatus[] = ['synced', 'synced', 'synced', 'pending', 'retrying'];
    return {
      id: `r-${s.id}-${i}`,
      subscriberId: s.id,
      subscriberName: s.name,
      projectId: s.projectId,
      readingM3: cur,
      previousM3: prev,
      capturedAt: `2026-07-0${(i % 9) + 1}T0${(i % 8) + 1}:00:00Z`,
      gps: { lat: 13.35 + rnd() * 0.3, lng: 43.9 + rnd() * 0.3 },
      hasPhoto: rnd() > 0.2,
      syncStatus: statuses[i % statuses.length],
      retries: i % 3 === 0 ? 2 : 0,
    };
  });
}

export function seedDirectives(_projects: WaterProject[]): Directive[] {
  return [
    {
      id: 'dir-1',
      projectId: 'p-waf-1',
      projectName: 'مشروع بلاد الوافي',
      title: 'تعميم: تجاوز نسبة الفاقد المائي الحد الحرج',
      body: 'لوحظ تجاوز نسبة الفاقد المائي 31% في مشروع بلاد الوافي بجبل حبشي، وهو ما يستوجب فتح أعمال صيانة عاجلة لكشف التسربات ومراجعة الوصلات غير النظامية خلال 14 يوماً.',
      severity: 'critical',
      createdAt: '2026-07-07T09:00:00Z',
      acknowledged: false,
    },
    {
      id: 'dir-2',
      projectId: 'p-maq-1',
      projectName: 'مشروع مياه مقبنة',
      title: 'توجيه: توحيد تعرفة المياه وفق الجدول المعتمد',
      body: 'يرجى الالتزام بالتعرفة المعتمدة وإيقاف أي رسوم إضافية غير مبررة في مشروع مياه مقبنة لحين مراجعة لجنة التسعير المركزية في المحافظة.',
      severity: 'warning',
      createdAt: '2026-07-05T12:00:00Z',
      acknowledged: false,
    },
    {
      id: 'dir-3',
      projectId: 'p-yaf-1',
      projectName: 'مشروع مياه يفرس',
      title: 'إشعار: رفع نسبة القراءات الموثقة ميدانياً',
      body: 'نوصي برفع نسبة القراءات الموثقة بالـ GPS والصور إلى ما فوق 95% في مشروع يفرس بالمواسط لتعزيز شفافية الفوترة قبل الجولة المقبلة.',
      severity: 'info',
      createdAt: '2026-07-02T08:00:00Z',
      acknowledged: true,
    },
  ];
}

export function seedWorkOrders(projects: WaterProject[]): WorkOrder[] {
  return projects
    .filter((p) => p.lossRatePct > 15)
    .map((p, i) => ({
      id: `wo-${p.id}`,
      projectId: p.id,
      projectName: p.name,
      type: p.lossRatePct > 25 ? ('illegal_connection' as const) : ('leak' as const),
      description:
        p.lossRatePct > 25
          ? 'أمر مسح للوصلات غير النظامية بسبب تجاوز الفاقد 25%'
          : 'أمر كشف تسربات شبكة بسبب تجاوز الفاقد 15%',
      lossPct: p.lossRatePct,
      createdAt: `2026-07-0${(i % 6) + 1}T07:00:00Z`,
      status: (i % 3 === 0 ? 'open' : i % 3 === 1 ? 'in_progress' : 'closed') as WorkOrder['status'],
    }));
}

export function recomputeProject(p: WaterProject): WaterProject {
  const loss = p.productionM3 > 0 ? +(((p.productionM3 - p.meteredConsumptionM3) / p.productionM3) * 100).toFixed(1) : 0;
  return {
    ...p,
    lossRatePct: loss,
    governanceGrade: gradeFromLoss(loss),
    conflictGrade: riskFromLoss(loss, p.tariffPerM3),
  };
}
