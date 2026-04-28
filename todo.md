# Project TODO

- [x] Configure dark-mode-only theme (theme.config.js)
- [x] Set up tab navigation with 3 tabs: Scan, History, Settings
- [x] Add icon mappings for all tabs in icon-symbol.tsx
- [x] Build Scan screen with camera placeholder and upload button
- [x] Build Loading screen with animated status text
- [x] Build Results screen with all 6 sections (Identification, Quick Decision, Market Data, Price Adjustments, Risk Analysis, Listings)
- [x] Build History screen with FlatList of past scans
- [x] Build Settings screen with placeholder rows
- [x] Create mock data matching the exact JSON structure
- [x] Implement image picker integration (camera + gallery)
- [x] Implement navigation flow: Scan → Loading → Results
- [x] Implement clipboard copy for listings with haptic feedback
- [x] Implement AsyncStorage persistence for scan history
- [x] Implement History → Results navigation
- [x] Implement Clear History in Settings
- [x] Generate custom app logo
- [x] Update app.config.ts with branding
- [x] Final testing and checkpoint

## Phase 2 — Real Functionality Upgrade

- [x] Build backend API endpoint for real AI image analysis (server's built-in LLM)
- [x] Backend: identify item from image (name, brand, category, era, style, material, wear)
- [x] Backend: research marketplace data and compute resale stats
- [x] Backend: generate eBay and Depop listing text
- [x] Backend: return full JSON result matching data structure
- [x] Update scan flow to upload image to backend instead of mock data
- [x] Update Loading screen to call real backend API
- [x] Display scanned image on Results screen
- [x] Display scanned image thumbnail on History screen cards
- [x] Make About FlipStart button functional (modal/page)
- [x] Make Rate App button functional (placeholder action)
- [x] Make Send Feedback button functional (email composer)
- [x] Make Scan History row navigate to History tab
- [x] Verify Clear History actually works and refreshes UI
- [x] Write tests for new backend endpoint
- [x] Final testing and checkpoint

## Phase 3 — Accuracy, Pricing, Speed, Loading UX, Camera UX

- [x] Fix AI identification: make prompts more conservative, avoid over-guessing sleeve length/era/details
- [x] Add confidence-based rules: use broader wording when uncertain about garment attributes
- [x] Fix pricing: make valuations more conservative and reseller-realistic
- [x] Tune pricing: common mall brands (Ralph Lauren polos, Aeropostale) valued lower
- [x] Pricing: demand/sell-speed/competition should more heavily influence suggested buy price
- [x] Pricing: oversaturated/basic items get lower estimated values
- [x] Optimize backend pipeline: reduce total scan time from ~60s
- [x] Restructure pipeline: identify → price → show results fast → generate listings in parallel
- [x] Redesign loading screen: progress bar, estimated time remaining, staged progress
- [x] Loading screen: animated, premium, no dead pauses, branded FlipStart look
- [x] Redesign camera flow: custom branded camera overlay with scan guides
- [x] Camera: themed capture controls, helper text (center item, good lighting, etc.)
- [x] Redesign photo review screen: premium retake/use-photo screen matching FlipStart theme
- [x] Preserve existing dark theme, mint green accents, and working features

## Phase 4 — Critical Regression Fixes

- [x] Fix camera: live video behavior → proper still-photo capture
- [x] Fix camera: X/close button must ONLY close, never capture
- [x] Fix camera: no auto-capture or accidental capture on dismiss
- [x] Fix camera: clear capture button for taking still image
- [x] Fix photo review: show exact captured photo, retake/use-photo flow
- [x] Fix analysis crash: "Cannot read properties of undefined (reading '0')"
- [x] Add defensive checks for missing arrays/fields in backend response
- [x] Add defensive checks for missing data in frontend (loading.tsx, results.tsx)
- [x] Improve error handling so failed analysis shows clean retry
- [x] Preserve dark theme and styling, prioritize functionality

## Phase 5 — Camera Fix: Remove CameraView, Use Native Camera

- [x] Remove custom camera.tsx screen entirely (CameraView causes live video bug in Expo Go)
- [x] Switch "Scan Item" button to use ImagePicker.launchCameraAsync() for reliable still-photo capture
- [x] Keep "Upload from Gallery" using ImagePicker.launchImageLibraryAsync()
- [x] Remove camera.tsx route from _layout.tsx
- [x] Add photo review step after capture (retake/analyze) directly in scan screen
- [x] Ensure X/close on camera just cancels without capturing
- [x] Test end-to-end: Scan Item → native camera → review → analyze

## Phase 6 — Speed Optimization & Camera Flow Fix

- [x] Optimize AI analysis to ~5 seconds total (currently too slow)
- [x] Compress image more aggressively before sending to backend
- [x] Combine identification + pricing + listings into single LLM call
- [x] Reduce prompt size and max_tokens for faster response
- [x] Use lower image resolution/quality to reduce upload time
- [x] Remove allowsEditing from launchCameraAsync to skip iOS native confirm
- [x] Single branded FlipStart review screen (no double confirmation)
- [x] Camera → FlipStart review (Retake/Analyze) → Loading → Results

## Phase 7 — Price Fix & Vintage Theme Overhaul

- [x] Fix AI prompt: price adjustments must be whole dollar amounts (not decimals)
- [x] Fix AI prompt: adjustments must mathematically add up to adjusted value
- [x] Add backend post-processing to round all price values to whole dollars
- [x] Add backend validation: base_value + sum(adjustments) = adjusted_value
- [x] Generate vintage thrift store background image (cream/beige/tan/olive)
- [x] Retheme: switch from dark green to warm vintage palette (cream, tan, soft brown, muted olive)
- [x] Update theme.config.js with new color tokens
- [x] Apply background image to all screens
- [x] Update all screen styles to match vintage aesthetic
- [x] Update loading screen colors to match new theme
- [x] Update results screen colors to match new theme
- [x] Update history screen colors to match new theme
- [x] Update settings screen colors to match new theme
- [x] Update scan screen colors to match new theme
- [x] Ensure readability on warm background
