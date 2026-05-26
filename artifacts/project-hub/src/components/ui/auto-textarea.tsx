import * as React from "react";
import { cn } from "@/lib/utils";

// Auto-growing textarea that:
//   - resizes vertically to fit its content whenever the value changes
//     (covers paste, programmatic fill from AI, typing, etc.)
//   - keeps the native corner drag-handle, and respects any larger size
//     the user has dragged it to (the dragged height becomes the floor).
type AutoTextareaProps = React.ComponentPropsWithoutRef<"textarea"> & {
  /** Minimum number of visible rows used as the initial height. */
  minRows?: number;
};

export const AutoTextarea = React.forwardRef<HTMLTextAreaElement, AutoTextareaProps>(
  function AutoTextarea({ className, value, minRows = 2, style, onInput, ...rest }, externalRef) {
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null);
    const userFloorRef = React.useRef<number>(0); // largest height the user manually dragged to

    // Combine external + internal refs.
    React.useImperativeHandle(externalRef, () => innerRef.current as HTMLTextAreaElement);

    const resize = React.useCallback(() => {
      const el = innerRef.current;
      if (!el) return;
      // Temporarily reset so scrollHeight reflects the *content* height.
      el.style.height = "auto";
      const content = el.scrollHeight;
      const target = Math.max(content, userFloorRef.current);
      el.style.height = `${target}px`;
    }, []);

    // Resize whenever the controlled value changes (typing, AI fill, etc.).
    React.useEffect(() => {
      resize();
    }, [value, resize]);

    // Initial layout pass after mount.
    React.useEffect(() => {
      resize();
    }, [resize]);

    // Watch for manual corner drags. If the rendered height grows beyond what
    // the content needs, treat that as the user's preferred floor so future
    // auto-grow calls don't shrink the box back below it.
    React.useEffect(() => {
      const el = innerRef.current;
      if (!el || typeof ResizeObserver === "undefined") return;
      const ro = new ResizeObserver(() => {
        const rendered = el.getBoundingClientRect().height;
        const contentNeeded = el.scrollHeight;
        if (rendered > contentNeeded + 4) {
          userFloorRef.current = rendered;
        }
      });
      ro.observe(el);
      return () => ro.disconnect();
    }, []);

    return (
      <textarea
        ref={innerRef}
        rows={minRows}
        value={value}
        onInput={(e) => {
          resize();
          onInput?.(e);
        }}
        className={cn(
          "block w-full resize-y overflow-hidden focus:outline-none",
          className,
        )}
        style={{ ...style }}
        {...rest}
      />
    );
  },
);
