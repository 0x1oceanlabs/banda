import { defineModule } from "@banda/ui/module"
import { screensSource } from "./sources"
import { viewPane } from "./ViewPane"

export const apps = defineModule({
  id: "apps",
  engine: true,
  panes: [viewPane],
  sources: [screensSource],
})
