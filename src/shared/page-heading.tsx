import { useEffect, useRef, type PropsWithChildren } from "react";

interface PageHeadingProps extends PropsWithChildren {
  className?: string;
  as?: "h1" | "h2";
}

export function PageHeading({ children, className, as: Tag = "h1" }: PageHeadingProps) {
  const ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  return (
    <Tag ref={ref} className={className} tabIndex={-1}>
      {children}
    </Tag>
  );
}
