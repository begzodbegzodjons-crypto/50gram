import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
  {
    variants: {
      variant: {
        default:
          "text-white shadow-[0_8px_20px_-8px_rgba(31,138,128,0.55)] bg-[linear-gradient(135deg,#2fa398_0%,#1f8a80_100%)] hover:brightness-105 active:scale-[0.98] dark:bg-[linear-gradient(135deg,#3fb5a8_0%,#2c9c90_100%)] dark:text-[#0d1413] dark:shadow-[0_8px_20px_-8px_rgba(0,0,0,0.5)]",
        destructive:
          "text-white bg-[linear-gradient(135deg,#d97b57_0%,#c2603f_100%)] shadow-[0_8px_20px_-8px_rgba(194,96,63,0.55)] hover:brightness-105 active:scale-[0.98]",
        outline:
          "border border-input bg-background text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:bg-accent/50 active:scale-[0.98]",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/70 active:scale-[0.98]",
        ghost:
          "bg-transparent text-foreground hover:bg-accent/60 active:scale-[0.98]",
        link: "bg-transparent text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-11 px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
