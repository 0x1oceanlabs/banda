/**
 * A Project's sign in its settings (ADR 0070, decision 5): the sign at
 * 40 px, which opens its five ways: what Banda finds, letters, an emoji, a
 * Lucide icon, or a picture. Letters and an icon take a quiet colour.
 */
import { useRef, useState } from "react"
import type {
  PictureKind,
  ProjectSummary,
  Sign,
  SignColor,
  SignPick,
} from "@banda/contract"
import { Button } from "@banda/ui/components/button"
import { Input } from "@banda/ui/components/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@banda/ui/components/popover"
import {
  ProjectSign,
  SIGN_COLORS,
  signColor,
} from "@banda/ui/components/project-sign"
import { base64Of, dataUrl } from "@banda/ui/lib/files"
import { cn } from "@banda/ui/lib/utils"
import { DynamicIcon, type IconName } from "lucide-react/dynamic"
import { RefreshCwIcon, UploadIcon } from "lucide-react"

type Way = "auto" | "letters" | "emoji" | "icon" | "picture"

const WAYS: { way: Way; title: string }[] = [
  { way: "auto", title: "Auto" },
  { way: "letters", title: "Letters" },
  { way: "emoji", title: "Emoji" },
  { way: "icon", title: "Icon" },
  { way: "picture", title: "Picture" },
]

const EMOJI = [
  "⌨️",
  "🚀",
  "🎨",
  "📓",
  "🧪",
  "🌊",
  "🎧",
  "🛠️",
  "📦",
  "🌱",
  "🔥",
  "⭐",
  "🧭",
  "🎮",
  "📷",
  "🧠",
]

const ICONS: IconName[] = [
  "terminal",
  "globe",
  "book-open",
  "code",
  "zap",
  "star",
  "box",
  "heart",
  "music",
  "camera",
  "cpu",
  "flask-conical",
  "pen-line",
  "layers",
  "leaf",
  "rocket",
]

/** The quiet palette, neutral first (ADR 0070, decision 4). */
const COLORS: { color: SignColor | undefined; name: string }[] = [
  { color: undefined, name: "Neutral" },
  ...(Object.entries(SIGN_COLORS) as [SignColor, string][]).map(
    ([color, name]) => ({ color, name })
  ),
]

/** The kinds a picked picture may be, by its extension. */
const KINDS: PictureKind[] = ["svg", "png", "webp", "ico"]

/** The most a picked picture weighs, as the engine takes it. */
const MOST = 256 * 1024

/** Where the sign comes from, in a few words. */
export function signAbout(project: ProjectSummary): string {
  const { sign } = project
  if (sign.picked) return "Picked by hand."
  if (sign.found) return `Found in the folder: ${sign.found}`
  return "Nothing found in the folder: letters from the name."
}

