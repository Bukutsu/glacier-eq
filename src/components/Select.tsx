import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
}

interface SelectProps<T extends string | number> {
  id?: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  disabled?: boolean;
}

export function Select<T extends string | number>({
  id,
  value,
  options,
  onChange,
  className = "",
  disabled = false,
}: SelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLUListElement>(null);
  const [dropdownRect, setDropdownRect] = useState<DOMRect | null>(null);

  const selectedOption = options.find((opt) => opt.value === value) ?? options[0];

  // Measure trigger position when opening
  useEffect(() => {
    if (isOpen && triggerRef.current) {
      setDropdownRect(triggerRef.current.getBoundingClientRect());
    }
  }, [isOpen]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current?.contains(event.target as Node) ||
        triggerRef.current?.contains(event.target as Node) ||
        dropdownRef.current?.contains(event.target as Node)
      ) {
        return;
      }
      setIsOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Close on scroll or resize
  useEffect(() => {
    if (!isOpen) return;

    const handleScrollOrResize = (event: Event) => {
      if (
        event.type === "scroll" &&
        dropdownRef.current &&
        dropdownRef.current.contains(event.target as Node)
      ) {
        return;
      }
      setIsOpen(false);
    };

    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [isOpen]);

  const handleToggle = () => {
    if (!disabled) {
      setIsOpen(!isOpen);
    }
  };

  const handleSelect = (val: T) => {
    onChange(val);
    setIsOpen(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      setIsOpen(true);
    }
  };

  const handleOptionKeyDown = (e: KeyboardEvent<HTMLLIElement>, val: T) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleSelect(val);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`custom-select-container ${isOpen ? "open" : ""} ${disabled ? "disabled" : ""} ${className}`}
    >
      <button
        id={id}
        ref={triggerRef}
        type="button"
        className="custom-select-trigger"
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="custom-select-label">{selectedOption?.label ?? ""}</span>
        <span className="custom-select-arrow"><Icon>expand_more</Icon></span>
      </button>

      {isOpen && dropdownRect && createPortal(
        <ul
          ref={dropdownRef}
          className="custom-select-dropdown"
          role="listbox"
          tabIndex={-1}
          style={{
            position: "absolute",
            top: `${dropdownRect.bottom + window.scrollY}px`,
            left: `${dropdownRect.left + window.scrollX}px`,
            width: `${dropdownRect.width}px`,
          }}
        >
          {options.map((opt) => (
            <li
              key={opt.value}
              role="option"
              tabIndex={0}
              aria-selected={opt.value === value}
              className={`custom-select-option ${opt.value === value ? "selected" : ""}`}
              onClick={() => handleSelect(opt.value)}
              onKeyDown={(e) => handleOptionKeyDown(e, opt.value)}
            >
              {opt.label}
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  );
}
