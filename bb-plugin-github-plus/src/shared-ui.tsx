import {
  cloneElement,
  createContext,
  forwardRef,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function Badge({
  className,
  variant = "default",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: string }) {
  return (
    <span
      {...props}
      className={cn(
        "inline-flex items-center gap-1 border px-1 py-0 text-[10px] font-medium leading-none tracking-tight",
        variant === "default" && "border-border bg-transparent text-foreground",
        variant === "secondary" && "border-border bg-transparent text-muted-foreground",
        variant === "destructive" && "border-border bg-transparent text-red-600 dark:text-red-400",
        variant === "outline" && "border-border bg-transparent text-muted-foreground",
        className,
      )}
    />
  );
}

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    size?: "sm" | "icon" | "default";
    variant?: "default" | "outline" | "ghost" | "destructive" | "secondary";
  }
>(function Button(
  { className, size = "default", variant = "default", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      {...props}
      className={cn(
        "inline-flex items-center justify-center border px-2 py-1 text-[11px] font-medium leading-none tracking-tight focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        variant === "default" && "border-border bg-foreground text-background hover:bg-accent hover:text-foreground",
        variant === "outline" && "border-border bg-transparent hover:bg-accent",
        variant === "ghost" && "border-transparent bg-transparent hover:bg-accent",
        variant === "secondary" && "border-border bg-transparent text-foreground hover:bg-accent",
        variant === "destructive" && "border-border bg-transparent text-red-600 hover:bg-accent dark:text-red-400",
        size === "sm" && "h-6 px-2 text-[11px]",
        size === "icon" && "size-7 p-0",
        className,
      )}
    />
  );
});

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "flex h-7 w-full border border-input bg-transparent px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
    />
  );
}

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      {...props}
      className={cn(
        "flex min-h-20 w-full border border-input bg-transparent px-2 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
    />
  );
});

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn("animate-pulse bg-muted", className)} />;
}

export function DelayedLoading({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 200);
    return () => clearTimeout(timer);
  }, []);
  return visible ? (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading…</span>
      {children}
    </div>
  ) : null;
}

interface MenuContextValue {
  open: boolean;
  toggle: () => void;
  setOpen: (open: boolean) => void;
  close: (restoreFocus?: boolean) => void;
  setTriggerRef: (node: HTMLElement | null) => void;
  rootRef: React.RefObject<HTMLDivElement | null>;
}
const MenuContext = createContext<MenuContextValue | null>(null);

export function DropdownMenu({ children, onOpenChange }: { children: ReactNode; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement>(null);
  const update = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };
  const close = (restoreFocus = true) => {
    update(false);
    if (restoreFocus) triggerRef.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) update(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  return (
    <MenuContext.Provider
      value={{
        open,
        toggle: () => update(!open),
        setOpen: update,
        close,
        setTriggerRef: (node) => {
          triggerRef.current = node;
        },
        rootRef,
      }}
    >
      <div ref={rootRef} className="relative inline-block">
        {children}
      </div>
    </MenuContext.Provider>
  );
}

export function DropdownMenuTrigger({ asChild, children, disabled }: { asChild?: boolean; children: ReactNode; disabled?: boolean }) {
  const menu = useContext(MenuContext);
  if (asChild && isValidElement(children)) {
    const child = children as ReactElement<{
      disabled?: boolean;
      onClick?: (event: React.MouseEvent) => void;
      onKeyDown?: (event: React.KeyboardEvent) => void;
      "aria-expanded"?: boolean;
      "aria-haspopup"?: string;
    }>;
    const childOnClick = child.props.onClick;
    const childOnKeyDown = child.props.onKeyDown;
    const onClick = (event: React.MouseEvent) => {
      event.stopPropagation();
      menu?.setTriggerRef(event.currentTarget as HTMLElement);
      childOnClick?.(event);
      if (!event.defaultPrevented) menu?.toggle();
    };
    const onKeyDown = (event: React.KeyboardEvent) => {
      childOnKeyDown?.(event);
      if (event.defaultPrevented) return;
      if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
        event.preventDefault();
        menu?.setTriggerRef(event.currentTarget as HTMLElement);
        menu?.setOpen(true);
      }
    };
    return cloneElement(child, {
      disabled: disabled ?? child.props.disabled,
      onClick,
      onKeyDown,
      "aria-expanded": menu?.open ?? false,
      "aria-haspopup": "menu",
    });
  }
  const onClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    menu?.setTriggerRef(event.currentTarget as HTMLElement);
    if (!event.defaultPrevented) menu?.toggle();
  };
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
          event.preventDefault();
          menu?.setTriggerRef(event.currentTarget as HTMLElement);
          menu?.setOpen(true);
        }
      }}
      aria-expanded={menu?.open ?? false}
      aria-haspopup="menu"
    >
      {children}
    </button>
  );
}

