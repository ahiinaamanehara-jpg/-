import { useEffect, useRef, type ComponentProps } from "react";

export function BlobImage({
  blob,
  ...props
}: Omit<ComponentProps<"img">, "src"> & { blob: Blob }) {
  const element = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(blob);
    if (element.current) element.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return <img {...props} ref={element} />;
}
