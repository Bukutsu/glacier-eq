import { decodeUtf8 } from "./utf8";

export async function readTextFile(
  file: File,
): Promise<{ name: string; text: string }> {
  if (file.size > 1_048_576) throw new Error("File exceeds the 1 MiB limit");
  return { name: file.name, text: decodeUtf8(await file.arrayBuffer()) };
}
