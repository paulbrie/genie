import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-md font-medium cursor-pointer transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-surface0 text-text border border-surface1 hover:bg-surface1",
        primary:
          "bg-mauve text-background border border-mauve font-semibold hover:bg-lavender hover:border-lavender",
        danger:
          "bg-surface0 text-red border border-red hover:bg-red hover:text-background",
        ghost:
          "bg-transparent border-none text-overlay0 hover:bg-background hover:text-subtext0",
        active:
          "bg-mauve text-background border border-mauve font-semibold hover:bg-lavender hover:border-lavender",
      },
      size: {
        default: "px-2.5 py-1 text-md",
        sm: "px-2 py-0.5 text-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  )
);
Button.displayName = "Button";

export { Button, buttonVariants };
