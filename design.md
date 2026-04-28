# FlipStart — Mobile App Interface Design

## Overview

FlipStart is an AI-powered resale assistant for thrifters and resellers. The app enables users to photograph or upload a clothing item, receive instant resale analysis (value, demand, risks), and generate ready-to-post listing content for eBay and Depop. The design must feel **fast, minimal, and decision-focused** — like a premium tool, not a generic utility.

---

## Screen List

| # | Screen | Route | Tab? |
|---|--------|-------|------|
| 1 | Scan Screen | `/(tabs)/index` | Yes — "Scan" |
| 2 | Loading Screen | `/loading` | No — modal/stack |
| 3 | Results Screen | `/results` | No — stack |
| 4 | History Screen | `/(tabs)/history` | Yes — "History" |
| 5 | Settings Screen | `/(tabs)/settings` | Yes — "Settings" |

---

## Screen Designs (Portrait 9:16, One-Handed)

### 1. Scan Screen (Home Tab)

**Layout:** Full-screen dark background. Centered camera viewfinder placeholder (rounded rectangle, dashed border). Below it, a large primary "Scan Item" button. Small secondary "Upload Photo" text link beneath.

**Content:**
- App logo / wordmark at top (small, subtle)
- Camera viewfinder area (placeholder — large rounded rect with camera icon)
- Primary CTA: "Scan Item" — large pill button, accent color
- Secondary CTA: "Upload from Gallery" — text link below button

**Functionality:**
- Tap "Scan Item" → opens image picker (camera option)
- Tap "Upload from Gallery" → opens image picker (gallery option)
- After image is selected → navigate to Loading screen

### 2. Loading Screen (Modal)

**Layout:** Full-screen dark overlay. Centered animated spinner or pulsing icon. Sequential status text that changes every ~1.5s.

**Content:**
- Animated loading indicator (pulsing circle or spinner)
- Status text cycling through:
  - "Identifying item..."
  - "Checking resale data..."
  - "Analyzing market trends..."
  - "Generating listing..."
- Subtle progress feel

**Functionality:**
- Simulates AI processing (2-4 second delay with mock data)
- Auto-navigates to Results screen when "done"

### 3. Results Screen (Most Important)

**Layout:** Scrollable dark screen with clearly separated card sections. Each section has a header label. The Quick Decision section is visually highlighted (accent border or background). Bottom has a "Scan Another" button.

**Sections (top to bottom):**

**A. Item Identification Card**
- Item name (large, bold)
- Brand, Category, Estimated Era
- Style labels (horizontal chips/tags)
- Material guess

**B. Quick Decision Card (HIGHLIGHTED)**
- Accent-colored border or subtle gradient background
- Estimated Resale Range: "$XX – $XX" (large)
- Suggested Buy Price: "$XX"
- Adjusted Estimated Value: "$XX" (bold, prominent)

**C. Market Data Card**
- Average Sold Price
- Demand level badge (High/Medium/Low with color coding)
- Sell Speed badge (Fast/Moderate/Slow)
- Competition Level

**D. Price Adjustments Card**
- List of adjustments, each row:
  - Reason text
  - Impact value with +/- sign
  - Green for positive, red for negative

**E. Risk Analysis Card**
- Match Confidence: circular progress or percentage bar
- Risk Flags: list of warning items with icon

**F. Listings Card**
- eBay section: Title + Description with copy button
- Depop section: Title + Description with copy button
- Listings have different tones (eBay = professional, Depop = casual)

**Bottom:**
- "Scan Another Item" button (full width)

**Functionality:**
- Copy buttons use Clipboard API with haptic feedback
- "Scan Another" returns to Scan screen
- Data saved to local history on view

### 4. History Screen (Tab)

**Layout:** Dark background. List of past scans. Each item shows thumbnail placeholder, item name, brand, estimated value, and date.

**Content:**
- Section header: "Past Scans"
- FlatList of scan cards
- Each card: item name, brand, value range, timestamp
- Empty state: "No scans yet. Start by scanning an item!"

**Functionality:**
- Tap a card → navigate to Results screen with that scan's data
- Data persisted in AsyncStorage

### 5. Settings Screen (Tab)

**Layout:** Dark background. Simple list of setting rows.

**Content:**
- App version info
- "About FlipStart" row
- "Clear History" row
- Placeholder rows for future settings

**Functionality:**
- Clear History: confirmation alert, then wipes AsyncStorage history
- Other rows are placeholders

---

## Key User Flows

### Primary Flow: Scan → Analyze → Results
1. User opens app → lands on Scan screen
2. Taps "Scan Item" or "Upload from Gallery"
3. Selects/takes a photo via image picker
4. App transitions to Loading screen (2-4s mock delay)
5. Loading screen auto-navigates to Results screen
6. User reviews all analysis sections
7. User copies listing text (eBay or Depop)
8. User taps "Scan Another Item" → back to Scan screen

### Secondary Flow: View History
1. User taps History tab
2. Sees list of past scans
3. Taps a scan → views full Results screen

---

## Color Choices

| Token | Light | Dark (Primary) | Usage |
|-------|-------|-----------------|-------|
| `background` | `#0D0D0D` | `#0D0D0D` | Main screen bg |
| `surface` | `#1A1A1A` | `#1A1A1A` | Cards, elevated surfaces |
| `foreground` | `#F5F5F5` | `#F5F5F5` | Primary text |
| `muted` | `#8A8A8A` | `#8A8A8A` | Secondary text |
| `primary` | `#00D47E` | `#00D47E` | Accent / CTA (muted green) |
| `border` | `#2A2A2A` | `#2A2A2A` | Card borders, dividers |
| `success` | `#22C55E` | `#22C55E` | Positive adjustments |
| `error` | `#EF4444` | `#EF4444` | Negative adjustments, risk flags |
| `warning` | `#F59E0B` | `#F59E0B` | Medium demand/caution |

The app is **dark-mode only** — both light and dark tokens use the same dark palette. This ensures a consistent premium feel regardless of system theme.

---

## Typography

- Headings: System font, bold, 20-28px
- Body: System font, regular, 14-16px
- Labels/Badges: System font, medium, 12-13px
- Numbers/Prices: System font, bold, 24-32px for emphasis
- All text high contrast against dark backgrounds

---

## Navigation Structure

```
Tab Bar (bottom, 3 tabs):
├── Scan (home icon) — index
├── History (clock icon) — history  
└── Settings (gear icon) — settings

Stack (from Scan):
├── Loading (modal presentation)
└── Results (push)

Stack (from History):
└── Results (push, with scan data)
```
