import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "~/lib/utils";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
  label?: string;
  helperText?: string;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, label, helperText, id, ...props }, ref) => {
    const textareaId = id ?? label?.toLowerCase().replace(/\s+/g, "-");

    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={textareaId}
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={cn(
            "w-full rounded-md border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 transition-colors resize-none",
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

Textarea.displayName = "Textarea";

export default Textarea;

