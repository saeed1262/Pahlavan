// The coach skill's files the plugin build bundles (tools/build-plugin.mjs):
// each path inside .claude/skills/fitness-coach/ to its text.
declare module 'virtual:coach-files' {
  export const COACH_FILES: Record<string, string>;
}
