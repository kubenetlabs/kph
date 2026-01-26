"use client";

import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTour } from "./tour-provider";
import Button from "~/components/ui/button";
import { XMarkIcon } from "@heroicons/react/24/outline";

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function TourOverlay() {
  const { isActive, currentStep, currentTour, nextStep, prevStep, skipTour } =
    useTour();
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const updateTargetPosition = useCallback(() => {
    if (!currentTour || !isActive) {
      setTargetRect(null);
      return;
    }

    const step = currentTour[currentStep];
    if (!step) {
      setTargetRect(null);
      return;
    }

    const element = document.querySelector(step.target);
    if (element) {
      const rect = element.getBoundingClientRect();
      setTargetRect({
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
        height: rect.height,
      });

      // Scroll element into view if needed
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      setTargetRect(null);
    }
  }, [currentTour, currentStep, isActive]);

  // Update position when step changes or on scroll/resize
  useEffect(() => {
    updateTargetPosition();

    window.addEventListener("resize", updateTargetPosition);
    window.addEventListener("scroll", updateTargetPosition, true);

    return () => {
      window.removeEventListener("resize", updateTargetPosition);
      window.removeEventListener("scroll", updateTargetPosition, true);
    };
  }, [updateTargetPosition]);

  if (!mounted || !isActive || !currentTour) {
    return null;
  }

  const step = currentTour[currentStep];
  if (!step) {
    return null;
  }

  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === currentTour.length - 1;

  // Calculate tooltip position based on placement and target
  const getTooltipStyle = (): React.CSSProperties => {
    if (!targetRect) {
      // Center tooltip if no target found
      return {
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      };
    }

    const padding = 16;
    const tooltipWidth = 320;
    const placement = step.placement ?? "bottom";

    switch (placement) {
      case "top":
        return {
          bottom: `calc(100% - ${targetRect.top - padding}px)`,
          left: targetRect.left + targetRect.width / 2 - tooltipWidth / 2,
        };
      case "bottom":
        return {
          top: targetRect.top + targetRect.height + padding,
          left: Math.max(
            padding,
            Math.min(
              targetRect.left + targetRect.width / 2 - tooltipWidth / 2,
              window.innerWidth - tooltipWidth - padding
            )
          ),
        };
      case "left":
        return {
          top: targetRect.top + targetRect.height / 2,
          right: `calc(100% - ${targetRect.left - padding}px)`,
          transform: "translateY(-50%)",
        };
      case "right":
        return {
          top: targetRect.top + targetRect.height / 2,
          left: targetRect.left + targetRect.width + padding,
          transform: "translateY(-50%)",
        };
      default:
        return {
          top: targetRect.top + targetRect.height + padding,
          left: targetRect.left,
        };
    }
  };

  const overlay = (
    <div className="fixed inset-0 z-[9999]" aria-modal="true" role="dialog">
      {/* Semi-transparent backdrop */}
      <div
        className="absolute inset-0 bg-black/60 transition-opacity"
        onClick={skipTour}
      />

      {/* Spotlight cutout for target element */}
      {targetRect && (
        <div
          className="absolute rounded-lg ring-4 ring-primary ring-offset-2 ring-offset-transparent transition-all duration-300"
          style={{
            top: targetRect.top - 4,
            left: targetRect.left - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
            boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.6)",
          }}
        />
      )}

      {/* Tooltip */}
      <div
        className="absolute w-80 rounded-lg border border-card-border bg-card p-4 shadow-xl"
        style={getTooltipStyle()}
      >
        {/* Close button */}
        <button
          onClick={skipTour}
          className="absolute right-2 top-2 rounded p-1 text-muted hover:bg-card-hover hover:text-foreground transition-colors"
          aria-label="Close tour"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>

        {/* Step indicator */}
        <div className="mb-2 text-xs text-muted">
          Step {currentStep + 1} of {currentTour.length}
        </div>

        {/* Content */}
        <h3 className="mb-2 pr-6 text-lg font-semibold text-foreground">
          {step.title}
        </h3>
        <p className="mb-4 text-sm text-muted">{step.content}</p>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <button
            onClick={skipTour}
            className="text-sm text-muted hover:text-foreground transition-colors"
          >
            Skip tour
          </button>
          <div className="flex gap-2">
            {!isFirstStep && (
              <Button variant="ghost" size="sm" onClick={prevStep}>
                Back
              </Button>
            )}
            <Button size="sm" onClick={nextStep}>
              {isLastStep ? "Finish" : "Next"}
            </Button>
          </div>
        </div>

        {/* Progress dots */}
        <div className="mt-4 flex justify-center gap-1">
          {currentTour.map((_, index) => (
            <div
              key={index}
              className={`h-1.5 w-1.5 rounded-full transition-colors ${
                index === currentStep ? "bg-primary" : "bg-card-border"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
