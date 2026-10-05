"use client";
import { Select } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes } from "react";

export function Panel({ id, title, action, className = "", children }: { id?: string; title?: React.ReactNode; action?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section id={id} className={`border-t border-line pt-4 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Chips<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={`tab ${value === o.value ? "tab-on" : ""}`} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, className = "" }: { checked: boolean; onChange: (on: boolean) => void; label: string; className?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className={`inline-flex h-9 items-center gap-2 rounded-full px-2 text-sm font-medium text-muted transition hover:text-ink ${className}`}>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-volt-500" : "bg-line"}`}>
        <span className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : ""}`} />
      </span>
      {label}
    </button>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "danger-outline" | "second" | "shard";
export function Button({ variant = "secondary", className = "", type = "button", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type={type} className={`btn btn-${variant} ${className}`} {...p} />;
}

export function Field({ label, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input className="field" {...p} />
    </label>
  );
}

export function Dropdown<T extends string>({ label, value, onChange, options, disabled }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; disabled?: boolean }) {
  return (
    <div>
      <span className="label">{label}</span>
      <Select.Root value={value} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
        <Select.Trigger aria-label={label} className="field flex items-center justify-between text-left">
          <Select.Value />
          <Select.Icon><ChevronDown className="size-4 text-muted" /></Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content position="popper" sideOffset={6} className="popup w-(--radix-select-trigger-width) p-1">
            <Select.Viewport>
              {options.map((o) => (
                <Select.Item key={o.value} value={o.value} className="flex h-9 cursor-pointer items-center justify-between rounded-lg px-3 text-sm outline-none data-highlighted:bg-volt-50 data-highlighted:text-volt-700">
                  <Select.ItemText>{o.label}</Select.ItemText>
                  <Select.ItemIndicator><Check className="size-4" /></Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
