/** Case-insensitive fuzzy search using subsequence matching.
 *
 *  Splits `query` into whitespace-separated tokens.
 *  Returns true if every token's characters appear **in order**
 *  (not necessarily consecutively) within `target`.
 *
 *  Examples:
 *    fuzzyMatch("hd600", "HD 600 S")       → true
 *    fuzzyMatch("hd 600", "HD 650")        → false
 *    fuzzyMatch("akg702", "AKG K 702")     → true
 *    fuzzyMatch("dt990", "Beyerdynamic DT 990 PRO") → true
 */
export function fuzzyMatch(query: string, target: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const t = target.toLowerCase();
  return q.split(/\s+/).every((token) => isSubsequence(token, t));
}

/** True if every character of `chars` appears in `target` in order. */
function isSubsequence(chars: string, target: string): boolean {
  let ti = 0;
  for (const char of chars) {
    ti = target.indexOf(char, ti);
    if (ti === -1) return false;
    ti++;
  }
  return true;
}
