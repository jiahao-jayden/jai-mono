import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";

import { cn } from "cn";
import { useShape } from "@/lib/shape-context";

interface InputProps extends React.ComponentProps<"input"> {
  density?: "default" | "compact";
}

function Input({
  className,
  density = "default",
  type,
  ...props
}: InputProps) {
  const shape = useShape();

  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "w-full min-w-0 border border-[0.5px] border-input bg-input/20 text-foreground transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-brand disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        density === "compact" ? "h-8 px-2.5 text-[12px]" : "h-9 px-3 text-[13.5px]",
        shape.input,
        className,
      )}
      {...props}
    />
  );
}

export { Input };
export type { InputProps };
