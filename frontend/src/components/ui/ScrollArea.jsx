import * as React from "react";

/**
 * ScrollArea - A custom scroll area component with styled scrollbars
 * Supports both vertical and horizontal scrolling
 */
export const ScrollArea = React.forwardRef(
  ({ className = "", children, orientation = "vertical", style, ...props }, ref) => {
    const scrollClasses = [
      "scroll-area",
      orientation === "horizontal" ? "scroll-horizontal" : "",
      orientation === "both" ? "scroll-both" : "",
      className,
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div ref={ref} className={scrollClasses} style={style} {...props}>
        <div className="scroll-area-viewport">{children}</div>
      </div>
    );
  }
);

ScrollArea.displayName = "ScrollArea";

/**
 * ScrollBar - Visual scrollbar indicator (optional, for custom styling)
 */
export const ScrollBar = ({ orientation = "vertical", className = "" }) => {
  return (
    <div
      className={`scroll-bar scroll-bar-${orientation} ${className}`}
      aria-hidden="true"
    />
  );
};

export default ScrollArea;
