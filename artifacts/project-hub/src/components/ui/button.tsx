import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// Buttons follow OHC's design language: pill-shaped (rounded-full), a
// blue→indigo gradient for the primary action, soft card surfaces for the
// quiet variants, with a subtle press scale. Mirrors the shared
// design-system.css .btn-primary / .btn-secondary / .btn-danger look.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-all duration-200 cursor-pointer active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // .btn-primary — blue→indigo gradient pill
        default:
          "text-white bg-gradient-to-r from-blue-600 to-indigo-600 shadow-md shadow-blue-500/25 hover:shadow-lg hover:shadow-blue-500/30 hover:brightness-110",
        // Destructive — filled red
        destructive:
          "text-white bg-red-600 hover:bg-red-700 shadow-md shadow-red-500/20",
        // .btn-secondary — card surface + hairline border
        outline:
          "border border-border bg-card text-foreground hover:bg-muted/50 hover:border-border",
        secondary:
          "border border-border bg-card text-foreground/70 hover:bg-muted/50",
        ghost: "font-medium text-foreground/70 hover:bg-accent hover:text-accent-foreground",
        link: "font-medium text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-9 px-5 py-2",
        sm: "min-h-8 px-4 text-xs",
        lg: "min-h-10 px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
