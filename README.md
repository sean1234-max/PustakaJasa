# School Portal — Event Ordering System

A React + Vite implementation of the teacher-facing school award/plaque ordering flow, built from the design spec in [`../design_handoff_teacher_order_flow/README.md`](../design_handoff_teacher_order_flow/README.md).

This is a **frontend-only prototype**: all data (orders, cart, session) lives in memory via React state. There is no backend — refreshing the page or restarting the dev server resets everything back to the 4 seeded sample orders.

## Running it

```powershell
cd "c:\Pustaka Jasa\Login and New Order mockups\school-order-app"
npm install   # only needed the first time, or after pulling new dependencies
npm run dev
```

Open the URL printed in the terminal (usually `http://localhost:5173/`). Log in with any User ID / password — auth isn't real, it just takes you to the dashboard.

Stop the server with `Ctrl+C` in that terminal.

## What's here

- **Login** → **My Orders dashboard** → **New Order** (2-step wizard: Function Details, then Order Details across 5 award categories) → **Cart** → **Submit**
- Dashboard actions gated by order status: **Update Details** (amend, pre-production), **Add On** (in-production), **Reorder** (completed)
- All quantity/price calculations (matrix totals, `harga = qty × unit price`, cart/amend/add-on subtotals) match the original design spec

## Project structure

```
src/
  data/        catalog.js (categories, plaque prices), seedOrders.js (sample orders)
  utils/       computeBlocks.js (shared qty/price calculation logic)
  state/       AppState.jsx (global app state + actions, via React Context)
  components/  shared UI: Nav, DatePicker, ImageDrop, CategoryTabs, OrderCategoryBlock
  pages/       one file per screen (Login, NewOrderStep1/2, Cart, Success, Dashboard, Amend, AmendSummary, AddOn, AddOnSummary)
```

## Known gaps vs. the original mockup

- No backend/persistence — nothing survives a page reload
- Visual polish (corner registration marks, entrance/stagger animations) wasn't reproduced; core layout, fields, and design tokens (colors, Barlow fonts, square corners) are in place
- Reference-sample images (per line item) are UI-only and aren't saved as part of an order's data
