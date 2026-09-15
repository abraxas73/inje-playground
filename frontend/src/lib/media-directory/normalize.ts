/** Mirrors SQL public.media_norm so previews agree with what the database will match. */
export function mediaNorm(value: string): string {
  return value.toLowerCase().replace(/㈜|㈔|\(주\)|\(사\)|주식회사|사단법인|\s/g, "").replace(/[·.,()[\]\/\\'"“”‘’&:;!?-]/g, "");
}
