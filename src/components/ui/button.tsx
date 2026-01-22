import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "~/lib/utils";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      isLoading = false,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    // WCAG AA compliant focus rings (3px minimum)
    const baseStyles =
      "inline-flex items-center justify-center rounded-md font-medium transition-colors focus:outline-none focus:ring-[3px] focus:ring-offset-2 focus:ring-offset-background disabled:pointer-events-none disabled:opacity-50";

    const variants = {
      primary: "bg-primary text-primary-foreground hover:bg-primary-600 focus:ring-primary/50",
      secondary: "bg-card text-foreground border border-card-border hover:bg-card-hover focus:ring-accent/50",
      danger: "bg-danger text-danger-foreground hover:bg-danger-dark focus:ring-danger/50",
      ghost: "text-muted hover:bg-card hover:text-foreground focus:ring-primary/50",
    };

    const sizes = {
      sm: "h-8 px-3 text-xs",
      md: "h-10 px-4 text-sm",
      lg: "h-12 px-6 text-base",
    };

    return (
      <button
        ref={ref}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        disabled={disabled ?? isLoading}
        {...props}
      >
        {isLoading ? (
          <>
            <svg
              className="mr-2 h-4 w-4 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Loading...
          </>
        ) : (
          children
        )}
      </button>
    );
  }
);

Button.displayName = "Button";

export default Button;
