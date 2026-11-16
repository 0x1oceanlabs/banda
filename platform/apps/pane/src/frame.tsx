/** What stands apart in a Tree with no Card around it, and what it
 * says where there is nothing. */
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@banda/ui/components/empty"

/** Its edge: a Card's own. */
export const FRAME = "overflow-hidden rounded-card ring-1 ring-foreground/10"

export function Nothing({
  title,
  about,
}: {
  title: string
  about?: string | null
}) {
  return (
    <Empty className={FRAME}>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {about && <EmptyDescription>{about}</EmptyDescription>}
      </EmptyHeader>
    </Empty>
  )
}
