export interface ImportableEmail {
  name: string;
  blob: Blob;
}

const EMAIL_MIME = "message/rfc822";

function isEmlName(name: string): boolean {
  return /\.eml$/i.test(name);
}

function isZipName(name: string): boolean {
  return /\.zip$/i.test(name);
}

async function extractEmlsFromZip(file: File): Promise<ImportableEmail[]> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const out: ImportableEmail[] = [];
  const entries = Object.values(zip.files);
  for (const entry of entries) {
    if (entry.dir) continue;
    if (!isEmlName(entry.name)) continue;
    const data = await entry.async("arraybuffer");
    out.push({
      name: entry.name.split(/[\\/]/).pop() || entry.name,
      blob: new Blob([data], { type: EMAIL_MIME }),
    });
  }
  return out;
}

export async function expandImportableEmails(
  files: File[],
): Promise<ImportableEmail[]> {
  const out: ImportableEmail[] = [];
  for (const file of files) {
    if (isZipName(file.name) || file.type === "application/zip") {
      out.push(...(await extractEmlsFromZip(file)));
      continue;
    }
    const blob = new Blob([await file.arrayBuffer()], { type: EMAIL_MIME });
    out.push({ name: file.name, blob });
  }
  return out;
}

export const EML_IMPORT_ACCEPT = ".eml,.zip,message/rfc822,application/zip";
