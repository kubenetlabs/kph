import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "~/lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  label?: string;
  helperText?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, label, helperText, id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            "w-full rounded-md border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 transition-colors",
            error
              ? "border-danger focus:border-danger focus:ring-danger"
              : "border-card-border focus:border-primary focus:ring-primary",
            className
          )}
          {...props}
        />
        {helperText && (
          <p
            className={cn(
              "mt-1.5 text-xs",
              error ? "text-danger" : "text-muted"
            )}
          >
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";

export default Input;
