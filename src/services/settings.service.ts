import { prisma } from "../lib/prisma";

export const SETTING_KEYS = {
  ACTIVE_QRIS_URL: "ACTIVE_QRIS_URL",
  ACTIVE_QRIS_FILENAME: "ACTIVE_QRIS_FILENAME",
  /** Teks kode QRIS statis (hasil scan) untuk membuat QRIS dinamis dengan nominal otomatis. */
  QRIS_PAYLOAD: "QRIS_PAYLOAD",
} as const;

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  return prisma.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

export async function getActiveQris(): Promise<{ url: string; filename: string } | null> {
  const url = await getSetting(SETTING_KEYS.ACTIVE_QRIS_URL);
  const filename = await getSetting(SETTING_KEYS.ACTIVE_QRIS_FILENAME);

  if (!url) return null;

  return {
    url,
    filename: filename ?? "qris.png",
  };
}

export async function setActiveQris(url: string, filename = "qris.png") {
  await setSetting(SETTING_KEYS.ACTIVE_QRIS_URL, url);
  await setSetting(SETTING_KEYS.ACTIVE_QRIS_FILENAME, filename);
}

/**
 * Sets the active QRIS from a manually-pasted link instead of an uploaded
 * file - e.g. a QRIS image already hosted elsewhere. Reuses the same
 * ACTIVE_QRIS_URL/ACTIVE_QRIS_FILENAME keys as setActiveQris(), so the bot's
 * getActiveQris() and every existing caller keep working unchanged.
 */
export async function setActiveQrisLink(url: string) {
  await setActiveQris(url, "Link QRIS");
}

export async function clearActiveQris() {
  await prisma.setting.deleteMany({
    where: {
      key: {
        in: [
          SETTING_KEYS.ACTIVE_QRIS_URL,
          SETTING_KEYS.ACTIVE_QRIS_FILENAME,
        ],
      },
    },
  });
}

export async function getQrisPayload(): Promise<string | null> {
  return getSetting(SETTING_KEYS.QRIS_PAYLOAD);
}

export async function setQrisPayload(payload: string) {
  await setSetting(SETTING_KEYS.QRIS_PAYLOAD, payload);
}

export async function clearQrisPayload() {
  await prisma.setting.deleteMany({ where: { key: SETTING_KEYS.QRIS_PAYLOAD } });
}

/** true bila QRIS dinamis (nominal otomatis) sudah diatur. */
export async function hasDynamicQris(): Promise<boolean> {
  return Boolean(await getQrisPayload());
}
