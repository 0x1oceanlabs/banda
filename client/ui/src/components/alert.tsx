import { cva, type VariantProps } from "class-variance-authority"
import type * as React from "react"
import { cn } from "../lib/utils"

const alertVariants = cva(
  "grid w-full gap-0.5 rounded-card border px-3 py-2.5 text-ui has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2.5 [&>svg]:row-span-2 [&>svg]:size-4 [&>svg]:translate-y-0.5",
  {
    variants: {
      variant: {
        default: "border-border text-foreground",
        good: "border-added/40 text-foreground [&>svg]:text-added",
        warning: "border-warning/40 text-foreground [&>svg]:text-warning",
        destructive:
          "border-destructive/40 text-destructive [&>svg]:text-destructive",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

/** Words that must be seen, in a box of their kind, as shadcn/ui draws
 * them. */
function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn("font-medium", className)}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn("text-meta text-muted-foreground", className)}
      {...props}
    />
  )
}

export { Alert, AlertDescription, AlertTitle }
