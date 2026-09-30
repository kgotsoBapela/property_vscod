/**
 * Minimal 5-field cron ("m h dom mon dow") evaluated in an IANA timezone.
 * Supports *, lists (1,2), ranges (1-5) and steps (*\/15, 0-30/5). Used for sync schedules.
 */
type Field = Set<number>;

function parseField(expr: string, min: number, max: number): Field {
  const out = new Set<number>();
  for (const part of expr.split(",")) {
    const [range, stepStr] = part.split("/");
    const step = stepStr ? Number(stepStr) : 1;
    if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid cron step: ${part}`);
    let lo = min;
    let hi = max;
    if (range !== "*") {
      const [a, b] = range!.split("-");
      lo = Number(a);
      hi = b === undefined ? (stepStr ? max : lo) : Number(b);
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) throw new Error(`Invalid cron field: ${part}`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("Cron expression must have 5 fields");
  const dow = parseField(parts[4]!, 0, 7);
  if (dow.has(7)) dow.add(0);
  return {
    minute: parseField(parts[0]!, 0, 59),
    hour: parseField(parts[1]!, 0, 23),
    dom: parseField(parts[2]!, 1, 31),
    month: parseField(parts[3]!, 1, 12),
    dow,
    domAny: parts[2] === "*",
    dowAny: parts[4] === "*",
  };
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function localParts(d: Date, fmt: Intl.DateTimeFormat) {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return {
    minute: Number(p.minute),
    hour: Number(p.hour) % 24,
    dom: Number(p.day),
    month: Number(p.month),
    dow: WEEKDAYS[p.weekday as string] ?? 0,
  };
}

/** Next run strictly after `from`, or null if none within a year. */
export function nextCronRun(expr: string, timeZone: string, from: Date = new Date()): Date | null {
  const c = parseCron(expr);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    minute: "numeric",
    hour: "numeric",
    day: "numeric",
    month: "numeric",
    weekday: "short",
  });
  let t = new Date(Math.floor(from.getTime() / 60_000) * 60_000 + 60_000);
  const limit = from.getTime() + 366 * 86_400_000;
  while (t.getTime() <= limit) {
    const l = localParts(t, fmt);
    const dayOk =
      c.domAny && c.dowAny ? true : c.domAny ? c.dow.has(l.dow) : c.dowAny ? c.dom.has(l.dom) : c.dom.has(l.dom) || c.dow.has(l.dow);
    if (!c.month.has(l.month) || !dayOk) {
      t = new Date(t.getTime() + (60 - l.minute) * 60_000 + (23 - l.hour) * 3_600_000); // jump to next local day
      continue;
    }
    if (!c.hour.has(l.hour)) {
      t = new Date(t.getTime() + (60 - l.minute) * 60_000); // next hour
      continue;
    }
    if (c.minute.has(l.minute)) return t;
    t = new Date(t.getTime() + 60_000);
  }
  return null;
}
