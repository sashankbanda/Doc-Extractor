import * as React from "react";
import { useState } from "react";

const ChevronIcon = ({ isOpen }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{
      transition: "transform 0.2s ease",
      transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
    }}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

export function Accordion({ type = "single", collapsible = true, children, className = "" }) {
  const [openItems, setOpenItems] = useState(new Set());

  const toggleItem = (value) => {
    setOpenItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(value)) {
        if (collapsible) {
          newSet.delete(value);
        }
      } else {
        if (type === "single") {
          newSet.clear();
        }
        newSet.add(value);
      }
      return newSet;
    });
  };

  const isOpen = (value) => openItems.has(value);

  return (
    <div className={`accordion ${className}`}>
      {React.Children.map(children, (child) =>
        React.isValidElement(child)
          ? React.cloneElement(child, { toggleItem, isOpen })
          : child
      )}
    </div>
  );
}

export function AccordionItem({ value, children, toggleItem, isOpen, className = "" }) {
  const open = isOpen ? isOpen(value) : false;

  return (
    <div className={`accordion-item ${open ? "open" : ""} ${className}`} data-state={open ? "open" : "closed"}>
      {React.Children.map(children, (child) =>
        React.isValidElement(child)
          ? React.cloneElement(child, { value, toggleItem, isOpen: open })
          : child
      )}
    </div>
  );
}

export function AccordionTrigger({ children, value, toggleItem, isOpen, className = "" }) {
  return (
    <button
      type="button"
      className={`accordion-trigger ${className}`}
      onClick={() => toggleItem && toggleItem(value)}
      aria-expanded={isOpen}
    >
      <span className="accordion-trigger-text">{children}</span>
      <ChevronIcon isOpen={isOpen} />
    </button>
  );
}

export function AccordionContent({ children, isOpen, className = "" }) {
  return (
    <div
      className={`accordion-content ${className}`}
      style={{
        display: isOpen ? "block" : "none",
      }}
    >
      <div className="accordion-content-inner">{children}</div>
    </div>
  );
}

export default Accordion;