export function DropdownMenuContent({ children, className, align: _align }: { children: ReactNode; className?: string; align?: "start" | "end" | "center" }) {
  const menu = useContext(MenuContext);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu?.open) return;
    contentRef.current?.querySelector<HTMLButtonElement>(
      '[role^="menuitem"]:not([disabled])',
    )?.focus();
  }, [menu?.open]);
  if (!menu?.open) return null;
  const alignClass = _align === "end" ? "right-0" : _align === "center" ? "left-1/2 -translate-x-1/2" : "left-0";
  return (
    <div
      ref={contentRef}
      role="menu"
      tabIndex={-1}
      className={cn("absolute top-full z-50 mt-1 min-w-40 border border-border bg-popover p-1", alignClass, className)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Tab") {
          menu?.close(false);
          return;
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        const items = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>(
            '[role^="menuitem"]:not([disabled])',
          ),
        );
        if (items.length === 0) return;
        event.preventDefault();
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const offset = event.key === "ArrowDown" ? 1 : -1;
        items[(current + offset + items.length) % items.length]?.focus();
      }}
    >
      {children}
    </div>
  );
}

export function DropdownMenuItem({ children, onSelect, disabled }: { children: ReactNode; onSelect?: () => void; disabled?: boolean }) {
  const menu = useContext(MenuContext);
  return <button type="button" role="menuitem" disabled={disabled} className="flex w-full items-center px-2 py-1 text-left text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50" onClick={(event) => { event.stopPropagation(); onSelect?.(); menu?.close(); }}>{children}</button>;
}

export function DropdownMenuCheckboxItem({ children, checked, onCheckedChange, onSelect }: { children: ReactNode; checked?: boolean; onCheckedChange?: (checked: boolean) => void; onSelect?: (event: React.MouseEvent) => void }) {
  const menu = useContext(MenuContext);
  return <button type="button" role="menuitemcheckbox" aria-checked={checked === true} className="flex w-full items-center gap-2 px-2 py-1 text-left text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" onClick={(event) => { event.stopPropagation(); onSelect?.(event); if (!event.defaultPrevented) { onCheckedChange?.(!checked); menu?.close(); } }}><span className="w-3 text-[10px]">{checked ? "✓" : ""}</span>{children}</button>;
}

export function DropdownMenuLabel({ children }: { children: ReactNode }) { return <div className="px-2 py-1 text-[11px] font-medium tracking-wide text-muted-foreground">{children}</div>; }
export function DropdownMenuSeparator() { return <div className="my-1 h-px bg-border" />; }

interface SelectContextValue {
  value: string;
  setValue: (value: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  close: () => void;
  triggerId: string;
  contentId: string;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  labels: Record<string, string>;
  registerLabel: (value: string, label: string) => void;
}
const SelectContext = createContext<SelectContextValue | null>(null);

type ElementPropsWithChildren = { children?: ReactNode };

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (isValidElement(node)) {
    const props = node.props as ElementPropsWithChildren;
    return textContent(props.children);
  }
  return "";
}

export function Select({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: ReactNode }) {
  const [current, setCurrent] = useState(value);
  const [open, setOpen] = useState(false);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const triggerId = useId();
  const contentId = `${triggerId}-content`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => setCurrent(value), [value]);
  const close = (focusTrigger = true) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  const setValue = (next: string) => {
    setCurrent(next);
    close();
    onValueChange(next);
  };
  const registerLabel = (optionValue: string, label: string) => {
    setLabels((previous) => previous[optionValue] === label ? previous : { ...previous, [optionValue]: label });
  };
  return <SelectContext.Provider value={{ value: current, setValue, open, setOpen, close, triggerId, contentId, triggerRef, labels, registerLabel }}><div ref={rootRef} className="relative w-full">{children}</div></SelectContext.Provider>;
}

