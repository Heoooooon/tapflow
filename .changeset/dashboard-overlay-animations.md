---
"@tapflowio/relay": patch
---

Dashboard: dialogs, menus, selects and tooltips fade and scale in and out, and the mobile sidebar slides, instead of appearing and vanishing at once. The motion classes were always in the components, but the Tailwind plugin that defines them was never installed. With the OS set to reduce motion they still open instantly.
