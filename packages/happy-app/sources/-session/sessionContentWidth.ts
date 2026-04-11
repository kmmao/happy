export function getSessionContentMaxWidth(props: {
  platform: string;
  defaultMaxWidth: number;
}): number {
  return props.platform === "web" ? Number.POSITIVE_INFINITY : props.defaultMaxWidth;
}