export const SelectTrigger = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }>(function SelectTrigger({ children, className, id, ...props }, ref) {
  const select = useContext(SelectContext);
  const setTriggerRef = (node: HTMLButtonElement | null) => {
    if (select) select.triggerRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };
  return <button {...props} ref={setTriggerRef} id={id ?? select?.triggerId} type="button" aria-haspopup="listbox" aria-expanded={select?.open ?? false} aria-controls={select?.contentId} className={cn("flex h-7 w-full items-center justify-between border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring", className)} onClick={(event) => { event.stopPropagation(); props.onClick?.(event); if (!event.defaultPrevented && select) { if (select.open) select.close(); else select.setOpen(true); } }} onKeyDown={(event) => { props.onKeyDown?.(event); if (event.defaultPrevented) return; if (event.key === "Escape" && select?.open) { event.preventDefault(); select.close(); } else if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); select?.setOpen(true); } }}><span className="min-w-0 flex-1 truncate text-left">{children}</span><span aria-hidden="true" className="ml-1 text-[10px] text-muted-foreground">⌄</span></button>;
});
export function SelectValue({ placeholder }: { placeholder?: string }) { const select = useContext(SelectContext); return <span>{(select?.value && select.labels[select.value]) || select?.value || placeholder || "Select"}</span>; }
export function SelectContent({ children, className }: { children: ReactNode; className?: string }) {
  const select = useContext(SelectContext);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!select?.open) return;
    const options = Array.from(contentRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not([disabled])') ?? []);
    options.find((option) => option.getAttribute("aria-selected") === "true")?.focus() ?? options[0]?.focus();
  }, [select?.open]);
  if (!select?.open) return null;
  return <div
    ref={contentRef}
    id={select.contentId}
    role="listbox"
    aria-label="Select options"
    className={cn("absolute left-0 top-full z-50 mt-1 max-h-72 w-full overflow-y-auto border border-border bg-popover p-1", className)}
    onKeyDown={(event) => {
      const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]:not([disabled])'));
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        select.close();
        return;
      }
      if (options.length === 0) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
        event.preventDefault();
        const current = options.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home"
          ? 0
          : event.key === "End"
            ? options.length - 1
            : current < 0
              ? event.key === "ArrowDown" ? 0 : options.length - 1
              : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
        options[next]?.focus();
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        const active = document.activeElement as HTMLButtonElement;
        const value = active?.dataset.value;
        if (value !== undefined) {
          event.preventDefault();
          event.stopPropagation();
          select.setValue(value);
        }
      }
    }}
  >
    {children}
  </div>;
}
export function SelectItem({ value, children }: { value: string; children: ReactNode }) {
  const select = useContext(SelectContext);
  const label = textContent(children) || value;
  const itemId = useId();
  useEffect(() => { select?.registerLabel(value, label); }, [select, value, label]);
  return <button id={`${select?.contentId}-${itemId}`} data-value={value} type="button" role="option" aria-selected={select?.value === value} tabIndex={select?.value === value ? 0 : -1} className="flex w-full items-center px-2 py-1 text-left text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" onClick={(event) => { event.stopPropagation(); select?.setValue(value); }}>{children}</button>;
}
interface TabsContextValue { value: string; setValue: (value: string) => void; id: string; }
const TabsContext = createContext<TabsContextValue | null>(null);
export function Tabs({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: ReactNode }) {
  const id = useId();
  return <TabsContext.Provider value={{ value, setValue: onValueChange, id }}><div>{children}</div></TabsContext.Provider>;
}
export function TabsList({ children }: { children: ReactNode }) {
  return <div role="tablist" aria-label="GitHub views" className="flex items-center gap-4 border-b border-border">{children}</div>;
}
export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  const tabs = useContext(TabsContext);
  const active = tabs?.value === value;
  const tabId = tabs === null ? undefined : `${tabs.id}-tab-${value}`;
  const panelId = tabs === null ? undefined : `${tabs.id}-panel-${value}`;
  return <button id={tabId} type="button" role="tab" aria-selected={active} aria-controls={panelId} tabIndex={active ? 0 : -1} data-value={value} className={cn("border-b-[1.5px] -mb-px px-1 py-1.5 text-[11px] font-medium tracking-wide focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring", active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")} onClick={() => tabs?.setValue(value)} onKeyDown={(event) => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; const list = event.currentTarget.closest('[role="tablist"]'); const triggers = list ? Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]')) : []; if (triggers.length === 0) return; event.preventDefault(); const current = triggers.indexOf(event.currentTarget); const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? triggers.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + triggers.length) % triggers.length; const next = triggers[nextIndex]; next?.focus(); if (next) tabs?.setValue(next.dataset.value ?? value); }}>{children}</button>;
}
export function TabsPanel({ value, children }: { value: string; children: ReactNode }) {
  const tabs = useContext(TabsContext);
  const active = tabs?.value === value;
  const panelId = tabs === null ? undefined : `${tabs.id}-panel-${value}`;
  const tabId = tabs === null ? undefined : `${tabs.id}-tab-${value}`;
  return <div id={panelId} role="tabpanel" aria-labelledby={tabId} hidden={!active} tabIndex={0}>{children}</div>;
}
