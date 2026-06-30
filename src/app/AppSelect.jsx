import React, { useMemo } from "react";
import Select from "react-select";

// Shared, slick dropdown used across the app instead of bland native <select>s.
// Wraps react-select with the app's dark theme, portals the menu to <body> so it
// escapes overflow/stacking contexts, and presents a plain value/onChange API:
// options can be strings or {value,label}; onChange receives the raw value.

const portalTarget = () => (typeof document !== "undefined" ? document.body : null);

export const APP_SELECT_STYLES = {
  control: (base, state) => ({
    ...base,
    minHeight: 36,
    borderRadius: 8,
    borderColor: state.isFocused
      ? "rgba(var(--forge-accent-rgb, 16, 185, 129), 0.5)"
      : "var(--forge-border-strong, rgba(148, 163, 184, 0.26))",
    backgroundColor: "var(--forge-surface, rgba(13, 17, 23, 0.92))",
    boxShadow: state.isFocused ? "0 0 0 3px rgba(var(--forge-accent-rgb, 16, 185, 129), 0.14)" : "none",
    cursor: "pointer",
    transition: "border-color 120ms ease, box-shadow 120ms ease",
    "&:hover": {
      borderColor: "rgba(var(--forge-accent-rgb, 16, 185, 129), 0.5)",
    },
  }),
  valueContainer: (base) => ({ ...base, padding: "0 10px" }),
  singleValue: (base) => ({
    ...base,
    color: "var(--forge-text, #e5edf7)",
    fontSize: 12,
    fontWeight: 700,
  }),
  placeholder: (base) => ({
    ...base,
    color: "var(--forge-text-muted, #94a3b8)",
    fontSize: 12,
    fontWeight: 600,
  }),
  input: (base) => ({ ...base, color: "var(--forge-text, #e5edf7)" }),
  menuPortal: (base) => ({ ...base, zIndex: 9999 }),
  menu: (base) => ({
    ...base,
    overflow: "hidden",
    border: "1px solid var(--forge-border-strong, rgba(148, 163, 184, 0.26))",
    borderRadius: 8,
    backgroundColor: "var(--forge-surface-raised, #0e1726)",
    boxShadow: "0 16px 36px rgba(0, 0, 0, 0.42)",
  }),
  menuList: (base) => ({ ...base, padding: 4 }),
  option: (base, state) => ({
    ...base,
    borderRadius: 6,
    color: state.isSelected ? "var(--forge-text, #e5edf7)" : "var(--forge-text-soft, #cbd5f5)",
    backgroundColor: state.isSelected
      ? "rgba(var(--forge-accent-rgb, 16, 185, 129), 0.2)"
      : state.isFocused
        ? "var(--forge-surface-selected, rgba(148, 163, 184, 0.14))"
        : "transparent",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    ":active": {
      backgroundColor: "rgba(var(--forge-accent-rgb, 16, 185, 129), 0.24)",
    },
  }),
  indicatorSeparator: () => ({ display: "none" }),
  dropdownIndicator: (base) => ({
    ...base,
    color: "var(--forge-text-muted, #94a3b8)",
    padding: 6,
  }),
};

function normalizeOptions(options) {
  return (Array.isArray(options) ? options : []).map((option) =>
    option && typeof option === "object" ? option : { value: option, label: String(option) },
  );
}

export default function AppSelect({
  options,
  value,
  onChange,
  placeholder = "Select…",
  isDisabled = false,
  isSearchable = false,
  isClearable = false,
  ...rest
}) {
  const normalizedOptions = useMemo(() => normalizeOptions(options), [options]);
  const selectedOption = useMemo(
    () => normalizedOptions.find((option) => option.value === value) ?? null,
    [normalizedOptions, value],
  );

  return (
    <Select
      classNamePrefix="app-select"
      isClearable={isClearable}
      isDisabled={isDisabled}
      isSearchable={isSearchable}
      menuPlacement="auto"
      menuPortalTarget={portalTarget()}
      menuPosition="fixed"
      onChange={(option) => onChange?.(option ? option.value : null, option)}
      options={normalizedOptions}
      placeholder={placeholder}
      styles={APP_SELECT_STYLES}
      value={selectedOption}
      {...rest}
    />
  );
}
