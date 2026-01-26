"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";

export interface TourStep {
  id: string;
  target: string; // CSS selector for the element to highlight
  title: string;
  content: string;
  placement?: "top" | "bottom" | "left" | "right";
  route?: string; // Optional route this step should appear on
}

interface TourContextType {
  isActive: boolean;
  currentStep: number;
  currentTour: TourStep[] | null;
  startTour: (steps: TourStep[]) => void;
  endTour: () => void;
  nextStep: () => void;
  prevStep: () => void;
  skipTour: () => void;
  hasCompletedTour: (tourId: string) => boolean;
  markTourComplete: (tourId: string) => void;
}

const TourContext = createContext<TourContextType | null>(null);

const TOUR_STORAGE_KEY = "kph-completed-tours";

export function TourProvider({ children }: { children: ReactNode }) {
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [currentTour, setCurrentTour] = useState<TourStep[] | null>(null);
  const [completedTours, setCompletedTours] = useState<Set<string>>(new Set());

  // Load completed tours from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(TOUR_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as string[];
        setCompletedTours(new Set(parsed));
      } catch {
        // Invalid data, reset
        localStorage.removeItem(TOUR_STORAGE_KEY);
      }
    }
  }, []);

  const saveCompletedTours = useCallback((tours: Set<string>) => {
    localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify([...tours]));
  }, []);

  const startTour = useCallback((steps: TourStep[]) => {
    setCurrentTour(steps);
    setCurrentStep(0);
    setIsActive(true);
  }, []);

  const endTour = useCallback(() => {
    setIsActive(false);
    setCurrentStep(0);
    setCurrentTour(null);
  }, []);

  const nextStep = useCallback(() => {
    if (currentTour && currentStep < currentTour.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      endTour();
    }
  }, [currentTour, currentStep, endTour]);

  const prevStep = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  }, [currentStep]);

  const skipTour = useCallback(() => {
    endTour();
  }, [endTour]);

  const hasCompletedTour = useCallback(
    (tourId: string) => completedTours.has(tourId),
    [completedTours]
  );

  const markTourComplete = useCallback(
    (tourId: string) => {
      const updated = new Set(completedTours);
      updated.add(tourId);
      setCompletedTours(updated);
      saveCompletedTours(updated);
    },
    [completedTours, saveCompletedTours]
  );

  return (
    <TourContext.Provider
      value={{
        isActive,
        currentStep,
        currentTour,
        startTour,
        endTour,
        nextStep,
        prevStep,
        skipTour,
        hasCompletedTour,
        markTourComplete,
      }}
    >
      {children}
    </TourContext.Provider>
  );
}

export function useTour() {
  const context = useContext(TourContext);
  if (!context) {
    throw new Error("useTour must be used within a TourProvider");
  }
  return context;
}
