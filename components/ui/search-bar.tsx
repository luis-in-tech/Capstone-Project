import * as React from "react"
import { Search, X } from "lucide-react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type SearchBarProps = Omit<React.ComponentProps<"input">, "value" | "defaultValue" | "onChange" | "height" | "width" | "type" | "ref"> & {
  value: string
  onValueChange: (value: string) => void
  height?: React.CSSProperties["height"]
  width?: React.CSSProperties["width"]
  containerClassName?: string
}

function SearchBar({ value, onValueChange, height, width, containerClassName, className, style, disabled, readOnly, placeholder = "Search…", ...props }: SearchBarProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)

  return (
    <div className={cn("relative w-full min-w-0", containerClassName)} style={{ width }}>
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        {...props}
        ref={inputRef}
        type="text"
        aria-label={props["aria-label"] ?? placeholder}
        placeholder={placeholder}
        value={value}
        onChange={event => onValueChange(event.target.value)}
        disabled={disabled}
        readOnly={readOnly}
        className={cn("h-10", className, "pl-9 pr-10")}
        style={{ ...style, ...(height !== undefined ? { height } : {}) }}
      />
      {value.length > 0 && !readOnly && (
        <button
          type="button"
          aria-label="Clear search"
          disabled={disabled}
          className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          onClick={() => {
            onValueChange("")
            inputRef.current?.focus()
          }}
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  )
}

export { SearchBar }
export type { SearchBarProps }
