import React, { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export interface ComboBoxOption {
  value: string;
  label: string;
}

interface ComboBoxProps {
  value: string;
  onChange: (value: string) => void;
  options: ComboBoxOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  variant?: "default" | "compact";
}

export const ComboBox: React.FC<ComboBoxProps> = ({
  value,
  onChange,
  options,
  placeholder,
  className = "",
  disabled = false,
  variant = "default",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (newValue: string) => {
    onChange(newValue);
    setIsOpen(false);
  };

  const paddingClasses = variant === "compact" ? "px-2 py-1" : "px-3 py-2";

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          onClick={() => !disabled && setIsOpen(true)}
          className={`w-full ${paddingClasses} pr-8 text-sm font-semibold bg-mid-gray/10 border border-mid-gray/80 rounded text-left transition-all duration-150 ${
            disabled
              ? "opacity-60 cursor-not-allowed bg-mid-gray/10 border-mid-gray/40"
              : "hover:bg-logo-primary/10 hover:border-logo-primary focus:outline-none focus:bg-logo-primary/20 focus:border-logo-primary"
          }`}
        />
        <button
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          className="absolute right-0 top-0 bottom-0 px-2 flex items-center justify-center text-gray-500 hover:text-gray-700"
          tabIndex={-1}
          disabled={disabled}
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>

      {isOpen && !disabled && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-background border border-mid-gray/80 rounded shadow-lg z-50 max-h-60 overflow-y-auto">
          {options.length === 0 ? (
            <div className="px-2 py-1 text-sm text-mid-gray">
              No options found
            </div>
          ) : (
            options.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`w-full px-3 py-2 text-sm text-left hover:bg-logo-primary/10 transition-colors duration-150 ${
                  value === option.value
                    ? "bg-logo-primary/20 font-semibold"
                    : ""
                }`}
                onClick={() => handleSelect(option.value)}
              >
                <div className="flex flex-col">
                  <span className="font-medium">{option.label}</span>
                  {option.value !== option.label && (
                    <span className="text-xs text-gray-500 truncate">
                      {option.value}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};
