export function captureEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|on|yes)$/i.test(env.CAPTURE_ENABLED?.trim() ?? "");
}
