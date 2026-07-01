export interface ManifestRow {
  inventory_number: string;
  image_url: string;
  is_primary: boolean;
  sort_order: number;
  short_description: string | null;
}

/** Loose truthy parse for CSV booleans. */
export function parseBool(v: string | undefined): boolean {
  return /^(true|yes|y|1)$/i.test((v ?? "").trim());
}

/** Validate and normalize one raw CSV record. Returns either a row or an error. */
export function parseManifestRow(
  raw: Record<string, string>,
  line: number
): { row?: ManifestRow; error?: string } {
  const inventory_number = (raw.inventory_number ?? "").trim();
  const image_url = (raw.image_url ?? "").trim();
  if (!inventory_number) return { error: `line ${line}: missing inventory_number` };
  if (!image_url) return { error: `line ${line}: missing image_url` };

  const sortRaw = parseInt((raw.sort_order ?? "0").trim(), 10);
  return {
    row: {
      inventory_number,
      image_url,
      is_primary: parseBool(raw.is_primary),
      sort_order: Number.isFinite(sortRaw) ? sortRaw : 0,
      short_description: (raw.short_description ?? "").trim() || null,
    },
  };
}