export function SignField({
  project,
  busy,
  onPick,
  onFindAgain,
}: {
  project: ProjectSummary
  busy: boolean
  /** A sign picked, or `null` to go back to what Banda finds. */
  onPick: (sign: SignPick | null) => void
  onFindAgain: () => void
}) {
  const { sign } = project
  const [way, setWay] = useState<Way>(sign.picked ? sign.kind : "auto")
  const [letters, setLetters] = useState(
    sign.kind === "letters" ? sign.text : ""
  )
  const file = useRef<HTMLInputElement>(null)
  const [refused, setRefused] = useState<string>()
  const { color } = sign
  const isPicked = (kind: Sign["kind"], text: string) =>
    sign.picked && sign.kind === kind && sign.text === text

  // Too large a file is refused here, before it is read and sent.
  const pickPicture = (chosen: File | undefined) => {
    const kind = chosen?.name.split(".").pop()?.toLowerCase() as PictureKind
    if (!chosen || !KINDS.includes(kind)) return
    if (chosen.size > MOST) {
      setRefused("A sign's picture is at most 256 KB.")
      return
    }
    setRefused(undefined)
    void dataUrl(chosen).then((url) => onPick({ picture: base64Of(url), kind }))
  }
  const tint = (next: SignColor | undefined) => {
    if (!sign.picked) return
    if (sign.kind === "icon") onPick({ icon: sign.text, color: next })
    else if (sign.kind === "letters")
      onPick({ letters: sign.text, color: next })
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            className="size-12 p-1"
            aria-label="Change the Project's sign"
          />
        }
      >
        <ProjectSign project={project} size={40} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-3">
        <div
          role="tablist"
          aria-label="Sign"
          className="flex rounded-control bg-muted p-0.5"
        >
          {WAYS.map(({ way: one, title }) => (
            <button
              key={one}
              type="button"
              role="tab"
              aria-selected={way === one}
              onClick={() => setWay(one)}
              className={cn(
                "flex-1 rounded-control py-1 text-xs text-muted-foreground",
                way === one && "bg-background text-foreground shadow-xs"
              )}
            >
              {title}
            </button>
          ))}
        </div>
        {way === "auto" && (
          <div className="flex flex-col gap-2 text-xs text-muted-foreground">
            <p>
              A file named as the Project, a favicon, a logo, or an app's icon
              in its folder; else letters from its name.
            </p>
            <div className="flex gap-2">
              {sign.picked && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => onPick(null)}
                >
                  Back to auto
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={busy || sign.picked}
                onClick={onFindAgain}
              >
                <RefreshCwIcon />
                Look again
              </Button>
            </div>
          </div>
        )}
        {way === "letters" && (
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              const text = letters.trim()
              if (text) onPick({ letters: text, color })
            }}
          >
            <Input
              aria-label="Letters"
              maxLength={2}
              value={letters}
              onChange={(event) => setLetters(event.target.value.toUpperCase())}
              className="w-16 text-center font-bold tracking-wide"
            />
            <Button size="sm" type="submit" disabled={busy || !letters.trim()}>
              Use
            </Button>
          </form>
        )}
        {way === "emoji" && (
          <Grid>
            {EMOJI.map((emoji) => (
              <Cell
                key={emoji}
                label={emoji}
                on={isPicked("emoji", emoji)}
                onClick={() => onPick({ emoji })}
              >
                <span className="text-title">{emoji}</span>
              </Cell>
            ))}
          </Grid>
        )}
        {way === "icon" && (
          <Grid>
            {ICONS.map((icon) => (
              <Cell
                key={icon}
                label={icon}
                on={isPicked("icon", icon)}
                onClick={() => onPick({ icon, color })}
              >
                <DynamicIcon name={icon} size={16} />
              </Cell>
            ))}
          </Grid>
        )}
        {(way === "letters" || way === "icon") && (
          <div role="radiogroup" aria-label="Colour" className="flex gap-1.5">
            {COLORS.map(({ color: one, name }) => (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={color === one}
                aria-label={name}
                title={name}
                disabled={busy}
                onClick={() => tint(one)}
                className={cn(
                  "size-5 rounded-full ring-1 ring-border",
                  color === one &&
                    "ring-2 ring-ring ring-offset-2 ring-offset-popover"
                )}
                style={{
                  background: one
                    ? signColor(one)
                    : "color-mix(in oklab, var(--foreground) 10%, transparent)",
                }}
              />
            ))}
          </div>
        )}
        {way === "picture" && (
          <div className="flex flex-col items-start gap-2 text-xs text-muted-foreground">
            <p>SVG, PNG, WebP or ICO, at most 256 KB.</p>
            {refused && (
              <p role="alert" className="text-destructive">
                {refused}
              </p>
            )}
            <input
              ref={file}
              type="file"
              accept={KINDS.map((kind) => `.${kind}`).join(",")}
              className="hidden"
              onChange={(event) => pickPicture(event.target.files?.[0])}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => file.current?.click()}
            >
              <UploadIcon />
              Choose…
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-8 gap-1">{children}</div>
}

function Cell({
  label,
  on,
  onClick,
  children,
}: {
  label: string
  on: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={label}
      onClick={onClick}
      className={cn(
        "flex aspect-square items-center justify-center rounded-control text-muted-foreground hover:bg-accent hover:text-foreground",
        on && "bg-accent text-foreground ring-1 ring-ring"
      )}
    >
      {children}
    </button>
  )
}
