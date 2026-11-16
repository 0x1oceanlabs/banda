// The page's worker in a browser (ADR 0124, decision 10; SE7): it shows
// what a machine pushed to this device while the page is not open, and
// brings the page up on a tap. It keeps no file of the page: the door
// serves those, as ever. The browser has opened the push already, with
// the keys this device handed the machine.

self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim())
)

self.addEventListener("push", (event) => {
  // What the devices module's `Pushed` has.
  let said = {}
  try {
    said = event.data?.json() ?? {}
  } catch {
    // A push that does not read still shows: the browser asks for one.
  }
  event.waitUntil(
    self.registration.showNotification(said.title ?? "Banda", {
      body: said.body,
      tag: said.tag,
      icon: "./icon-192.png",
      data: { to: said.to },
    })
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const to = event.notification.data?.to
  event.waitUntil(
    (async () => {
      const pages = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      return pages[0]?.focus() ?? self.clients.openWindow(to ?? "./")
    })()
  )
})
